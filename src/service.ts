// 核对服务：对清单逐条执行 解析 -> 目录校验 -> 策略求值，并生成报告。
import { parse, collectIds, ParseError } from './parser';
import { evaluate } from './evaluate';
import { Store } from './store';

export interface CheckItemResult {
  dependencyId: number;
  status: 'PASS' | 'REJECTED' | 'SYNTAX_ERROR' | 'UNKNOWN_IDENTIFIER';
  ast: unknown;
  detail: {
    outcome: string;
    trace?: string[];
    error?: { code: string; message: string; position?: number };
    unknownIdentifiers?: { licenses: string[]; exceptions: string[] };
  };
}

export function runCheck(store: Store, manifestId: number, policyId: number) {
  const deps = store.getManifestDeps(manifestId);
  const policy = store.getPolicy(policyId);
  const catalog = store.listCatalog();

  const items: CheckItemResult[] = deps.map((dep) => {
    // 1. 语法解析
    let ast;
    try {
      ast = parse(dep.expression);
    } catch (e) {
      if (e instanceof ParseError) {
        return {
          dependencyId: dep.id,
          status: 'SYNTAX_ERROR' as const,
          ast: null,
          detail: {
            outcome: '语法错误，未准入（错误不默认放行）',
            error: { code: 'SYNTAX_ERROR', message: e.message, position: e.position },
          },
        };
      }
      throw e;
    }
    // 2. 目录校验
    const ids = collectIds(ast);
    const unknownLicenses = ids.licenses.filter((l) => !catalog.licenses.includes(l));
    const unknownExceptions = ids.exceptions.filter((x) => !catalog.exceptions.includes(x));
    if (unknownLicenses.length > 0 || unknownExceptions.length > 0) {
      return {
        dependencyId: dep.id,
        status: 'UNKNOWN_IDENTIFIER' as const,
        ast,
        detail: {
          outcome: '包含目录外标识符，未准入（未知标识不默认放行）',
          error: { code: 'UNKNOWN_IDENTIFIER', message: '表达式包含本地目录之外的许可证或例外标识' },
          unknownIdentifiers: { licenses: unknownLicenses, exceptions: unknownExceptions },
        },
      };
    }
    // 3. 策略求值
    const result = evaluate(ast, policy.rules);
    return {
      dependencyId: dep.id,
      status: result.ok ? ('PASS' as const) : ('REJECTED' as const),
      ast,
      detail: {
        outcome: result.ok ? '符合策略，准入' : '有效表达式，但被策略拒绝',
        ...(result.ok ? {} : { error: { code: 'POLICY_REJECTED', message: '表达式有效但未满足准入策略' } }),
        trace: result.trace,
      },
    };
  });

  const { reportId, summary } = store.saveReport(manifestId, policyId, items);
  return { reportId, summary, policy, itemCount: items.length };
}

/** 比较两份报告（通常为同一清单在两个策略版本下的结果）。 */
export function compareReports(store: Store, reportAId: number, reportBId: number) {
  const a = store.getReport(reportAId);
  const b = store.getReport(reportBId);
  const keyOf = (it: any) => `${it.dependency.name}@${it.dependency.version}`;
  const mapA = new Map(a.items.map((it: any) => [keyOf(it), it]));
  const mapB = new Map(b.items.map((it: any) => [keyOf(it), it]));
  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])];
  const changes = keys.map((k) => {
    const ia = mapA.get(k) as any;
    const ib = mapB.get(k) as any;
    return {
      dependency: k,
      statusInA: ia ? ia.status : null,
      statusInB: ib ? ib.status : null,
      changed: !ia || !ib || ia.status !== ib.status,
    };
  });
  return {
    reportA: { id: a.id, policyId: a.policyId, manifestId: a.manifestId },
    reportB: { id: b.id, policyId: b.policyId, manifestId: b.manifestId },
    sameManifest: a.manifestId === b.manifestId,
    changes,
    changedCount: changes.filter((c) => c.changed).length,
  };
}
