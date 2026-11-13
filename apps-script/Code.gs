/**
 * แบบฟอร์มออนไลน์ — บริษัท เทพวัฒนา จำกัด
 * Form 1: ใบตรวจรับบรรจุภัณฑ์ (packaging incoming inspection, AQL Level II / 6.5).
 * Backend for Google Apps Script (data in Google Sheets, photos / signatures in Drive).
 *
 * Setup (once): run setupSystem() from the Apps Script editor. It creates the
 * "Online Forms Database" spreadsheet (one sheet per table) and the "Online
 * Forms Files" Drive folder and stores their IDs in Script Properties
 * (FORM_SPREADSHEET_ID, FORM_FOLDER_ID). Apps Script project name:
 * "Online Forms Thepwatana". Deploy as a web app (Execute as: me, Who has access: Anyone).
 *
 * Open site: anyone may read (bootstrap, history, one inspection, supplier
 * summary, files of an inspection) and submit an inspection without a password.
 * The name typed in the page header is sent as "actor" and recorded; writes need it.
 *
 * Password levels (Script Properties only, never in the source):
 *   FORM_QC_PASSWORD     qc     "หัวหน้า QC": approve / return pending sheets
 *   FORM_ADMIN_PASSWORD  admin  "ผู้ดูแลระบบ": qc + settings (suppliers, packaging
 *                        items, QC heads), edit / delete any sheet, audit log
 * login compares the password with both (SHA-256 digests, constant time, the
 * higher level wins) and issues a random token kept in CacheService (12 h).
 * Wrong passwords: 1 s delay each; lockout per client (5 / 15 min) and global (30 / 15 min).
 *
 * Flow of a sheet: submit -> pending ("รอหัวหน้า QC") -> approve -> approved
 * ("อนุมัติแล้ว") or return (reason) -> returned ("ตีกลับ") -> anyone may fix
 * and submit it again (same sheet no.) -> pending. Admin may edit any sheet.
 *
 * Files (inspection photos, the supplier's signed bill, signatures) are stored
 * in the Drive folder; the page gets them back through action "file" (base64),
 * only for ids that an inspection references.
 *
 * Optional: run installKeepWarmTrigger() once from the editor (10-minute
 * read-only trigger keeping the read cache hot).
 *
 * Transport (no CORS preflight): POST text/plain JSON
 *   {action, token?, actor, ...fields} -> {ok:true,data} | {ok:false,error,code}
 *   GET ?action=<public read> also works (anonymous).
 */

var SPREADSHEET_ID_PROPERTY = "FORM_SPREADSHEET_ID";
var FOLDER_ID_PROPERTY = "FORM_FOLDER_ID";
var SPREADSHEET_NAME = "Online Forms Database";
var FOLDER_NAME = "Online Forms Files";

var RESET_ACTION = "reset_data"; // not offered (kept so the shared write path stays unchanged)
var RESET_PASSWORD_PROPERTY = "FORM_ADMIN_PASSWORD";
var ROLE_PROPERTY = { qc: "FORM_QC_PASSWORD", admin: RESET_PASSWORD_PROPERTY };
var ROLE_LEVEL = { qc: 1, admin: 2 };
var ROLE_NAME = { qc: "หัวหน้า QC", admin: "ผู้ดูแลระบบ" };
var ROLE_ORDER = ["admin", "qc"];
var PUBLIC = "public";
var ACTION_ROLE = {
  bootstrap: PUBLIC, history: PUBLIC, inspection: PUBLIC, summary: PUBLIC, file: PUBLIC, batch: PUBLIC,
  submit: PUBLIC,
  approve: "qc", "return": "qc",
  supplier_save: "admin", supplier_delete: "admin", item_save: "admin", item_delete: "admin",
  head_save: "admin", head_delete: "admin", inspection_update: "admin", inspection_delete: "admin",
  logs: "admin", logs_export: "admin"
};
var SESSION_PREFIX = "FORM_SS_";
var SESSION_TTL = 43200;
var CACHE_MAX_TTL = 21600;
var SESSION_RENEW_MS = 3600000;
var FAIL_GLOBAL_KEY = "FORM_LOGIN_FAILURES";
var FAIL_CLIENT_PREFIX = "FORM_LF_";
var CLIENT_MAX_FAILURES = 5;
var GLOBAL_MAX_FAILURES = 30;
var PASSWORD_LOCK_SECONDS = 900;

var TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

var COMPANY = { name: "บริษัท เทพวัฒนา จำกัด" };
var FORM_TITLE = "ใบตรวจรับบรรจุภัณฑ์";

var STATUS_NAME = { pending: "รอหัวหน้า QC", approved: "อนุมัติแล้ว", returned: "ตีกลับ" };
var RESULT_NAME = { pass: "ผ่าน", fail: "ไม่ผ่าน" };
var DOC_PREFIX = "PI";

/* Packaging categories and their checklists (slide 2 of the brief).
 * weight: the category is weighed (sampling grid shown). strength: boxes ask 3 / 5 ชั้น. */
var CATEGORIES = [
  { key: "bottle", name: "ขวด / แกลลอน / กระปุก / ถัง / จุก / ฝา", weight: true, checks: [
    "มีโลโก้/ความคมชัด ถูกต้องตามแบรนด์", "ไม่มีโลโก้", "ไม่มีตำหนิ ไม่มีรอยรั่วซึม ตัวหนังสือชัดเจน",
    "สภาพปกติ ไม่ยุบตัว แท็กปิดสนิท ไม่มีสิ่งสกปรก", "เทียบตามมาตรฐานตัวอย่างบรรจุภัณฑ์"] },
  { key: "box", name: "กล่อง / ไส้ติ้น / แผ่นรอง-รองกล่อง", weight: true, strength: true, checks: [
    "มีโลโก้/ความคมชัด ถูกต้องตามแบรนด์ / ไม่มีโลโก้", "สีคมชัดสม่ำเสมอ สัญลักษณ์ชัดเจน",
    "เทียบตามมาตรฐานตัวอย่างบรรจุภัณฑ์"] },
  { key: "sachet", name: "ซองฟอยล์สำเร็จรูป / กระสอบ", weight: true, checks: [
    "ชื่อสินค้า/ผู้ผลิต/ผู้จัดจำหน่าย/ทะเบียน/ปริมาตร ครบถ้วน", "สัญลักษณ์ ภาพ ข้อความ / QR Code / กรอบ ISO ชัดเจน",
    "สภาพปกติไม่รั่ว ไม่ฉีกขาด สีและตัวหนังสือชัดเจน", "เทียบตามมาตรฐานตัวอย่างบรรจุภัณฑ์"] },
  { key: "label", name: "ฉลาก / สติ๊กเกอร์ / ใบแทรก / ซองฟอยล์แบบม้วน", weight: false, checks: [
    "ชื่อสินค้า/ผู้ผลิต/ผู้จัดจำหน่าย/ทะเบียน/ปริมาตร ครบถ้วน", "สัญลักษณ์ ภาพ ข้อความ / QR Code / กรอบ ISO ชัดเจน",
    "สภาพปกติ ไม่พับ ไม่ฉีกขาด สีและตัวหนังสือชัดเจน", "เทียบตามมาตรฐานตัวอย่างบรรจุภัณฑ์"] },
  { key: "bag", name: "ถุงพลาสติก", weight: true, checks: [
    "สภาพปกติไม่มีรอยฉีกขาด ไม่รั่ว ไม่มีสิ่งสกปรกหรือฝุ่น"] },
  { key: "film", name: "ชริ้งค์ฟิล์ม / เทป / ฟิล์มพันพาเลท / กาว / ลูกศร / ฟอยล์ชั้น", weight: false, checks: [
    "สภาพปกติ ไม่เสื่อม ไม่ชำรุด ไม่ฉีกขาด"] }
];

/* AQL: ISO 2859-1, General Inspection Level II, AQL 6.5 (slide 3 of the brief).
 * [lot from, lot to, code, sample size, Ac, Re]. Above 10,000 the 6.5 column
 * points back to code L, so the plan stays L / 200 / 21 / 22. A lot of 1 piece
 * is inspected whole (code A row, sample 1). */
var AQL_TABLE = [
  [2, 8, "A", 2, 0, 1], [9, 15, "B", 3, 0, 1], [16, 25, "C", 5, 0, 1], [26, 50, "D", 8, 1, 2],
  [51, 90, "E", 13, 1, 2], [91, 150, "F", 20, 2, 3], [151, 280, "G", 32, 5, 6], [281, 500, "H", 50, 7, 8],
  [501, 1200, "J", 80, 10, 11], [1201, 3200, "K", 125, 14, 15], [3201, 10000, "L", 200, 21, 22]
];
var AQL_LEVEL = "II";
var AQL_VALUE = "6.5";

var MAX_PHOTOS = 8;
var MAX_IMAGE_BYTES = 3 * 1024 * 1024; // one image after the page resized it
var MAX_LOT = 100000000;
var MAX_PERSON = 100;
var MAX_TEXT = 255;
var MAX_LONG = 2000;

/* Column definitions. Types: int, num, str, dt ("YYYY-MM-DD HH:MM:SS"); a trailing "?"
 * = null when empty. New columns are only ever APPENDED (added on first use, see table_). */
var SCHEMA = {
  suppliers: [
    ["id", "int"], ["name", "str"], ["contact", "str"], ["active", "int"], ["sort", "int"],
    ["updated_at", "dt?"], ["updated_by", "str"]
  ],
  items: [
    ["id", "int"], ["name", "str"], ["code", "str"], ["category", "str"], ["wmin", "num?"], ["wmax", "num?"],
    ["wunit", "str"], ["unit", "str"], ["active", "int"], ["updated_at", "dt?"], ["updated_by", "str"]
  ],
  heads: [
    ["id", "int"], ["name", "str"], ["active", "int"], ["updated_at", "dt?"], ["updated_by", "str"]
  ],
  inspections: [
    ["id", "int"], ["doc_no", "str"], ["status", "str"], ["received_at", "dt"],
    ["supplier_id", "int"], ["supplier_name", "str"], ["item_id", "int"], ["item_name", "str"], ["item_code", "str"],
    ["category", "str"], ["po_no", "str"], ["invoice_no", "str"], ["lot_qty", "int"], ["unit", "str"], ["lot_no", "str"],
    ["aql_code", "str"], ["sample_n", "int"], ["ac", "int"], ["re", "int"], ["defects", "int"],
    ["checks", "str"], ["cat_result", "str"], ["strength", "str"],
    ["weights", "str"], ["wmin", "num?"], ["wmax", "num?"], ["wunit", "str"], ["w_avg", "num?"], ["w_count", "int"], ["w_out", "int"],
    ["result", "str"], ["defect_detail", "str"], ["photos", "str"], ["bill_photo", "str"],
    ["inspector", "str"], ["inspector_sign", "str"], ["inspected_at", "dt"],
    ["head", "str"], ["head_sign", "str"], ["approved_at", "dt?"], ["head_comment", "str"],
    ["return_reason", "str"], ["returned_at", "dt?"],
    ["created_at", "dt"], ["created_by", "str"], ["updated_at", "dt?"], ["updated_by", "str"],
    // id the page generates per form: a retried submit (lost response) returns the first sheet
    ["req_id", "str"]
  ],
  audit_logs: [
    ["id", "int"], ["category", "str"], ["action", "str"], ["ref", "str"], ["detail", "str"],
    ["actor", "str"], ["created_at", "dt"]
  ]
};
var TABLE_ORDER = ["inspections", "suppliers", "items", "heads", "audit_logs"];
var AUTO_CREATE_TABLES = [];
var RESET_TABLES = [];

var ACT_NAME = {
  submit: "ส่งใบตรวจรับ", approve: "อนุมัติใบตรวจรับ", "return": "ตีกลับใบตรวจรับ",
  supplier_save: "ตั้งค่า Supplier", supplier_delete: "ลบ Supplier", item_save: "ตั้งค่าบรรจุภัณฑ์",
  item_delete: "ลบบรรจุภัณฑ์", head_save: "ตั้งค่าหัวหน้า QC", head_delete: "ลบหัวหน้า QC",
  inspection_update: "แก้ไขใบตรวจรับ", inspection_delete: "ลบใบตรวจรับ"
};
var LOG_CAT_NAME = { inspect: "ใบตรวจรับ", approve: "อนุมัติ / ตีกลับ", edit: "แก้ไข / ลบ", setting: "ตั้งค่า", warn: "ถูกปฏิเสธ" };

var READ_ACTIONS = ["bootstrap", "history", "inspection", "summary", "file", "logs", "logs_export", "batch"];
var BATCH_ACTIONS = ["bootstrap", "history", "summary", "inspection"];
var BATCH_MAX = 6;

var CACHED_TABLES = ["inspections", "suppliers", "items", "heads", "audit_logs"];
var VERSION_PREFIX = "FORM_V_";
var VERSION_TTL = 21600;
var RC_PREFIX = "FORM_RC_";
var READ_CACHE_TTL = 600;
var KEEP_WARM_TTL = 900;
var KEEP_WARM_MINUTES = 10;
var RC_CHUNK = 30000;
var RC_MAX_CHUNKS = 30;
var WRITE_ACTIONS = ["submit", "approve", "return", "supplier_save", "supplier_delete", "item_save", "item_delete",
  "head_save", "head_delete", "inspection_update", "inspection_delete"];

/* ===================== web app entry points ===================== */

// GET: public reads only, always anonymous (a token in a URL is never used).
// Everything else (and every request carrying a token) is POST.
function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = String(params.action || "");
  try {
    if (!action) return jsonResponse_({ ok: true, data: { service: "Online Forms API" } });
    if (READ_ACTIONS.indexOf(action) !== -1 && ACTION_ROLE[action] === PUBLIC) {
      resetRequest_("");
      REQ_.role = null;
      return jsonResponse_({ ok: true, data: runRead_(action, params) });
    }
    if (action === "login" || action === "logout" || Object.prototype.hasOwnProperty.call(ACTION_ROLE, action)) {
      throw new Error("คำสั่งนี้ต้องส่งแบบ POST");
    }
    fail_("Unknown action");
  } catch (error) {
    return errorResponse_(error);
  }
}

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (parseError) {
    return jsonResponse_({ ok: false, error: "ข้อมูลที่ส่งมาไม่ใช่ JSON ที่ถูกต้อง" });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) payload = {};
  var action = String(payload.action || "");

  var reads = null;
  var sess;
  try {
    if (action === "login") return jsonResponse_({ ok: true, data: actionLogin_(payload) });
    if (action === "logout") return jsonResponse_({ ok: true, data: actionLogout_(payload.token) });
    if (!Object.prototype.hasOwnProperty.call(ACTION_ROLE, action)) fail_("Unknown action");
    // Server-side access control on every action (never trusts the page).
    // Public actions: a missing / unknown / expired token is simply anonymous.
    sess = ACTION_ROLE[action] === PUBLIC
      ? (session_(payload.token) || { role: null })
      : requireRole_(payload.token, ACTION_ROLE[action]);
    if (READ_ACTIONS.indexOf(action) !== -1) {
      resetRequest_("");
      REQ_.role = sess.role;
      return jsonResponse_({ ok: true, data: runRead_(action, payload) });
    }
    if (payload.reads != null && payload.reads !== "") reads = parseReads_(payload.reads);
    // Every change must say who made it (name set in the page header).
    if (!actorIn_(payload)) fail_("กรุณาระบุชื่อผู้ใช้งาน (มุมขวาบน) ก่อนบันทึก", "NAME_REQUIRED");
    // Wiping all data: the admin password is typed again. Checked before taking
    // the lock so guessing (1 s delay) never blocks writers.
    if (action === RESET_ACTION) assertResetPassword_(payload.resetPassword, payload.client);
  } catch (error) {
    return errorResponse_(error);
  }
  return runWrite_(action, payload, reads, sess);
}

function actorIn_(input) {
  var v = input.actor;
  return mbSubstr_(phpTrim_(v !== null && typeof v === "object" ? "" : str_(v)), 0, MAX_PERSON);
}

function runWrite_(action, input, reads, sess) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockError) {
    return jsonResponse_({ ok: false, error: "ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง" });
  }
  var actor = actorIn_(input);
  var result;
  var start = function () {
    resetRequest_(actor);
    REQ_.role = sess.role;
  };
  try {
    start();
    try {
      result = handleWrite_(action, input);
      flush_();
      trashFiles_(REQ_.trashAfter || []);
      if (reads) versions_();
    } catch (error) {
      trashFiles_((REQ_ && REQ_.newFiles) || []);
      // Nothing buffered by the failed action is written (acts as a rollback).
      var actName = ACT_NAME[action];
      if (actName && action !== RESET_ACTION) {
        try {
          start();
          audit_("warn", action, "ปฏิเสธ" + actName + ": " + errorMessage_(error), "");
          flush_();
        } catch (ignored) {}
      }
      return errorResponse_(error);
    }
  } finally {
    lock.releaseLock();
  }
  if (reads) result.reads = afterReads_(reads);
  return jsonResponse_({ ok: true, data: result });
}

/* ===================== reads: single, batch, after a write ===================== */

function runRead_(action, p) {
  REQ_.cacheReads = true;
  return handleRead_(action, p);
}

function parseReads_(raw) {
  var list = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch (e) { fail_("reads ไม่ถูกต้อง"); }
  }
  if (!Array.isArray(list) || !list.length || list.length > BATCH_MAX) fail_("reads ไม่ถูกต้อง");
  return list.map(function (r) {
    if (typeof r === "string") r = { action: r };
    if (!r || typeof r !== "object" || Array.isArray(r)) fail_("reads ไม่ถูกต้อง");
    if (BATCH_ACTIONS.indexOf(String(r.action || "")) === -1) fail_("Unknown action");
    return r;
  });
}

function actionBatch_(p) {
  var reads = parseReads_(p.reads);
  return { results: reads.map(function (r) { return handleRead_(r.action, r); }) };
}

function afterReads_(reads) {
  try {
    REQ_.cacheReads = true;
    return reads.map(function (r) { return handleRead_(r.action, r); });
  } catch (error) {
    return null;
  }
}

/* ===================== login / sessions / passwords ===================== */

function cache_() {
  return CacheService.getScriptCache();
}

// SHA-256 of a text as signed bytes (Apps Script digest format).
function digest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
}

// Constant-time comparison of two digests (no early exit).
function sameBytes_(a, b) {
  var diff = a.length ^ b.length;
  for (var i = 0; i < a.length && i < b.length; i++) diff |= (a[i] ^ b[i]);
  return diff === 0;
}

function hex_(bytes) {
  return bytes.map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
}

// Ties a session to the password it was opened with: a changed / removed
// password ends the sessions of that level. Never the password itself.
function fingerprint_(password) {
  return hex_(digest_("online-forms-session|" + password)).slice(0, 24);
}

function passwordError_(message) {
  var error = new Error(message);
  error.passwordError = true;
  return error;
}

// Optional random id of the browser (sent by the page) for the per-client lockout.
function clientId_(v) {
  return typeof v === "string" && /^[0-9a-f]{16,64}$/.test(v) ? v : "";
}

var LOCKED_MESSAGE = "ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาที / Too many wrong attempts. Try again in 15 minutes.";

function lockoutCheck_(client) {
  var cache = cache_();
  if (Number(cache.get(FAIL_GLOBAL_KEY) || 0) >= GLOBAL_MAX_FAILURES) throw passwordError_(LOCKED_MESSAGE);
  if (client && Number(cache.get(FAIL_CLIENT_PREFIX + client) || 0) >= CLIENT_MAX_FAILURES) throw passwordError_(LOCKED_MESSAGE);
}

function recordFailure_(client) {
  var cache = cache_();
  cache.put(FAIL_GLOBAL_KEY, String(Number(cache.get(FAIL_GLOBAL_KEY) || 0) + 1), PASSWORD_LOCK_SECONDS);
  if (client) {
    var key = FAIL_CLIENT_PREFIX + client;
    cache.put(key, String(Number(cache.get(key) || 0) + 1), PASSWORD_LOCK_SECONDS);
  }
  Utilities.sleep(1000);
}

function missingPasswordsMessage_() {
  return "ยังไม่ได้ตั้งรหัสผ่านใน Script Properties (" + ROLE_ORDER.map(function (r) { return ROLE_PROPERTY[r]; }).join(", ") +
    ") กรุณาให้ผู้ดูแลระบบตั้งค่าที่ Project Settings > Script properties ก่อน";
}

// Compares a typed password with one stored password (digests, constant time).
function passwordMatches_(typed, expected) {
  var ok = sameBytes_(digest_(typeof typed === "string" ? typed : ""), digest_(expected || ""));
  return ok && typeof typed === "string" && Boolean(expected);
}

// login {password, client?} -> {token, role, role_name, expires_at, ttl}
function actionLogin_(p) {
  var client = clientId_(p.client);
  var props = PropertiesService.getScriptProperties().getProperties() || {};
  var configured = ROLE_ORDER.filter(function (r) { return Boolean(props[ROLE_PROPERTY[r]]); });
  if (!configured.length) throw passwordError_(missingPasswordsMessage_());
  lockoutCheck_(client);
  var role = null;
  ROLE_ORDER.forEach(function (r) { // every level is compared (no early exit)
    var same = passwordMatches_(p.password, props[ROLE_PROPERTY[r]]);
    if (same && !role) role = r;
  });
  if (!role) {
    recordFailure_(client);
    throw passwordError_("รหัสไม่ถูกต้อง / Incorrect password.");
  }
  if (client) {
    try { cache_().remove(FAIL_CLIENT_PREFIX + client); } catch (ignored) {}
  }
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "").toLowerCase();
  var now = Date.now();
  var exp = now + SESSION_TTL * 1000;
  try {
    cache_().put(SESSION_PREFIX + token, JSON.stringify({ r: role, e: exp, p: now, f: fingerprint_(props[ROLE_PROPERTY[role]]) }), CACHE_MAX_TTL);
  } catch (error) {
    fail_("ระบบเข้าสู่ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง");
  }
  return { token: token, role: role, role_name: ROLE_NAME[role], expires_at: exp, ttl: SESSION_TTL };
}

function actionLogout_(token) {
  if (typeof token === "string" && /^[0-9a-f]{64}$/.test(token)) {
    try { cache_().remove(SESSION_PREFIX + token); } catch (ignored) {}
  }
  return { loggedOut: true };
}

// The session of a token, or null (unknown, expired, password changed, cache error).
function session_(token) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  var key = SESSION_PREFIX + token;
  var rec;
  try { rec = JSON.parse(cache_().get(key) || "null"); } catch (error) { return null; }
  var now = Date.now();
  if (!rec || typeof rec !== "object" || !Object.prototype.hasOwnProperty.call(ROLE_LEVEL, rec.r) || !(Number(rec.e) > now)) return null;
  var pw = PropertiesService.getScriptProperties().getProperty(ROLE_PROPERTY[rec.r]) || "";
  if (!pw || fingerprint_(pw) !== rec.f) return null;
  if (!(now - Number(rec.p) < SESSION_RENEW_MS)) {
    // CacheService keeps an entry <= 6 h: renew it while the 12 h session is in use.
    rec.p = now;
    var ttl = Math.max(1, Math.min(CACHE_MAX_TTL, Math.ceil((rec.e - now) / 1000)));
    try { cache_().put(key, JSON.stringify(rec), ttl); } catch (ignored) {}
  }
  return { role: rec.r, expires_at: rec.e };
}

function requireRole_(token, need) {
  var s = session_(token);
  if (!s) {
    fail_("ต้องใส่รหัสผ่าน “" + ROLE_NAME[need] + "” ขึ้นไปก่อน (ยังไม่ได้ปลดล็อก หรือหมดเวลา)", "AUTH_REQUIRED");
  }
  if (ROLE_LEVEL[s.role] < ROLE_LEVEL[need]) {
    fail_("สิทธิ์ “" + ROLE_NAME[s.role] + "” ทำรายการนี้ไม่ได้ (ต้องเป็น “" + ROLE_NAME[need] + "”)", "FORBIDDEN");
  }
  return s;
}

// reset_data: the admin password typed again (same lockout as login).
function assertResetPassword_(password, client) {
  var expected = PropertiesService.getScriptProperties().getProperty(RESET_PASSWORD_PROPERTY) || "";
  if (!expected) {
    throw passwordError_("ยังไม่ได้ตั้งรหัสผ่านผู้ดูแลใน Script Properties (" + RESET_PASSWORD_PROPERTY +
      ") กรุณาให้ผู้ดูแลระบบตั้งค่าที่ Project Settings > Script properties ก่อน");
  }
  client = clientId_(client);
  lockoutCheck_(client);
  if (!passwordMatches_(password, expected)) {
    recordFailure_(client);
    throw passwordError_("รหัสไม่ถูกต้อง / Incorrect password.");
  }
}

/* ===================== router ===================== */

function handleRead_(action, p) {
  switch (action) {
    case "bootstrap": return actionBootstrap_();
    case "history": return { items: queryHistory_(p) };
    case "inspection": return actionInspection_(p);
    case "summary": return actionSummary_(p);
    case "file": return actionFile_(p);
    case "logs": return { items: queryLogs_(p) };
    case "logs_export": return exportLogs_(queryLogs_(p));
    case "batch": return actionBatch_(p);
  }
  fail_("Unknown action");
}

function handleWrite_(action, input) {
  switch (action) {
    case "submit": return actionSubmit_(input, false);
    case "inspection_update": return actionSubmit_(input, true);
    case "approve": return actionDecide_(input, true);
    case "return": return actionDecide_(input, false);
    case "inspection_delete": return actionInspectionDelete_(input);
    case "supplier_save": return actionListSave_("suppliers", input);
    case "item_save": return actionListSave_("items", input);
    case "head_save": return actionListSave_("heads", input);
    case "supplier_delete": return actionListDelete_("suppliers", input);
    case "item_delete": return actionListDelete_("items", input);
    case "head_delete": return actionListDelete_("heads", input);
  }
  fail_("Unknown action");
}

/* ===================== AQL / categories ===================== */

// Sampling plan for a lot size: {code, n, ac, re}, or null for an invalid lot.
function aql_(lot) {
  lot = Number(lot);
  if (!(lot >= 1) || Math.floor(lot) !== lot) return null;
  if (lot === 1) return { code: "A", n: 1, ac: 0, re: 1 };
  for (var i = 0; i < AQL_TABLE.length; i++) {
    var r = AQL_TABLE[i];
    if (lot >= r[0] && lot <= r[1]) return { code: r[2], n: r[3], ac: r[4], re: r[5] };
  }
  var last = AQL_TABLE[AQL_TABLE.length - 1];
  return { code: last[2], n: last[3], ac: last[4], re: last[5] };
}

function category_(key) {
  for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].key === key) return CATEGORIES[i];
  return null;
}

/* ===================== reads ===================== */

function activeList_(name) {
  return table_(name).rows.filter(function (r) { return r.active; });
}

function actionBootstrap_() {
  var data = cachedDerived_("boot", ["suppliers", "items", "heads", "inspections"], function () {
    var byName = function (a, b) { return String(a.name).localeCompare(String(b.name), "th"); };
    return {
      suppliers: table_("suppliers").rows.map(plain_).sort(function (a, b) { return (a.sort - b.sort) || byName(a, b); }),
      items: table_("items").rows.map(plain_).sort(byName),
      heads: table_("heads").rows.map(plain_).sort(byName),
      pending: table_("inspections").rows.filter(function (r) { return r.status === "pending"; }).length
    };
  });
  return {
    company: COMPANY, form_title: FORM_TITLE, role: REQ_.role || null, role_name: REQ_.role ? ROLE_NAME[REQ_.role] : "",
    suppliers: data.suppliers, items: data.items, heads: data.heads, pending: data.pending,
    categories: CATEGORIES, aql: { level: AQL_LEVEL, value: AQL_VALUE, table: AQL_TABLE },
    statuses: STATUS_NAME, results: RESULT_NAME, max_photos: MAX_PHOTOS, now: nowParts_().datetime
  };
}

// The list fields of a sheet (history, pending list).
function listRow_(r) {
  return {
    id: r.id, doc_no: r.doc_no, status: r.status, received_at: r.received_at, supplier_name: r.supplier_name,
    item_name: r.item_name, item_code: r.item_code, category: r.category, po_no: r.po_no, invoice_no: r.invoice_no,
    lot_no: r.lot_no, lot_qty: r.lot_qty, unit: r.unit, sample_n: r.sample_n, defects: r.defects, result: r.result,
    inspector: r.inspector, head: r.head, approved_at: r.approved_at, return_reason: r.return_reason
  };
}

// history {q, supplier_id, item_id, status, result, from, to} -> newest first
function queryHistory_(p) {
  var from = phpEmpty_(p.from) ? null : str_(p.from) + " 00:00:00";
  var to = phpEmpty_(p.to) ? null : str_(p.to) + " 23:59:59";
  var sup = phpEmpty_(p.supplier_id) ? null : phpInt_(p.supplier_id);
  var item = phpEmpty_(p.item_id) ? null : phpInt_(p.item_id);
  var st = phpEmpty_(p.status) ? null : str_(p.status);
  var res = phpEmpty_(p.result) ? null : str_(p.result);
  var q = phpEmpty_(p.q) ? null : likeMatcher_(str_(p.q));
  return table_("inspections").rows.filter(function (r) {
    if (from !== null && !(r.received_at >= from)) return false;
    if (to !== null && !(r.received_at <= to)) return false;
    if (sup !== null && r.supplier_id !== sup) return false;
    if (item !== null && r.item_id !== item) return false;
    if (st !== null && r.status !== st) return false;
    if (res !== null && r.result !== res) return false;
    if (q && !(q(r.doc_no) || q(r.po_no) || q(r.invoice_no) || q(r.lot_no) || q(r.item_name) || q(r.item_code) || q(r.supplier_name) || q(r.inspector))) return false;
    return true;
  }).sort(function (a, b) {
    return a.received_at < b.received_at ? 1 : a.received_at > b.received_at ? -1 : b.id - a.id;
  }).slice(0, 2000).map(listRow_);
}

function jsonArr_(text) {
  try {
    var v = JSON.parse(text || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function fullRow_(r) {
  var o = plain_(r);
  o.checks = jsonArr_(r.checks);
  o.weights = jsonArr_(r.weights);
  o.photos = jsonArr_(r.photos);
  return o;
}

function findInspection_(id) {
  id = phpInt_(id);
  var found = null;
  table_("inspections").rows.forEach(function (r) { if (r.id === id) found = r; });
  if (!found) fail_("ไม่พบใบตรวจรับนี้ (อาจถูกลบไปแล้ว)");
  return found;
}

function actionInspection_(p) {
  return { inspection: fullRow_(findInspection_(p.id)) };
}

// summary {from, to}: per supplier, sheets that were submitted (not returned) in the range.
function actionSummary_(p) {
  var from = phpEmpty_(p.from) ? null : str_(p.from) + " 00:00:00";
  var to = phpEmpty_(p.to) ? null : str_(p.to) + " 23:59:59";
  var by = {};
  var order = [];
  // One row per supplier id (a renamed supplier stays one row), shown with the current settings name.
  var names = {};
  table_("suppliers").rows.forEach(function (x) { names[x.id] = x.name; });
  table_("inspections").rows.forEach(function (r) {
    if (r.status === "returned") return;
    if (from !== null && !(r.received_at >= from)) return;
    if (to !== null && !(r.received_at <= to)) return;
    var key = String(r.supplier_id);
    if (!by[key]) { by[key] = { supplier_id: r.supplier_id, supplier: names[r.supplier_id] || r.supplier_name, total: 0, fail: 0, pending: 0, last_fail: "" }; order.push(key); }
    var s = by[key];
    s.total++;
    if (r.status === "pending") s.pending++;
    if (r.result === "fail") {
      s.fail++;
      if (r.received_at > s.last_fail) s.last_fail = r.received_at;
    }
  });
  var rows = order.map(function (k) {
    var s = by[k];
    s.pct = s.total ? Math.round(s.fail * 1000 / s.total) / 10 : 0;
    return s;
  }).sort(function (a, b) { return (b.pct - a.pct) || (b.fail - a.fail) || (b.total - a.total) || String(a.supplier).localeCompare(String(b.supplier), "th"); });
  var total = rows.reduce(function (a, s) { return a + s.total; }, 0);
  var fail = rows.reduce(function (a, s) { return a + s.fail; }, 0);
  return { rows: rows, total: total, fail: fail, pct: total ? Math.round(fail * 1000 / total) / 10 : 0 };
}

// file {id}: an image of an inspection -> {mime, data (base64)}. Only ids that an
// inspection references are served (never an arbitrary Drive file).
function actionFile_(p) {
  var id = str_(p.id);
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(id)) fail_("ไม่พบไฟล์");
  var used = table_("inspections").rows.some(function (r) {
    return r.bill_photo === id || r.inspector_sign === id || r.head_sign === id || jsonArr_(r.photos).indexOf(id) !== -1;
  });
  if (!used) fail_("ไม่พบไฟล์");
  var blob;
  try {
    blob = DriveApp.getFileById(id).getBlob();
  } catch (e) {
    fail_("เปิดไฟล์ไม่ได้ (อาจถูกลบจาก Google Drive)");
  }
  return { id: id, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function queryLogs_(p) {
  var from = phpEmpty_(p.from) ? null : str_(p.from) + " 00:00:00";
  var to = phpEmpty_(p.to) ? null : str_(p.to) + " 23:59:59";
  var cat = phpEmpty_(p.cat) ? null : str_(p.cat);
  var q = phpEmpty_(p.q) ? null : likeMatcher_(str_(p.q));
  return table_("audit_logs").rows.filter(function (l) {
    if (from !== null && !(l.created_at >= from)) return false;
    if (to !== null && !(l.created_at <= to)) return false;
    if (cat !== null && !eqCi_(l.category, cat)) return false;
    if (q && !(q(l.detail) || q(l.ref) || q(l.actor))) return false;
    return true;
  }).sort(function (a, b) { return b.id - a.id; }).slice(0, 3000).map(plain_);
}

function exportLogs_(items) {
  var lines = [csvLine_(["ลำดับ", "วันที่", "เวลา", "หมวด", "เลขที่อ้างอิง", "รายละเอียด", "ผู้ทำรายการ"])];
  items.forEach(function (r) {
    lines.push(csvLine_([r.id, r.created_at.slice(0, 10), r.created_at.slice(11, 19), LOG_CAT_NAME[r.category] || r.category,
      r.ref, csvText_(r.detail), csvText_(r.actor)]));
  });
  return { filename: "online_forms_log_" + stamp_() + ".csv", csv: lines.join("") };
}

function csvText_(v) {
  var s = String(v == null ? "" : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/* ===================== files (Drive) ===================== */

function folder_() {
  var id = PropertiesService.getScriptProperties().getProperty(FOLDER_ID_PROPERTY);
  if (!id) fail_("ยังไม่ได้ตั้งค่าโฟลเดอร์ไฟล์ กรุณารัน setupSystem() อีกครั้ง");
  return DriveApp.getFolderById(id);
}

// Checks an image data URL and returns {mime, b64} (nothing is written yet).
function imageIn_(v, label) {
  var m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(typeof v === "string" ? v : "");
  if (!m) fail_(label + ": ไฟล์ต้องเป็นรูปภาพ (JPG / PNG)");
  if (Math.floor(m[2].length * 3 / 4) > MAX_IMAGE_BYTES) fail_(label + ": รูปใหญ่เกินไป");
  return { mime: m[1], b64: m[2] };
}

// Writes a checked image to the Drive folder; the file is registered in REQ_ so a
// failing request trashes what it created.
function saveImage_(img, name) {
  var ext = img.mime === "image/png" ? ".png" : img.mime === "image/webp" ? ".webp" : ".jpg";
  var blob = Utilities.newBlob(Utilities.base64Decode(img.b64), img.mime, name + ext);
  var file = folder_().createFile(blob);
  (REQ_.newFiles = REQ_.newFiles || []).push(file.getId());
  return file.getId();
}

function trashFiles_(ids) {
  ids.forEach(function (id) {
    if (!id) return;
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
  });
}

/* ===================== submit / edit ===================== */

function numOrNull_(v, label) {
  if (v === null || v === undefined || v === "") return null;
  var x = Number(String(v).replace(/,/g, ""));
  if (!isFinite(x) || x < 0 || x > 1000000) fail_(label + " ไม่ถูกต้อง");
  return Math.round(x * 1000) / 1000;
}

function intIn_(v, label, min, max) {
  var s = String(v == null ? "" : v).replace(/,/g, "").trim();
  if (!/^\d+$/.test(s)) fail_("กรุณากรอก" + label + "เป็นจำนวนเต็ม");
  var n = Number(s);
  if (n < min || n > max) fail_(label + "ต้องอยู่ระหว่าง " + min + " ถึง " + max);
  return n;
}

function requiredText_(input, key, max, label) {
  var v = textIn_(input, key, max, label);
  if (v === "") fail_("กรุณากรอก" + label);
  return v;
}

function pickActive_(name, id, label, keepId) {
  id = phpInt_(id);
  var row = null;
  table_(name).rows.forEach(function (r) { if (r.id === id) row = r; });
  if (!row || (!row.active && id !== keepId)) fail_("กรุณาเลือก" + label + "จากรายการ");
  return row;
}

/* submit (public): a new sheet, or a returned sheet sent again (id + status returned).
 * inspection_update (admin): any sheet, status unchanged.
 * Fields: received_date, received_time, supplier_id, item_id, po_no, invoice_no, lot_qty, unit, lot_no,
 * defects, checks[] (booleans of the category checklist), cat_result pass|fail, strength "3"|"5"|"",
 * weights[] (numbers or null, at most the sample size), wmin, wmax, result pass|fail, defect_detail,
 * photos[] (new image data URLs or ids of this sheet's photos to keep), bill_photo (data URL or the kept id),
 * inspector, inspector_sign (data URL or the kept id). */
function actionSubmit_(input, admin) {
  var old = null;
  if (!phpEmpty_(input.id)) {
    old = findInspection_(input.id);
    if (!admin && old.status !== "returned") fail_("ใบนี้ไม่ได้อยู่ในสถานะตีกลับ จึงแก้ไขไม่ได้ (" + STATUS_NAME[old.status] + ")");
  } else if (admin) {
    fail_("ไม่พบใบตรวจรับนี้");
  }
  var reqId = str_(input.req_id);
  if (reqId !== "" && !/^[A-Za-z0-9_-]{8,64}$/.test(reqId)) fail_("req_id ไม่ถูกต้อง");
  if (!old && reqId !== "") {
    var dup = null;
    table_("inspections").rows.forEach(function (x) { if (x.req_id === reqId) dup = x; });
    if (dup) return { id: dup.id, doc_no: dup.doc_no, status: dup.status, duplicate: true, message: "ใบตรวจรับ " + dup.doc_no + " ถูกบันทึกไว้แล้ว" };
  }
  var f = {};
  f.received_at = moment_({ date: input.received_date, time: input.received_time });
  var sup = pickActive_("suppliers", input.supplier_id, "Supplier ", old ? old.supplier_id : null);
  var item = pickActive_("items", input.item_id, "รายการบรรจุภัณฑ์ ", old ? old.item_id : null);
  // An edited sheet keeps the names / category it was recorded with unless the supplier / item is changed.
  var sameItem = old && item.id === old.item_id;
  var cat = category_(sameItem ? old.category : item.category);
  if (!cat) fail_("รายการบรรจุภัณฑ์นี้ยังไม่ได้กำหนดหมวด กรุณาแก้ที่หน้าตั้งค่า");
  f.supplier_id = sup.id; f.supplier_name = old && sup.id === old.supplier_id ? old.supplier_name : sup.name;
  f.item_id = item.id; f.item_name = sameItem ? old.item_name : item.name; f.item_code = sameItem ? old.item_code : item.code; f.category = cat.key;
  f.po_no = requiredText_(input, "po_no", 60, "เลขที่ใบสั่งซื้อ (PO)");
  f.invoice_no = requiredText_(input, "invoice_no", 60, "เลขที่ใบส่งของ");
  f.lot_no = requiredText_(input, "lot_no", 60, "เลขที่ Lot / Batch");
  f.lot_qty = intIn_(input.lot_qty, "จำนวนที่ส่งมอบ", 1, MAX_LOT);
  f.unit = textIn_(input, "unit", 30, "หน่วย") || item.unit || "ชิ้น";
  var plan = aql_(f.lot_qty);
  f.aql_code = plan.code; f.sample_n = plan.n; f.ac = plan.ac; f.re = plan.re;
  f.defects = intIn_(input.defects == null || input.defects === "" ? "0" : input.defects, "จำนวนของเสียที่พบ", 0, plan.n);

  var checks = Array.isArray(input.checks) ? input.checks : [];
  f.checks = JSON.stringify(cat.checks.map(function (c, i) { return checks[i] === true; }));
  f.cat_result = str_(input.cat_result);
  if (f.cat_result !== "pass" && f.cat_result !== "fail") fail_("กรุณาเลือกผลตรวจของหมวดบรรจุภัณฑ์ (Pass / Fail)");
  f.strength = cat.strength && (input.strength === "3" || input.strength === "5") ? input.strength : "";

  // weight sampling (weighed categories only)
  var weights = [];
  f.wmin = null; f.wmax = null; f.wunit = ""; f.w_avg = null; f.w_count = 0; f.w_out = 0;
  if (cat.weight) {
    var raw = Array.isArray(input.weights) ? input.weights : [];
    if (raw.length > plan.n) fail_("กรอกน้ำหนักได้ไม่เกินจำนวนตัวอย่าง (" + plan.n + " ชิ้น)");
    weights = raw.map(function (w, i) { return numOrNull_(w, "น้ำหนักชิ้นที่ " + (i + 1)); });
    f.wmin = numOrNull_(input.wmin, "น้ำหนักต่ำสุด");
    f.wmax = numOrNull_(input.wmax, "น้ำหนักสูงสุด");
    if (f.wmin !== null && f.wmax !== null && f.wmin > f.wmax) fail_("น้ำหนักต่ำสุดต้องไม่มากกว่าน้ำหนักสูงสุด");
    f.wunit = textIn_(input, "wunit", 10, "หน่วยน้ำหนัก") || item.wunit || "g";
    var sum = 0;
    weights.forEach(function (w) {
      if (w === null) return;
      f.w_count++;
      sum += w;
      if ((f.wmin !== null && w < f.wmin) || (f.wmax !== null && w > f.wmax)) f.w_out++;
    });
    f.w_avg = f.w_count ? Math.round(sum / f.w_count * 1000) / 1000 : null;
  }
  while (weights.length && weights[weights.length - 1] === null) weights.pop();
  f.weights = JSON.stringify(weights);

  f.result = str_(input.result);
  if (f.result !== "pass" && f.result !== "fail") fail_("กรุณาเลือกผลการตรวจรับรวม (ผ่าน / ไม่ผ่าน)");
  f.defect_detail = textIn_(input, "defect_detail", MAX_LONG, "รายละเอียดข้อบกพร่อง");
  if (f.result === "fail" && f.defect_detail === "") fail_("ผลไม่ผ่าน: กรุณากรอกรายละเอียดข้อบกพร่อง / การดำเนินการ");
  f.inspector = requiredText_(input, "inspector", MAX_PERSON, "ชื่อผู้ตรวจรับ");

  // images: check everything first, then write (nothing reaches Drive when a field is wrong)
  var oldPhotos = old ? jsonArr_(old.photos) : [];
  var photosIn = Array.isArray(input.photos) ? input.photos : [];
  if (photosIn.length > MAX_PHOTOS) fail_("แนบรูปได้ไม่เกิน " + MAX_PHOTOS + " รูป");
  var photoPlan = photosIn.map(function (v, i) {
    if (typeof v === "string" && oldPhotos.indexOf(v) !== -1) return { keep: v };
    return { img: imageIn_(v, "รูปที่ " + (i + 1)) };
  });
  var keepOr = function (v, oldId, label, required) {
    if (old && typeof v === "string" && v !== "" && v === oldId) return { keep: v };
    if ((v === "" || v == null) && !required) return { none: true };
    if (v === "" || v == null) fail_("กรุณาแนบ" + label);
    return { img: imageIn_(v, label) };
  };
  var billPlan = keepOr(input.bill_photo, old ? old.bill_photo : "", "รูปบิลที่ Supplier ลงชื่อ", true);
  var signPlan = keepOr(input.inspector_sign, old ? old.inspector_sign : "", "ลายเซ็นผู้ตรวจรับ", true);

  var docNo = old ? old.doc_no : nextNo_(DOC_PREFIX, "inspections", "doc_no");
  var photoIds = photoPlan.map(function (pl, i) { return pl.keep || saveImage_(pl.img, docNo + "-photo-" + (i + 1)); });
  f.photos = JSON.stringify(photoIds);
  f.bill_photo = billPlan.keep || saveImage_(billPlan.img, docNo + "-bill");
  f.inspector_sign = signPlan.keep || saveImage_(signPlan.img, docNo + "-sign-inspector");

  var now = nowParts_().datetime;
  var row;
  if (!old) {
    f.doc_no = docNo; f.status = "pending"; f.inspected_at = now;
    f.head = ""; f.head_sign = ""; f.approved_at = null; f.head_comment = ""; f.return_reason = ""; f.returned_at = null;
    f.created_at = now; f.created_by = REQ_.actor; f.updated_at = null; f.updated_by = ""; f.req_id = reqId;
    row = insert_("inspections", f);
    audit_("inspect", "submit", "ส่งใบตรวจรับ " + docNo + ": " + f.supplier_name + " · " + f.item_name + " · Lot " + f.lot_no +
      " · " + f.lot_qty + " " + f.unit + " · ผล" + RESULT_NAME[f.result], docNo);
  } else {
    var dropped = oldPhotos.filter(function (id) { return photoIds.indexOf(id) === -1; });
    if (old.bill_photo && old.bill_photo !== f.bill_photo) dropped.push(old.bill_photo);
    if (old.inspector_sign && old.inspector_sign !== f.inspector_sign) dropped.push(old.inspector_sign);
    f.updated_at = now; f.updated_by = REQ_.actor;
    if (!admin) { // back to the QC heads: the return details stay in the audit log
      f.status = "pending"; f.inspected_at = now;
      f.head = ""; f.return_reason = ""; f.returned_at = null;
    }
    update_("inspections", old, f);
    row = old;
    REQ_.trashAfter = dropped;
    audit_(admin ? "edit" : "inspect", admin ? "inspection_update" : "submit",
      (admin ? "แก้ไขใบตรวจรับ " : "ส่งใบตรวจรับที่แก้ไขแล้วอีกครั้ง ") + docNo + " · ผล" + RESULT_NAME[f.result], docNo);
  }
  return { id: row.id, doc_no: docNo, status: row.status, message: (old && admin ? "บันทึกการแก้ไข " : "ส่งใบตรวจรับ ") + docNo + " แล้ว" + (row.status === "pending" ? " — รอหัวหน้า QC อนุมัติ" : "") };
}

/* approve {id, head_id, sign (data URL), comment} / return {id, head_id, reason} (qc). */
function actionDecide_(input, approve) {
  var r = findInspection_(input.id);
  if (r.status !== "pending") fail_("ใบ " + r.doc_no + " ไม่ได้รออนุมัติแล้ว (" + STATUS_NAME[r.status] + ") — อาจมีหัวหน้าท่านอื่นดำเนินการไปแล้ว");
  var head = pickActive_("heads", input.head_id, "ชื่อหัวหน้า QC ", null);
  var now = nowParts_().datetime;
  if (approve) {
    var img = imageIn_(input.sign, "ลายเซ็นหัวหน้า QC");
    var comment = textIn_(input, "comment", MAX_LONG, "ความเห็น");
    var signId = saveImage_(img, r.doc_no + "-sign-qc");
    update_("inspections", r, { status: "approved", head: head.name, head_sign: signId, approved_at: now, head_comment: comment, updated_at: now, updated_by: REQ_.actor });
    audit_("approve", "approve", "อนุมัติใบตรวจรับ " + r.doc_no + " โดย " + head.name + (comment ? " · " + comment : ""), r.doc_no);
    return { id: r.id, doc_no: r.doc_no, status: "approved", message: "อนุมัติใบ " + r.doc_no + " แล้ว" };
  }
  var reason = requiredText_(input, "reason", MAX_LONG, "เหตุผลที่ตีกลับ");
  update_("inspections", r, { status: "returned", head: head.name, return_reason: reason, returned_at: now, updated_at: now, updated_by: REQ_.actor });
  audit_("approve", "return", "ตีกลับใบตรวจรับ " + r.doc_no + " โดย " + head.name + ": " + reason, r.doc_no);
  return { id: r.id, doc_no: r.doc_no, status: "returned", message: "ตีกลับใบ " + r.doc_no + " แล้ว" };
}

function actionInspectionDelete_(input) {
  var r = findInspection_(input.id);
  var files = jsonArr_(r.photos).concat([r.bill_photo, r.inspector_sign, r.head_sign]);
  delete_("inspections", r);
  REQ_.trashAfter = files;
  audit_("edit", "inspection_delete", "ลบใบตรวจรับ " + r.doc_no + " (" + r.supplier_name + " · " + r.item_name + " · Lot " + r.lot_no + ")", r.doc_no);
  return { deleted: true, message: "ลบใบ " + r.doc_no + " แล้ว" };
}

/* ===================== settings lists (admin) ===================== */

var LIST_LABEL = { suppliers: "Supplier", items: "บรรจุภัณฑ์", heads: "หัวหน้า QC" };

// supplier_save {id?, name, contact, sort, active} / item_save {id?, name, code, category, wmin, wmax, wunit, unit, active}
// head_save {id?, name, active}
function actionListSave_(name, input) {
  var label = LIST_LABEL[name];
  var rows = table_(name).rows;
  var row = null;
  if (!phpEmpty_(input.id)) {
    var id = phpInt_(input.id);
    rows.forEach(function (r) { if (r.id === id) row = r; });
    if (!row) fail_("ไม่พบ" + label + "นี้");
  }
  var f = { name: requiredText_(input, "name", 150, "ชื่อ" + label) };
  rows.forEach(function (r) {
    if (r !== row && eqCi_(r.name, f.name) && (name !== "items" || eqCi_(r.code, str_(input.code)))) fail_("มี" + label + "ชื่อนี้อยู่แล้ว: " + r.name);
  });
  f.active = input.active === undefined || input.active === null || input.active === "" ? 1 : (phpTruthy_(input.active) && input.active !== "0" ? 1 : 0);
  if (name === "suppliers") {
    f.contact = textIn_(input, "contact", MAX_TEXT, "ผู้ติดต่อ / เบอร์โทร");
    f.sort = phpEmpty_(input.sort) ? (row ? row.sort : 0) : phpInt_(input.sort);
  } else if (name === "items") {
    f.code = textIn_(input, "code", 60, "รหัสสินค้า");
    f.category = str_(input.category);
    if (!category_(f.category)) fail_("กรุณาเลือกหมวดบรรจุภัณฑ์");
    f.wmin = numOrNull_(input.wmin, "น้ำหนักต่ำสุด");
    f.wmax = numOrNull_(input.wmax, "น้ำหนักสูงสุด");
    if (f.wmin !== null && f.wmax !== null && f.wmin > f.wmax) fail_("น้ำหนักต่ำสุดต้องไม่มากกว่าน้ำหนักสูงสุด");
    f.wunit = textIn_(input, "wunit", 10, "หน่วยน้ำหนัก") || "g";
    f.unit = textIn_(input, "unit", 30, "หน่วยนับ") || "ชิ้น";
  }
  f.updated_at = nowParts_().datetime;
  f.updated_by = REQ_.actor;
  if (row) update_(name, row, f);
  else row = insert_(name, f);
  audit_("setting", name.slice(0, -1) + "_save", (row.id && !phpEmpty_(input.id) ? "แก้ไข" : "เพิ่ม") + label + ": " + f.name + (f.active ? "" : " (ปิดใช้งาน)"), "");
  return { id: row.id, message: "บันทึก" + label + " " + f.name + " แล้ว" };
}

// Deleting a list entry that sheets refer to only deactivates it (history keeps the stored names).
function actionListDelete_(name, input) {
  var label = LIST_LABEL[name];
  var id = phpInt_(input.id);
  var row = null;
  table_(name).rows.forEach(function (r) { if (r.id === id) row = r; });
  if (!row) fail_("ไม่พบ" + label + "นี้");
  var used = false;
  if (name !== "heads") {
    var col = name === "suppliers" ? "supplier_id" : "item_id";
    used = table_("inspections").rows.some(function (r) { return r[col] === id; });
  }
  if (used) {
    update_(name, row, { active: 0, updated_at: nowParts_().datetime, updated_by: REQ_.actor });
    audit_("setting", name.slice(0, -1) + "_delete", "ปิดใช้งาน" + label + ": " + row.name + " (มีใบตรวจรับอ้างถึง)", "");
    return { deleted: false, deactivated: true, message: label + " " + row.name + " มีใบตรวจรับอ้างถึง จึงปิดใช้งานแทนการลบ" };
  }
  delete_(name, row);
  audit_("setting", name.slice(0, -1) + "_delete", "ลบ" + label + ": " + row.name, "");
  return { deleted: true, message: "ลบ" + label + " " + row.name + " แล้ว" };
}

/* ===================== helpers ===================== */

// date/time from the client (default: now), "YYYY-MM-DD" + "HH:MM".
function moment_(input) {
  var now = nowParts_();
  var d = input.date == null || input.date === "" ? now.date : safeStr_(input.date);
  var t = input.time == null || input.time === "" ? now.time : safeStr_(input.time);
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})$/.exec(d + " " + t.slice(0, 5));
  if (!m) fail_("วันที่/เวลาไม่ถูกต้อง");
  var Y = Number(m[1]), M = Number(m[2]), D = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
  var dt = new Date(Date.UTC(Y, M - 1, D, h, mi, 0));
  if (Y < 2000 || dt.getUTCMonth() !== M - 1 || dt.getUTCDate() !== D || h > 23 || mi > 59) fail_("วันที่/เวลาไม่ถูกต้อง");
  return formatUtcParts_(dt).datetime.slice(0, 16) + ":00";
}

// Next running number for today's tag (audit refs scanned too, so a number
// freed by a delete is never handed out again).
function nextNo_(prefix, table, col) {
  var tag = prefix + "-" + nowParts_().ymd + "-";
  var max = 0;
  var scan = function (v) {
    var s = String(v || "").toUpperCase();
    if (s.indexOf(tag) !== 0) return;
    var n = parseInt(s.slice(tag.length), 10);
    if (n > max) max = n;
  };
  table_(table).rows.forEach(function (r) { scan(r[col]); });
  table_("audit_logs").rows.forEach(function (l) { scan(l.ref); });
  var next = max + 1;
  return tag + ("0000" + next).slice(-Math.max(4, String(next).length));
}

function audit_(category, action, detail, ref) {
  insert_("audit_logs", {
    category: category, action: action, ref: ref || "",
    detail: mbSubstr_(detail, 0, 500),
    actor: REQ_.actor || "",
    created_at: nowParts_().datetime
  });
}

function textIn_(input, key, max, label) {
  var value = phpTrim_(safeStr_(input[key]));
  if (mbLen_(value) > max) fail_(label + "ยาวเกิน " + max + " ตัวอักษร");
  return value;
}

function dtTh_(s) {
  return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + (Number(s.slice(0, 4)) + 543) + " " + s.slice(11, 16) + " น.";
}

/* ===================== sheet storage ===================== */

var REQ_ = null; // per-request state: spreadsheet, loaded tables, pending writes

// actor: the name typed in the page header ("" when none).
function resetRequest_(actor) {
  REQ_ = {
    ss: null, tables: {}, appends: {}, updates: [], deletes: [], actor: actor || "",
    dirty: {},          // sheets changed outside the buffers (reset_data) -> version bump on flush
    cacheReads: false,  // true only while answering read actions
    refreshCache: false, // keepWarm: read the sheets live and store them again (fresh TTL)
    vers: null          // data versions read for this request (see versions_)
  };
}

function db_() {
  if (!REQ_.ss) {
    var id = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY);
    if (!id) throw new Error("ยังไม่ได้ตั้งค่าระบบ กรุณารัน setupSystem() ใน Apps Script ก่อน");
    REQ_.ss = SpreadsheetApp.openById(id);
  }
  return REQ_.ss;
}

// Reads the whole sheet once per request and converts rows to typed objects.
// Sheets in AUTO_CREATE_TABLES are created when missing, and columns added to
// SCHEMA after a sheet was created are appended to its header row (existing
// rows read them as empty), so an older live spreadsheet upgrades itself.
function table_(name) {
  if (REQ_.tables[name]) return REQ_.tables[name];
  var cacheable = REQ_.cacheReads && CACHED_TABLES.indexOf(name) !== -1;
  var ver = null;
  if (cacheable) {
    ver = versions_()[name] || null; // taken BEFORE the sheet is read
    var hit = ver && !REQ_.refreshCache ? cachedRows_(name, ver) : null;
    if (hit) return (REQ_.tables[name] = hit);
  }
  var sheet = db_().getSheetByName(name);
  if (!sheet && AUTO_CREATE_TABLES.indexOf(name) !== -1) sheet = prepareSheet_(db_(), name, null);
  if (!sheet) throw new Error('ไม่พบชีต "' + name + '" กรุณารัน setupSystem() อีกครั้ง');
  var values = sheet.getDataRange().getValues();
  var header = (values[0] || []).map(function (h) { return String(h).trim(); });
  var cols = SCHEMA[name];
  var idx = cols.map(function (c) { return header.indexOf(c[0]); });
  if (idx.indexOf(-1) !== -1) {
    if (!header.some(function (h) { return h !== ""; })) {
      throw new Error('หัวตารางของชีต "' + name + '" ไม่ครบ กรุณารัน setupSystem()');
    }
    header = addMissingColumns_(sheet, name, header);
    idx = cols.map(function (c) { return header.indexOf(c[0]); });
  }
  var rows = [];
  var maxId = 0;
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    var empty = true;
    for (var k = 0; k < raw.length; k++) if (raw[k] !== "" && raw[k] !== null) { empty = false; break; }
    if (empty) continue;
    var obj = {};
    cols.forEach(function (col, i) { obj[col[0]] = fromCell_(col[1], raw[idx[i]]); });
    Object.defineProperty(obj, "_row", { value: r + 1, writable: true, enumerable: false });
    if (obj.id > maxId) maxId = obj.id;
    rows.push(obj);
  }
  // values: the raw sheet rows, so flush_ can update a row without reading it again.
  REQ_.tables[name] = { name: name, sheet: sheet, header: header, idx: idx, rows: rows, maxId: maxId, values: values };
  if (ver) storeRows_(name, ver, rows);
  return REQ_.tables[name];
}

/* ---------- read cache helpers (see CACHED_TABLES) ---------- */

function newVersion_() {
  return Date.now().toString(36) + "." + Utilities.getUuid().replace(/-/g, "").slice(0, 12);
}

// The current data version of every cached sheet (one CacheService call per
// request). A missing version (evicted / first use) gets a new random one, so
// nothing stored under an older version can match it. Cache errors disable the
// read cache for the request ({}).
function versions_() {
  if (REQ_.vers) return REQ_.vers;
  var vers = {};
  try {
    var keys = CACHED_TABLES.map(function (n) { return VERSION_PREFIX + n; });
    var got = cache_().getAll(keys) || {};
    var missing = {};
    CACHED_TABLES.forEach(function (n) {
      var v = got[VERSION_PREFIX + n];
      if (!v) { v = newVersion_(); missing[VERSION_PREFIX + n] = v; }
      vers[n] = v;
    });
    if (Object.keys(missing).length) cache_().putAll(missing, VERSION_TTL);
  } catch (error) {
    vers = {};
  }
  REQ_.vers = vers;
  return vers;
}

// Gives every named (cached) sheet a new data version. Called after the
// changes are flushed to the spreadsheet. If the cache cannot be updated the
// versions are removed instead (readers then start new ones).
function bumpVersions_(names) {
  var map = {};
  names.forEach(function (n) { if (CACHED_TABLES.indexOf(n) !== -1) map[VERSION_PREFIX + n] = newVersion_(); });
  var keys = Object.keys(map);
  if (!keys.length) return;
  try {
    cache_().putAll(map, VERSION_TTL);
  } catch (error) {
    try { cache_().removeAll(keys); } catch (ignored) {}
  }
  if (REQ_ && REQ_.vers) REQ_.vers = null; // re-read on the next cached read of this request
}

// Stores text under key in chunks of RC_CHUNK characters: key holds "<n>|<chunk 0>",
// key_1..key_<n-1> the rest. Too big (> RC_MAX_CHUNKS) or cache errors: not stored.
function rcPut_(key, text) {
  var ttl = REQ_ && REQ_.refreshCache ? KEEP_WARM_TTL : READ_CACHE_TTL;
  var n = Math.max(1, Math.ceil(text.length / RC_CHUNK));
  if (n > RC_MAX_CHUNKS) return;
  var map = {};
  for (var i = 0; i < n; i++) {
    var part = text.substr(i * RC_CHUNK, RC_CHUNK);
    map[i ? key + "_" + i : key] = i ? part : n + "|" + part;
  }
  try { cache_().putAll(map, ttl); } catch (ignored) {}
}

function rcGet_(key) {
  try {
    var head = cache_().get(key);
    if (!head) return null;
    var bar = head.indexOf("|");
    var n = parseInt(head.slice(0, bar), 10);
    if (!(n >= 1)) return null;
    var parts = [head.slice(bar + 1)];
    if (n > 1) {
      var keys = [];
      for (var i = 1; i < n; i++) keys.push(key + "_" + i);
      var got = cache_().getAll(keys) || {};
      for (var j = 0; j < keys.length; j++) {
        if (typeof got[keys[j]] !== "string") return null;
        parts.push(got[keys[j]]);
      }
    }
    return parts.join("");
  } catch (error) {
    return null;
  }
}

// Rows are stored as arrays in SCHEMA order, normalised exactly like a sheet
// round trip (toCell_ -> fromCell_), so cached and live reads are identical.
function storeRows_(name, ver, rows) {
  var cols = SCHEMA[name];
  var data = rows.map(function (r) {
    return cols.map(function (c) { return fromCell_(c[1], toCell_(c[1], r[c[0]])); });
  });
  rcPut_(RC_PREFIX + name + "_" + ver, JSON.stringify(data));
}

function cachedRows_(name, ver) {
  var text = rcGet_(RC_PREFIX + name + "_" + ver);
  if (!text) return null;
  var data;
  try { data = JSON.parse(text); } catch (error) { return null; }
  var cols = SCHEMA[name];
  var maxId = 0;
  var rows = data.map(function (a) {
    var obj = {};
    cols.forEach(function (c, i) { obj[c[0]] = a[i]; });
    Object.defineProperty(obj, "_row", { value: 0, writable: true, enumerable: false });
    if (obj.id > maxId) maxId = obj.id;
    return obj;
  });
  // No sheet: tables from the cache are read-only (writes always read live).
  return { name: name, sheet: null, header: null, idx: null, rows: rows, maxId: maxId, values: null, cached: true };
}

// Result of fn() cached under the versions of the sheets it depends on.
function cachedDerived_(id, deps, fn) {
  if (!REQ_.cacheReads) return fn();
  var vers = versions_();
  var parts = [];
  for (var i = 0; i < deps.length; i++) {
    if (!vers[deps[i]]) return fn();
    parts.push(vers[deps[i]]);
  }
  var key = RC_PREFIX + id + "_" + parts.join("_");
  var text = REQ_.refreshCache ? null : rcGet_(key);
  if (text) {
    try { return JSON.parse(text); } catch (ignored) {}
  }
  var value = fn();
  rcPut_(key, JSON.stringify(value));
  return value;
}

/**
 * Run from the Apps Script editor after editing the spreadsheet by hand: gives
 * every cached sheet a new data version, so the next reads load the sheets.
 */
function clearReadCache() {
  bumpVersions_(CACHED_TABLES);
  return { cleared: CACHED_TABLES };
}

/* ---------- keep-warm (time-driven trigger) ----------
 * keepWarm() runs the reads the pages open with (bootstrap, dashboard)
 * the way a web request would, but reads every sheet live and stores
 * it again in the read cache under the CURRENT data versions with a TTL longer
 * than the trigger period, so the next web request is answered from
 * CacheService. It only reads: no sheet row is written, no version is bumped,
 * no lock is taken (a missing version is created exactly as by any read).
 * Hand edits in the spreadsheet are picked up at each run.
 * Run installKeepWarmTrigger() once from the Apps Script editor.
 */
function keepWarm() {
  try {
    resetRequest_("");
    REQ_.cacheReads = true;
    REQ_.refreshCache = true;
    handleRead_("bootstrap", {});
    handleRead_("summary", {});
    return { warmed: true };
  } catch (error) {
    console.log("keepWarm: " + errorMessage_(error));
    return { warmed: false, error: errorMessage_(error) };
  } finally {
    REQ_ = null;
  }
}

/** Run once from the editor: (re)creates the one keepWarm trigger (every 10 minutes). */
function installKeepWarmTrigger() {
  removeKeepWarmTrigger();
  ScriptApp.newTrigger("keepWarm").timeBased().everyMinutes(KEEP_WARM_MINUTES).create();
  var warm = keepWarm();
  var result = { installed: true, everyMinutes: KEEP_WARM_MINUTES, warmed: warm.warmed };
  console.log(JSON.stringify(result));
  return result;
}

/** Deletes every keepWarm trigger of this project (other triggers are left alone). */
function removeKeepWarmTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "keepWarm") { ScriptApp.deleteTrigger(t); removed++; }
  });
  return { removed: removed };
}

function insert_(name, obj) {
  var t = table_(name);
  var row = {};
  SCHEMA[name].forEach(function (col) { row[col[0]] = obj[col[0]] === undefined ? null : obj[col[0]]; });
  t.maxId += 1;
  row.id = t.maxId;
  Object.defineProperty(row, "_row", { value: 0, writable: true, enumerable: false });
  t.rows.push(row);
  (REQ_.appends[name] = REQ_.appends[name] || []).push(row);
  return row;
}

function update_(name, row, fields) {
  Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
  if (row._row > 0) {
    for (var i = 0; i < REQ_.updates.length; i++) if (REQ_.updates[i].row === row) return;
    REQ_.updates.push({ name: name, row: row });
  } // rows inserted in this request are written with their latest values on flush
}

// Removes a row from the in-memory table and buffers the sheet row deletion.
function delete_(name, row) {
  var t = table_(name);
  var i = t.rows.indexOf(row);
  if (i !== -1) t.rows.splice(i, 1);
  REQ_.updates = REQ_.updates.filter(function (u) { return u.row !== row; });
  if (row._row > 0) {
    REQ_.deletes.push({ name: name, row: row });
  } else if (REQ_.appends[name]) {
    REQ_.appends[name] = REQ_.appends[name].filter(function (r) { return r !== row; });
  }
}

// Writes buffered changes in a safe order: updates (row numbers are still the
// ones read at the start of the request), then deletions (highest row first,
// each run of consecutive rows in one deleteRows call), then appends (one
// setNumberFormats + one setValues per table). Tables that lost rows are
// dropped from the per-request cache because their row numbers have shifted.
// Afterwards every changed sheet gets a new data version (read cache), also when
// a write fails half-way.
function flush_() {
  var changed = Object.keys(REQ_.dirty);
  REQ_.updates.forEach(function (u) { changed.push(u.name); });
  REQ_.deletes.forEach(function (d) { changed.push(d.name); });
  Object.keys(REQ_.appends).forEach(function (n) { if (REQ_.appends[n].length) changed.push(n); });
  REQ_.dirty = {};
  try {
    flushBuffers_();
  } finally {
    if (changed.length) {
      // Make the writes visible to other executions before announcing them.
      try { SpreadsheetApp.flush(); } catch (ignored) {}
      bumpVersions_(changed.filter(function (n, i, a) { return a.indexOf(n) === i; }));
    }
  }
}

function flushBuffers_() {
  REQ_.updates.forEach(function (u) {
    var t = REQ_.tables[u.name];
    var range = t.sheet.getRange(u.row._row, 1, 1, t.header.length);
    // The row as read at the start of this request (under the lock), else read it now.
    var current = t.values && t.values[u.row._row - 1] ? t.values[u.row._row - 1] : range.getValues()[0];
    var next = rowValues_(u.name, t, u.row, t.header.length, current);
    range.setValues([next]);
    if (t.values && t.values[u.row._row - 1]) t.values[u.row._row - 1] = next;
  });
  REQ_.updates = [];

  var byTable = {};
  REQ_.deletes.forEach(function (d) { (byTable[d.name] = byTable[d.name] || []).push(d.row._row); });
  Object.keys(byTable).forEach(function (name) {
    var sheet = REQ_.tables[name].sheet;
    var rows = byTable[name]
      .filter(function (r, i, a) { return r > 1 && a.indexOf(r) === i; })
      .sort(function (a, b) { return b - a; });
    // Sheets refuses to delete every non-frozen row: keep one spare row.
    if (sheet.getMaxRows() - rows.length < 2) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    var i = 0;
    while (i < rows.length) {
      var j = i;
      while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
      sheet.deleteRows(rows[j], j - i + 1); // rows[j] = lowest row number of the run
      i = j + 1;
    }
  });
  REQ_.deletes = [];

  Object.keys(REQ_.appends).forEach(function (name) {
    var list = REQ_.appends[name];
    if (!list.length) return;
    var t = REQ_.tables[name];
    var width = t.header.length;
    var start = Math.max(t.sheet.getLastRow(), 1) + 1;
    var needed = start + list.length - 1;
    var maxRows = t.sheet.getMaxRows();
    if (needed > maxRows) t.sheet.insertRowsAfter(maxRows, needed - maxRows);
    var formats = [];
    var values = list.map(function (row) {
      formats.push(rowFormats_(name, t));
      row._row = start + formats.length - 1;
      return rowValues_(name, t, row, width);
    });
    var range = t.sheet.getRange(start, 1, list.length, width);
    range.setNumberFormats(formats);
    range.setValues(values);
  });
  REQ_.appends = {};
  Object.keys(byTable).forEach(function (name) { delete REQ_.tables[name]; });
}

// Appends the SCHEMA columns missing from the header row (written at once, not
// buffered; plain-text / number format for the whole new columns). Returns the
// new header.
function addMissingColumns_(sheet, name, header) {
  while (header.length && header[header.length - 1] === "") header.pop();
  var missing = SCHEMA[name].filter(function (c) { return header.indexOf(c[0]) === -1; });
  if (!missing.length) return header;
  var start = header.length + 1;
  var needCols = start + missing.length - 1;
  var maxCols = sheet.getMaxColumns();
  if (needCols > maxCols) sheet.insertColumnsAfter(maxCols, needCols - maxCols);
  sheet.getRange(1, start, 1, missing.length).setValues([missing.map(function (c) { return c[0]; })]);
  var maxRows = sheet.getMaxRows();
  var rowFormat = missing.map(function (c) { return cellFormat_(c[1]); });
  var formats = [];
  for (var r = 0; r < maxRows; r++) formats.push(rowFormat);
  sheet.getRange(1, start, maxRows, missing.length).setNumberFormats(formats);
  sheet.getRange(1, start, 1, missing.length).setFontWeight("bold");
  bumpVersions_([name]);
  return header.concat(missing.map(function (c) { return c[0]; }));
}

function rowValues_(name, t, row, width, base) {
  var out = base ? base.slice() : [];
  while (out.length < width) out.push("");
  SCHEMA[name].forEach(function (col, i) { out[t.idx[i]] = toCell_(col[1], row[col[0]]); });
  return out;
}

function rowFormats_(name, t) {
  var out = [];
  for (var i = 0; i < t.header.length; i++) out.push("@");
  SCHEMA[name].forEach(function (col, i) { out[t.idx[i]] = cellFormat_(col[1]); });
  return out;
}

// Sheet number format of a column type: whole numbers, decimals or plain text.
function cellFormat_(type) {
  if (type.indexOf("int") === 0) return "0";
  if (type.indexOf("num") === 0) return "0.00#";
  return "@";
}

function toCell_(type, v) {
  if (v === null || v === undefined) return "";
  if (type.indexOf("int") === 0 || type.indexOf("num") === 0) return Number(v);
  var s = String(v);
  // Never let user text become a formula (cells are also plain-text formatted).
  if (s.charAt(0) === "=") s = "'" + s;
  return s;
}

function fromCell_(type, v) {
  var nullable = type.charAt(type.length - 1) === "?";
  var base = nullable ? type.slice(0, -1) : type;
  if (v === "" || v === null || v === undefined) return nullable ? null : (base === "int" || base === "num" ? 0 : "");
  if (base === "num") {
    var x = Number(v);
    return isFinite(x) ? Math.round(x * 1000) / 1000 : 0;
  }
  if (base === "int") {
    var n = Number(v);
    return isFinite(n) ? Math.trunc(n) : 0;
  }
  if (Object.prototype.toString.call(v) === "[object Date]") {
    // A cell Sheets converted to a Date (spreadsheet time zone is Asia/Bangkok).
    return formatUtcParts_(new Date(v.getTime() + TZ_OFFSET_MS)).datetime;
  }
  var s = String(v);
  if (s.charAt(0) === "'" && s.charAt(1) === "=") s = s.slice(1);
  return s;
}

/* ===================== setup ===================== */

/**
 * One-time setup. Run from the Apps Script editor and approve permissions.
 * Creates the spreadsheet + Drive folder (or reuses the ones in Script Properties;
 * missing sheets/headers are added, existing data is never changed).
 */
function setupSystem() {
  var properties = PropertiesService.getScriptProperties();
  var id = properties.getProperty(SPREADSHEET_ID_PROPERTY);
  var ss;
  var created = false;
  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
    } catch (error) {
      throw new Error("เปิดสเปรดชีตเดิม (" + id + ") ไม่ได้: " + errorMessage_(error) +
        " — ถ้าต้องการสร้างใหม่ ให้ลบ Script Property " + SPREADSHEET_ID_PROPERTY + " แล้วรันอีกครั้ง");
    }
  } else {
    ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    ss.setSpreadsheetTimeZone("Asia/Bangkok");
    created = true;
    properties.setProperty(SPREADSHEET_ID_PROPERTY, ss.getId());
  }
  var folderId = properties.getProperty(FOLDER_ID_PROPERTY);
  var folder = null;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder(FOLDER_NAME);
    properties.setProperty(FOLDER_ID_PROPERTY, folder.getId());
  }

  var defaultSheets = created ? ss.getSheets() : [];
  TABLE_ORDER.forEach(function (name, i) {
    var sheet = ss.getSheetByName(name);
    if (!sheet && created && i === 0 && defaultSheets.length) {
      sheet = defaultSheets[0];
      sheet.setName(name);
    }
    prepareSheet_(ss, name, sheet);
  });

  resetRequest_("setupSystem");
  REQ_.ss = ss;
  TABLE_ORDER.forEach(function (name) { table_(name); REQ_.dirty[name] = true; });
  flush_();
  REQ_ = null;

  var passwords = {};
  var missing = [];
  ROLE_ORDER.forEach(function (r) {
    passwords[ROLE_PROPERTY[r]] = Boolean(properties.getProperty(ROLE_PROPERTY[r]));
    if (!passwords[ROLE_PROPERTY[r]]) missing.push(ROLE_PROPERTY[r] + " (" + ROLE_NAME[r] + ")");
  });
  var result = {
    created: created,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    folderId: folder.getId(),
    passwords: passwords,
    passwordMessage: missing.length
      ? "ยังไม่ได้ตั้ง Script Property: " + missing.join(", ") + " — ระดับนั้นจะใส่รหัสไม่ได้จนกว่าจะตั้งค่า (Project Settings > Script properties)"
      : "ตั้งรหัสผ่านครบทั้ง 2 ระดับแล้ว"
  };
  console.log(JSON.stringify(result));
  console.log(result.passwordMessage);
  return result;
}

// Creates the sheet when missing, writes the header row on an empty sheet,
// bolds/freezes it and sets number / plain-text formats per column so Sheets
// never converts values (e.g. "080409" into 80409 or a date text into a Date).
function prepareSheet_(ss, name, sheet) {
  if (!sheet) sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var cols = SCHEMA[name];
  var headers = cols.map(function (c) { return c[0]; });
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
  var maxRows = sheet.getMaxRows();
  var formats = [];
  var rowFormat = cols.map(function (c) { return cellFormat_(c[1]); });
  for (var r = 0; r < maxRows; r++) formats.push(rowFormat);
  sheet.getRange(1, 1, maxRows, headers.length).setNumberFormats(formats);
  return sheet;
}

/* ===================== small utilities ===================== */

function fail_(message, code) {
  var error = new Error(message);
  if (code) error.code = code;
  throw error;
}

function errorMessage_(error) {
  return (error && error.message) ? String(error.message) : String(error);
}

function errorResponse_(error) {
  var body = { ok: false, error: errorMessage_(error) };
  if (error && error.code) body.code = error.code;
  if (error && error.passwordError) body.passwordError = true;
  return jsonResponse_(body);
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function plain_(obj) {
  var out = {};
  Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
  return out;
}

function sortBy_(arr, cmp) { // stable sort
  return arr.map(function (v, i) { return [v, i]; })
    .sort(function (a, b) { return cmp(a[0], b[0]) || a[1] - b[1]; })
    .map(function (p) { return p[0]; });
}

function str_(v) {
  if (v === null || v === undefined || v === false) return "";
  if (v === true) return "1";
  return String(v);
}

// Like str_ but rejects arrays/objects (PHP trim() on an array throws).
function safeStr_(v) {
  if (v !== null && typeof v === "object") fail_("ข้อมูลที่ส่งมาไม่ถูกต้อง");
  return str_(v);
}

function phpTrim_(s) {
  return String(s).replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, "");
}

function phpInt_(v) {
  if (v === null || v === undefined || v === false) return 0;
  if (v === true) return 1;
  if (typeof v === "number") return isFinite(v) ? Math.trunc(v) : 0;
  if (typeof v === "object") return Array.isArray(v) && v.length ? 1 : 0;
  var m = /^[ \t\n\r\v\f]*([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)/.exec(String(v));
  if (!m) return 0;
  var n = Number(m[1]);
  return isFinite(n) ? Math.trunc(n) : 0;
}

function phpTruthy_(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "" || v === "0") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function phpEmpty_(v) {
  return !phpTruthy_(v);
}

function mbLen_(s) {
  return Array.from(String(s)).length;
}

function mbSubstr_(s, start, len) {
  return Array.from(String(s)).slice(start, start + len).join("");
}

function eqCi_(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

// MySQL "col LIKE '%q%'" (case-insensitive, % and _ wildcards, \ escape).
function likeMatcher_(q) {
  var re = "";
  var chars = Array.from(q);
  for (var i = 0; i < chars.length; i++) {
    var ch = chars[i];
    if (ch === "\\" && i + 1 < chars.length) { re += escapeRe_(chars[++i]); continue; }
    if (ch === "%") re += "[\\s\\S]*";
    else if (ch === "_") re += "[\\s\\S]";
    else re += escapeRe_(ch);
  }
  var rx = new RegExp(re, "i");
  return function (v) { return v !== null && v !== undefined && rx.test(String(v)); };
}

function escapeRe_(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
}

// CSV line: quoted when PHP fputcsv() would quote, "\n" line ending.
function csvLine_(fields) {
  return fields.map(function (f) {
    var s = f === null || f === undefined ? "" : (f === true ? "1" : f === false ? "" : String(f));
    if (!/[,"\\\n\r\t ]/.test(s)) return s;
    // Every '"' doubled (RFC 4180, how Excel reads it). PHP's backslash escape left
    // '\"' undoubled, which split the cell into two columns in Excel.
    return '"' + s.replace(/"/g, '""') + '"';
  }).join(",") + "\n";
}

function pad2_(n) {
  return (n < 10 ? "0" : "") + n;
}

function formatUtcParts_(d) {
  var y = String(d.getUTCFullYear());
  while (y.length < 4) y = "0" + y;
  var date = y + "-" + pad2_(d.getUTCMonth() + 1) + "-" + pad2_(d.getUTCDate());
  var time = pad2_(d.getUTCHours()) + ":" + pad2_(d.getUTCMinutes());
  return {
    date: date,
    time: time,
    datetime: date + " " + time + ":" + pad2_(d.getUTCSeconds()),
    ymd: y.slice(-2) + pad2_(d.getUTCMonth() + 1) + pad2_(d.getUTCDate())
  };
}

// Current wall-clock time in Asia/Bangkok.
function nowParts_() {
  return formatUtcParts_(new Date(Date.now() + TZ_OFFSET_MS));
}

function parseDt_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
}

function shiftDate_(date, days) {
  return formatUtcParts_(new Date(parseDt_(date) + days * 86400000)).date;
}

function shiftDateTime_(datetime, days) {
  return formatUtcParts_(new Date(parseDt_(datetime) + days * 86400000)).datetime;
}

function stamp_() {
  var p = nowParts_();
  return p.date.replace(/-/g, "") + "_" + p.datetime.slice(11).replace(/:/g, "");
}
