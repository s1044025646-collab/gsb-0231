import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, SyntaxError } from '../expression.js';
import { evaluate, type PolicyRules } from '../evaluator.js';

const rules = (licenses: string[], combos: string[] = []): PolicyRules => ({
  allowedLicenses: new Set(licenses),
  allowedCombos: new Set(combos),
});

test('AND has higher precedence than OR', () => {
  const ast = parse('MIT OR Apache-2.0 AND GPL-3.0-only');
  assert.equal(ast.type, 'or');
  assert.equal((ast as any).right.type, 'and');
  const t = evaluate(ast, rules(['MIT']));
  assert.equal(t.status, 'pass');
  const t2 = evaluate(ast, rules(['Apache-2.0']));
  assert.equal(t2.status, 'fail');
});

test('parentheses change the result', () => {
  const flat = evaluate(parse('MIT OR Apache-2.0 AND GPL-3.0-only'), rules(['Apache-2.0']));
  assert.equal(flat.status, 'fail');
  const grouped = evaluate(parse('(MIT OR Apache-2.0) AND GPL-3.0-only'), rules(['Apache-2.0', 'GPL-3.0-only']));
  assert.equal(grouped.status, 'pass');
});

test('OR picks first passing branch in stable order', () => {
  const t = evaluate(parse('GPL-3.0-only OR MIT OR Apache-2.0'), rules(['MIT', 'Apache-2.0']));
  assert.equal(t.status, 'pass');
  assert.equal(t.decidedBy, 0);
});

test('WITH binds a single license and combo is checked independently', () => {
  const ast = parse('GPL-3.0-only WITH Classpath-exception-2.0');
  assert.deepEqual(ast, { type: 'license', id: 'GPL-3.0-only', exception: 'Classpath-exception-2.0' });
  const t = evaluate(ast, rules(['GPL-3.0-only']));
  assert.equal(t.status, 'fail');
  assert.match(t.reason, /exception is not approved/);
  const t2 = evaluate(ast, rules([], ['GPL-3.0-only WITH Classpath-exception-2.0']));
  assert.equal(t2.status, 'pass');
});

test('WITH after parenthesized expression is a syntax error', () => {
  assert.throws(() => parse('(MIT OR Apache-2.0) WITH Foo'), SyntaxError);
});

test('syntax errors carry positions', () => {
  assert.throws(() => parse(''), (e: SyntaxError) => e.position === 0);
  assert.throws(() => parse('MIT AND'), (e: SyntaxError) => e.position === 7);
  assert.throws(() => parse('MIT AND OR Apache-2.0'), (e: SyntaxError) => e.position === 8);
  assert.throws(() => parse('(MIT OR Apache-2.0'), (e: SyntaxError) => e.position === 18);
  assert.throws(() => parse('MIT)'), (e: SyntaxError) => e.position === 3);
  assert.throws(() => parse('MIT @ Apache-2.0'), (e: SyntaxError) => e.position === 4);
});

test('nested expressions', () => {
  const t = evaluate(
    parse('(MIT AND (Apache-2.0 OR BSD-3-Clause)) OR (GPL-3.0-only WITH Classpath-exception-2.0)'),
    rules(['MIT', 'BSD-3-Clause']),
  );
  assert.equal(t.status, 'pass');
});

