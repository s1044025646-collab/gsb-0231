// 策略求值：判断表达式 AST 是否被策略准入，并给出造成通过/拒绝的具体分支。
import { ExprNode } from './parser';

export interface PolicyRules {
  /** 允许单独出现的许可证标识符 */
  allowedLicenses: string[];
  /** 允许的组合：许可证 + 例外（独立于基础许可证单独核对） */
  allowedCombos: Array<{ license: string; exception: string }>;
}

export interface BranchResult {
  ok: boolean;
  /** 说明路径，按稳定顺序（从左到右）记录 */
  trace: string[];
}

function comboAllowed(rules: PolicyRules, license: string, exception: string): boolean {
  return rules.allowedCombos.some(
    (c) => c.license === license && c.exception === exception,
  );
}

export function evaluate(ast: ExprNode, rules: PolicyRules): BranchResult {
  switch (ast.kind) {
    case 'license': {
      const ok = rules.allowedLicenses.includes(ast.id);
      return {
        ok,
        trace: [ok
          ? `许可证 ${ast.id} 在允许列表中，通过`
          : `许可证 ${ast.id} 不在允许列表中，拒绝`],
      };
    }
    case 'with': {
      const { license, exception } = ast;
      const ok = comboAllowed(rules, license.id, exception);
      return {
        ok,
        trace: [ok
          ? `组合 ${license.id} WITH ${exception} 在允许组合列表中，通过`
          : `组合 ${license.id} WITH ${exception} 未获准（基础许可证是否允许不影响组合判定），拒绝`],
      };
    }
    case 'and': {
      const l = evaluate(ast.left, rules);
      const r = evaluate(ast.right, rules);
      const ok = l.ok && r.ok;
      return {
        ok,
        trace: [
          `AND 分支：两侧均须满足，结果 ${ok ? '通过' : '拒绝'}`,
          ...l.trace.map((t) => `  [左] ${t}`),
          ...r.trace.map((t) => `  [右] ${t}`),
        ],
      };
    }
    case 'or': {
      const l = evaluate(ast.left, rules);
      if (l.ok) {
        return {
          ok: true,
          trace: [
            'OR 分支：左分支已满足，采用左分支（稳定顺序：从左到右，不搜索全局最优）',
            ...l.trace.map((t) => `  [左] ${t}`),
          ],
        };
      }
      const r = evaluate(ast.right, rules);
      if (r.ok) {
        return {
          ok: true,
          trace: [
            'OR 分支：左分支不满足，右分支满足，采用右分支',
            ...l.trace.map((t) => `  [左] ${t}`),
            ...r.trace.map((t) => `  [右] ${t}`),
          ],
        };
      }
      return {
        ok: false,
        trace: [
          'OR 分支：两侧均不满足，拒绝',
          ...l.trace.map((t) => `  [左] ${t}`),
          ...r.trace.map((t) => `  [右] ${t}`),
        ],
      };
    }
  }
}
