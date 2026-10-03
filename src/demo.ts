// End-to-end demo: seeds a project, runs checks under two policy versions,
// and shows which dependencies are affected by the policy change.
import fs from 'node:fs';
import path from 'node:path';
import { openDb, seedCatalog } from './db.js';
import { Service } from './service.js';

const DATA_DIR = path.join(process.cwd(), 'data-demo');
fs.rmSync(DATA_DIR, { recursive: true, force: true });

const db = openDb(DATA_DIR);
seedCatalog(db);
const svc = new Service(db);

const project = svc.createProject('demo-project');

const deps = [
  { name: 'and-ok', version: '1.0.0', expression: 'MIT AND Apache-2.0' },          // AND both satisfied
  { name: 'or-choice', version: '2.1.0', expression: 'GPL-3.0-only OR MIT' },      // OR alternative branch
  { name: 'paren-flip', version: '0.9.0', expression: 'MIT OR Apache-2.0 AND GPL-3.0-only' }, // precedence vs parens
  { name: 'with-combo', version: '3.2.1', expression: 'GPL-3.0-only WITH Classpath-exception-2.0' }, // WITH combo
];
console.log('import:', svc.importManifest(project.id, deps));

// Policy v1: allow MIT, Apache-2.0 and the Classpath combo; GPL-3.0-only alone is NOT allowed.
const v1 = svc.createPolicy({
  name: 'demo-policy',
  allowedLicenses: ['MIT', 'Apache-2.0'],
  allowedCombos: [{ license: 'GPL-3.0-only', exception: 'Classpath-exception-2.0' }],
});
const r1 = svc.check(project.id, v1.policyVersionId);
console.log('\n=== Report under policy v1 ===');
for (const item of svc.getReport(r1.reportId).items as any[]) {
  console.log(`  ${item.status.toUpperCase()}  ${item.dep_name}: ${item.expression}`);
}

// Policy v2: drop Apache-2.0 and the combo, allow GPL-3.0-only plainly.
const v2 = svc.updatePolicy(v1.policyId, {
  allowedLicenses: ['MIT', 'GPL-3.0-only'],
  allowedCombos: [],
});
const r2 = svc.check(project.id, v2.policyVersionId);
console.log('\n=== Report under policy v2 ===');
for (const item of svc.getReport(r2.reportId).items as any[]) {
  console.log(`  ${item.status.toUpperCase()}  ${item.dep_name}: ${item.expression}`);
}

console.log('\n=== Changes v1 -> v2 ===');
console.log(JSON.stringify(svc.compareReports(r1.reportId, r2.reportId).changes, null, 2));
