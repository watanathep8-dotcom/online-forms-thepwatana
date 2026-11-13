// Local-only preview of docs/ against the in-memory GAS mock (no Google, no network).
//   node test/dev-server.js [port] [--demo]
// --demo: synthetic suppliers / items / QC heads + a few sample sheets (fake data, nothing stored).
// Dev-only passwords of the mock: qc = "dev-qc", admin = "dev-admin".
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const { createGas, loadCode, seedFixtures } = require("./gas-mock.js");
const { gas, state } = createGas();
const ctx = loadCode(gas);
Object.assign(state.props, { FORM_QC_PASSWORD: "dev-qc", FORM_ADMIN_PASSWORD: "dev-admin" });
ctx.setupSystem();
const args = process.argv.slice(2);
const port = Number(args.find(a => /^\d+$/.test(a))) || 8790;
const call = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());

if (args.includes("--demo")) {
  const token = call({ action: "login", password: "dev-admin" }).data.token;
  seedFixtures(b => call(Object.assign({ actor: "ผู้ดูแล (ตัวอย่าง)", token }, b)));
  const boot = call({ action: "bootstrap" }).data;
  // 1x1 png
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const it = k => boot.items.find(i => i.category === k);
  const mk = (sup, item, lot, res, day, extra = {}) => call(Object.assign({
    action: "submit", actor: "ผู้ตรวจ (ตัวอย่าง)", received_date: "2026-11-" + day, received_time: "09:15",
    supplier_id: boot.suppliers[sup].id, item_id: item.id, po_no: "PO-DEMO-" + day, invoice_no: "DN-DEMO-" + day, lot_qty: lot, unit: "ชิ้น",
    lot_no: "LOT-DEMO-" + day, defects: res === "fail" ? 12 : 1, checks: [true, true, true, true, true], cat_result: res, strength: "5",
    weights: [12.4, 12.5, 12.3, 12.9], wmin: item.wmin, wmax: item.wmax, wunit: "g", result: res,
    defect_detail: res === "fail" ? "ตัวอย่าง: พบรอยบุบ" : "", photos: [PNG], bill_photo: PNG, inspector: "ผู้ตรวจ (ตัวอย่าง)", inspector_sign: PNG
  }, extra));
  const a = mk(0, it("bottle"), 5000, "pass", "03");
  mk(1, it("box"), 800, "fail", "05");
  mk(2, it("label"), 20000, "pass", "08");
  const r = mk(1, it("box"), 300, "fail", "10");
  const qc = call({ action: "login", password: "dev-qc" }).data.token;
  call({ action: "approve", actor: "หัวหน้า (ตัวอย่าง)", token: qc, id: a.data.id, head_id: boot.heads[0].id, sign: PNG });
  call({ action: "return", actor: "หัวหน้า (ตัวอย่าง)", token: qc, id: r.data.id, head_id: boot.heads[1].id, reason: "ตัวอย่าง: PO ไม่ตรง" });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      const out = req.method === "POST" ? ctx.doPost({ postData: { contents: body } }) : ctx.doGet({ parameter: Object.fromEntries(url.searchParams) });
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(out.getContent());
    });
    return;
  }
  if (url.pathname === "/config.js") {
    res.writeHead(200, { "Content-Type": TYPES[".js"] });
    res.end('window.FORM_CONFIG = { apiUrl: "/api" };');
    return;
  }
  const file = path.join(ROOT, "docs", decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(path.join(ROOT, "docs")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log("Preview: http://127.0.0.1:" + port + "/  (qc: dev-qc, admin: dev-admin)"));
