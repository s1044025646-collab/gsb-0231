import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, ParseError } from '../src/parser';

test('AND 优先于 OR（结构断言）', () => {
  const ast = parse('MIT OR GPL-3.0-only AND Apache-2.0');
  assert.deepEqual(ast, {
    kind: 'or',
    left: { kind: 'license', id: 'MIT' },
    right: {
      kind: 'and',
      left: { kind: 'license', id: 'GPL-3.0-only' },
      right: { kind: 'license', id: 'Apache-2.0' },
    },
  });
});

test('括号改变组合顺序', () => {
  const ast = parse('(MIT OR GPL-3.0-only) AND Apache-2.0');
  assert.equal(ast.kind, 'and');
  if (ast.kind === 'and') assert.equal(ast.left.kind, 'or');
});

test('嵌套括号', () => {
  const ast = parse('((MIT AND ISC) OR (Apache-2.0 AND (BSD-2-Clause OR 0BSD)))');
  assert.equal(ast.kind, 'or');
});

test('WITH 绑定单个许可证', () => {
  const ast = parse('GPL-2.0-only WITH Classpath-exception-2.0');
  assert.deepEqual(ast, {
    kind: 'with',
    license: { kind: 'license', id: 'GPL-2.0-only' },
    exception: 'Classpath-exception-2.0',
  });
});

test('WITH 优先于 AND', () => {
  const ast = parse('MIT AND GPL-2.0-only WITH Classpath-exception-2.0');
  assert.equal(ast.kind, 'and');
  if (ast.kind === 'and') assert.equal(ast.right.kind, 'with');
});

test('关键字大小写不敏感', () => {
  const ast = parse('mit and apache-2.0');
  assert.equal(ast.kind, 'and');
});

test('空表达式报错', () => {
  assert.throws(() => parse(''), (e: unknown) => e instanceof ParseError && (e as ParseError).position === 0);
  assert.throws(() => parse('   '), ParseError);
});

test('连续运算符报错并定位', () => {
  try {
    parse('MIT AND OR Apache-2.0');
    assert.fail('应抛出 ParseError');
  } catch (e) {
    assert.ok(e instanceof ParseError);
    assert.equal((e as ParseError).position, 8); // 'OR' 的位置
  }
});

test('括号不匹配报错', () => {
  assert.throws(() => parse('(MIT AND ISC'), ParseError);
  try {
    parse('MIT)');
    assert.fail('应抛出');
  } catch (e) {
    assert.equal((e as ParseError).position, 3);
  }
});

test('WITH 后缺少例外报错', () => {
  assert.throws(() => parse('MIT WITH'), ParseError);
});

test('表达式以运算符开头报错', () => {
  assert.throws(() => parse('AND MIT'), ParseError);
});
