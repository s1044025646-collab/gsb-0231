import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Store } from '../src/store';
import { seedCatalog } from '../src/seed';
import { runCheck, compareReports } from '../src/service';
import { startServer } from '../src/server';

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-')), 'test.db');
}

function freshStore(dbPath = tmpDb()): Store {
  const s = new Store(dbPath);
  seedCatalog(s);
  return s;
}

const DEPS = [
  { name: 'a', version: '1.0.0', expression: 'MIT AND Apache-2.0' },
  { name: 'b', version: '1.0.0', expression: 'GPL-3.0-only OR MIT' },
  { name: 'c', version: '1.0.0', expression: '(MIT OR GPL-3.0-only) AND GPL-2.0-only' },
  { name: 'd', version: '1.0.0', expression: 'GPL-2.0-only WITH Classpath-exception-2.0' },
  { name: 'e', version: '1.0.0', expression: 'MIT WITH No-such-exception' },
  { name: 'f', version: '1.0.0', expression: 'MIT AND OR ISC' },
  { name: 'g', version: '1.0.0', expression: 'MadeUp-License' },
];

const RULES_V1 = {
  allowedLicenses: ['MIT', 'ISC', 'Apache-2.0'],
  allowedCombos: [{ license: 'GPL-2.0-only', exception: 'Classpath-exception-2.0' }],
};

function setup(store: Store) {
  const p = store.createProject('p1');
  const m = store.importManifest(p.id, DEPS);
  const v1 = store.createPolicy('default', RULES_V1);
  return { p, m, v1 };
}

test('批量检查：状态区分 通过/拒绝/语法错误/未知标识', () => {
  const store = freshStore();
  const { m, v1 } = setup(store);
  const { reportId } = runCheck(store, m.manifestId, v1.id);
  const report = store.getReport(reportId);
  const byName = new Map(report.items.map((it: any) => [it.dependency.name, it]));
  assert.equal((byName.get('a') as any).status, 'PASS');
  assert.equal((byName.get('b') as any).status, 'PASS');
  assert.equal((byName.get('c') as any).status, 'REJECTED');
  assert.equal((byName.get('d') as any).status, 'PASS');
  assert.equal((byName.get('e') as any).status, 'UNKNOWN_IDENTIFIER');
  assert.deepEqual((byName.get('e') as any).detail.unknownIdentifiers.exceptions, ['No-such-exception']);
  assert.equal((byName.get('f') as any).status, 'SYNTAX_ERROR');
  assert.equal((byName.get('f') as any).detail.error.position, 8);
  assert.equal((byName.get('g') as any).status, 'UNKNOWN_IDENTIFIER');
  assert.equal(report.summary.PASS, 3);
  assert.equal(report.summary.REJECTED, 1);
  assert.equal(report.summary.SYNTAX_ERROR, 1);
  assert.equal(report.summary.UNKNOWN_IDENTIFIER, 2);
  store.close();
});

test('空清单生成空报告', () => {
  const store = freshStore();
  const p = store.createProject('empty');
  const m = store.importManifest(p.id, []);
  const v = store.createPolicy('default', RULES_V1);
  const { reportId } = runCheck(store, m.manifestId, v.id);
  const report = store.getReport(reportId);
  assert.equal(report.items.length, 0);
  assert.equal(report.summary.PASS, 0);
  store.close();
});

test('重复导入同一清单返回已有记录', () => {
  const store = freshStore();
  const p = store.createProject('p1');
  const m1 = store.importManifest(p.id, DEPS);
  const m2 = store.importManifest(p.id, DEPS);
  assert.equal(m1.manifestId, m2.manifestId);
  assert.equal(m1.duplicated, false);
  assert.equal(m2.duplicated, true);
  assert.equal(store.getManifestDeps(m1.manifestId).length, DEPS.length);
  store.close();
});

test('策略修改生成新版本，旧报告不被覆盖', () => {
  const store = freshStore();
  const { m, v1 } = setup(store);
  const r1 = runCheck(store, m.manifestId, v1.id);
  const v2 = store.createPolicy('default', {
    allowedLicenses: ['MIT', 'ISC'],
    allowedCombos: [],
  });
  assert.equal(v2.version, 2);
  const r2 = runCheck(store, m.manifestId, v2.id);
  assert.notEqual(r1.reportId, r2.reportId);
  const report1 = store.getReport(r1.reportId);
  assert.equal(report1.policyId, v1.id);
  assert.equal(report1.summary.PASS, 3); // 旧报告保持原样
  const cmp = compareReports(store, r1.reportId, r2.reportId);
  assert.equal(cmp.sameManifest, true);
  const changed = new Map(cmp.changes.filter((c: any) => c.changed).map((c: any) => [c.dependency, c]));
  assert.ok(changed.get('a@1.0.0')); // Apache-2.0 被移除
  assert.ok(changed.get('d@1.0.0')); // 组合被移除
  assert.equal(changed.get('b@1.0.0'), undefined); // MIT 仍允许
  store.close();
});

test('重启后（重新打开数据库）报告仍可读取', () => {
  const dbPath = tmpDb();
  let store = freshStore(dbPath);
  const { m, v1 } = setup(store);
  const { reportId } = runCheck(store, m.manifestId, v1.id);
  store.close();
  store = new Store(dbPath);
  const report = store.getReport(reportId);
  assert.equal(report.items.length, DEPS.length);
  assert.equal(report.summary.PASS, 3);
  store.close();
});

test('参数校验与错误码', () => {
  const store = freshStore();
  assert.throws(() => store.createProject(''), /VALIDATION_ERROR|名称不能为空/);
  assert.throws(() => store.createPolicy('x', { allowedLicenses: ['Nope'], allowedCombos: [] }), /目录外许可证/);
  assert.throws(() => store.getReport(999), /不存在/);
  store.close();
});

test('HTTP API 端到端', async () => {
  const store = freshStore();
  const { port, close } = await startServer(store, 0);
  assert.ok(port > 0); // 默认选择空闲端口
  const base = `http://127.0.0.1:${port}`;
  const post = async (p: string, body: unknown) => {
    const res = await fetch(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  const proj = await post('/api/projects', { name: 'api-p' });
  assert.equal(proj.status, 201);
  const man = await post(`/api/projects/${proj.json.id}/manifests`, { dependencies: DEPS });
  assert.equal(man.status, 201);
  const man2 = await post(`/api/projects/${proj.json.id}/manifests`, { dependencies: DEPS });
  assert.equal(man2.status, 200);
  assert.equal(man2.json.duplicated, true);
  const pol = await post('/api/policies', { name: 'default', ...RULES_V1 });
  assert.equal(pol.status, 201);
  const chk = await post('/api/checks', { manifestId: man.json.manifestId, policyId: pol.json.id });
  assert.equal(chk.status, 201);
  const repRes = await fetch(`${base}/api/reports/${chk.json.reportId}`);
  const report = await repRes.json();
  assert.equal(report.items.length, DEPS.length);
  const bad = await post('/api/checks', { manifestId: 'abc', policyId: 1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'VALIDATION_ERROR');
  const notFound = await fetch(`${base}/api/reports/999`);
  assert.equal(notFound.status, 404);
  close();
  store.close();
});



