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
assert.ok(cssSource.includes('.pending-list th:nth-child(6)'), 'approval quantity column should have an explicit width');
assert.ok(cssSource.includes('overflow-wrap: anywhere'), 'long labels should wrap instead of squeezing other columns');
assert.ok(htmlSource.includes('assets/style.css?v=4'), 'stylesheet cache version should be bumped for the layout update');

console.log('table-layout-contract: ok');
