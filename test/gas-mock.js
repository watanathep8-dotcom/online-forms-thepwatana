/*
 * In-memory mocks of the Apps Script services used by apps-script/Code.gs (แบบฟอร์มออนไลน์),
 * plus an end-to-end test of every API action through doGet/doPost.
 *
 *   node test/gas-mock.js
 */
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const crypto = require("crypto");
const { Buffer } = require("buffer"); // explicit: test/dev-server.js evaluates this file in a bare vm context

const ROOT = path.join(__dirname, "..");

/* ===================== mocks ===================== */
function createGas() {
  const state = { props: {}, cache: {}, cachePuts: [], cachePutAlls: [], cacheGetAlls: 0, flushes: 0, cacheDown: false, sheetReads: {}, rowReads: 0, events: [], sleeps: 0, locks: 0, unlocks: 0, lockFail: false, spreadsheets: {}, seq: 0, formatCalls: 0, created: 0, fetches: [], fetchStatus: 202, fetchError: null, logs: [] };

  class Range {
    constructor(sheet, row, col, nr, nc) {
      if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error("Range out of bounds");
      if (row + nr - 1 > sheet.maxRows) throw new Error("Range exceeds sheet rows: " + (row + nr - 1) + " > " + sheet.maxRows);
      if (col + nc - 1 > sheet.maxCols) throw new Error("Range exceeds sheet columns: " + (col + nc - 1) + " > " + sheet.maxCols);
      Object.assign(this, { sheet, row, col, nr, nc });
    }
    getValues() {
      if (this.nr === 1 && this.row > 1) state.rowReads++;
      const out = [];
      for (let r = 0; r < this.nr; r++) {
        const src = this.sheet.data[this.row - 1 + r] || [];
        const line = [];
        for (let c = 0; c < this.nc; c++) {
          const v = src[this.col - 1 + c];
          line.push(v === undefined || v === null ? "" : v);
        }
        out.push(line);
      }
      return out;
    }
    setValues(values) {
      state.events.push("write:" + this.sheet.name);
      assert.strictEqual(values.length, this.nr, "setValues row count");
      values.forEach((line, r) => {
        assert.strictEqual(line.length, this.nc, "setValues column count");
        const idx = this.row - 1 + r;
        while (this.sheet.data.length <= idx) this.sheet.data.push([]);
        line.forEach((v, c) => {
          if (typeof v === "string" && v.charAt(0) === "'") v = v.slice(1); // Sheets consumes the apostrophe prefix (stored as text)
          else if (typeof v === "string" && v.charAt(0) === "=") throw new Error("Formula written to sheet: " + v);
          this.sheet.data[idx][this.col - 1 + c] = v;
        });
      });
      return this;
    }
    setNumberFormats(f) {
      assert.strictEqual(f.length, this.nr, "setNumberFormats rows");
      f.forEach(line => assert.strictEqual(line.length, this.nc, "setNumberFormats cols"));
      state.formatCalls++;
      return this;
    }
    setFontWeight() { return this; }
    clearContent() {
      state.clearCalls = (state.clearCalls || 0) + 1;
      for (let r = 0; r < this.nr; r++) {
        const line = this.sheet.data[this.row - 1 + r];
        if (line) for (let c = 0; c < this.nc; c++) if (this.col - 1 + c < line.length) line[this.col - 1 + c] = "";
      }
      return this;
    }
  }

  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
    getLastRow() {
      for (let r = this.data.length - 1; r >= 0; r--) {
        if ((this.data[r] || []).some(v => v !== "" && v !== undefined && v !== null)) return r + 1;
      }
      return 0;
    }
    getLastColumn() { return this.data.reduce((m, row) => Math.max(m, row.length), 0); }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(after, n) { this.maxRows += n; return this; }
    getMaxColumns() { return this.maxCols; }
    insertColumnsAfter(after, n) { this.maxCols += n; state.colInserts = (state.colInserts || 0) + 1; return this; }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
    getDataRange() {
      state.sheetReads[this.name] = (state.sheetReads[this.name] || 0) + 1;
      return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
    }
    setFrozenRows(n) { this.frozen = n; return this; }
    getFrozenRows() { return this.frozen || 0; }
    deleteRows(pos, n) {
      if (pos < 1 || n < 1 || pos + n - 1 > this.maxRows) throw new Error("deleteRows out of bounds");
      if (this.maxRows - n <= (this.frozen || 0)) throw new Error("Sorry, it is not possible to delete all non-frozen rows.");
      state.deleteCalls = (state.deleteCalls || []).concat([[this.name, pos, n]]);
      this.data.splice(pos - 1, n);
      this.maxRows -= n;
      return this;
    }
    deleteRow(pos) { return this.deleteRows(pos, 1); }
  }

  class Spreadsheet {
    constructor(name) { this.id = "ss" + (++state.seq); this.name = name; this.sheets = [new Sheet("Sheet1")]; this.tz = null; }
    getId() { return this.id; }
    getUrl() { return "https://docs.google.com/spreadsheets/d/" + this.id + "/edit"; }
    getSheets() { return this.sheets.slice(); }
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
    setSpreadsheetTimeZone(tz) { this.tz = tz; }
  }

  function mkFolder(id) {
    return {
      getId: () => id,
      createFile(blob) {
        if (state.driveFail) throw new Error("Drive down");
        const fid = "file" + (++state.seq) + "abcdefghij";
        (state.files = state.files || {})[fid] = { name: blob.name, mime: blob.mime, bytes: blob.bytes, trashed: false, folder: id };
        return { getId: () => fid };
      }
    };
  }

  const gas = {
    SpreadsheetApp: {
      create(name) { const ss = new Spreadsheet(name); state.spreadsheets[ss.id] = ss; state.created++; return ss; },
      openById(id) { const ss = state.spreadsheets[id]; if (!ss) throw new Error("Spreadsheet not found: " + id); state.opens = (state.opens || 0) + 1; return ss; },
      flush() { state.flushes++; state.events.push("flush"); }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty: k => (k in state.props ? state.props[k] : null),
          getProperties: () => Object.assign({}, state.props),
          setProperty: (k, v) => { state.props[k] = String(v); },
          setProperties: (o) => { Object.assign(state.props, o); },
          deleteProperty: k => { delete state.props[k]; }
        };
      }
    },
    CacheService: {
      getScriptCache() {
        return {
          get: k => { if (state.cacheDown) throw new Error("Cache down"); return k in state.cache ? state.cache[k] : null; },
          put: (k, v, ttl) => { state.cache[k] = String(v); state.cachePuts.push(ttl); },
          remove: k => { delete state.cache[k]; },
          // Batch calls (read cache / data versions); tracked apart from put().
          getAll: keys => { if (state.cacheDown || state.batchCacheDown) throw new Error("Cache down"); state.cacheGetAlls++; const o = {}; keys.forEach(k => { if (k in state.cache) o[k] = state.cache[k]; }); return o; },
          putAll: (map, ttl) => {
            if (state.cacheDown || state.batchCacheDown) throw new Error("Cache down");
            Object.keys(map).forEach(k => {
              if (/^FORM_V_/.test(k)) state.events.push("version:" + k.slice(7));
              const v = String(map[k]);
              assert.ok(k.length <= 250, "cache key too long: " + k);
              assert.ok(Buffer.byteLength(v, "utf8") <= 100 * 1024, "cache value over 100 KB: " + k);
              state.cache[k] = v;
            });
            state.cachePutAlls.push(ttl);
          },
          removeAll: keys => { keys.forEach(k => { delete state.cache[k]; }); }
        };
      }
    },
    LockService: {
      getScriptLock() {
        return {
          waitLock() { if (state.lockFail) throw new Error("Lock timeout"); state.locks++; },
          tryLock() { state.locks++; return true; },
          releaseLock() { state.unlocks++; }
        };
      }
    },
    Utilities: {
      sleep(ms) { state.sleeps += ms; },
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
      getUuid() { return crypto.randomUUID(); },
      base64Decode(b64) { return Array.from(Buffer.from(b64, "base64"), b => (b > 127 ? b - 256 : b)); },
      base64Encode(bytes) { return Buffer.from(bytes.map(b => b & 255)).toString("base64"); },
      newBlob(bytes, mime, name) { return { bytes: Buffer.from(bytes.map(b => b & 255)), mime, name }; },
      // Like Apps Script: string (charset) or byte array in, signed byte array out.
      computeDigest(alg, value) {
        assert.strictEqual(alg, "SHA_256");
        const buf = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value.map(b => b & 255));
        return Array.from(crypto.createHash("sha256").update(buf).digest(), b => (b > 127 ? b - 256 : b));
      }
    },
    ContentService: {
      MimeType: { JSON: "application/json", JAVASCRIPT: "application/javascript", CSV: "text/csv", TEXT: "text/plain" },
      createTextOutput(text) {
        return { text, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.text; }, getMimeType() { return this.mime; } };
      }
    },
    Logger: { log() {} },
    // Everything Code.gs logs is kept in state.logs (checked for leaked secrets).
    console: {
      log(...a) { state.logs.push(["log", a.join(" ")]); },
      warn(...a) { state.logs.push(["warn", a.join(" ")]); },
      error(...a) { state.logs.push(["error", a.join(" ")]); console.error(...a); }
    },
    // Teams webhook: never touches the network. Records each call (and whether the
    // script lock was held at that moment); answers state.fetchStatus or throws
    // state.fetchError.
    UrlFetchApp: {
      fetch(url, opts) {
        state.fetches.push({ url, opts, lockHeld: state.locks !== state.unlocks });
        if (state.fetchError) throw new Error(state.fetchError);
        const code = state.fetchStatus;
        return { getResponseCode: () => code, getContentText: () => "" };
      }
    },
    // Drive: one folder of files. state.files[id] = {name, mime, bytes(Buffer), trashed}
    DriveApp: {
      createFolder(name) { const id = "fld" + (++state.seq) + "abcdefghij"; (state.folders = state.folders || {})[id] = { name }; return mkFolder(id); },
      getFolderById(id) { if (!(state.folders || {})[id]) throw new Error("No folder " + id); return mkFolder(id); },
      getFileById(id) {
        const f = (state.files || {})[id];
        if (!f) throw new Error("No file " + id);
        return { getId: () => id, getBlob: () => ({ getContentType: () => f.mime, getBytes: () => Array.from(f.bytes) }), setTrashed(v) { f.trashed = Boolean(v); return this; } };
      }
    },
    // Project triggers (keep-warm). state.triggers: [{handler, everyMinutes, id}]
    ScriptApp: {
      getProjectTriggers() {
        return (state.triggers || []).map(t => ({ getHandlerFunction: () => t.handler, getUniqueId: () => t.id, _t: t }));
      },
      deleteTrigger(tr) { state.triggers = (state.triggers || []).filter(t => t !== tr._t); },
      newTrigger(handler) {
        const t = { handler, id: "trg" + (++state.seq) };
        const b = {
          timeBased() { t.timeBased = true; return b; },
          everyMinutes(n) { assert.ok([1, 5, 10, 15, 30].includes(n), "everyMinutes(" + n + ")"); t.everyMinutes = n; return b; },
          create() { assert.ok(t.timeBased, "time-based"); (state.triggers = state.triggers || []).push(t); return { getUniqueId: () => t.id }; }
        };
        return b;
      }
    }
  };
  return { gas, state };
}

function loadCode(gas) {
  const ctx = vm.createContext(Object.assign({}, gas));
  const src = fs.readFileSync(path.join(ROOT, "apps-script", "Code.gs"), "utf8");
  vm.runInContext(src, ctx, { filename: "Code.gs" });
  return ctx;
}


/* ===================== synthetic test fixtures =====================
 * Fake suppliers / packaging items / QC heads created through the admin API,
 * exactly like the settings page does. Not real company data. */
const FIX_SUPPLIERS = ["บจก. ทดสอบ บรรจุภัณฑ์ เอ", "บจก. ทดสอบ กล่อง บี", "หจก. ทดสอบ ฉลาก ซี"];
// [name, code, category, wmin, wmax]
const FIX_ITEMS = [
  ["ขวด PET 500 ml (ทดสอบ)", "PK-BTL-001", "bottle", 12, 12.8],
  ["กล่องลูกฟูก 5 ชั้น A1 (ทดสอบ)", "PK-BOX-001", "box", 480, 520],
  ["ฉลากสินค้า 100 ml (ทดสอบ)", "PK-LBL-001", "label", "", ""]
];
const FIX_HEADS = ["หัวหน้า ทดสอบ หนึ่ง", "หัวหน้า ทดสอบ สอง"];
// call(body): one request as admin with an actor
function seedFixtures(call) {
  const ok = r => { assert.strictEqual(r.ok, true, "fixture: " + JSON.stringify(r)); return r.data; };
  FIX_SUPPLIERS.forEach(n => ok(call({ action: "supplier_save", name: n })));
  FIX_ITEMS.forEach(i => ok(call({ action: "item_save", name: i[0], code: i[1], category: i[2], wmin: i[3], wmax: i[4] })));
  FIX_HEADS.forEach(n => ok(call({ action: "head_save", name: n })));
}

/* ===================== test runner ===================== */
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n       ")); }
}
if (require.main !== module) { module.exports = { createGas, loadCode, seedFixtures }; return; }

const { gas, state } = createGas();
const ctx = loadCode(gas);
const QPW = "qc-pass", APW = "admin-pass"; // fake passwords of the in-memory mock (tests only)
const ACTOR = "ผู้ตรวจ ทดสอบ";
const rawPost = payload => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
const postAs = (token, action, body = {}, who = ACTOR) => rawPost(Object.assign(who ? { actor: who } : {}, { token }, body, { action }));
const okData = res => { assert.strictEqual(res.ok, true, "expected ok, got: " + JSON.stringify(res).slice(0, 400)); return res.data; };
const err = (res, re) => {
  assert.strictEqual(res.ok, false, "expected error, got: " + JSON.stringify(res).slice(0, 300));
  if (re) assert.ok(re.test(res.error), "error '" + res.error + "' !~ " + re);
  return res;
};
const login = pw => okData(rawPost({ action: "login", password: pw })).token;
let TQ = "", TA = "";
const pub = (action, body) => postAs(undefined, action, body);
const qc = (action, body) => postAs(TQ, action, body);
const adm = (action, body) => postAs(TA, action, body);
const sheet = n => state.spreadsheets[state.props.FORM_SPREADSHEET_ID].getSheetByName(n);
const dataRows = n => sheet(n).getLastRow() - 1;
const boot = () => okData(pub("bootstrap"));
const IMG = "data:image/jpeg;base64," + Buffer.from("fake-jpeg-bytes").toString("base64");
const IMG2 = "data:image/png;base64," + Buffer.from("fake-png-bytes-2").toString("base64");
const liveFiles = () => Object.values(state.files || {}).filter(f => !f.trashed).length;
let S, I, H; // fixtures from bootstrap: suppliers / items / heads by name order
// a complete valid submission (bottle, lot 5,000 -> J / 80 / 10 / 11)
const form = (extra = {}) => Object.assign({
  received_date: "2026-11-10", received_time: "09:30", supplier_id: S[0].id, item_id: I.bottle.id,
  po_no: "PO-2026-0001", invoice_no: "DN-2026-0001", lot_qty: "5,000", unit: "ชิ้น", lot_no: "LOT-20261110-01",
  defects: 2, checks: [true, false, true, true, true], cat_result: "pass", strength: "",
  weights: [12.4, 12.5, null, 12.3], wmin: 12, wmax: 12.8, wunit: "g", result: "pass", defect_detail: "",
  photos: [IMG, IMG2], bill_photo: IMG, inspector: "ผู้ตรวจ ทดสอบ", inspector_sign: IMG2
}, extra);

console.log("Online Forms (ใบตรวจรับบรรจุภัณฑ์) GAS backend tests");

/* ---------- setup / access ---------- */
test("setupSystem creates the spreadsheet (5 sheets with headers) and the Drive folder; idempotent", () => {
  const r = JSON.parse(JSON.stringify(ctx.setupSystem()));
  assert.strictEqual(r.created, true);
  assert.ok(state.props.FORM_SPREADSHEET_ID && state.props.FORM_FOLDER_ID);
  const ss = state.spreadsheets[state.props.FORM_SPREADSHEET_ID];
  assert.deepStrictEqual(ss.getSheets().map(s => s.getName()), ["inspections", "suppliers", "items", "heads", "audit_logs"]);
  assert.strictEqual(sheet("inspections").data[0][1], "doc_no");
  assert.deepStrictEqual(r.passwords, { FORM_ADMIN_PASSWORD: false, FORM_QC_PASSWORD: false });
  const again = ctx.setupSystem();
  assert.strictEqual(again.created, false);
  assert.strictEqual(state.created, 1);
  assert.strictEqual(Object.keys(state.folders).length, 1);
});

test("login: qc and admin passwords give their roles; wrong password refused", () => {
  Object.assign(state.props, { FORM_QC_PASSWORD: QPW, FORM_ADMIN_PASSWORD: APW });
  TQ = login(QPW); TA = login(APW);
  assert.strictEqual(okData(postAs(TQ, "bootstrap")).role, "qc");
  assert.strictEqual(okData(postAs(TA, "bootstrap")).role, "admin");
  err(rawPost({ action: "login", password: "nope" }), /รหัสไม่ถูกต้อง/);
  Object.keys(state.cache).forEach(k => { if (/FAILURES|^FORM_LF_/.test(k)) delete state.cache[k]; });
});

test("role gating: settings / edit / delete need admin, approve / return need qc; anonymous submit allowed", () => {
  ["supplier_save", "item_save", "head_save", "supplier_delete", "item_delete", "head_delete", "inspection_update", "inspection_delete", "logs"]
    .forEach(a => { err(pub(a, { id: 1, name: "x" }), /รหัสผ่าน|AUTH|ต้องใส่/); err(qc(a, { id: 1, name: "x" }), /ทำรายการนี้ไม่ได้/); });
  ["approve", "return"].forEach(a => err(pub(a, { id: 1 }), /ต้องใส่รหัสผ่าน/));
  err(rawPost({ action: "supplier_save", token: TA, name: "x" }), /กรุณาระบุชื่อผู้ใช้งาน/); // actor required on writes
});

test("settings: suppliers / items / heads saved and listed in bootstrap; duplicate name refused; bad category refused", () => {
  seedFixtures(b => adm(b.action, b));
  const b = boot();
  assert.deepStrictEqual(b.suppliers.map(s => s.name).sort(), FIX_SUPPLIERS.slice().sort()); // listed by sort, then Thai name
  assert.strictEqual(b.items.length, 3);
  assert.strictEqual(b.heads.length, 2);
  err(adm("supplier_save", { name: FIX_SUPPLIERS[0] }), /มีSupplierชื่อนี้อยู่แล้ว/);
  err(adm("item_save", { name: "x", category: "nope" }), /กรุณาเลือกหมวดบรรจุภัณฑ์/);
  err(adm("item_save", { name: "y", category: "bag", wmin: 5, wmax: 2 }), /ต่ำสุดต้องไม่มากกว่า/);
  S = FIX_SUPPLIERS.map(n => b.suppliers.find(x => x.name === n));
  I = { bottle: b.items.find(i => i.category === "bottle"), box: b.items.find(i => i.category === "box"), label: b.items.find(i => i.category === "label") };
  H = FIX_HEADS.map(n => b.heads.find(x => x.name === n));
  assert.strictEqual(I.bottle.wmin, 12);
  assert.strictEqual(I.label.wmin, null);
  assert.strictEqual(b.categories.length, 6);
  assert.strictEqual(b.aql.level, "II");
  assert.strictEqual(b.aql.value, "6.5");
});

/* ---------- AQL ---------- */
test("aql edge sizes: Level II / 6.5 table; >10,000 stays L 200 21/22; 1 piece = whole lot; invalid -> null", () => {
  const a = n => JSON.parse(JSON.stringify(ctx.aql_(n)));
  assert.deepStrictEqual(a(2), { code: "A", n: 2, ac: 0, re: 1 });
  assert.deepStrictEqual(a(8), { code: "A", n: 2, ac: 0, re: 1 });
  assert.deepStrictEqual(a(9), { code: "B", n: 3, ac: 0, re: 1 });
  assert.deepStrictEqual(a(50), { code: "D", n: 8, ac: 1, re: 2 });
  assert.deepStrictEqual(a(280), { code: "G", n: 32, ac: 5, re: 6 });
  assert.deepStrictEqual(a(1200), { code: "J", n: 80, ac: 10, re: 11 });
  assert.deepStrictEqual(a(1201), { code: "K", n: 125, ac: 14, re: 15 });
  assert.deepStrictEqual(a(10000), { code: "L", n: 200, ac: 21, re: 22 });
  assert.deepStrictEqual(a(10001), { code: "L", n: 200, ac: 21, re: 22 });
  assert.deepStrictEqual(a(1), { code: "A", n: 1, ac: 0, re: 1 });
  assert.strictEqual(ctx.aql_(0), null);
  assert.strictEqual(ctx.aql_(""), null);
  assert.strictEqual(ctx.aql_(2.5), null);
});

/* ---------- submit ---------- */
let FIRST;
test("submit: new sheet pending, PI- number, AQL from lot, weights avg / out count, files saved to Drive", () => {
  const before = liveFiles();
  const d = okData(pub("submit", form()));
  assert.ok(/^PI-\d{6}-0001$/.test(d.doc_no), d.doc_no);
  assert.strictEqual(d.status, "pending");
  const r = okData(pub("inspection", { id: d.id })).inspection;
  assert.strictEqual(r.status, "pending");
  assert.strictEqual(r.received_at, "2026-11-10 09:30:00");
  assert.strictEqual(r.lot_qty, 5000);
  assert.deepStrictEqual([r.aql_code, r.sample_n, r.ac, r.re], ["L", 200, 21, 22]);
  assert.deepStrictEqual(r.checks, [true, false, true, true, true]);
  assert.deepStrictEqual(r.weights, [12.4, 12.5, null, 12.3]);
  assert.strictEqual(r.w_count, 3);
  assert.strictEqual(r.w_avg, 12.4);
  assert.strictEqual(r.w_out, 0);
  assert.strictEqual(r.photos.length, 2);
  assert.strictEqual(liveFiles() - before, 4); // 2 photos + bill + inspector signature
  assert.strictEqual(r.supplier_name, FIX_SUPPLIERS[0]);
  assert.strictEqual(r.item_code, "PK-BTL-001");
  assert.strictEqual(r.created_by, ACTOR);
  assert.strictEqual(boot().pending, 1);
  FIRST = r;
});

test("submit validation: required fields, supplier / item from the list, bill photo + signature required, fail needs detail", () => {
  const n = dataRows("inspections"), files = liveFiles();
  err(pub("submit", form({ supplier_id: "" })), /กรุณาเลือกSupplier/);
  err(pub("submit", form({ item_id: 999 })), /กรุณาเลือกรายการบรรจุภัณฑ์/);
  err(pub("submit", form({ po_no: " " })), /กรุณากรอกเลขที่ใบสั่งซื้อ/);
  err(pub("submit", form({ invoice_no: "" })), /เลขที่ใบส่งของ/);
  err(pub("submit", form({ lot_no: "" })), /Lot/);
  err(pub("submit", form({ lot_qty: "0" })), /จำนวนที่ส่งมอบต้องอยู่ระหว่าง 1/);
  err(pub("submit", form({ lot_qty: "abc" })), /จำนวนเต็ม/);
  err(pub("submit", form({ defects: 201 })), /ของเสียที่พบต้องอยู่ระหว่าง 0 ถึง 200/);
  err(pub("submit", form({ cat_result: "" })), /Pass \/ Fail/);
  err(pub("submit", form({ result: "" })), /ผ่าน \/ ไม่ผ่าน/);
  err(pub("submit", form({ result: "fail", defect_detail: "" })), /รายละเอียดข้อบกพร่อง/);
  err(pub("submit", form({ bill_photo: "" })), /รูปบิลที่ Supplier ลงชื่อ/);
  err(pub("submit", form({ inspector_sign: "" })), /ลายเซ็นผู้ตรวจรับ/);
  err(pub("submit", form({ inspector: "" })), /ชื่อผู้ตรวจรับ/);
  err(pub("submit", form({ wmin: 13, wmax: 12 })), /ต่ำสุดต้องไม่มากกว่า/);
  err(pub("submit", form({ received_date: "2026-02-30" })), /วันที่\/เวลาไม่ถูกต้อง/);
  assert.strictEqual(dataRows("inspections"), n);
  assert.strictEqual(liveFiles(), files); // nothing reached Drive
});

test("photo limits: more than 8 photos or a non-image refused, nothing written", () => {
  const n = dataRows("inspections"), files = liveFiles();
  err(pub("submit", form({ photos: Array(9).fill(IMG) })), /ไม่เกิน 8 รูป/);
  err(pub("submit", form({ photos: ["data:application/pdf;base64,AAAA"] })), /ต้องเป็นรูปภาพ/);
  err(pub("submit", form({ photos: ["not-an-image"] })), /ต้องเป็นรูปภาพ/);
  err(pub("submit", form({ bill_photo: "data:image/jpeg;base64," + "A".repeat(4 * 1024 * 1024 + 8) })), /รูปใหญ่เกินไป/);
  assert.strictEqual(dataRows("inspections"), n);
  assert.strictEqual(liveFiles(), files);
});

test("a failing Drive write trashes the files the request already created; no row written", () => {
  const n = dataRows("inspections"), files = liveFiles();
  let calls = 0;
  const orig = gas.DriveApp.getFolderById;
  gas.DriveApp.getFolderById = id => { const f = orig(id); const c = f.createFile; f.createFile = b => { if (++calls === 3) throw new Error("Drive down"); return c(b); }; return f; };
  err(pub("submit", form()), /Drive down/);
  gas.DriveApp.getFolderById = orig;
  assert.strictEqual(dataRows("inspections"), n);
  assert.strictEqual(liveFiles(), files);
});

test("weights: out-of-tolerance counted; more weights than the sample refused; label (not weighed) ignores weights", () => {
  const d = okData(pub("submit", form({ lot_qty: 20, weights: [11.9, 12.5, 12.9], lot_no: "LOT-W" })));
  const r = okData(pub("inspection", { id: d.id })).inspection;
  assert.deepStrictEqual([r.aql_code, r.sample_n, r.ac, r.re], ["C", 5, 0, 1]);
  assert.strictEqual(r.w_out, 2);
  err(pub("submit", form({ lot_qty: 20, weights: [1, 2, 3, 4, 5, 6] })), /ไม่เกินจำนวนตัวอย่าง \(5 ชิ้น\)/);
  const l = okData(pub("inspection", { id: okData(pub("submit", form({ item_id: I.label.id, checks: [true, true, true, true], weights: [5], lot_no: "LOT-L" }))).id })).inspection;
  assert.deepStrictEqual(l.weights, []);
  assert.strictEqual(l.w_avg, null);
  assert.strictEqual(l.category, "label");
});

/* ---------- approve / return / resubmit ---------- */
test("approve: qc picks a head + signs -> approved; double approve refused", () => {
  err(qc("approve", { id: FIRST.id, head_id: H[0].id }), /ลายเซ็นหัวหน้า QC/);
  err(qc("approve", { id: FIRST.id, head_id: 999, sign: IMG }), /ชื่อหัวหน้า QC/);
  const d = okData(qc("approve", { id: FIRST.id, head_id: H[0].id, sign: IMG, comment: "ok" }));
  assert.strictEqual(d.status, "approved");
  const r = okData(pub("inspection", { id: FIRST.id })).inspection;
  assert.strictEqual(r.head, H[0].name);
  assert.ok(r.head_sign && r.approved_at);
  err(qc("approve", { id: FIRST.id, head_id: H[1].id, sign: IMG }), /ไม่ได้รออนุมัติแล้ว \(อนุมัติแล้ว\)/);
  err(pub("submit", form({ id: FIRST.id })), /ไม่ได้อยู่ในสถานะตีกลับ/); // an approved sheet cannot be resubmitted
});

let RET;
test("resubmit keeps doc_no and photos: return with reason -> returned; fix + submit with the kept ids -> pending", () => {
  const d = okData(pub("submit", form({ lot_no: "LOT-RET", photos: [IMG, IMG2] })));
  err(qc("return", { id: d.id, head_id: H[1].id, reason: "" }), /เหตุผลที่ตีกลับ/);
  okData(qc("return", { id: d.id, head_id: H[1].id, reason: "PO ไม่ตรง" }));
  const r = okData(pub("inspection", { id: d.id })).inspection;
  assert.strictEqual(r.status, "returned");
  assert.strictEqual(r.return_reason, "PO ไม่ตรง");
  const keep = r.photos[0], drop = r.photos[1];
  const re = okData(pub("submit", form({ id: d.id, lot_no: "LOT-RET", po_no: "PO-FIXED", photos: [keep, IMG], bill_photo: r.bill_photo, inspector_sign: r.inspector_sign })));
  assert.strictEqual(re.doc_no, r.doc_no);
  const r2 = okData(pub("inspection", { id: d.id })).inspection;
  assert.strictEqual(r2.status, "pending");
  assert.strictEqual(r2.po_no, "PO-FIXED");
  assert.strictEqual(r2.photos[0], keep);
  assert.notStrictEqual(r2.photos[1], drop);
  assert.strictEqual(r2.bill_photo, r.bill_photo);
  assert.strictEqual(state.files[drop].trashed, true);   // the replaced photo is trashed
  assert.strictEqual(state.files[keep].trashed, false);
  err(pub("submit", form({ id: d.id })), /ไม่ได้อยู่ในสถานะตีกลับ/); // pending again
  // an id of ANOTHER sheet's photo is not "kept": it must be an image
  err(adm("inspection_update", form({ id: d.id, photos: [FIRST.photos[0]] })), /ต้องเป็นรูปภาพ/);
  RET = r2;
});

/* ---------- reads ---------- */
test("history: filters (status, result, supplier, item, q, dates) and newest first; pending list", () => {
  okData(pub("submit", form({ supplier_id: S[1].id, item_id: I.box.id, checks: [true, true, true], strength: "5", result: "fail", defect_detail: "กล่องยุบ", received_date: "2026-11-12", lot_no: "LOT-BOX" })));
  const all = okData(pub("history")).items;
  assert.ok(all.length >= 5);
  assert.strictEqual(all[0].lot_no, "LOT-BOX"); // latest received_at first
  assert.ok(okData(pub("history", { status: "pending" })).items.every(r => r.status === "pending"));
  assert.deepStrictEqual(okData(pub("history", { result: "fail" })).items.map(r => r.lot_no), ["LOT-BOX"]);
  assert.strictEqual(okData(pub("history", { supplier_id: S[1].id })).items.length, 1);
  assert.strictEqual(okData(pub("history", { item_id: I.box.id })).items.length, 1);
  assert.deepStrictEqual(okData(pub("history", { q: "fixed" })).items.map(r => r.doc_no), [RET.doc_no]);
  assert.strictEqual(okData(pub("history", { from: "2026-11-11", to: "2026-11-12" })).items.length, 1);
  assert.strictEqual(okData(pub("history", { q: "PK-LBL" })).items.length, 1);
  const box = okData(pub("inspection", { id: okData(pub("history", { q: "LOT-BOX" })).items[0].id })).inspection;
  assert.strictEqual(box.strength, "5");
});

test("summary: per supplier total / fail / % fail sorted by % fail; returned sheets not counted; month range", () => {
  const s = okData(pub("summary"));
  const b = s.rows.find(r => r.supplier === FIX_SUPPLIERS[1]);
  assert.deepStrictEqual([b.total, b.fail, b.pct], [1, 1, 100]);
  assert.strictEqual(s.rows[0].supplier, FIX_SUPPLIERS[1]);
  const a = s.rows.find(r => r.supplier === FIX_SUPPLIERS[0]);
  assert.strictEqual(a.fail, 0);
  assert.ok(a.total >= 4);
  assert.strictEqual(okData(pub("summary", { from: "2026-11-12", to: "2026-11-30" })).total, 1);
});

test("history keeps names after settings change: rename / delete supplier used by sheets -> deactivated, names stay", () => {
  okData(adm("supplier_save", { id: S[0].id, name: "ชื่อใหม่ ทดสอบ" }));
  assert.strictEqual(okData(pub("inspection", { id: FIRST.id })).inspection.supplier_name, FIX_SUPPLIERS[0]);
  const d = okData(adm("supplier_delete", { id: S[1].id }));
  assert.strictEqual(d.deactivated, true);
  assert.strictEqual(boot().suppliers.find(s => s.id === S[1].id).active, 0);
  err(pub("submit", form({ supplier_id: S[1].id })), /กรุณาเลือกSupplier/); // inactive: not selectable for new sheets
  const del = okData(adm("supplier_delete", { id: S[2].id })); // unused: really deleted
  assert.strictEqual(del.deleted, true);
  assert.ok(okData(pub("history", { supplier_id: S[1].id })).items.length === 1);
});

test("file: serves only files that a sheet references", () => {
  const f = okData(pub("file", { id: FIRST.bill_photo }));
  assert.strictEqual(f.mime, "image/jpeg");
  assert.strictEqual(Buffer.from(f.data, "base64").toString(), "fake-jpeg-bytes");
  err(pub("file", { id: "fileNOTREFERENCED1234" }), /ไม่พบไฟล์/);
  err(pub("file", { id: "../x" }), /ไม่พบไฟล์/);
});

/* ---------- admin edit / delete / logs ---------- */
test("admin edit keeps status; delete removes the row and trashes its files; audit log records everything", () => {
  okData(adm("inspection_update", form({ id: FIRST.id, po_no: "PO-ADMIN", photos: FIRST.photos, bill_photo: FIRST.bill_photo, inspector_sign: FIRST.inspector_sign })));
  const r = okData(pub("inspection", { id: FIRST.id })).inspection;
  assert.strictEqual(r.status, "approved");
  assert.strictEqual(r.po_no, "PO-ADMIN");
  const files = [r.bill_photo, r.inspector_sign, r.head_sign].concat(r.photos);
  okData(adm("inspection_delete", { id: FIRST.id }));
  err(pub("inspection", { id: FIRST.id }), /ไม่พบใบตรวจรับ/);
  files.forEach(id => assert.strictEqual(state.files[id].trashed, true));
  const logs = okData(adm("logs")).items.map(l => l.action);
  ["submit", "approve", "return", "inspection_update", "inspection_delete", "supplier_save", "supplier_delete"].forEach(a => assert.ok(logs.includes(a), a));
  assert.ok(okData(adm("logs", { cat: "warn" })).items.length > 0); // refused writes are logged
  const csv = okData(adm("logs_export"));
  assert.ok(/^online_forms_log_/.test(csv.filename));
});

test("final review: summary groups a renamed supplier into ONE row (by supplier id)", () => {
  okData(adm("supplier_save", { name: "บจก. เปลี่ยนชื่อ เดิม" }));
  const sup = boot().suppliers.find(x => x.name === "บจก. เปลี่ยนชื่อ เดิม");
  okData(pub("submit", form({ supplier_id: sup.id, lot_no: "LOT-RN1", result: "fail", defect_detail: "x" })));
  okData(adm("supplier_save", { id: sup.id, name: "บจก. เปลี่ยนชื่อ ใหม่" }));
  okData(pub("submit", form({ supplier_id: sup.id, lot_no: "LOT-RN2" })));
  const rows = okData(pub("summary")).rows.filter(r => r.supplier_id === sup.id);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual([rows[0].supplier, rows[0].total, rows[0].fail, rows[0].pct], ["บจก. เปลี่ยนชื่อ ใหม่", 2, 1, 50]);
});

test("final review: editing a sheet keeps its stored supplier / item names and category when the ids are unchanged", () => {
  okData(adm("item_save", { name: "ขวดเดิม ทดสอบ", code: "OLD-1", category: "bottle" }));
  const it = boot().items.find(x => x.code === "OLD-1");
  const d = okData(pub("submit", form({ item_id: it.id, lot_no: "LOT-KEEP" })));
  okData(adm("item_save", { id: it.id, name: "ขวดชื่อใหม่", code: "NEW-1", category: "box" }));
  const r0 = okData(pub("inspection", { id: d.id })).inspection;
  okData(adm("inspection_update", form({ id: d.id, item_id: it.id, lot_no: "LOT-KEEP", po_no: "PO-ONLY", photos: r0.photos, bill_photo: r0.bill_photo, inspector_sign: r0.inspector_sign })));
  const r = okData(pub("inspection", { id: d.id })).inspection;
  assert.deepStrictEqual([r.item_name, r.item_code, r.category, r.po_no], ["ขวดเดิม ทดสอบ", "OLD-1", "bottle", "PO-ONLY"]);
  assert.strictEqual(r.checks.length, 5); // still the bottle checklist
});

test("final review: a retried submit with the same req_id returns the first sheet (no duplicate, no extra files)", () => {
  const n = dataRows("inspections");
  const a = okData(pub("submit", form({ lot_no: "LOT-REQ", req_id: "req-0123456789abcdef" })));
  const files = liveFiles();
  const b = okData(pub("submit", form({ lot_no: "LOT-REQ", req_id: "req-0123456789abcdef" })));
  assert.strictEqual(b.id, a.id);
  assert.strictEqual(b.doc_no, a.doc_no);
  assert.strictEqual(b.duplicate, true);
  assert.strictEqual(dataRows("inspections"), n + 1);
  assert.strictEqual(liveFiles(), files);
  err(pub("submit", form({ req_id: "bad id with spaces" })), /req_id/);
});

test("final review: resubmitting a returned sheet clears the returning head from the pending sheet", () => {
  const d = okData(pub("submit", form({ lot_no: "LOT-HEAD" })));
  okData(qc("return", { id: d.id, head_id: H[0].id, reason: "แก้ PO" }));
  const r = okData(pub("inspection", { id: d.id })).inspection;
  okData(pub("submit", form({ id: d.id, lot_no: "LOT-HEAD", photos: r.photos, bill_photo: r.bill_photo, inspector_sign: r.inspector_sign })));
  const r2 = okData(pub("inspection", { id: d.id })).inspection;
  assert.deepStrictEqual([r2.status, r2.head, r2.return_reason, r2.returned_at], ["pending", "", "", null]);
  const pend = okData(pub("history", { status: "pending", q: "LOT-HEAD" })).items[0];
  assert.strictEqual(pend.head, "");
});

test("GET: public reads work, writes / tokens refused", () => {
  const g = p => JSON.parse(ctx.doGet({ parameter: p }).getContent());
  assert.strictEqual(g({ action: "bootstrap" }).ok, true);
  assert.strictEqual(g({ action: "summary" }).ok, true);
  assert.strictEqual(g({ action: "submit" }).ok, false);
  assert.strictEqual(g({ action: "logs" }).ok, false);
});

test("frontend files parse; no stored passwords; storage keys prefixed oft_", () => {
  const app = fs.readFileSync(path.join(ROOT, "docs/assets/app.js"), "utf8");
  new Function(app);
  assert.ok(!/(local|session)Storage\.setItem\([^)]*[Pp]ass/.test(app));
  const keys = [...app.matchAll(/(?:local|session)Storage\.(?:get|set|remove)Item\(\s*(["'`])([^"'`]+)\1/g)].map(m => m[2]);
  keys.forEach(k => assert.ok(k.startsWith("oft_"), "storage key " + k));
  const cfg = {};
  new Function("window", fs.readFileSync(path.join(ROOT, "docs/config.js"), "utf8"))(cfg);
  assert.ok(cfg.FORM_CONFIG.apiUrl === "" || /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(cfg.FORM_CONFIG.apiUrl));
});

test("no secrets in logs", () => {
  state.logs.forEach(([, line]) => { assert.ok(!line.includes(QPW) && !line.includes(APW), "secret logged: " + line); });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
