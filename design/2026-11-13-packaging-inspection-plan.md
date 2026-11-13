# แบบฟอร์มออนไลน์ — ใบตรวจรับบรรจุภัณฑ์ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub Pages + Apps Script site where Thepwatana QC records packaging incoming inspections, QC heads approve them, and anyone can search history and see supplier fail rates.

**Architecture:** Fork of `C:\sdsrepo\waste-thepwatana` (Balance Waste): keep its transport (doGet/doPost, POST text/plain JSON), password roles + CacheService sessions, sheet table layer (`table_/insert_/update_/flush_`, read cache, `addMissingColumns_`), audit log, `test/gas-mock.js` harness; replace the waste domain. Photos/signatures go to a Drive folder and are served back through the API.

**Tech Stack:** Apps Script V8 (single `apps-script/Code.gs`), vanilla JS/CSS (`docs/index.html`, `docs/assets/app.js`, `docs/assets/style.css`), Node test mock (`node test/gas-mock.js`).

**Spec:** `design/2026-11-13-packaging-inspection-design.md`

## Global Constraints

- Company text: "บริษัท เทพวัฒนา จำกัด"; site title "แบบฟอร์มออนไลน์"; form title "ใบตรวจรับบรรจุภัณฑ์".
- Script Properties: `FORM_SPREADSHEET_ID`, `FORM_FOLDER_ID`, `FORM_QC_PASSWORD` (role `qc`), `FORM_ADMIN_PASSWORD` (role `admin`). No password in code or tests' real values.
- Browser storage keys prefixed `oft_`.
- Sheet no. `PI-YYMMDD-NNN`. AQL Level II / 6.5 table exactly as slide 3; lot > 10,000 → L / 200 / Ac 21 / Re 22.
- Statuses: `pending` "รอหัวหน้า QC", `approved` "อนุมัติแล้ว", `returned` "ตีกลับ". Results: `pass` "ผ่าน", `fail` "ไม่ผ่าน".
- Phone width works (≥ 360 px); images resized client-side to max 1600 px JPEG q 0.8; max 8 inspection photos.

## Review Focus

1. Resubmitting a returned sheet must keep its sheet no. and earlier photos it did not replace → test `resubmit keeps doc_no and photos`.
2. Lot qty 0 / blank / > 10,000 → AQL function returns null for ≤1, L/200/21/22 above 10,000 → test `aql edge sizes`.
3. Approving an already approved sheet (two heads at once) → second gets a Thai error → test `double approve refused`.
4. Supplier/item renamed or deactivated in settings after sheets exist → history still shows the stored names → test `history keeps names after settings change`.
5. Oversized upload (> 8 photos or a non-image data URL) → refused, nothing written → test `photo limits`.

---

### Task 1: Backend (Code.gs) + tests

**Files:** Create `apps-script/Code.gs`, `test/gas-mock.js` (fork; add `DriveApp` + `Utilities.base64Decode/newBlob/base64Encode` mocks), `appsscript.json`-less (single file).

**Interfaces (actions):**
- public reads: `bootstrap` → `{company, role, suppliers[], items[], heads[], categories, aql, pendingCount}`; `history` (q, supplier_id, item_id, status, result, from, to) → `{items[]}`; `inspection` (id) → full record incl. photo ids; `summary` (from, to) → `[{supplier, total, fail, pct}]`; `file` (id) → `{mime, data}` (only ids referenced by a record).
- public writes: `submit` (new or resubmit of a `returned` sheet by id) with fields of the 4 parts + `sign_inspector` (data URL), `photos[]` (data URLs or kept ids), `bill_photo`.
- `qc`: `approve` (id, head, sign) / `return` (id, head, reason).
- `admin`: `supplier_save/delete`, `item_save/delete`, `head_save/delete`, `inspection_update` (same as submit, any status), `inspection_delete`, `logs`.
- Sheets: `suppliers`, `items` (name, code, category, wmin, wmax, unit, active), `heads`, `inspections` (one row; criteria / weights / photo ids as JSON text), `audit_logs`.
- `aql_(lot)` → `{code, n, ac, re}`; categories constant `CATEGORIES` (6, checklist text from slide 2, `weight` flag).

- [ ] Tests (role gating, submit validation, AQL table incl. Review Focus 2, approve/return/resubmit flow incl. 1 & 3, history filters + 4, summary %, photo limits 5, file action only for referenced ids). Run `node test/gas-mock.js` → all ok. Commit.

### Task 2: Frontend

**Files:** `docs/index.html`, `docs/assets/app.js`, `docs/assets/style.css`, `docs/config.js`.

- Pages: ตรวจรับใหม่ (4 sections, AQL auto, weight grid + average + out-of-range, signature canvas, camera/upload with resize), รออนุมัติ (qc login → approve/return with signature), ประวัติ (filters, open, print A4), สรุป Supplier, ตั้งค่า (admin).
- [ ] Syntax test in `test/gas-mock.js` (parse app.js, no stored passwords). Preview with `test/dev-server.js` on the mock; screenshot each page at phone + desktop width. Commit.

### Task 3: Deploy

- [ ] GitHub repo `online-forms-thepwatana`, Pages main `/docs`; GAS project "Online Forms Thepwatana" (user runs `setupSystem`, sets the 2 passwords, deploys); `config.js` apiUrl; portal card in `/thepwatana/`; xampp copy + memory note.
