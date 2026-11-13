# แบบฟอร์มออนไลน์ — บริษัท เทพวัฒนา จำกัด

ฟอร์มแรก: **ใบตรวจรับบรรจุภัณฑ์** (AQL ระดับ II / 6.5) — ผู้ตรวจรับกรอกฟอร์ม ถ่ายรูป แนบรูปบิลที่ Supplier ลงชื่อ
และเซ็นชื่อ → หัวหน้า QC อนุมัติ (ลงนาม) หรือตีกลับ → ค้นประวัติ และดูสรุป Supplier ที่ไม่ผ่านบ่อย

- หน้าเว็บ: `docs/` (GitHub Pages: main / docs) — `docs/config.js` ใส่ลิงก์ `/exec` ของ Apps Script
- หลังบ้าน: `apps-script/Code.gs` (Google Apps Script) — ข้อมูลใน Google Sheet "Online Forms Database",
  รูป / ลายเซ็นในโฟลเดอร์ Drive "Online Forms Files"
- ออกแบบ / แผนงาน: `design/`

## ติดตั้ง (ครั้งเดียว)

1. สร้างโปรเจกต์ Apps Script "Online Forms Thepwatana" แล้ววาง `apps-script/Code.gs`
2. รัน `setupSystem` (อนุญาตสิทธิ์ Sheets + Drive)
3. Project Settings → Script properties:
   - `FORM_QC_PASSWORD` — รหัสหัวหน้า QC (อนุมัติ / ตีกลับ)
   - `FORM_ADMIN_PASSWORD` — รหัสผู้ดูแลระบบ (ตั้งค่ารายชื่อ, แก้ไข / ลบใบ, Log)
4. Deploy → เว็บแอป: ดำเนินการในฐานะ "ฉัน", ผู้มีสิทธิ์เข้าถึง "ทุกคน" → ใส่ลิงก์ `/exec` ใน `docs/config.js`
5. (แนะนำ) รัน `installKeepWarmTrigger` หนึ่งครั้ง
6. เข้าเว็บ → ตั้งค่ารายชื่อ: เพิ่ม Supplier, บรรจุภัณฑ์ (หมวด + น้ำหนักที่ยอมรับ), หัวหน้า QC

หลังแก้ `Code.gs`: วางโค้ดใหม่ → การทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้ → ✏️ → เวอร์ชันใหม่

## ทดสอบ

```
node test/gas-mock.js          # ชุดทดสอบหลังบ้าน (Apps Script mock ในหน่วยความจำ)
node test/dev-server.js --demo # ดูหน้าเว็บในเครื่อง http://127.0.0.1:8790 (รหัสจำลอง qc: dev-qc, admin: dev-admin)
```
