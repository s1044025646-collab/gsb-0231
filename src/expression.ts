// Restricted SPDX-style expression lexer + parser.
// Grammar:
//   expr     := orExpr
//   orExpr   := andExpr (OR andExpr)*
//   andExpr  := withExpr (AND withExpr)*
//   withExpr := primary (WITH IDENT)?
//   primary  := IDENT | '(' expr ')'

export type ExprNode =
  | { type: 'license'; id: string; exception?: string }
  | { type: 'and' | 'or'; left: ExprNode; right: ExprNode };

export class SyntaxError extends Error {
  constructor(
    message: string,
    public position: number,
  ) {
    super(message);
    this.name = 'SyntaxError';
  }
}

type Token =
  | { kind: 'ident'; value: string; pos: number }
  | { kind: 'AND' | 'OR' | 'WITH' | '(' | ')'; pos: number };

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') { tokens.push({ kind: '(', pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: ')', pos: i }); i++; continue; }
    if (/[A-Za-z0-9.-]/.test(ch)) {
      const start = i;
      while (i < input.length && /[A-Za-z0-9.+-]/.test(input[i])) i++;
      const word = input.slice(start, i);
      if (word === 'AND') tokens.push({ kind: 'AND', pos: start });
      else if (word === 'OR') tokens.push({ kind: 'OR', pos: start });
      else if (word === 'WITH') tokens.push({ kind: 'WITH', pos: start });
      else tokens.push({ kind: 'ident', value: word, pos: start });
      continue;
    }
    throw new SyntaxError(`unexpected character '${ch}'`, i);
  }
  return tokens;
}

export function parse(input: string): ExprNode {
  if (!input || !input.trim()) {
    throw new SyntaxError('empty expression', 0);
  }
  const tokens = tokenize(input);
  let cursor = 0;

  const peek = (): Token | undefined => tokens[cursor];
  const next = (): Token => tokens[cursor++];

  function parsePrimary(): ExprNode {
    const tok = peek();
    if (!tok) throw new SyntaxError('unexpected end of expression', input.length);
    if (tok.kind === 'ident') {
      next();
      return { type: 'license', id: tok.value };
    }
    if (tok.kind === '(') {
      next();
      const inner = parseOr();
      const closing = peek();
      if (!closing || closing.kind !== ')') {
        throw new SyntaxError("missing closing ')'", closing ? closing.pos : input.length);
      }
      next();
      return inner;
    }
    if (tok.kind === ')') throw new SyntaxError("unmatched ')'", tok.pos);
    throw new SyntaxError(`expected identifier or '(', got operator ${tok.kind}`, tok.pos);
  }

  function parseWith(): ExprNode {
    let node = parsePrimary();
    const tok = peek();
    if (tok && tok.kind === 'WITH') {
      next();
      if (node.type !== 'license') {
        throw new SyntaxError('WITH must follow a single license identifier', tok.pos);
      }
      const exc = peek();
      if (!exc || exc.kind !== 'ident') {
        throw new SyntaxError('WITH requires an exception identifier', exc ? exc.pos : input.length);
      }
      next();
      node = { ...node, exception: exc.value };
    }
    return node;
  }

  function parseAnd(): ExprNode {
    let left = parseWith();
    while (peek() && peek()!.kind === 'AND') {
      next();
      const right = parseWith();
      left = { type: 'and', left, right };
    }
    return left;
  }

  function parseOr(): ExprNode {
    let left = parseAnd();
    while (peek() && peek()!.kind === 'OR') {
      next();
      const right = parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  const ast = parseOr();
  if (cursor < tokens.length) {
    const tok = tokens[cursor];
    if (tok.kind === ')') throw new SyntaxError("unmatched ')'", tok.pos);
    throw new SyntaxError('unexpected trailing input', tok.pos);
  }
  return ast;
}

export function collectIdentifiers(node: ExprNode): { licenses: string[]; exceptions: string[] } {
  const licenses: string[] = [];
  const exceptions: string[] = [];
  const walk = (n: ExprNode) => {
    if (n.type === 'license') {
      licenses.push(n.id);
      if (n.exception) exceptions.push(n.exception);
    } else {
      walk(n.left);
      walk(n.right);
    }
  };
  walk(node);
  return { licenses, exceptions };
}
