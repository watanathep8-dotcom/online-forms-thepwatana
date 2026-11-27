const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'assets', 'app.js'), 'utf8');
const gasSource = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

assert.ok(!appSource.includes('เลขที่ Lot / Batch No.'), 'new inspection form must not render the Lot / Batch field');
assert.ok(!appSource.includes("['lot_no', 'เลขที่ Lot']"), 'Lot / Batch must not be required by the client form');
assert.ok(!appSource.includes('PO / Lot'), 'list tables must not show a Lot column label');
assert.ok(!appSource.includes('<small>Lot</small>'), 'list tables must not show Lot row labels');
assert.ok(!appSource.includes('เลขที่ Lot / Batch'), 'inspection detail must not show the Lot / Batch row');
assert.ok(!appSource.includes('ค้นหา เลขที่ใบ / PO / Lot'), 'history search must not advertise Lot');
assert.ok(!appSource.includes('จำนวนที่ส่งมอบ (Lot / Order Qty)'), 'entry form must not show Lot in the quantity label');
assert.ok(!appSource.includes('ขนาด Lot'), 'AQL reference table must not show Lot in its heading');
assert.ok(!gasSource.includes('requiredText_(input, "lot_no"'), 'backend must accept submissions without Lot / Batch');
assert.ok(gasSource.includes('กล่อง / ไส้คั่น / แผ่นรอง-รองกล่อง'), 'box category label should use the corrected Thai wording');
assert.ok(!gasSource.includes('กล่อง / ไส้ติ้น / แผ่นรอง-รองกล่อง'), 'box category label must not retain the typo');
assert.ok(appSource.includes('กล่อง / ไส้คั่น / แผ่นรอง-รองกล่อง'), 'frontend should normalize the corrected box category label');
assert.ok(!appSource.includes('3. ตัวแทนผู้จัดส่ง / Supplier'), 'new inspection form must not render the supplier representative section');
assert.ok(!appSource.includes('billCam') && !appSource.includes('billUp'), 'new inspection form must not render bill upload controls');
assert.ok(!appSource.includes("if (!f.bill) miss.push('รูปบิลที่ Supplier ลงชื่อ')"), 'client form must not require a supplier bill');
assert.ok(!gasSource.includes('keepOr(input.bill_photo, old ? old.bill_photo : "", "รูปบิลที่ Supplier ลงชื่อ", true)'), 'backend must not require a supplier bill');
assert.ok(appSource.includes('หมายเหตุ'), 'criteria table must render an optional notes column');
assert.ok(appSource.includes('criteria_notes'), 'frontend must submit criteria notes');
assert.ok(appSource.includes('b.aql.level'), 'frontend should render the AQL level from bootstrap data');
assert.ok(!appSource.includes('AQL ระดับ II') && !appSource.includes('ตาราง AQL ระดับ II'), 'frontend must not retain Level II AQL copy');
assert.ok(appSource.includes('lastAql'), 'frontend overflow AQL row should use the bootstrap table');
assert.ok(gasSource.includes('["criteria_notes", "str"]'), 'inspection schema must persist criteria notes');
assert.ok(gasSource.includes('criteria_notes'), 'backend must normalize criteria notes');
assert.ok(gasSource.includes('var AQL_LEVEL = "I"'), 'backend AQL level must be Level I');
assert.ok(!gasSource.includes('General Inspection Level II'), 'backend must not retain Level II AQL copy');

console.log('form-entry-contract: ok');
