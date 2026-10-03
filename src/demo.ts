// 演示脚本：覆盖 AND / OR / 括号改变结果 / WITH 单独获准 四种情况，
// 然后修改策略生成新版本，比较两个版本下受影响依赖。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Store } from './store';
import { seedCatalog } from './seed';
import { runCheck, compareReports } from './service';

const dir = path.join(process.cwd(), 'data');
const dbPath = path.join(dir, 'demo.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(dbPath + suffix); } catch { /* 忽略 */ }
}

const store = new Store(dbPath);
seedCatalog(store);

const project = store.createProject('demo-project');
console.log(`创建项目: #${project.id} ${project.name}`);

const deps = [
  { name: 'pkg-and', version: '1.0.0', expression: 'MIT AND Apache-2.0' },
  { name: 'pkg-or', version: '2.1.0', expression: 'GPL-3.0-only OR MIT' },
  { name: 'pkg-parens-pass', version: '0.9.0', expression: 'MIT OR GPL-3.0-only AND Apache-2.0' },
  { name: 'pkg-parens-fail', version: '0.9.0', expression: '(MIT OR GPL-3.0-only) AND GPL-2.0-only' },
  { name: 'pkg-with', version: '4.8.2', expression: 'GPL-2.0-only WITH Classpath-exception-2.0' },
  { name: 'pkg-gpl-bare', version: '3.0.0', expression: 'GPL-2.0-only' },
  { name: 'pkg-unknown-exc', version: '1.2.3', expression: 'MIT WITH MadeUp-exception' },
  { name: 'pkg-bad-syntax', version: '0.1.0', expression: 'MIT AND OR Apache-2.0' },
];
const manifest = store.importManifest(project.id, deps);
console.log(`导入清单: #${manifest.manifestId}（${manifest.count} 条依赖）`);

const policyV1 = store.createPolicy('default', {
  allowedLicenses: ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause'],
  allowedCombos: [{ license: 'GPL-2.0-only', exception: 'Classpath-exception-2.0' }],
});
console.log(`\n策略 default v${policyV1.version}: 允许 ${['MIT','ISC','Apache-2.0','BSD-2-Clause'].join(', ')} + 组合 GPL-2.0-only WITH Classpath-exception-2.0`);

const check1 = runCheck(store, manifest.manifestId, policyV1.id);
console.log(`\n=== 报告 #${check1.reportId}（策略 v1）===`);
const report1 = store.getReport(check1.reportId);
for (const item of report1.items) {
  console.log(`\n[${item.status}] ${item.dependency.name}@${item.dependency.version}  <=  ${item.dependency.expression}`);
  console.log(`    ${item.detail.outcome}`);
  for (const line of item.detail.trace ?? []) console.log(`    ${line}`);
  if (item.detail.error) console.log(`    错误码: ${item.detail.error.code}${item.detail.error.position != null ? ` @位置 ${item.detail.error.position}` : ''}`);
}
console.log(`\n汇总: ${JSON.stringify(report1.summary)}`);

// 修改策略：移除 Apache-2.0，生成 v2（不覆盖既有报告）
const policyV2 = store.createPolicy('default', {
  allowedLicenses: ['MIT', 'ISC', 'BSD-2-Clause'],
  allowedCombos: [{ license: 'GPL-2.0-only', exception: 'Classpath-exception-2.0' }],
});
console.log(`\n策略 default v${policyV2.version}: 移除 Apache-2.0`);
const check2 = runCheck(store, manifest.manifestId, policyV2.id);
console.log(`生成报告 #${check2.reportId}（策略 v2），汇总: ${JSON.stringify(check2.summary)}`);

const cmp = compareReports(store, check1.reportId, check2.reportId);
console.log(`\n=== 报告比较 #${check1.reportId} vs #${check2.reportId} ===`);
for (const c of cmp.changes.filter((x) => x.changed)) {
  console.log(`  ${c.dependency}: ${c.statusInA} -> ${c.statusInB}`);
}
console.log(`受影响依赖数: ${cmp.changedCount}`);

store.close();
console.log(`\n演示数据已保存到 ${dbPath}（重启后仍可读取）`);
