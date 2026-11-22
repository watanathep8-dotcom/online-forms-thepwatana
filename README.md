# แบบฟอร์มออนไลน์ — บริษัท เทพวัฒนา จำกัด

ฟอร์มแรก: **ใบตรวจรับบรรจุภัณฑ์** (AQL ระดับ II / 6.5) — ผู้ตรวจรับกรอกฟอร์ม ถ่ายรูป แนบรูปบิลที่ Supplier ลงชื่อ
และเซ็นชื่อ → หัวหน้า QC อนุมัติ (ลงนาม) หรือตีกลับ → ค้นประวัติ และดูสรุป Supplier ที่ไม่ผ่านบ่อย

- หน้าเว็บ: `docs/` (GitHub Pages: main / docs) — `docs/config.js` ใส่ลิงก์ `/exec` ของ Apps Script
- หลังบ้าน: `apps-script/Code.gs` (Google Apps Script) — ข้อมูลใน Google Sheet "Online Forms Database",
  รูป / ลายเซ็นในโฟลเดอร์ Drive "Online Forms Files"
- ออกแบบ / แผนงาน: `design/`

## ติดตั้ง (ครั้งเดียว)

1. สร้างโปรเจกต์ Apps Script "Online Forms Thepwatana" แล้ววาง `apps-script/Code.gs` และ `apps-script/CatalogData.gs`
2. รัน `setupSystem` (อนุญาตสิทธิ์ Sheets + Drive) ถ้ายังไม่เคยสร้างฐานข้อมูล
3. Project Settings → Script properties:
   - `FORM_QC_PASSWORD` — รหัสหัวหน้า QC (อนุมัติ / ตีกลับ)
   - `FORM_ADMIN_PASSWORD` — รหัสผู้ดูแลระบบ (ตั้งค่ารายชื่อ, แก้ไข / ลบใบ, Log)
   - `FORM_GOOGLE_CLIENT_ID` — OAuth Web Client ID ของ Google Identity Services
   - `FORM_GOOGLE_ADMIN_EMAILS` — อีเมลผู้ดูแล คั่นด้วย comma/ขึ้นบรรทัดใหม่
   - `FORM_GOOGLE_QC_EMAILS` — อีเมล QC คั่นด้วย comma/ขึ้นบรรทัดใหม่
   - `FORM_ALLOW_LEGACY_LOGIN` — `true` ช่วงย้ายระบบ; ตั้งเป็น `false` หลังทดสอบ Google Login สำเร็จ
4. เว็บนี้เปิดที่ `https://watanathep8-dotcom.github.io/online-forms-thepwatana/`; สร้าง OAuth Web Client ใน Google Cloud Console และเพิ่ม Authorized JavaScript origin เป็น `https://watanathep8-dotcom.github.io` (ใส่เฉพาะ origin ไม่ใส่ path) จากนั้นใส่ Client ID เฉพาะส่วน public ใน `docs/config.js` ช่อง `googleClientId`
5. Deploy → เว็บแอป: ดำเนินการในฐานะ "ฉัน", ผู้มีสิทธิ์เข้าถึง "ทุกคน" → ใส่ลิงก์ `/exec` ใน `docs/config.js`
6. (แนะนำ) รัน `installKeepWarmTrigger` หนึ่งครั้ง
7. จาก Apps Script editor รัน `importCatalog()` หนึ่งครั้ง แล้วตรวจผลสรุปจำนวน `added / matched / disabled / skipped`; ฟังก์ชันจะไม่ลบข้อมูลเก่าและจะคง `id` เดิม
8. เข้าเว็บ → ตั้งค่ารายชื่อเพื่อตรวจแก้หมวดหรือน้ำหนักที่ยังว่าง (ไฟล์ Excel ไม่มีค่า `wmin`/`wmax` จึงไม่สร้างตัวเลขขึ้นเอง)

`CatalogData.gs` ใช้เฉพาะ `SUP+ลูกค้า` และ `PK-TW-PU-CU`; ชีต `ลูกค้า B2B` ไม่ถูกนำเข้า

หน้าเว็บจะแสดง Google Login เป็นทางหลัก และเก็บช่องรหัสผ่านเดิมไว้เป็น fallback ชั่วคราวเท่านั้น รหัสผ่านและ Google credential ไม่ถูกเก็บใน browser; Apps Script จะตรวจ allowlist ใหม่ทุกคำขอที่ใช้สิทธิ์ หากนำอีเมลออก ให้ session เดิมหมดสิทธิ์ในการเรียกครั้งถัดไป

หลังแก้ `Code.gs` หรือ `CatalogData.gs`: วางโค้ดใหม่ → การทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้ → ✏️ → เวอร์ชันใหม่ แล้วตรวจ URL `/exec` เดิมและทดสอบ Google Login/สิทธิ์ก่อนปิด fallback

## ทดสอบ

```
node test/gas-mock.js          # ชุดทดสอบหลังบ้าน (Apps Script mock ในหน่วยความจำ)
node test/dev-server.js --demo # ดูหน้าเว็บในเครื่อง http://127.0.0.1:8790 (รหัสจำลอง qc: dev-qc, admin: dev-admin)
```
