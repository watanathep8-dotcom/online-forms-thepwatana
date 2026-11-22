const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'assets', 'app.js'), 'utf8');
const gasSource = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

assert.ok(!appSource.includes('เลขที่ Lot / Batch No.'), 'new inspection form must not render the Lot / Batch field');
assert.ok(!appSource.includes("['lot_no', 'เลขที่ Lot']"), 'Lot / Batch must not be required by the client form');
assert.ok(!gasSource.includes('requiredText_(input, "lot_no"'), 'backend must accept submissions without Lot / Batch');

console.log('form-no-lot: ok');
