// 受限 SPDX 风格表达式解析器。
// 语法（关键字大小写不敏感）：
//   expr    := orExpr
//   orExpr  := andExpr (OR andExpr)*
//   andExpr := withExpr (AND withExpr)*
//   withExpr:= primary (WITH IDENT)?        // WITH 只绑定单个许可证
//   primary := IDENT | '(' orExpr ')'
// 优先级：括号 > WITH > AND > OR

export type ExprNode =
  | { kind: 'license'; id: string }
  | { kind: 'with'; license: { kind: 'license'; id: string }; exception: string }
  | { kind: 'and'; left: ExprNode; right: ExprNode }
  | { kind: 'or'; left: ExprNode; right: ExprNode };

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly position: number, // 在原始输入中的字符偏移（0 起）
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

interface Token {
  type: 'ident' | 'and' | 'or' | 'with' | 'lparen' | 'rparen';
  text: string;
  pos: number;
}

const IDENT_RE = /[A-Za-z0-9.+-]+/y;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') { tokens.push({ type: 'lparen', text: '(', pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', text: ')', pos: i }); i++; continue; }
    IDENT_RE.lastIndex = i;
    const m = IDENT_RE.exec(input);
    if (m) {
      const text = m[0];
      const upper = text.toUpperCase();
      const type =
        upper === 'AND' ? 'and' :
        upper === 'OR' ? 'or' :
        upper === 'WITH' ? 'with' : 'ident';
      tokens.push({ type, text, pos: i });
      i += text.length;
      continue;
    }
    throw new ParseError(`无法识别的字符 '${ch}'`, i);
  }
  return tokens;
}

export function parse(input: string): ExprNode {
  if (input == null || input.trim() === '') {
    throw new ParseError('表达式为空', 0);
  }
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new ParseError('表达式为空', 0);
  let cursor = 0;

  const peek = (): Token | undefined => tokens[cursor];
  const next = (): Token => tokens[cursor++];

  function parsePrimary(): ExprNode {
    const t = peek();
    if (!t) throw new ParseError('表达式意外结束，缺少许可证标识符或括号', input.length);
    if (t.type === 'ident') {
      next();
      return { kind: 'license', id: t.text };
    }
    if (t.type === 'lparen') {
      next();
      const inner = parseOr();
      const closing = peek();
      if (!closing || closing.type !== 'rparen') {
        throw new ParseError("括号不匹配：缺少 ')'", closing ? closing.pos : input.length);
      }
      next();
      return inner;
    }
    if (t.type === 'rparen') throw new ParseError("括号不匹配：多余的 ')'", t.pos);
    throw new ParseError(`此处不应出现运算符 '${t.text}'（可能是连续运算符或表达式以运算符开头）`, t.pos);
  }

  function parseWith(): ExprNode {
    const base = parsePrimary();
    const t = peek();
    if (t && t.type === 'with') {
      next();
      if (base.kind !== 'license') {
        throw new ParseError('WITH 只能绑定单个许可证标识符，不能作用于括号表达式', t.pos);
      }
      const exc = peek();
      if (!exc || exc.type !== 'ident') {
        throw new ParseError('WITH 之后必须跟随一个例外标识符', exc ? exc.pos : input.length);
      }
      next();
      return { kind: 'with', license: base, exception: exc.text };
    }
    return base;
  }

  function parseAnd(): ExprNode {
    let left = parseWith();
    while (peek() && peek()!.type === 'and') {
      next();
      const right = parseWith();
      left = { kind: 'and', left, right };
    }
    return left;
  }

  function parseOr(): ExprNode {
    let left = parseAnd();
    while (peek() && peek()!.type === 'or') {
      next();
      const right = parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }

  const ast = parseOr();
  const rest = peek();
  if (rest) {
    if (rest.type === 'rparen') throw new ParseError("括号不匹配：多余的 ')'", rest.pos);
    throw new ParseError(`表达式在 '${rest.text}' 处存在多余内容（可能缺少运算符）`, rest.pos);
  }
  return ast;
}

/** 收集表达式中的许可证与例外标识符（用于未知标识检查）。 */
export function collectIds(ast: ExprNode): { licenses: string[]; exceptions: string[] } {
  const licenses: string[] = [];
  const exceptions: string[] = [];
  const walk = (n: ExprNode): void => {
    switch (n.kind) {
      case 'license': licenses.push(n.id); break;
      case 'with': licenses.push(n.license.id); exceptions.push(n.exception); break;
      case 'and': case 'or': walk(n.left); walk(n.right); break;
    }
  };
  walk(ast);
  return { licenses, exceptions };
}
