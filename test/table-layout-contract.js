const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'docs', 'assets', 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'docs', 'assets', 'style.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');

[
  'pending-list',
  'sum-list',
  'settings-list',
  'items-list',
  'heads-list',
  'logs-list'
].forEach(className => {
  assert.ok(appSource.includes(`class="list ${className}"`), `app should render a semantic ${className} table`);
  assert.ok(cssSource.includes(`table.${className}`), `style should define the ${className} table layout`);
});

assert.ok(cssSource.includes('table-layout: fixed'), 'list tables should use predictable column sizing');
assert.ok(cssSource.includes('font-variant-numeric: tabular-nums'), 'numeric cells should use tabular figures');
assert.ok(cssSource.includes(".list th, .list td { font-family: 'Kanit', sans-serif;"), 'list headers and body cells should use the same font');
assert.ok(cssSource.includes("table th, table td { font-family: 'Kanit', sans-serif;"), 'all table pages should use the same font family');
assert.ok(cssSource.includes('.num-cell { text-align: left;'), 'numeric cells should start on the same left edge as their headers');
assert.ok(appSource.includes('fmt(s.avg, 2)'), 'weight summary averages should display two decimal places');
assert.ok(appSource.includes('fmt(r.w_avg, 2)'), 'inspection detail averages should display two decimal places');
assert.ok(!appSource.includes('fmt(s.avg, 3)'), 'weight summary averages should not display three decimal places');
assert.ok(!appSource.includes('fmt(r.w_avg, 3)'), 'inspection detail averages should not display three decimal places');
assert.ok(cssSource.includes('.pending-list th:nth-child(6)'), 'approval quantity column should have an explicit width');
assert.ok(cssSource.includes('table.pending-list { width: 100%; min-width: 0;'), 'approval and history tables should fit the available page width');
assert.ok(cssSource.includes('.pending-list th:nth-child(8), .pending-list td:nth-child(8) { width: 10%; min-width: 0;'), 'status column should use a responsive width inside the table');
assert.ok(cssSource.includes('.pending-list th { white-space: normal;'), 'pending table headers should wrap instead of widening the table');
assert.ok(cssSource.includes('.pending-list .nw { white-space: normal;'), 'pending table dates and quantities should wrap on narrow screens');
assert.ok(cssSource.includes('.pending-list td:nth-child(8) .pill { max-width: 100%;'), 'status pills should stay inside the status column');
assert.ok(cssSource.includes('overflow-wrap: anywhere'), 'long labels should wrap instead of squeezing other columns');
assert.ok(htmlSource.includes('assets/style.css?v=8'), 'stylesheet cache version should be bumped for the responsive table update');
assert.ok(htmlSource.includes('assets/app.js?v=11'), 'script cache version should be bumped for the weight display update');

console.log('table-layout-contract: ok');
