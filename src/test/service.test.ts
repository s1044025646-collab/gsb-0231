import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb, seedCatalog } from '../db.js';
import { Service, ApiError } from '../service.js';

let dir: string;
let svc: Service;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-test-'));
  const db = openDb(dir);
  seedCatalog(db);
  svc = new Service(db);
});

const makeProject = () => svc.createProject('p') as { id: number };
const makePolicy = (licenses: string[], combos: { license: string; exception: string }[] = []) =>
  svc.createPolicy({ name: `pol-${Math.random()}`, allowedLicenses: licenses, allowedCombos: combos }) as any;

test('check classifies pass, fail, syntax error, unknown identifier', () => {
  const p = makeProject();
  svc.importManifest(p.id, [
    { name: 'a', version: '1', expression: 'MIT AND Apache-2.0' },
    { name: 'b', version: '1', expression: 'GPL-3.0-only' },
    { name: 'c', version: '1', expression: 'MIT AND' },
    { name: 'd', version: '1', expression: 'Unknown-License' },
    { name: 'e', version: '1', expression: 'GPL-3.0-only WITH Unknown-Exception' },
  ]);
  const v = makePolicy(['MIT', 'Apache-2.0']);
  const r = svc.check(p.id, v.policyVersionId);
  assert.deepEqual({ pass: r.pass, fail: r.fail, error: r.error }, { pass: 1, fail: 1, error: 3 });
  const report = svc.getReport(r.reportId) as any;
  const byName = Object.fromEntries(report.items.map((i: any) => [i.dep_name, i]));
  assert.equal(byName.a.status, 'pass');
  assert.equal(byName.b.status, 'fail');
  assert.equal(byName.c.error_kind, 'syntax');
  assert.equal(byName.c.error_position, 7);
  assert.equal(byName.d.error_kind, 'unknown_identifier');
  assert.equal(byName.e.error_kind, 'unknown_identifier');
});

test('empty manifest produces an empty report', () => {
  const p = makeProject();
  const v = makePolicy(['MIT']);
  const r = svc.check(p.id, v.policyVersionId);
  assert.equal(r.total, 0);
  assert.equal((svc.getReport(r.reportId) as any).items.length, 0);
});

test('duplicate imports are skipped, not duplicated', () => {
  const p = makeProject();
  const deps = [{ name: 'a', version: '1', expression: 'MIT' }];
  const first = svc.importManifest(p.id, deps);
  const second = svc.importManifest(p.id, deps);
  assert.deepEqual(first, { inserted: 1, skipped: 0, total: 1 });
  assert.deepEqual(second, { inserted: 0, skipped: 1, total: 1 });
  assert.equal((svc.listDependencies(p.id) as any[]).length, 1);
});

test('policy update creates a new version and old reports are preserved', () => {
  const p = makeProject();
  svc.importManifest(p.id, [{ name: 'a', version: '1', expression: 'MIT AND GPL-3.0-only' }]);
  const v1 = svc.createPolicy({ name: 'pol', allowedLicenses: ['MIT', 'GPL-3.0-only'], allowedCombos: [] }) as any;
  const r1 = svc.check(p.id, v1.policyVersionId);
  const v2 = svc.updatePolicy(v1.policyId, { allowedLicenses: ['MIT'], allowedCombos: [] }) as any;
  assert.equal(v2.version, 2);
  const r2 = svc.check(p.id, v2.policyVersionId);
  assert.equal((svc.getReport(r1.reportId) as any).items[0].status, 'pass');
  assert.equal((svc.getReport(r2.reportId) as any).items[0].status, 'fail');
  const cmp = svc.compareReports(r1.reportId, r2.reportId) as any;
  assert.deepEqual(cmp.changes, [
    { dependency: 'a@1', change: 'status_changed', from: 'pass', to: 'fail', expression: 'MIT AND GPL-3.0-only' },
  ]);
});

test('data survives reopening the database', () => {
  const p = makeProject();
  svc.importManifest(p.id, [{ name: 'a', version: '1', expression: 'MIT' }]);
  const v = makePolicy(['MIT']);
  const r = svc.check(p.id, v.policyVersionId);
  const svc2 = new Service(openDb(dir));
  const report = svc2.getReport(r.reportId) as any;
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].status, 'pass');
  assert.equal((svc2.listReports(p.id) as any[]).length, 1);
});

test('validation errors and error codes', () => {
  assert.throws(() => svc.createProject(''), (e: ApiError) => e.code === 'VALIDATION_ERROR');
  assert.throws(() => svc.importManifest(999, []), (e: ApiError) => e.code === 'NOT_FOUND');
  const p = makeProject();
  assert.throws(
    () => svc.importManifest(p.id, [{ name: 'a', version: '', expression: 'MIT' }]),
    (e: ApiError) => e.code === 'VALIDATION_ERROR',
  );
  assert.throws(
    () => makePolicy(['Not-In-Catalog']),
    (e: ApiError) => e.code === 'UNKNOWN_IDENTIFIER',
  );
  assert.throws(() => svc.check(p.id, 999), (e: ApiError) => e.code === 'NOT_FOUND');
});
