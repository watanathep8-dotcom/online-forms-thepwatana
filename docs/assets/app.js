/* ================= แบบฟอร์มออนไลน์ — ใบตรวจรับบรรจุภัณฑ์ (บริษัท เทพวัฒนา) ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
const store = (fn, k, v) => { try { return fn === 'get' ? localStorage.getItem(k) : fn === 'del' ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { return null; } };
const sstore = (fn, k, v) => { try { return fn === 'get' ? sessionStorage.getItem(k) : fn === 'del' ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { return null; } };
const S = { boot: null, user: store('get', 'oft_user') || '', sess: null, files: {} };
const STATUS = { pending: { t: 'รอหัวหน้า QC', c: 'amber', i: 'fa-hourglass-half' }, approved: { t: 'อนุมัติแล้ว', c: 'green', i: 'fa-circle-check' }, returned: { t: 'ตีกลับ', c: 'red', i: 'fa-rotate-left' } };
const RESULT = { pass: { t: 'ผ่าน', c: 'green', i: 'fa-check' }, fail: { t: 'ไม่ผ่าน', c: 'red', i: 'fa-xmark' } };
const PAGES = {
  new: ['ตรวจรับใหม่', 'ใบตรวจรับบรรจุภัณฑ์ · AQL ระดับ II / 6.5'],
  edit: ['แก้ไขใบที่ถูกตีกลับ', 'แก้ไขแล้วส่งให้หัวหน้า QC อีกครั้ง (เลขที่ใบเดิม)'],
  pending: ['รออนุมัติ', 'ใบตรวจรับที่รอหัวหน้า QC ตรวจและลงนาม'],
  history: ['ประวัติการตรวจรับ', 'ค้นหาจากวันที่ Supplier บรรจุภัณฑ์ PO หรือ Lot'],
  sheet: ['ใบตรวจรับ', ''],
  summary: ['สรุป Supplier', 'จำนวนส่งมอบและ % ไม่ผ่าน ของแต่ละ Supplier'],
  settings: ['ตั้งค่ารายชื่อ', 'Supplier · บรรจุภัณฑ์ (มาตรฐาน) · หัวหน้า QC'],
  logs: ['บันทึกประวัติ (Log)', 'ทุกการกระทำในระบบ'],
};

/* ---------- API (Google Apps Script web app): POST text/plain JSON, token in the body ---------- */
const API_URL = String((window.FORM_CONFIG || {}).apiUrl || '').trim();
const NO_API = 'ยังไม่ได้ตั้งค่า apiUrl ใน docs/config.js';
const NAME_REQUIRED = ['submit', 'approve', 'return', 'supplier_save', 'supplier_delete', 'item_save', 'item_delete', 'head_save', 'head_delete', 'inspection_update', 'inspection_delete'];
async function api(action, body = {}) {
  if (!API_URL) throw new Error(NO_API);
  if (NAME_REQUIRED.includes(action) && !S.user) {
    await askName(true);
    if (!S.user) throw new Error('กรุณาระบุชื่อผู้ใช้งาน (มุมขวาบน) ก่อนบันทึก');
  }
  const payload = { actor: S.user, ...body, action };
  if (S.sess) payload.token = S.sess.t;
  let j;
  try {
    const res = await fetch(API_URL, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload) });
    j = await res.json();
  } catch { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (ตรวจสอบอินเทอร์เน็ต)'); }
  if (!j || !j.ok) {
    const e = new Error((j && j.error) || 'เกิดข้อผิดพลาด');
    e.code = (j && j.code) || '';
    if (e.code === 'AUTH_REQUIRED' && S.sess) { setSess(null); toast('หมดเวลาการใช้รหัสผ่าน กรุณาใส่ใหม่', 'warn'); }
    throw e;
  }
  return j.data || {};
}

/* ---------- session (qc / admin), kept in this tab only ---------- */
const ROLE_LV = { qc: 1, admin: 2 };
const ROLE_TH = { qc: 'หัวหน้า QC', admin: 'ผู้ดูแลระบบ' };
function loadSess() {
  try {
    const v = JSON.parse(sstore('get', 'oft_sess') || 'null');
    if (v && /^[0-9a-f]{64}$/.test(v.t) && ROLE_LV[v.role] && v.exp > Date.now()) return v;
  } catch {}
  sstore('del', 'oft_sess');
  return null;
}
function setSess(v) {
  S.sess = v;
  if (v) sstore('set', 'oft_sess', JSON.stringify(v)); else sstore('del', 'oft_sess');
  paintUser();
}
const can = r => !!S.sess && ROLE_LV[S.sess.role] >= ROLE_LV[r];
const CLIENT_ID = (() => {
  let id = store('get', 'oft_client') || '';
  if (!/^[0-9a-f]{32}$/.test(id)) {
    try { id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''); store('set', 'oft_client', id); } catch { id = ''; }
  }
  return id;
})();
function askUnlock(need, why) {
  if (can(need)) return Promise.resolve(true);
  return new Promise(resolve => {
    openModal(`<h3><i class="fa-solid fa-key"></i> รหัสผ่าน${ROLE_TH[need]}</h3>
      <p class="hint">${esc(why || '')}</p>
      <form id="pwForm" autocomplete="off">
        <input type="password" id="pwIn" class="inp" placeholder="ใส่รหัสผ่าน" autocomplete="current-password">
        <div class="err" id="pwErr" role="alert"></div>
        <div class="acts"><button type="button" class="btn ghost" data-close>ยกเลิก</button><button class="btn primary" id="pwGo"><i class="fa-solid fa-lock-open"></i> ปลดล็อก</button></div>
      </form>`, () => resolve(can(need)));
    $('#pwIn').focus();
    $('#pwForm').onsubmit = async ev => {
      ev.preventDefault();
      const go = $('#pwGo');
      go.disabled = true;
      try {
        const d = await api('login', { password: $('#pwIn').value, client: CLIENT_ID });
        setSess({ t: d.token, role: d.role, exp: d.expires_at });
        if (!can(need)) { $('#pwErr').textContent = 'รหัสนี้เป็นระดับ “' + ROLE_TH[d.role] + '” ซึ่งทำรายการนี้ไม่ได้'; go.disabled = false; return; }
        closeModal();
        toast('ปลดล็อก: ' + ROLE_TH[d.role], 'ok');
      } catch (e) { $('#pwErr').textContent = e.message; go.disabled = false; }
    };
  });
}

/* ---------- UI helpers ---------- */
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<i class="fa-solid ${type === 'ok' ? 'fa-circle-check' : type === 'err' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}"></i><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 4200);
  setTimeout(() => t.remove(), 4700);
}
let modalOnClose = null;
function openModal(html, onClose) {
  $('#modalCard').innerHTML = html;
  $('#modal').hidden = false;
  modalOnClose = onClose || null;
  $$('[data-close]', $('#modalCard')).forEach(b => b.onclick = closeModal);
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modalCard').innerHTML = '';
  const f = modalOnClose; modalOnClose = null;
  if (f) f();
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
const pill = (map, k) => map[k] ? `<span class="pill ${map[k].c}"><i class="fa-solid ${map[k].i}"></i>${map[k].t}</span>` : '';
const dtTH = s => s ? new Date(s.replace(' ', 'T')).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) + ' ' + s.slice(11, 16) + ' น.' : '—';
const dTH = s => s ? new Date(s.slice(0, 10) + 'T00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const nowParts = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` }; };
const catOf = key => (S.boot?.categories || []).find(c => c.key === key);
function aqlOf(lot) {
  lot = Number(String(lot).replace(/,/g, ''));
  if (!(lot >= 1) || Math.floor(lot) !== lot) return null;
  if (lot === 1) return { code: 'A', n: 1, ac: 0, re: 1 };
  const t = S.boot.aql.table;
  const r = t.find(r => lot >= r[0] && lot <= r[1]) || t[t.length - 1];
  return { code: r[2], n: r[3], ac: r[4], re: r[5] };
}

/* ---------- user name ---------- */
function paintUser() {
  $('#userName').textContent = S.user || 'ระบุชื่อผู้ใช้';
  $('#userChip').classList.toggle('warn', !S.user);
  $('#roleChip').hidden = !S.sess;
  if (S.sess) $('#roleName').textContent = ROLE_TH[S.sess.role];
}
function askName(required) {
  return new Promise(resolve => {
    openModal(`<h3><i class="fa-solid fa-user"></i> ชื่อผู้ใช้งาน</h3>
      <p class="hint">${required ? 'ต้องระบุชื่อก่อนบันทึก — ' : ''}ชื่อนี้จะถูกบันทึกเป็น “ผู้บันทึก” ในทุกรายการ (เก็บไว้ในเครื่องนี้)</p>
      <form id="nmForm"><input class="inp" id="nmIn" maxlength="100" value="${esc(S.user)}" placeholder="ชื่อ-นามสกุล">
      <div class="acts"><button type="button" class="btn ghost" data-close>ยกเลิก</button><button class="btn primary">บันทึกชื่อ</button></div></form>`, () => resolve(S.user));
    $('#nmIn').focus();
    $('#nmForm').onsubmit = e => {
      e.preventDefault();
      const v = $('#nmIn').value.trim().slice(0, 100);
      if (!v) return;
      S.user = v; store('set', 'oft_user', v); paintUser(); closeModal();
    };
  });
}
$('#userChip').onclick = () => askName(false);
$('#roleChip').onclick = async () => {
  if (!confirm('ล็อกรหัสผ่าน (' + ROLE_TH[S.sess.role] + ') ของแท็บนี้?')) return;
  try { await api('logout', {}); } catch {}
  setSess(null);
  route();
};

/* ---------- bootstrap data ---------- */
async function loadBoot(force) {
  if (!force && S.boot) return S.boot;
  if (!S.boot) { try { S.boot = JSON.parse(store('get', 'oft_boot') || 'null'); } catch {} }
  try {
    const d = await api('bootstrap');
    S.boot = d;
    store('set', 'oft_boot', JSON.stringify({ ...d, role: null }));
    if (d.role === null && S.sess) setSess(null);
  } catch (e) {
    if (!S.boot) throw e;
  }
  const n = S.boot.pending || 0;
  $('#pendingBadge').hidden = !n;
  $('#pendingBadge').textContent = n;
  return S.boot;
}

/* ---------- images: resize in the browser, load back through the API ---------- */
function resizeImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('ไฟล์ ' + file.name + ' ไม่ใช่รูปภาพ'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูป ' + file.name + ' ไม่ได้')); };
    img.src = url;
  });
}
async function fileSrc(id) {
  if (!id) return '';
  if (/^data:/.test(id)) return id;
  if (!S.files[id]) S.files[id] = api('file', { id }).then(d => `data:${d.mime};base64,${d.data}`).catch(() => '');
  return S.files[id];
}
function hydrateImages(root = view) {
  $$('img[data-fid]', root).forEach(async im => {
    const src = await fileSrc(im.dataset.fid);
    if (src) { im.src = src; im.classList.add('ok'); } else im.alt = 'โหลดรูปไม่ได้';
  });
}

/* ---------- signature pad ---------- */
function signPad(canvas) {
  const g = canvas.getContext('2d');
  let drawing = false, dirty = false, last = null;
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const k = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * k)); canvas.height = Math.max(1, Math.round(r.height * k));
    g.setTransform(k, 0, 0, k, 0, 0);
    g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0f172a';
    dirty = false;
  };
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke();
    last = p; dirty = true;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  requestAnimationFrame(fit);
  // phone rotated / window resized: refit the canvas and redraw what was signed
  let lastW = 0;
  const onResize = () => {
    if (!canvas.isConnected) { window.removeEventListener('resize', onResize); return; }
    const w = canvas.getBoundingClientRect().width;
    if (!w || Math.abs(w - lastW) < 2) return;
    lastW = w;
    const had = dirty ? canvas.toDataURL('image/png') : null;
    const ow = canvas.width, oh = canvas.height;
    fit();
    if (had) {
      const im = new Image();
      im.onload = () => { const k = window.devicePixelRatio || 1; g.drawImage(im, 0, 0, ow, oh, 0, 0, canvas.width / k, canvas.height / k); dirty = true; };
      im.src = had;
    }
  };
  requestAnimationFrame(() => { lastW = canvas.getBoundingClientRect().width; });
  window.addEventListener('resize', onResize);
  return { clear: fit, empty: () => !dirty, data: () => canvas.toDataURL('image/png') };
}

/* ================= page: ตรวจรับใหม่ / แก้ไขใบที่ถูกตีกลับ ================= */
async function pageForm(editId) {
  const b = await loadBoot();
  let old = null;
  if (editId) {
    old = (await api('inspection', { id: editId })).inspection;
    if (old.status !== 'returned') setTitle('แก้ไขใบ ' + old.doc_no, 'ผู้ดูแลระบบ · สถานะคงเดิม');
    if (old.status !== 'returned' && !can('admin')) { view.innerHTML = `<div class="card empty"><i class="fa-solid fa-lock"></i>ใบ ${esc(old.doc_no)} อยู่ในสถานะ “${STATUS[old.status].t}” แก้ไขได้เฉพาะใบที่ถูกตีกลับ</div>`; return; }
  }
  const sups = b.suppliers.filter(s => s.active || (old && s.id === old.supplier_id));
  const items = b.items.filter(i => i.active || (old && i.id === old.item_id));
  if (!sups.length || !items.length) {
    view.innerHTML = `<div class="card empty"><i class="fa-solid fa-list-check"></i><b>ยังไม่มีรายชื่อ ${!sups.length ? 'Supplier' : ''}${!sups.length && !items.length ? ' และ ' : ''}${!items.length ? 'บรรจุภัณฑ์' : ''}</b><p>ผู้ดูแลระบบเพิ่มได้ที่เมนู “ตั้งค่ารายชื่อ”</p><a class="btn primary" href="#settings"><i class="fa-solid fa-gear"></i> ไปหน้าตั้งค่า</a></div>`;
    return;
  }
  const np = nowParts();
  const f = {
    date: old ? old.received_at.slice(0, 10) : np.date, time: old ? old.received_at.slice(11, 16) : np.time,
    photos: old ? old.photos.slice() : [], bill: old ? old.bill_photo : '', sign: old ? old.inspector_sign : '',
  };
  const opt = (list, sel, lab) => `<option value="">— เลือก —</option>` + list.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(lab(x))}</option>`).join('');
  view.innerHTML = `
  ${old && old.status === 'returned' ? `<div class="banner red"><i class="fa-solid fa-rotate-left"></i><div><b>${esc(old.doc_no)} ถูกตีกลับ</b> โดย ${esc(old.head)} · ${dtTH(old.returned_at)}<br>เหตุผล: ${esc(old.return_reason)}</div></div>` : ''}
  ${old && old.status !== 'returned' ? `<div class="banner blue"><i class="fa-solid fa-user-shield"></i><div><b>ผู้ดูแลระบบแก้ไข ${esc(old.doc_no)}</b> · สถานะคงเดิม (${STATUS[old.status].t})</div></div>` : ''}
  <form id="pf" class="pf" novalidate>
  <section class="card sec">
    <h2><span class="num">1</span>ข้อมูลการรับเข้า</h2>
    <div class="grid2">
      <label class="fld"><span>วันที่และเวลาที่รับเข้า <em>*</em></span><span class="row2"><input type="date" class="inp" name="received_date" value="${f.date}" required><input type="time" class="inp" name="received_time" value="${f.time}" required></span></label>
      <label class="fld"><span>ชื่อบริษัท Supplier / ผู้จัดส่ง <em>*</em></span><select class="inp" name="supplier_id" required>${opt(sups, old?.supplier_id, s => s.name + (s.active ? '' : ' (ปิดใช้งาน)'))}</select></label>
      <label class="fld"><span>ชื่อรายการ Packaging <em>*</em></span><select class="inp" name="item_id" required>${opt(items, old?.item_id, i => i.name + (i.code ? ' · ' + i.code : '') + (i.active ? '' : ' (ปิดใช้งาน)'))}</select></label>
      <label class="fld">รหัสสินค้า (Item Code / SKU)<input class="inp" id="itemCode" readonly placeholder="เลือกรายการก่อน"></label>
      <label class="fld"><span>เลขที่ใบสั่งซื้อ (PO No.) <em>*</em></span><input class="inp" name="po_no" maxlength="60" value="${esc(old?.po_no)}" placeholder="PO-2026-XXXX" required></label>
      <label class="fld"><span>เลขที่ใบส่งของ (Invoice / Delivery Note) <em>*</em></span><input class="inp" name="invoice_no" maxlength="60" value="${esc(old?.invoice_no)}" placeholder="DN-2026-XXXX" required></label>
      <label class="fld"><span>จำนวนที่ส่งมอบ (Lot / Order Qty) <em>*</em></span><span class="row2 r21"><input class="inp" name="lot_qty" inputmode="numeric" value="${old ? old.lot_qty : ''}" placeholder="เช่น 5000" required><input class="inp" name="unit" maxlength="30" value="${esc(old?.unit || 'ชิ้น')}"></span></label>
      <label class="fld">จำนวนสุ่มตรวจ (Sample Size / AQL)<input class="inp" id="sampleOut" readonly placeholder="คำนวณจากจำนวนที่ส่งมอบ"></label>
      <label class="fld"><span>เลขที่ Lot / Batch No. <em>*</em></span><input class="inp" name="lot_no" maxlength="60" value="${esc(old?.lot_no)}" placeholder="LOT-20261113-01" required></label>
    </div>
  </section>

  <section class="card sec">
    <h2><span class="num">2</span>เกณฑ์การตรวจสอบทางกายภาพแยกตามหมวดหมู่บรรจุภัณฑ์ <small>(Inspection Criteria)</small></h2>
    <p class="hint">หมวดถูกเลือกให้อัตโนมัติตามรายการบรรจุภัณฑ์ — ทำเครื่องหมายรายการที่ตรวจแล้ว และเลือกผล Pass / Fail</p>
    <div class="tbl-wrap"><table class="crit" id="critTbl"></table></div>
  </section>

  <section class="card sec">
    <h2><span class="num">3</span>ระดับการตรวจสอบตามมาตรฐาน AQL</h2>
    <div class="aql-strip">
      <div><small>ระดับการตรวจสอบแบบทั่วไป</small><b>ระดับ ${esc(b.aql.level)}</b></div>
      <div><small>ระดับคุณภาพที่ยอมรับ (AQL)</small><b>${esc(b.aql.value)}</b></div>
      <div><small>Sample Size Code</small><b id="aqlCode">—</b></div>
      <div><small>ผู้จัดจำหน่าย</small><b id="aqlVendor">—</b></div>
    </div>
    <div class="grid4">
      <div class="stat"><small>จำนวนทั้งหมด (Total Qty)</small><b id="qTotal">—</b></div>
      <div class="stat"><small>จำนวนตัวอย่าง (Sample Size)</small><b id="qN">—</b></div>
      <div class="stat ok"><small>จำนวนยอมรับ (Accept ≤)</small><b id="qAc">—</b></div>
      <div class="stat bad"><small>จำนวนปฏิเสธ (Reject ≥)</small><b id="qRe">—</b></div>
    </div>
    <div class="grid2 mt">
      <label class="fld">จำนวนชิ้นที่พบข้อบกพร่อง (จากตัวอย่าง)<input class="inp" name="defects" inputmode="numeric" value="${old ? old.defects : 0}"></label>
      <div class="fld"><span>ผลตามเกณฑ์ AQL</span><div id="aqlVerdict" class="verdict">—</div></div>
    </div>
    <details class="aql-ref"><summary><i class="fa-solid fa-table"></i> ตาราง AQL ระดับ II · 6.5</summary>
      <table class="mini"><thead><tr><th>ขนาด Lot</th><th>Code</th><th>ตัวอย่าง</th><th>Ac</th><th>Re</th></tr></thead><tbody>
      ${b.aql.table.map(r => `<tr><td>${fmt(r[0])} – ${fmt(r[1])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td></tr>`).join('')}
      <tr><td>10,001 ขึ้นไป</td><td>L</td><td>200</td><td>21</td><td>22</td></tr></tbody></table></details>
    <div id="weightBox"></div>
  </section>

  <section class="card sec">
    <h2><span class="num">4</span>ผลการตรวจรับ หลักฐาน และการลงนาม</h2>
    <div class="fld"><span>ผลการตรวจรับรวม <em>*</em></span>
      <div class="seg" id="resultSeg"><label><input type="radio" name="result" value="pass" ${old?.result === 'pass' ? 'checked' : ''}><span class="g"><i class="fa-solid fa-check"></i> ผ่าน</span></label><label><input type="radio" name="result" value="fail" ${old?.result === 'fail' ? 'checked' : ''}><span class="r"><i class="fa-solid fa-xmark"></i> ไม่ผ่าน</span></label></div>
      <small class="hint" id="autoHint"></small></div>
    <label class="fld">รายละเอียดข้อบกพร่อง / Action Taken (Defect Details &amp; Action)<textarea class="inp" name="defect_detail" rows="3" maxlength="2000" placeholder="ระบุสิ่งที่ตรวจพบไม่ผ่านเกณฑ์ ปริมาณของที่เสีย หรือเงื่อนไขการรับสินค้า…">${esc(old?.defect_detail)}</textarea><small class="hint">* กรณีไม่ผ่าน หรือรับแบบมีเงื่อนไข กรุณาระบุรายละเอียดข้อบกพร่องให้ชัดเจน</small></label>

    <div class="sub-h"><b><i class="fa-solid fa-camera"></i> ภาพถ่ายประกอบการตรวจรับ (Inspection Photos &amp; Evidence)</b>
      <span><label class="btn sm primary"><i class="fa-solid fa-camera"></i> ถ่ายภาพ<input type="file" accept="image/*" capture="environment" hidden id="camIn"></label>
      <label class="btn sm dark"><i class="fa-solid fa-upload"></i> อัปโหลดรูป<input type="file" accept="image/*" multiple hidden id="upIn"></label></span></div>
    <p class="hint">ถ่ายภาพรถขนส่ง ป้าย Label สภาพสินค้า หรือข้อบกพร่องที่พบ (ไม่เกิน ${b.max_photos} รูป)</p>
    <div class="photos" id="photos"></div>

    <div class="sign-grid">
      <div class="sign-box">
        <div class="sb-h"><b>1. ผู้ตรวจรับงาน (Inspected By) <em>*</em></b><button type="button" class="lnk" id="signClear">ล้างลายเซ็น</button></div>
        <div class="pad-wrap">${f.sign ? `<img class="old-sign" data-fid="${esc(f.sign)}" alt="ลายเซ็นเดิม">` : ''}<canvas id="signPad" ${f.sign ? 'hidden' : ''}></canvas></div>
        ${f.sign ? '<button type="button" class="lnk" id="signRedo">เซ็นใหม่</button>' : ''}
        <input class="inp" name="inspector" maxlength="100" value="${esc(old?.inspector || S.user)}" placeholder="ชื่อ-นามสกุล ผู้ตรวจรับ">
      </div>
      <div class="sign-box muted"><div class="sb-h"><b>2. หัวหน้างาน QC (Verified By)</b></div><div class="pad-wrap note"><i class="fa-solid fa-hourglass-half"></i>หัวหน้า QC ลงนามในขั้นอนุมัติ (เมนู “รออนุมัติ”)</div></div>
      <div class="sign-box">
        <div class="sb-h"><b>3. ตัวแทนผู้จัดส่ง / Supplier <em>*</em></b></div>
        <p class="hint">ถ่ายรูปบิลที่ Supplier ลงลายมือชื่อแล้วแนบ</p>
        <div class="bill" id="bill"></div>
        <span class="row2"><label class="btn sm primary"><i class="fa-solid fa-camera"></i> ถ่ายรูปบิล<input type="file" accept="image/*" capture="environment" hidden id="billCam"></label><label class="btn sm dark"><i class="fa-solid fa-upload"></i> เลือกไฟล์<input type="file" accept="image/*" hidden id="billUp"></label></span>
      </div>
    </div>
  </section>
  <div class="form-acts">
    <button type="button" class="btn ghost" id="resetBtn"><i class="fa-solid fa-eraser"></i> ${old ? 'ยกเลิก' : 'ล้างฟอร์ม'}</button>
    <button class="btn green big" id="submitBtn"><i class="fa-solid fa-floppy-disk"></i> ${old ? (old.status === 'returned' ? 'ส่งให้หัวหน้า QC อีกครั้ง' : 'บันทึกการแก้ไข') : 'บันทึกผลการตรวจรับ (Submit Inspection)'}</button>
  </div>
  </form>`;

  const form = $('#pf');
  const el = n => form.elements[n];
  const state = { checks: old ? old.checks.slice() : [], cat_result: old?.cat_result || '', strength: old?.strength || '', weights: old ? old.weights.slice() : [], wmin: old?.wmin ?? null, wmax: old?.wmax ?? null, wunit: old?.wunit || 'g', autoResult: '' };
  const pad = signPad($('#signPad'));
  const curItem = () => b.items.find(i => i.id === Number(el('item_id').value));
  // the category the sheet was recorded with stays while its item is unchanged (the server does the same)
  const catKey = () => { const it = curItem(); return !it ? '' : old && it.id === old.item_id ? old.category : it.category; };
  const reqId = 'r' + Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join(''); // a retried submit returns the same sheet

  function renderCrit() {
    const cat = catKey();
    $('#critTbl').innerHTML = `<thead><tr><th>หมวดหมู่บรรจุภัณฑ์</th><th>กายภาพ</th><th>น้ำหนัก</th><th>รายละเอียดข้อกำหนดการตรวจสอบทางกายภาพ</th><th>ผลตรวจ</th></tr></thead><tbody>` +
      b.categories.map(c => {
        const on = c.key === cat;
        return `<tr class="${on ? 'on' : 'off'}"><td><b>${esc(c.name)}</b>${on ? '<span class="pill blue sm">หมวดของรายการนี้</span>' : ''}</td><td class="ck">✓</td><td class="ck">${c.weight ? '✓' : '-'}</td>
        <td>${c.checks.map((t, i) => `<label class="cb"><input type="checkbox" data-ck="${i}" ${on ? '' : 'disabled'} ${on && state.checks[i] ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}
        ${c.strength ? `<div class="strength">ความแข็งแรงกล่อง: ${['3', '5'].map(v => `<label><input type="radio" name="strength" value="${v}" ${on ? '' : 'disabled'} ${on && state.strength === v ? 'checked' : ''}> ${v} ชั้น</label>`).join(' ')}</div>` : ''}</td>
        <td>${on ? `<select class="inp sm res-sel ${state.cat_result}" id="catRes"><option value="">-</option><option value="pass" ${state.cat_result === 'pass' ? 'selected' : ''}>✓ Pass</option><option value="fail" ${state.cat_result === 'fail' ? 'selected' : ''}>✗ Fail</option></select>` : '<span class="dim">-</span>'}</td></tr>`;
      }).join('') + '</tbody>';
    $$('[data-ck]', $('#critTbl')).forEach(cb => cb.onchange = () => { state.checks[+cb.dataset.ck] = cb.checked; });
    $$('input[name=strength]', $('#critTbl')).forEach(r => r.onchange = () => { state.strength = r.value; });
    const sel = $('#catRes');
    if (sel) sel.onchange = () => { state.cat_result = sel.value; sel.className = 'inp sm res-sel ' + sel.value; refresh(); };
  }

  function renderWeights() {
    const it = curItem();
    const cat = it && catOf(catKey());
    const plan = aqlOf(el('lot_qty').value);
    const box = $('#weightBox');
    if (!cat || !cat.weight) { box.innerHTML = it ? '<p class="hint mt"><i class="fa-solid fa-circle-info"></i> หมวดนี้ไม่ต้องชั่งน้ำหนัก</p>' : ''; return; }
    if (!plan) { box.innerHTML = '<p class="hint mt"><i class="fa-solid fa-circle-info"></i> กรอกจำนวนที่ส่งมอบก่อน เพื่อสร้างตารางน้ำหนักตามจำนวนตัวอย่าง</p>'; return; }
    state.weights.length = Math.min(state.weights.length, plan.n);
    box.innerHTML = `<div class="w-head"><h3><i class="fa-solid fa-weight-scale"></i> ส่วนบันทึกน้ำหนักตัวอย่าง (Weight Sampling)</h3><small>สุ่มตรวจชิ้นที่ 1 – ${plan.n} · กรอกเท่าที่ชั่ง</small></div>
      <div class="grid3">
        <label class="fld">น้ำหนักต่ำสุด (Min)<input class="inp" id="wmin" inputmode="decimal" value="${state.wmin ?? ''}"></label>
        <label class="fld">น้ำหนักสูงสุด (Max)<input class="inp" id="wmax" inputmode="decimal" value="${state.wmax ?? ''}"></label>
        <label class="fld">หน่วย<input class="inp" id="wunit" maxlength="10" value="${esc(state.wunit)}"></label>
      </div>
      <div class="wgrid" id="wgrid">${Array.from({ length: plan.n }, (_, i) => `<label><small>${i + 1}</small><input inputmode="decimal" data-w="${i}" value="${state.weights[i] ?? ''}"></label>`).join('')}</div>
      <div class="w-sum" id="wsum"></div>`;
    $('#wmin').oninput = () => { state.wmin = numOr($('#wmin').value); paintW(); refresh(); };
    $('#wmax').oninput = () => { state.wmax = numOr($('#wmax').value); paintW(); refresh(); };
    $('#wunit').oninput = () => { state.wunit = $('#wunit').value.trim(); paintW(); };
    $$('[data-w]', box).forEach(inp => inp.oninput = () => { state.weights[+inp.dataset.w] = numOr(inp.value); paintW(); refresh(); });
    paintW();
  }
  const numOr = v => { const s = String(v).replace(/,/g, '').trim(); if (s === '') return null; const x = Number(s); return isFinite(x) && x >= 0 ? x : null; };
  function wStats() {
    const vals = state.weights.filter(w => w != null);
    const out = vals.filter(w => (state.wmin != null && w < state.wmin) || (state.wmax != null && w > state.wmax)).length;
    return { n: vals.length, avg: vals.length ? vals.reduce((a, b2) => a + b2, 0) / vals.length : null, out };
  }
  function paintW() {
    $$('[data-w]', view).forEach(inp => {
      const w = state.weights[+inp.dataset.w];
      inp.classList.toggle('bad', w != null && ((state.wmin != null && w < state.wmin) || (state.wmax != null && w > state.wmax)));
      inp.classList.toggle('filled', w != null);
    });
    const s = wStats(), u = esc(state.wunit || '');
    if ($('#wsum')) $('#wsum').innerHTML = `<div><small>เกณฑ์การยอมรับน้ำหนัก</small><b>${state.wmin ?? '—'} – ${state.wmax ?? '—'} ${u}</b></div>
      <div class="avg"><small>น้ำหนักเฉลี่ย (คำนวณอัตโนมัติ)</small><b>${s.avg == null ? '—' : fmt(s.avg, 3) + ' ' + u}</b></div>
      <div><small>ชั่งแล้ว</small><b>${s.n} ชิ้น</b></div><div class="${s.out ? 'bad' : ''}"><small>นอกเกณฑ์</small><b>${s.out} ชิ้น</b></div>`;
  }

  function refresh() {
    const it = curItem();
    $('#itemCode').value = it ? (it.code || '—') : '';
    const sup = b.suppliers.find(s => s.id === Number(el('supplier_id').value));
    $('#aqlVendor').textContent = sup ? sup.name : '—';
    const plan = aqlOf(el('lot_qty').value);
    const unit = el('unit').value || 'ชิ้น';
    $('#sampleOut').value = plan ? `${plan.n} ${unit} (Code ${plan.code})` : '';
    $('#aqlCode').textContent = plan ? plan.code : '—';
    $('#qTotal').textContent = plan ? fmt(Number(String(el('lot_qty').value).replace(/,/g, ''))) + ' ' + unit : '—';
    $('#qN').textContent = plan ? plan.n + ' ' + unit : '—';
    $('#qAc').textContent = plan ? plan.ac + ' ' + unit : '—';
    $('#qRe').textContent = plan ? plan.re + ' ' + unit : '—';
    const dRaw = String(el('defects').value).trim();
    const d = /^\d+$/.test(dRaw) ? Number(dRaw) : null;
    const v = $('#aqlVerdict');
    if (!plan || d == null) { v.className = 'verdict'; v.textContent = plan ? 'กรอกจำนวนข้อบกพร่อง' : '—'; }
    else if (d > plan.n) { v.className = 'verdict bad'; v.textContent = 'เกินจำนวนตัวอย่าง (' + plan.n + ')'; }
    else if (d >= plan.re) { v.className = 'verdict bad'; v.innerHTML = '<i class="fa-solid fa-xmark"></i> Reject (พบ ' + d + ' ≥ ' + plan.re + ')'; }
    else { v.className = 'verdict ok'; v.innerHTML = '<i class="fa-solid fa-check"></i> Accept (พบ ' + d + ' ≤ ' + plan.ac + ')'; }
    // proposed overall result
    const why = [];
    if (state.cat_result === 'fail') why.push('หมวดบรรจุภัณฑ์ Fail');
    if (plan && d != null && d >= plan.re) why.push('ข้อบกพร่องถึงเกณฑ์ปฏิเสธ');
    const cat = it && catOf(catKey());
    if (cat && cat.weight && wStats().out) why.push('น้ำหนักนอกเกณฑ์ ' + wStats().out + ' ชิ้น');
    const ready = state.cat_result && plan && d != null;
    state.autoResult = why.length ? 'fail' : ready ? 'pass' : '';
    const cur = form.querySelector('input[name=result]:checked');
    $('#autoHint').innerHTML = state.autoResult ? `ระบบเสนอ: <b class="${state.autoResult === 'fail' ? 'tbad' : 'tok'}">${RESULT[state.autoResult].t}</b>${why.length ? ' (' + why.join(', ') + ')' : ''}${cur && cur.value !== state.autoResult ? ' · <span class="tbad">ผลที่เลือกต่างจากที่ระบบเสนอ</span>' : ''}` : '';
    if (!cur && state.autoResult && !refresh.touched) form.querySelector(`input[name=result][value=${state.autoResult}]`).checked = true;
    else if (cur && !refresh.touched && state.autoResult && cur.value !== state.autoResult) form.querySelector(`input[name=result][value=${state.autoResult}]`).checked = true;
  }
  refresh.touched = !!old;

  function renderPhotos() {
    $('#photos').innerHTML = f.photos.length ? f.photos.map((p, i) => `<figure><img ${/^data:/.test(p) ? `src="${p}" class="ok"` : `data-fid="${esc(p)}"`} alt="รูปที่ ${i + 1}"><button type="button" class="x" data-rm="${i}" aria-label="ลบรูป"><i class="fa-solid fa-xmark"></i></button></figure>`).join('')
      : '<div class="drop"><i class="fa-regular fa-image"></i>ยังไม่มีภาพถ่ายประกอบ — กด “ถ่ายภาพ” หรือ “อัปโหลดรูป”</div>';
    $$('[data-rm]', $('#photos')).forEach(x => x.onclick = () => { f.photos.splice(+x.dataset.rm, 1); renderPhotos(); });
    hydrateImages($('#photos'));
  }
  function renderBill() {
    $('#bill').innerHTML = f.bill ? `<figure><img ${/^data:/.test(f.bill) ? `src="${f.bill}" class="ok"` : `data-fid="${esc(f.bill)}"`} alt="บิลที่ Supplier ลงชื่อ"><button type="button" class="x" id="billRm" aria-label="ลบรูปบิล"><i class="fa-solid fa-xmark"></i></button></figure>` : '<div class="drop sm"><i class="fa-solid fa-file-signature"></i>ยังไม่ได้แนบรูปบิล</div>';
    if ($('#billRm')) $('#billRm').onclick = () => { f.bill = ''; renderBill(); };
    hydrateImages($('#bill'));
  }
  async function addPhotos(files) {
    for (const file of files) {
      if (f.photos.length >= b.max_photos) { toast('แนบรูปได้ไม่เกิน ' + b.max_photos + ' รูป', 'warn'); break; }
      try { f.photos.push(await resizeImage(file)); } catch (e) { toast(e.message, 'err'); }
    }
    renderPhotos();
  }
  $('#camIn').onchange = e => { addPhotos([...e.target.files]); e.target.value = ''; };
  $('#upIn').onchange = e => { addPhotos([...e.target.files]); e.target.value = ''; };
  const setBill = async file => { if (!file) return; try { f.bill = await resizeImage(file); renderBill(); } catch (e) { toast(e.message, 'err'); } };
  $('#billCam').onchange = e => { setBill(e.target.files[0]); e.target.value = ''; };
  $('#billUp').onchange = e => { setBill(e.target.files[0]); e.target.value = ''; };
  $('#signClear').onclick = () => pad.clear();
  if ($('#signRedo')) $('#signRedo').onclick = () => { f.sign = ''; $('.old-sign', view)?.remove(); $('#signPad').hidden = false; $('#signRedo').remove(); pad.clear(); };

  el('item_id').onchange = () => {
    const it = curItem();
    state.checks = []; state.cat_result = ''; state.strength = ''; state.weights = [];
    state.wmin = it?.wmin ?? null; state.wmax = it?.wmax ?? null; state.wunit = it?.wunit || 'g';
    renderCrit(); renderWeights(); refresh();
  };
  el('supplier_id').onchange = refresh;
  el('lot_qty').oninput = () => { renderWeights(); refresh(); };
  el('unit').oninput = refresh;
  el('defects').oninput = refresh;
  $$('input[name=result]', form).forEach(r => r.onchange = () => { refresh.touched = true; refresh(); });
  $('#resetBtn').onclick = () => { if (old) { location.hash = '#sheet/' + old.id; return; } if (confirm('ล้างข้อมูลในฟอร์มทั้งหมด?')) { store('del', 'oft_draft'); pageForm(); } };

  if (old) { state.wmin = old.wmin; state.wmax = old.wmax; }
  else if (curItem()) { const it = curItem(); state.wmin = it.wmin; state.wmax = it.wmax; state.wunit = it.wunit || 'g'; }
  renderCrit(); renderWeights(); renderPhotos(); renderBill(); refresh(); hydrateImages();

  form.onsubmit = async e => {
    e.preventDefault();
    const miss = [];
    [['supplier_id', 'Supplier'], ['item_id', 'รายการ Packaging'], ['po_no', 'เลขที่ PO'], ['invoice_no', 'เลขที่ใบส่งของ'], ['lot_qty', 'จำนวนที่ส่งมอบ'], ['lot_no', 'เลขที่ Lot']]
      .forEach(([n, t]) => { const ok = String(el(n).value).trim() !== ''; el(n).classList.toggle('need', !ok); if (!ok) miss.push(t); });
    if (!aqlOf(el('lot_qty').value)) miss.push('จำนวนที่ส่งมอบ (จำนวนเต็ม)');
    if (!state.cat_result) miss.push('ผล Pass / Fail ของหมวดบรรจุภัณฑ์');
    const res = form.querySelector('input[name=result]:checked');
    if (!res) miss.push('ผลการตรวจรับรวม');
    if (res && res.value === 'fail' && !el('defect_detail').value.trim()) miss.push('รายละเอียดข้อบกพร่อง (ผลไม่ผ่าน)');
    if (!f.bill) miss.push('รูปบิลที่ Supplier ลงชื่อ');
    if (!f.sign && pad.empty()) miss.push('ลายเซ็นผู้ตรวจรับ');
    if (!el('inspector').value.trim()) miss.push('ชื่อผู้ตรวจรับ');
    if (miss.length) { toast('กรุณากรอก: ' + miss.join(', '), 'warn'); return; }
    const body = {
      received_date: el('received_date').value, received_time: el('received_time').value,
      supplier_id: el('supplier_id').value, item_id: el('item_id').value, po_no: el('po_no').value, invoice_no: el('invoice_no').value,
      lot_qty: el('lot_qty').value, unit: el('unit').value, lot_no: el('lot_no').value, defects: el('defects').value || '0',
      checks: catOf(catKey()).checks.map((_, i) => !!state.checks[i]), cat_result: state.cat_result, strength: state.strength,
      weights: state.weights, wmin: state.wmin ?? '', wmax: state.wmax ?? '', wunit: state.wunit,
      result: res.value, defect_detail: el('defect_detail').value, photos: f.photos, bill_photo: f.bill,
      inspector: el('inspector').value, inspector_sign: f.sign || pad.data(),
    };
    if (old) body.id = old.id; else body.req_id = reqId;
    const btn = $('#submitBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก…';
    try {
      const d = await api(old && old.status !== 'returned' ? 'inspection_update' : 'submit', body);
      toast(d.message, 'ok');
      await loadBoot(true);
      location.hash = '#sheet/' + d.id;
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> ลองบันทึกอีกครั้ง';
    }
  };
}

/* ================= page: รออนุมัติ ================= */
async function pagePending() {
  await loadBoot(true);
  const items = (await api('history', { status: 'pending' })).items;
  view.innerHTML = `<div class="card">
    <div class="card-h"><h2><i class="fa-solid fa-hourglass-half"></i> รอหัวหน้า QC อนุมัติ <span class="pill amber">${items.length} ใบ</span></h2>
    ${can('qc') ? `<span class="pill blue"><i class="fa-solid fa-user-shield"></i> ${ROLE_TH[S.sess.role]}</span>` : '<button class="btn sm primary" id="qcLogin"><i class="fa-solid fa-key"></i> หัวหน้า QC ใส่รหัส</button>'}</div>
    ${items.length ? listTable(items) : '<div class="empty"><i class="fa-solid fa-mug-hot"></i>ไม่มีใบที่รออนุมัติ</div>'}</div>`;
  if ($('#qcLogin')) $('#qcLogin').onclick = async () => { if (await askUnlock('qc', 'ใส่รหัสหัวหน้า QC เพื่ออนุมัติ / ตีกลับใบตรวจรับ')) pagePending(); };
}
function listTable(items) {
  return `<div class="tbl-wrap"><table class="list"><thead><tr><th>เลขที่</th><th>วันที่รับเข้า</th><th>Supplier</th><th>บรรจุภัณฑ์</th><th>PO / Lot</th><th class="num">จำนวน</th><th>ผล</th><th>สถานะ</th><th>ผู้ตรวจรับ</th></tr></thead><tbody>
  ${items.map(r => `<tr data-open="${r.id}"><td><b>${esc(r.doc_no)}</b></td><td class="nw">${dtTH(r.received_at)}</td><td>${esc(r.supplier_name)}</td><td>${esc(r.item_name)}<br><small class="dim">${esc(r.item_code)}</small></td>
  <td><small>PO</small> ${esc(r.po_no)}<br><small>Lot</small> ${esc(r.lot_no)}</td><td class="num nw">${fmt(r.lot_qty)} ${esc(r.unit)}</td><td>${pill(RESULT, r.result)}</td><td>${pill(STATUS, r.status)}</td><td>${esc(r.inspector)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
view.addEventListener('click', e => {
  const tr = e.target.closest('[data-open]');
  if (tr) location.hash = '#sheet/' + tr.dataset.open;
});

/* ================= page: ประวัติ ================= */
async function pageHistory() {
  const b = await loadBoot();
  const q = S.histQ || { q: '', supplier_id: '', item_id: '', status: '', result: '', from: '', to: '' };
  view.innerHTML = `<div class="card">
    <form class="filters" id="hf">
      <input class="inp" name="q" value="${esc(q.q)}" placeholder="ค้นหา เลขที่ใบ / PO / Lot / ใบส่งของ / ชื่อ">
      <select class="inp" name="supplier_id"><option value="">ทุก Supplier</option>${b.suppliers.map(s => `<option value="${s.id}" ${String(s.id) === String(q.supplier_id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <select class="inp" name="item_id"><option value="">ทุกบรรจุภัณฑ์</option>${b.items.map(i => `<option value="${i.id}" ${String(i.id) === String(q.item_id) ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
      <select class="inp" name="status"><option value="">ทุกสถานะ</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${q.status === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select>
      <select class="inp" name="result"><option value="">ทุกผล</option>${Object.entries(RESULT).map(([k, v]) => `<option value="${k}" ${q.result === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select>
      <label class="dt"><small>ตั้งแต่</small><input type="date" class="inp" name="from" value="${q.from}"></label>
      <label class="dt"><small>ถึง</small><input type="date" class="inp" name="to" value="${q.to}"></label>
      <button class="btn primary"><i class="fa-solid fa-magnifying-glass"></i> ค้นหา</button>
    </form>
    <div id="hres"><div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลด…</div></div></div>`;
  const run = async () => {
    const fd = Object.fromEntries(new FormData($('#hf')));
    S.histQ = fd;
    try {
      const items = (await api('history', fd)).items;
      $('#hres').innerHTML = `<p class="hint">${fmt(items.length)} ใบ</p>` + (items.length ? listTable(items) : '<div class="empty"><i class="fa-solid fa-magnifying-glass"></i>ไม่พบใบตรวจรับ</div>');
    } catch (e) { $('#hres').innerHTML = `<div class="empty err">${esc(e.message)}</div>`; }
  };
  $('#hf').onsubmit = e => { e.preventDefault(); run(); };
  run();
}

/* ================= page: ใบตรวจรับ (ดู / พิมพ์ / อนุมัติ) ================= */
async function pageSheet(id) {
  const b = await loadBoot();
  const r = (await api('inspection', { id })).inspection;
  const cat = catOf(r.category) || { name: r.category, checks: [], weight: false };
  setTitle('ใบตรวจรับ ' + r.doc_no, r.supplier_name + ' · ' + r.item_name);
  const ws = r.weights.map((w, i) => ({ w, i })).filter(x => x.w != null);
  const outW = w => (r.wmin != null && w < r.wmin) || (r.wmax != null && w > r.wmax);
  view.innerHTML = `
  <div class="sheet-acts no-print">
    <a class="btn ghost" href="javascript:history.back()"><i class="fa-solid fa-arrow-left"></i> กลับ</a>
    <span class="sp"></span>
    ${r.status === 'returned' ? `<a class="btn amber" href="#edit/${r.id}"><i class="fa-solid fa-pen"></i> แก้ไขแล้วส่งใหม่</a>` : ''}
    ${r.status === 'pending' ? `<button class="btn red" id="retBtn"><i class="fa-solid fa-rotate-left"></i> ตีกลับ</button><button class="btn green" id="appBtn"><i class="fa-solid fa-signature"></i> อนุมัติ</button>` : ''}
    <button class="btn dark" onclick="window.print()"><i class="fa-solid fa-print"></i> พิมพ์</button>
    ${can('admin') ? `<a class="btn ghost" href="#edit/${r.id}"><i class="fa-solid fa-pen-to-square"></i> แก้ไข (ผู้ดูแล)</a><button class="btn ghost red-t" id="delBtn"><i class="fa-solid fa-trash"></i> ลบ</button>` : ''}
  </div>
  <article class="card sheet">
    <header class="sh-h"><div><h2>${esc(b.form_title)}</h2><small>${esc(b.company.name)}</small></div><div class="sh-no"><b>${esc(r.doc_no)}</b>${pill(STATUS, r.status)}${pill(RESULT, r.result)}</div></header>
    ${r.status === 'returned' ? `<div class="banner red"><i class="fa-solid fa-rotate-left"></i><div>ตีกลับโดย <b>${esc(r.head)}</b> · ${dtTH(r.returned_at)}<br>เหตุผล: ${esc(r.return_reason)}</div></div>` : ''}
    <h3>1. ข้อมูลการรับเข้า</h3>
    <dl class="kv">
      <div><dt>วันที่และเวลาที่รับเข้า</dt><dd>${dtTH(r.received_at)}</dd></div><div><dt>Supplier / ผู้จัดส่ง</dt><dd>${esc(r.supplier_name)}</dd></div>
      <div><dt>รายการ Packaging</dt><dd>${esc(r.item_name)}</dd></div><div><dt>รหัสสินค้า</dt><dd>${esc(r.item_code || '—')}</dd></div>
      <div><dt>เลขที่ PO</dt><dd>${esc(r.po_no)}</dd></div><div><dt>เลขที่ใบส่งของ</dt><dd>${esc(r.invoice_no)}</dd></div>
      <div><dt>จำนวนที่ส่งมอบ</dt><dd>${fmt(r.lot_qty)} ${esc(r.unit)}</dd></div><div><dt>เลขที่ Lot / Batch</dt><dd>${esc(r.lot_no)}</dd></div>
    </dl>
    <h3>2. เกณฑ์การตรวจสอบ — ${esc(cat.name)} ${pill({ pass: { t: 'Pass', c: 'green', i: 'fa-check' }, fail: { t: 'Fail', c: 'red', i: 'fa-xmark' } }, r.cat_result)}</h3>
    <ul class="checks">${cat.checks.map((t, i) => `<li class="${r.checks[i] ? 'y' : 'n'}"><i class="fa-${r.checks[i] ? 'solid fa-square-check' : 'regular fa-square'}"></i>${esc(t)}</li>`).join('')}
    ${r.strength ? `<li class="y"><i class="fa-solid fa-box"></i>ความแข็งแรงกล่อง: ${esc(r.strength)} ชั้น</li>` : ''}</ul>
    <h3>3. AQL ระดับ ${esc(b.aql.level)} / ${esc(b.aql.value)}</h3>
    <div class="grid4 kv4"><div class="stat"><small>Code</small><b>${esc(r.aql_code)}</b></div><div class="stat"><small>ตัวอย่าง</small><b>${r.sample_n}</b></div><div class="stat ok"><small>Accept ≤</small><b>${r.ac}</b></div><div class="stat bad"><small>Reject ≥</small><b>${r.re}</b></div></div>
    <p>พบข้อบกพร่อง <b>${r.defects}</b> ชิ้น → ${r.defects >= r.re ? '<b class="tbad">Reject</b>' : '<b class="tok">Accept</b>'}</p>
    ${cat.weight ? `<h3>น้ำหนักตัวอย่าง</h3><p>เกณฑ์ ${r.wmin ?? '—'} – ${r.wmax ?? '—'} ${esc(r.wunit)} · เฉลี่ย <b>${r.w_avg == null ? '—' : fmt(r.w_avg, 3) + ' ' + esc(r.wunit)}</b> · ชั่ง ${r.w_count} ชิ้น · นอกเกณฑ์ <b class="${r.w_out ? 'tbad' : ''}">${r.w_out}</b> ชิ้น</p>
      ${ws.length ? `<div class="wgrid ro">${ws.map(x => `<span class="${outW(x.w) ? 'bad' : ''}"><small>${x.i + 1}</small>${x.w}</span>`).join('')}</div>` : ''}` : ''}
    <h3>4. ผลการตรวจรับ</h3>
    <p>ผลรวม: ${pill(RESULT, r.result)}</p>
    ${r.defect_detail ? `<div class="note-box"><small>รายละเอียดข้อบกพร่อง / Action Taken</small><p>${esc(r.defect_detail).replace(/\n/g, '<br>')}</p></div>` : ''}
    ${r.photos.length ? `<div class="photos ro">${r.photos.map((p, i) => `<figure><img data-fid="${esc(p)}" alt="รูปที่ ${i + 1}"></figure>`).join('')}</div>` : ''}
    <div class="sign-grid ro">
      <div class="sign-box"><b>1. ผู้ตรวจรับงาน</b><img class="sig" data-fid="${esc(r.inspector_sign)}" alt="ลายเซ็นผู้ตรวจรับ"><span>${esc(r.inspector)}</span><small>${dtTH(r.inspected_at)}</small></div>
      <div class="sign-box"><b>2. หัวหน้างาน QC</b>${r.head_sign ? `<img class="sig" data-fid="${esc(r.head_sign)}" alt="ลายเซ็นหัวหน้า QC"><span>${esc(r.head)}</span><small>${dtTH(r.approved_at)}</small>${r.head_comment ? `<small>“${esc(r.head_comment)}”</small>` : ''}` : '<div class="pad-wrap note">ยังไม่ได้อนุมัติ</div>'}</div>
      <div class="sign-box"><b>3. ตัวแทน Supplier (บิลที่ลงชื่อ)</b><img class="bill-img" data-fid="${esc(r.bill_photo)}" alt="บิลที่ Supplier ลงชื่อ"></div>
    </div>
    <footer class="sh-f">บันทึกโดย ${esc(r.created_by)} · ${dtTH(r.created_at)}${r.updated_at ? ' · แก้ไขล่าสุด ' + esc(r.updated_by) + ' ' + dtTH(r.updated_at) : ''}</footer>
  </article>`;
  hydrateImages();
  $$('img[data-fid]', view).forEach(im => im.onclick = () => im.src && openModal(`<img class="zoom" src="${im.src}" alt=""><div class="acts"><button class="btn ghost" data-close>ปิด</button></div>`));
  if ($('#appBtn')) $('#appBtn').onclick = () => decide(r, true);
  if ($('#retBtn')) $('#retBtn').onclick = () => decide(r, false);
  if ($('#delBtn')) $('#delBtn').onclick = async () => {
    if (!confirm('ลบใบ ' + r.doc_no + ' ถาวร (รวมรูปทั้งหมด)?')) return;
    try { toast((await api('inspection_delete', { id: r.id })).message); await loadBoot(true); location.hash = '#history'; } catch (e) { toast(e.message, 'err'); }
  };
}
async function decide(r, approve) {
  if (!(await askUnlock('qc', 'ใส่รหัสหัวหน้า QC เพื่อ' + (approve ? 'อนุมัติ' : 'ตีกลับ') + 'ใบ ' + r.doc_no))) return;
  const heads = S.boot.heads.filter(h => h.active);
  if (!heads.length) { toast('ยังไม่มีรายชื่อหัวหน้า QC — ผู้ดูแลเพิ่มได้ที่หน้าตั้งค่า', 'warn'); return; }
  const last = store('get', 'oft_head') || '';
  openModal(`<h3>${approve ? '<i class="fa-solid fa-signature"></i> อนุมัติ' : '<i class="fa-solid fa-rotate-left"></i> ตีกลับ'} ${esc(r.doc_no)}</h3>
    <form id="dcf">
      <label class="fld">ชื่อหัวหน้า QC<select class="inp" id="dcHead">${heads.map(h => `<option value="${h.id}" ${String(h.id) === last ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select></label>
      ${approve ? `<div class="fld"><span>ลายเซ็น <button type="button" class="lnk" id="dcClr">ล้าง</button></span><div class="pad-wrap"><canvas id="dcPad"></canvas></div></div>
        <label class="fld">ความเห็น (ถ้ามี)<textarea class="inp" id="dcCm" rows="2" maxlength="2000"></textarea></label>`
      : `<label class="fld"><span>เหตุผลที่ตีกลับ <em>*</em></span><textarea class="inp" id="dcWhy" rows="3" maxlength="2000" placeholder="เช่น PO ไม่ตรงกับใบส่งของ"></textarea></label>`}
      <div class="err" id="dcErr"></div>
      <div class="acts"><button type="button" class="btn ghost" data-close>ยกเลิก</button><button class="btn ${approve ? 'green' : 'red'}" id="dcGo">${approve ? 'ลงนามอนุมัติ' : 'ตีกลับ'}</button></div>
    </form>`);
  const pad = approve ? signPad($('#dcPad')) : null;
  if (pad) $('#dcClr').onclick = () => pad.clear();
  $('#dcf').onsubmit = async e => {
    e.preventDefault();
    const body = { id: r.id, head_id: $('#dcHead').value };
    if (approve) { if (pad.empty()) { $('#dcErr').textContent = 'กรุณาลงลายเซ็น'; return; } body.sign = pad.data(); body.comment = $('#dcCm').value; }
    else { body.reason = $('#dcWhy').value.trim(); if (!body.reason) { $('#dcErr').textContent = 'กรุณาระบุเหตุผล'; return; } }
    $('#dcGo').disabled = true;
    try {
      const d = await api(approve ? 'approve' : 'return', body);
      store('set', 'oft_head', body.head_id);
      closeModal(); toast(d.message, 'ok'); await loadBoot(true); route();
    } catch (err) { $('#dcErr').textContent = err.message; $('#dcGo').disabled = false; }
  };
}

/* ================= page: สรุป Supplier ================= */
async function pageSummary() {
  const now = new Date();
  const ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const q = S.sumQ || { from: ym(new Date(now.getFullYear(), now.getMonth() - 5, 1)), to: ym(now) };
  view.innerHTML = `<div class="card"><form class="filters" id="sf">
      <label class="dt"><small>ตั้งแต่เดือน</small><input type="month" class="inp" name="from" value="${q.from}"></label>
      <label class="dt"><small>ถึงเดือน</small><input type="month" class="inp" name="to" value="${q.to}"></label>
      <button class="btn primary"><i class="fa-solid fa-chart-column"></i> แสดง</button><button type="button" class="btn ghost" id="sfAll">ทั้งหมด</button></form>
    <div id="sres"><div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลด…</div></div></div>`;
  const lastDay = m => { const [y, mo] = m.split('-').map(Number); return m + '-' + String(new Date(y, mo, 0).getDate()).padStart(2, '0'); };
  const run = async all => {
    const fd = Object.fromEntries(new FormData($('#sf')));
    S.sumQ = fd;
    const p = all ? {} : { from: fd.from ? fd.from + '-01' : '', to: fd.to ? lastDay(fd.to) : '' };
    try {
      const s = await api('summary', p);
      $('#sres').innerHTML = `<div class="grid3 mt"><div class="stat"><small>ใบตรวจรับ (ไม่นับใบที่ตีกลับ)</small><b>${fmt(s.total)}</b></div><div class="stat bad"><small>ไม่ผ่าน</small><b>${fmt(s.fail)}</b></div><div class="stat"><small>% ไม่ผ่านรวม</small><b>${s.pct}%</b></div></div>
      ${s.rows.length ? `<div class="tbl-wrap"><table class="list sum"><thead><tr><th>#</th><th>Supplier</th><th class="num">ส่งมอบ</th><th class="num">ไม่ผ่าน</th><th>% ไม่ผ่าน</th><th>ไม่ผ่านล่าสุด</th></tr></thead><tbody>
      ${s.rows.map((r, i) => `<tr data-sup="${r.supplier_id}"><td>${i + 1}</td><td><b>${esc(r.supplier)}</b>${r.pending ? `<br><small class="dim">รออนุมัติ ${r.pending}</small>` : ''}</td><td class="num">${fmt(r.total)}</td><td class="num ${r.fail ? 'tbad' : ''}">${fmt(r.fail)}</td>
        <td><div class="bar"><i style="width:${Math.min(100, r.pct)}%" class="${r.pct >= 20 ? 'hi' : r.pct > 0 ? 'mid' : ''}"></i><span>${r.pct}%</span></div></td><td class="nw">${r.last_fail ? dTH(r.last_fail) : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">กดที่ Supplier เพื่อดูประวัติการตรวจรับของรายนั้น</p>` : '<div class="empty"><i class="fa-solid fa-chart-column"></i>ยังไม่มีข้อมูลในช่วงนี้</div>'}`;
      $$('[data-sup]', $('#sres')).forEach(tr => tr.onclick = () => { S.histQ = { q: '', supplier_id: tr.dataset.sup, item_id: '', status: '', result: '', from: p.from || '', to: p.to || '' }; location.hash = '#history'; });
    } catch (e) { $('#sres').innerHTML = `<div class="empty err">${esc(e.message)}</div>`; }
  };
  $('#sf').onsubmit = e => { e.preventDefault(); run(false); };
  $('#sfAll').onclick = () => run(true);
  run(false);
}

/* ================= page: ตั้งค่ารายชื่อ (admin) ================= */
async function pageSettings() {
  if (!(await askUnlock('admin', 'การตั้งค่ารายชื่อต้องใช้รหัสผู้ดูแลระบบ'))) { view.innerHTML = '<div class="card empty"><i class="fa-solid fa-lock"></i>ต้องใช้รหัสผู้ดูแลระบบ</div>'; return; }
  const b = await loadBoot(true);
  const catName = k => (catOf(k) || {}).name || k;
  const act = x => x.active ? '' : ' <span class="pill sm">ปิดใช้งาน</span>';
  view.innerHTML = `
  <div class="card"><div class="card-h"><h2><i class="fa-solid fa-truck"></i> Supplier <span class="pill">${b.suppliers.length}</span></h2><button class="btn sm primary" data-add="suppliers"><i class="fa-solid fa-plus"></i> เพิ่ม Supplier</button></div>
    <div class="tbl-wrap"><table class="list"><thead><tr><th>ชื่อบริษัท</th><th>ผู้ติดต่อ / โทร</th><th></th></tr></thead><tbody>${b.suppliers.map(s => `<tr><td>${esc(s.name)}${act(s)}</td><td>${esc(s.contact)}</td><td class="acts-c">${editBtns('suppliers', s.id)}</td></tr>`).join('') || '<tr><td colspan="3" class="dim">ยังไม่มี</td></tr>'}</tbody></table></div></div>
  <div class="card"><div class="card-h"><h2><i class="fa-solid fa-box-open"></i> บรรจุภัณฑ์ (มาตรฐาน) <span class="pill">${b.items.length}</span></h2><button class="btn sm primary" data-add="items"><i class="fa-solid fa-plus"></i> เพิ่มบรรจุภัณฑ์</button></div>
    <div class="tbl-wrap"><table class="list"><thead><tr><th>ชื่อรายการ</th><th>รหัส</th><th>หมวด</th><th>น้ำหนักที่ยอมรับ</th><th></th></tr></thead><tbody>${b.items.map(i => `<tr><td>${esc(i.name)}${act(i)}</td><td>${esc(i.code)}</td><td><small>${esc(catName(i.category))}</small></td><td class="nw">${i.wmin ?? '—'} – ${i.wmax ?? '—'} ${esc(i.wunit)}</td><td class="acts-c">${editBtns('items', i.id)}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">ยังไม่มี</td></tr>'}</tbody></table></div></div>
  <div class="card"><div class="card-h"><h2><i class="fa-solid fa-user-check"></i> หัวหน้า QC <span class="pill">${b.heads.length}</span></h2><button class="btn sm primary" data-add="heads"><i class="fa-solid fa-plus"></i> เพิ่มหัวหน้า QC</button></div>
    <div class="tbl-wrap"><table class="list"><thead><tr><th>ชื่อ</th><th></th></tr></thead><tbody>${b.heads.map(h => `<tr><td>${esc(h.name)}${act(h)}</td><td class="acts-c">${editBtns('heads', h.id)}</td></tr>`).join('') || '<tr><td colspan="2" class="dim">ยังไม่มี</td></tr>'}</tbody></table></div></div>`;
  $$('[data-add]', view).forEach(x => x.onclick = () => listForm(x.dataset.add, null));
  $$('[data-edit]', view).forEach(x => x.onclick = () => listForm(x.dataset.list, b[x.dataset.list].find(r => r.id === +x.dataset.edit)));
  $$('[data-del]', view).forEach(x => x.onclick = async () => {
    const row = b[x.dataset.list].find(r => r.id === +x.dataset.del);
    if (!confirm('ลบ “' + row.name + '” ?')) return;
    try { toast((await api(x.dataset.list.slice(0, -1) + '_delete', { id: row.id })).message); pageSettings(); } catch (e) { toast(e.message, 'err'); }
  });
}
const editBtns = (list, id) => `<button class="icon-btn" data-list="${list}" data-edit="${id}" title="แก้ไข"><i class="fa-solid fa-pen"></i></button><button class="icon-btn red-t" data-list="${list}" data-del="${id}" title="ลบ"><i class="fa-solid fa-trash"></i></button>`;
function listForm(list, row) {
  const t = { suppliers: 'Supplier', items: 'บรรจุภัณฑ์', heads: 'หัวหน้า QC' }[list];
  const v = row || { active: 1, wunit: 'g', unit: 'ชิ้น' };
  openModal(`<h3>${row ? 'แก้ไข' : 'เพิ่ม'}${t}</h3><form id="lf">
    <label class="fld"><span>ชื่อ${t} <em>*</em></span><input class="inp" name="name" maxlength="150" value="${esc(v.name)}" required></label>
    ${list === 'suppliers' ? `<label class="fld">ผู้ติดต่อ / เบอร์โทร<input class="inp" name="contact" maxlength="255" value="${esc(v.contact)}"></label>` : ''}
    ${list === 'items' ? `<label class="fld">รหัสสินค้า (Item Code / SKU)<input class="inp" name="code" maxlength="60" value="${esc(v.code)}"></label>
      <label class="fld"><span>หมวดบรรจุภัณฑ์ <em>*</em></span><select class="inp" name="category" required><option value="">— เลือก —</option>${S.boot.categories.map(c => `<option value="${c.key}" ${v.category === c.key ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <div class="grid3"><label class="fld">น้ำหนักต่ำสุด<input class="inp" name="wmin" inputmode="decimal" value="${v.wmin ?? ''}"></label><label class="fld">น้ำหนักสูงสุด<input class="inp" name="wmax" inputmode="decimal" value="${v.wmax ?? ''}"></label><label class="fld">หน่วยน้ำหนัก<input class="inp" name="wunit" maxlength="10" value="${esc(v.wunit)}"></label></div>
      <label class="fld">หน่วยนับ<input class="inp" name="unit" maxlength="30" value="${esc(v.unit)}"></label>` : ''}
    <label class="cb"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}><span>ใช้งาน (แสดงให้เลือกในฟอร์ม)</span></label>
    <div class="err" id="lfErr"></div>
    <div class="acts"><button type="button" class="btn ghost" data-close>ยกเลิก</button><button class="btn primary" id="lfGo">บันทึก</button></div></form>`);
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData($('#lf')));
    fd.active = $('#lf').elements.active.checked ? 1 : 0;
    if (row) fd.id = row.id;
    $('#lfGo').disabled = true;
    try { toast((await api(list.slice(0, -1) + '_save', fd)).message); closeModal(); pageSettings(); }
    catch (err) { $('#lfErr').textContent = err.message; $('#lfGo').disabled = false; }
  };
}

/* ================= page: Log (admin) ================= */
async function pageLogs() {
  if (!(await askUnlock('admin', 'บันทึกประวัติ (Log) ต้องใช้รหัสผู้ดูแลระบบ'))) { view.innerHTML = '<div class="card empty"><i class="fa-solid fa-lock"></i>ต้องใช้รหัสผู้ดูแลระบบ</div>'; return; }
  const items = (await api('logs', {})).items;
  view.innerHTML = `<div class="card"><div class="card-h"><h2><i class="fa-solid fa-clipboard-list"></i> ${fmt(items.length)} รายการ</h2><button class="btn sm dark" id="csvBtn"><i class="fa-solid fa-file-csv"></i> ส่งออก CSV</button></div>
  <div class="tbl-wrap"><table class="list"><thead><tr><th>เวลา</th><th>หมวด</th><th>อ้างอิง</th><th>รายละเอียด</th><th>ผู้ทำรายการ</th></tr></thead><tbody>
  ${items.map(l => `<tr><td class="nw">${dtTH(l.created_at)}</td><td>${esc(l.category)}</td><td>${esc(l.ref)}</td><td>${esc(l.detail)}</td><td>${esc(l.actor)}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#csvBtn').onclick = async () => {
    try {
      const d = await api('logs_export', {});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + d.csv], { type: 'text/csv;charset=utf-8' }));
      a.download = d.filename; a.click();
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* ================= router ================= */
function setTitle(t, sub) { $('#pageTitle').textContent = t; $('#pageSub').textContent = sub || ''; document.title = t + ' · แบบฟอร์มออนไลน์'; }
async function route() {
  const [page, arg] = (location.hash.replace(/^#/, '') || 'new').split('/');
  const key = PAGES[page] ? page : 'new';
  setTitle(...PAGES[key]);
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.page === (key === 'edit' || key === 'sheet' ? 'history' : key)));
  document.body.classList.remove('nav-open');
  view.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลด…</div>';
  try {
    if (key === 'new') await pageForm();
    else if (key === 'edit') await pageForm(arg);
    else if (key === 'pending') await pagePending();
    else if (key === 'history') await pageHistory();
    else if (key === 'sheet') await pageSheet(arg);
    else if (key === 'summary') await pageSummary();
    else if (key === 'settings') await pageSettings();
    else if (key === 'logs') await pageLogs();
  } catch (e) {
    view.innerHTML = `<div class="card empty err"><i class="fa-solid fa-circle-exclamation"></i>${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
$('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
$('#navOverlay').onclick = () => document.body.classList.remove('nav-open');
window.addEventListener('hashchange', route);
S.sess = loadSess();
paintUser();
$('#cfgBanner').hidden = !!API_URL;
route();
