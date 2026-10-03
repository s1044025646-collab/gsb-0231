import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parser';
import { evaluate, PolicyRules } from '../src/evaluate';

const rules: PolicyRules = {
  allowedLicenses: ['MIT', 'ISC', 'Apache-2.0'],
  allowedCombos: [{ license: 'GPL-2.0-only', exception: 'Classpath-exception-2.0' }],
};

test('AND 两侧都满足才通过', () => {
  assert.equal(evaluate(parse('MIT AND Apache-2.0'), rules).ok, true);
  assert.equal(evaluate(parse('MIT AND GPL-3.0-only'), rules).ok, false);
});

test('OR 任一分支满足即通过', () => {
  assert.equal(evaluate(parse('GPL-3.0-only OR MIT'), rules).ok, true);
  assert.equal(evaluate(parse('GPL-3.0-only OR EPL-2.0'), rules).ok, false);
});

test('AND 优先于 OR 影响结果', () => {
  assert.equal(evaluate(parse('MIT OR GPL-3.0-only AND Apache-2.0'), rules).ok, true);
});

test('括号改变结果', () => {
  assert.equal(evaluate(parse('(MIT OR GPL-3.0-only) AND GPL-2.0-only'), rules).ok, false);
});

test('WITH 组合单独获准', () => {
  assert.equal(evaluate(parse('GPL-2.0-only WITH Classpath-exception-2.0'), rules).ok, true);
});

test('组合获准不影响裸许可证', () => {
  assert.equal(evaluate(parse('GPL-2.0-only'), rules).ok, false);
});

test('基础许可证被允许不豁免未获准的例外组合', () => {
  const r2: PolicyRules = { allowedLicenses: ['GPL-2.0-only'], allowedCombos: [] };
  assert.equal(evaluate(parse('GPL-2.0-only WITH Classpath-exception-2.0'), r2).ok, false);
});

test('OR 稳定顺序：优先采用左分支', () => {
  const r = evaluate(parse('MIT OR Apache-2.0'), rules);
  assert.equal(r.ok, true);
  assert.ok(r.trace.join('\n').includes('采用左分支'));
});

test('OR 左失败右成功时记录两分支说明', () => {
  const r = evaluate(parse('GPL-3.0-only OR MIT'), rules);
  assert.equal(r.ok, true);
  assert.ok(r.trace.join('\n').includes('采用右分支'));
});
