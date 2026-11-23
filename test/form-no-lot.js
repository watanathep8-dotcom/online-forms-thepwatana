const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'assets', 'app.js'), 'utf8');
const gasSource = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

assert.ok(!appSource.includes('เลขที่ Lot / Batch No.'), 'new inspection form must not render the Lot / Batch field');
assert.ok(!appSource.includes("['lot_no', 'เลขที่ Lot']"), 'Lot / Batch must not be required by the client form');
assert.ok(!gasSource.includes('requiredText_(input, "lot_no"'), 'backend must accept submissions without Lot / Batch');
assert.ok(!appSource.includes('3. ตัวแทนผู้จัดส่ง / Supplier'), 'new inspection form must not render the supplier representative section');
assert.ok(!appSource.includes('billCam') && !appSource.includes('billUp'), 'new inspection form must not render bill upload controls');
assert.ok(!appSource.includes("if (!f.bill) miss.push('รูปบิลที่ Supplier ลงชื่อ')"), 'client form must not require a supplier bill');
assert.ok(!gasSource.includes('keepOr(input.bill_photo, old ? old.bill_photo : "", "รูปบิลที่ Supplier ลงชื่อ", true)'), 'backend must not require a supplier bill');
assert.ok(appSource.includes('หมายเหตุ'), 'criteria table must render an optional notes column');
assert.ok(appSource.includes('criteria_notes'), 'frontend must submit criteria notes');
assert.ok(gasSource.includes('["criteria_notes", "str"]'), 'inspection schema must persist criteria notes');
assert.ok(gasSource.includes('criteria_notes'), 'backend must normalize criteria notes');

console.log('form-entry-contract: ok');
