import type { DatabaseSync } from 'node:sqlite';
import { parse, collectIdentifiers, SyntaxError } from './expression.js';
import { evaluate, type EvalTrace, type PolicyRules } from './evaluator.js';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface DepInput { name: string; version: string; expression: string }

function validateDep(d: unknown, index: number): DepInput {
  if (typeof d !== 'object' || d === null) {
    throw new ApiError('VALIDATION_ERROR', `dependency[${index}] must be an object`);
  }
  const { name, version, expression } = d as Record<string, unknown>;
  for (const [key, val] of Object.entries({ name, version, expression })) {
    if (typeof val !== 'string' || !val.trim()) {
      throw new ApiError('VALIDATION_ERROR', `dependency[${index}].${key} must be a non-empty string`);
    }
  }
  return { name: (name as string).trim(), version: (version as string).trim(), expression: (expression as string).trim() };
}

export class Service {
  constructor(private db: DatabaseSync) {}

  createProject(name: unknown) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ApiError('VALIDATION_ERROR', 'project name must be a non-empty string');
    }
    try {
      const r = this.db.prepare('INSERT INTO projects (name) VALUES (?)').run(name.trim());
      return { id: Number(r.lastInsertRowid), name: name.trim() };
    } catch {
      throw new ApiError('CONFLICT', `project '${name}' already exists`, 409);
    }
  }

  listProjects() {
    return this.db.prepare('SELECT id, name, created_at FROM projects ORDER BY id').all();
  }

  private requireProject(projectId: number) {
    const p = this.db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId);
    if (!p) throw new ApiError('NOT_FOUND', `project ${projectId} not found`, 404);
    return p;
  }

  importManifest(projectId: number, deps: unknown) {
    this.requireProject(projectId);
    if (!Array.isArray(deps)) {
      throw new ApiError('VALIDATION_ERROR', 'dependencies must be an array');
    }
    const validated = deps.map(validateDep);
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO dependencies (project_id, name, version, expression) VALUES (?, ?, ?, ?)',
    );
    let inserted = 0;
    let skipped = 0;
    for (const d of validated) {
      const r = insert.run(projectId, d.name, d.version, d.expression);
      if (Number(r.changes) > 0) inserted++; else skipped++;
    }
    return { inserted, skipped, total: validated.length };
  }

  listDependencies(projectId: number) {
    this.requireProject(projectId);
    return this.db.prepare(
      'SELECT id, name, version, expression FROM dependencies WHERE project_id = ? ORDER BY id',
    ).all(projectId);
  }

  catalog() {
    return {
      licenses: (this.db.prepare('SELECT id FROM licenses ORDER BY id').all() as any[]).map((r) => r.id),
      exceptions: (this.db.prepare('SELECT id FROM exceptions ORDER BY id').all() as any[]).map((r) => r.id),
    };
  }

  addLicense(id: unknown) {
    if (typeof id !== 'string' || !id.trim()) throw new ApiError('VALIDATION_ERROR', 'license id required');
    this.db.prepare('INSERT OR IGNORE INTO licenses (id) VALUES (?)').run(id.trim());
    return { id: id.trim() };
  }

  addException(id: unknown) {
    if (typeof id !== 'string' || !id.trim()) throw new ApiError('VALIDATION_ERROR', 'exception id required');
    this.db.prepare('INSERT OR IGNORE INTO exceptions (id) VALUES (?)').run(id.trim());
    return { id: id.trim() };
  }

  private validatePolicyBody(body: any): { allowedLicenses: string[]; allowedCombos: string[] } {
    if (typeof body !== 'object' || body === null) throw new ApiError('VALIDATION_ERROR', 'policy body required');
    const { allowedLicenses, allowedCombos } = body;
    if (!Array.isArray(allowedLicenses) || allowedLicenses.some((x) => typeof x !== 'string')) {
      throw new ApiError('VALIDATION_ERROR', 'allowedLicenses must be an array of strings');
    }
    if (!Array.isArray(allowedCombos)) throw new ApiError('VALIDATION_ERROR', 'allowedCombos must be an array');
    const combos = allowedCombos.map((c: any, i: number) => {
      if (typeof c !== 'object' || c === null || typeof c.license !== 'string' || typeof c.exception !== 'string') {
        throw new ApiError('VALIDATION_ERROR', `allowedCombos[${i}] must have license and exception strings`);
      }
      return `${c.license} WITH ${c.exception}`;
    });
    const known = this.catalog();
    for (const l of allowedLicenses) {
      if (!known.licenses.includes(l)) throw new ApiError('UNKNOWN_IDENTIFIER', `license '${l}' is not in the catalog`);
    }
    for (const c of allowedCombos) {
      if (!known.licenses.includes(c.license)) throw new ApiError('UNKNOWN_IDENTIFIER', `license '${c.license}' is not in the catalog`);
      if (!known.exceptions.includes(c.exception)) throw new ApiError('UNKNOWN_IDENTIFIER', `exception '${c.exception}' is not in the catalog`);
    }
    return { allowedLicenses, allowedCombos: combos };
  }

  createPolicy(body: any) {
    if (typeof body?.name !== 'string' || !body.name.trim()) {
      throw new ApiError('VALIDATION_ERROR', 'policy name required');
    }
    const rules = this.validatePolicyBody(body);
    try {
      const r = this.db.prepare('INSERT INTO policies (name) VALUES (?)').run(body.name.trim());
      const policyId = Number(r.lastInsertRowid);
      return this.addPolicyVersion(policyId, rules);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('CONFLICT', `policy '${body.name}' already exists`, 409);
    }
  }

  addPolicyVersion(policyId: number, rules: { allowedLicenses: string[]; allowedCombos: string[] }) {
    const row = this.db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM policy_versions WHERE policy_id = ?').get(policyId) as any;
    const version = row.v + 1;
    const r = this.db.prepare(
      'INSERT INTO policy_versions (policy_id, version, allowed_licenses, allowed_combos) VALUES (?, ?, ?, ?)',
    ).run(policyId, version, JSON.stringify(rules.allowedLicenses), JSON.stringify(rules.allowedCombos));
    return { policyId, policyVersionId: Number(r.lastInsertRowid), version, ...rules };
  }

  updatePolicy(policyId: number, body: any) {
    const p = this.db.prepare('SELECT id FROM policies WHERE id = ?').get(policyId);
    if (!p) throw new ApiError('NOT_FOUND', `policy ${policyId} not found`, 404);
    const rules = this.validatePolicyBody(body);
    return this.addPolicyVersion(policyId, rules);
  }

  listPolicies() {
    const policies = this.db.prepare('SELECT id, name FROM policies ORDER BY id').all() as any[];
    return policies.map((p) => ({
      ...p,
      versions: (this.db.prepare(
        'SELECT id, version, allowed_licenses, allowed_combos, created_at FROM policy_versions WHERE policy_id = ? ORDER BY version',
      ).all(p.id) as any[]).map((v) => ({
        ...v,
        allowed_licenses: JSON.parse(v.allowed_licenses),
        allowed_combos: JSON.parse(v.allowed_combos),
      })),
    }));
  }

  private loadRules(policyVersionId: number): PolicyRules {
    const v = this.db.prepare('SELECT allowed_licenses, allowed_combos FROM policy_versions WHERE id = ?').get(policyVersionId) as any;
    if (!v) throw new ApiError('NOT_FOUND', `policy version ${policyVersionId} not found`, 404);
    return {
      allowedLicenses: new Set(JSON.parse(v.allowed_licenses)),
      allowedCombos: new Set(JSON.parse(v.allowed_combos)),
    };
  }

  check(projectId: number, policyVersionId: number) {
    this.requireProject(projectId);
    const rules = this.loadRules(policyVersionId);
    const known = this.catalog();
    const knownLicenses = new Set(known.licenses);
    const knownExceptions = new Set(known.exceptions);
    const deps = this.listDependencies(projectId) as any[];

    const r = this.db.prepare('INSERT INTO reports (project_id, policy_version_id) VALUES (?, ?)').run(projectId, policyVersionId);
    const reportId = Number(r.lastInsertRowid);
    const insItem = this.db.prepare(
      `INSERT INTO report_items (report_id, dep_name, dep_version, expression, status, error_kind, error_message, error_position, trace)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let pass = 0, fail = 0, error = 0;
    for (const dep of deps) {
      let status: 'pass' | 'fail' | 'error';
      let errorKind: string | null = null;
      let errorMessage: string | null = null;
      let errorPosition: number | null = null;
      let trace: EvalTrace | null = null;
      try {
        const ast = parse(dep.expression);
        const ids = collectIdentifiers(ast);
        const unknownLic = ids.licenses.find((l) => !knownLicenses.has(l));
        const unknownExc = ids.exceptions.find((e) => !knownExceptions.has(e));
        if (unknownLic || unknownExc) {
          status = 'error';
          errorKind = 'unknown_identifier';
          errorMessage = `unknown ${unknownLic ? `license '${unknownLic}'` : `exception '${unknownExc}'`} (not in catalog)`;
        } else {
          trace = evaluate(ast, rules);
          status = trace.status;
        }
      } catch (e) {
        status = 'error';
        errorKind = 'syntax';
        if (e instanceof SyntaxError) {
          errorMessage = e.message;
          errorPosition = e.position;
        } else {
          errorMessage = String(e);
        }
      }
      if (status === 'pass') pass++; else if (status === 'fail') fail++; else error++;
      insItem.run(reportId, dep.name, dep.version, dep.expression, status, errorKind, errorMessage, errorPosition, trace ? JSON.stringify(trace) : null);
    }
    return { reportId, projectId, policyVersionId, total: deps.length, pass, fail, error };
  }

  getReport(reportId: number) {
    const report = this.db.prepare(
      `SELECT r.id, r.project_id, r.policy_version_id, r.created_at, pv.policy_id, pv.version AS policy_version
       FROM reports r JOIN policy_versions pv ON pv.id = r.policy_version_id WHERE r.id = ?`,
    ).get(reportId) as any;
    if (!report) throw new ApiError('NOT_FOUND', `report ${reportId} not found`, 404);
    const items = (this.db.prepare(
      'SELECT dep_name, dep_version, expression, status, error_kind, error_message, error_position, trace FROM report_items WHERE report_id = ? ORDER BY id',
    ).all(reportId) as any[]).map((i) => ({ ...i, trace: i.trace ? JSON.parse(i.trace) : null }));
    return { ...report, items };
  }

  listReports(projectId: number) {
    this.requireProject(projectId);
    return this.db.prepare(
      `SELECT r.id, r.policy_version_id, pv.version AS policy_version, r.created_at,
              SUM(CASE WHEN i.status='pass' THEN 1 ELSE 0 END) AS pass,
              SUM(CASE WHEN i.status='fail' THEN 1 ELSE 0 END) AS fail,
              SUM(CASE WHEN i.status='error' THEN 1 ELSE 0 END) AS error
       FROM reports r JOIN policy_versions pv ON pv.id = r.policy_version_id
       LEFT JOIN report_items i ON i.report_id = r.id
       WHERE r.project_id = ? GROUP BY r.id ORDER BY r.id`,
    ).all(projectId);
  }

  compareReports(aId: number, bId: number) {
    const a = this.getReport(aId);
    const b = this.getReport(bId);
    const key = (i: any) => `${i.dep_name}@${i.dep_version}`;
    const mapA = new Map<string, any>(a.items.map((i: any) => [key(i), i]));
    const mapB = new Map<string, any>(b.items.map((i: any) => [key(i), i]));
    const changes: any[] = [];
    for (const [k, ib] of mapB) {
      const ia = mapA.get(k) as any;
      if (!ia) { changes.push({ dependency: k, change: 'added', to: ib.status }); continue; }
      if (ia.status !== ib.status) {
        changes.push({ dependency: k, change: 'status_changed', from: ia.status, to: ib.status, expression: ib.expression });
      }
    }
    for (const [k, ia] of mapA) {
      if (!mapB.has(k)) changes.push({ dependency: k, change: 'removed', from: (ia as any).status });
    }
    return {
      reportA: { id: a.id, policyVersion: a.policy_version },
      reportB: { id: b.id, policyVersion: b.policy_version },
      changes,
    };
  }
}
