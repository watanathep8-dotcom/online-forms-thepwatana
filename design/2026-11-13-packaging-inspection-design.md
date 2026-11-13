# แบบฟอร์มออนไลน์ (บริษัท เทพวัฒนา) — ใบตรวจรับบรรจุภัณฑ์: design

Source: `แบบฟอร์มออนไลน์ที่อยากทำ.pptx` (4 slides) + conversation 2026-11-13.
Approved by the user ("ครบแล้ว ลุยเลย"). Items marked **(call)** are Claude's
decisions, open to correction.

## Intent / why

A web form replacing the paper packaging incoming-inspection sheet of
บริษัท เทพวัฒนา จำกัด, so that (1) past inspections are easy to look up and
(2) it is visible which supplier fails most often.

## Goals

- One site "แบบฟอร์มออนไลน์" (a hub that can hold more forms later; first and
  only form now: **ใบตรวจรับบรรจุภัณฑ์**).
- Form, 4 parts (from the slides):
  1. Receiving data: date/time (default now), supplier **picked from a list**
     (no typing), packaging item **picked from the packaging-standard list**
     (fills item code + category + weight tolerance), PO no., invoice /
     delivery-note no., lot/order qty + unit, lot/batch no. Required: date,
     supplier, item, PO, invoice, lot no., qty.
  2. Inspection criteria by packaging category (6 categories, checklists as on
     slide 2, box strength 3/5 ชั้น radio for boxes). The item's category is
     selected automatically; the inspector ticks items and sets **Pass / Fail**.
  3. AQL: General Inspection Level **II**, AQL **6.5** (slide-3 table): from
     the lot qty the page shows code, sample size, Ac, Re. Inspector enters
     defects found → accept (≤ Ac) / reject (≥ Re). Weight sampling grid
     (one cell per sample, sample-size cells, entries optional), tolerance
     min–max (from the item, editable), average computed, cells outside the
     tolerance highlighted and counted. Weight applies to categories with
     น้ำหนัก ✓ on slide 2 (bottles, boxes, foil sachets, plastic bags).
  4. Defect details / action taken (text), inspection photos (camera or
     upload, several), digital signature of the inspector (canvas) + name +
     date, **photo of the supplier's signed bill** instead of a supplier
     signature (required **(call)**).
- Approval flow (user picked "แบบ 2"): submit → status **รอหัวหน้า QC**;
  QC head opens the "รออนุมัติ" list, reviews, then **อนุมัติ** (signs) →
  **อนุมัติแล้ว**, or **ตีกลับ** with a reason → **ตีกลับ**; anyone may fix
  a returned sheet and resubmit (back to รอหัวหน้า QC).
- Overall result per sheet: **ผ่าน / ไม่ผ่าน** — proposed automatically
  (fail if category Fail, defects ≥ Re, or any weight out of tolerance),
  the inspector can override **(call)**.
- Pages: ตรวจรับใหม่ · รออนุมัติ (count) · ประวัติ · สรุป Supplier · ตั้งค่า.
  - ประวัติ: search by date range, supplier, item, PO, lot, status, result;
    open a sheet; print it (A4).
  - สรุป Supplier: per supplier deliveries, fails, % fail, sorted by % fail,
    month range filter.
- Settings page (admin): suppliers, packaging items (name, code, category,
  weight min/max, unit), QC-head names. Added by hand, no import file.

## Access (proposed by Claude, accepted by the user)

- Inspectors: no account; type own name (kept in the browser) and submit.
- QC heads: shared approval password (Script Property `FORM_QC_PASSWORD`),
  then pick own name from the QC-head list.
- Admin: password `FORM_ADMIN_PASSWORD` for settings and edit/delete of sheets.
- History and supplier summary: open to anyone with the link.
- Passwords only in Script Properties.

## Non-goals (now)

Teams notifications, other forms, import of supplier/packaging lists from
Excel, per-user accounts, offline mode.

## Anti-goals

- Lost or silently changed records (every write is audit-logged; approved
  sheets can only be changed by admin).
- Mixing with other systems / the other company's data.

## Constraints

- Same stack as the other Thepwatana sites: GitHub Pages (`docs/`) + Google
  Apps Script web app + Google Sheet + Google Drive (photos, signatures).
- Phones at the receiving dock: layout must work at phone width; photos are
  resized in the browser (≈1600 px JPEG) before upload.
- Same github.io origin as other sites: browser storage keys prefixed `oft_`.

## Approaches (decided)

- **A. Pages + Apps Script + Sheet + Drive** — picked: full form (AQL calc,
  weight grid, signature, camera), history + summary, same upkeep as the other
  sites; ~2–3 s per save.
- B. Google Forms — no AQL calc, weight grid or signatures.
- C. XAMPP local web — LAN only, single machine holds all data.

## Builder notes (calls)

- Fork of the Balance Waste (Thepwatana) code base: its request transport,
  password roles + sessions, sheet tables, read cache, audit log and GAS test
  mock are reused; domain code replaced. Roles: `qc` (approve), `admin`.
- Repo `watanathep8-dotcom/online-forms-thepwatana`; GAS project
  "Online Forms Thepwatana"; sheet "Online Forms Database"; Drive folder
  "Online Forms Files".
- Sheet no. `PI-YYMMDD-NNN`.
- AQL above 10,000 pcs: ISO 2859-1 arrow → stays at code L (200 / Ac 21 / Re 22).
- Images are served through the API (`file` action, base64), so viewers never
  need Drive access.
- Portal: card in /thepwatana/ (4 systems).
