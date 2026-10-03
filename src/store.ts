// SQLite 存储层：目录、项目、清单、策略版本、报告。
import { DatabaseSync } from 'node:sqlite';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PolicyRules } from './evaluate';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface DependencyInput {
  name: string;
  version: string;
  expression: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS catalog (
        kind TEXT NOT NULL CHECK (kind IN ('license','exception')),
        id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (kind, id)
      );
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS manifests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        content_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manifest_id INTEGER NOT NULL REFERENCES manifests(id),
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        expression TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        rules_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (name, version)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manifest_id INTEGER NOT NULL REFERENCES manifests(id),
        policy_id INTEGER NOT NULL REFERENCES policies(id),
        summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS report_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL REFERENCES reports(id),
        dependency_id INTEGER NOT NULL REFERENCES dependencies(id),
        status TEXT NOT NULL CHECK (status IN ('PASS','REJECTED','SYNTAX_ERROR','UNKNOWN_IDENTIFIER')),
        ast_json TEXT,
        detail_json TEXT NOT NULL
      );
    `);
  }

  close(): void { this.db.close(); }

  // ---- 目录 ----
  addCatalogEntry(kind: 'license' | 'exception', id: string, name = ''): void {
    if (!id || !/^[A-Za-z0-9.+-]+$/.test(id)) {
      throw new ApiError('VALIDATION_ERROR', `非法的${kind === 'license' ? '许可证' : '例外'}标识符: '${id}'`);
    }
    this.db.prepare('INSERT OR IGNORE INTO catalog (kind, id, name) VALUES (?, ?, ?)')
      .run(kind, id, name);
  }

  listCatalog(): { licenses: string[]; exceptions: string[] } {
    const rows = this.db.prepare('SELECT kind, id FROM catalog ORDER BY kind, id').all() as any[];
    return {
      licenses: rows.filter((r) => r.kind === 'license').map((r) => r.id),
      exceptions: rows.filter((r) => r.kind === 'exception').map((r) => r.id),
    };
  }

  // ---- 项目 ----
  createProject(name: string): { id: number; name: string } {
    if (!name || !name.trim()) throw new ApiError('VALIDATION_ERROR', '项目名称不能为空');
    try {
      const r = this.db.prepare('INSERT INTO projects (name) VALUES (?)').run(name.trim());
      return { id: Number(r.lastInsertRowid), name: name.trim() };
    } catch {
      throw new ApiError('CONFLICT', `项目 '${name}' 已存在`, 409);
    }
  }

  getProject(id: number): { id: number; name: string } {
    const row = this.db.prepare('SELECT id, name FROM projects WHERE id = ?').get(id) as any;
    if (!row) throw new ApiError('NOT_FOUND', `项目 ${id} 不存在`, 404);
    return row;
  }

  listProjects(): any[] {
    return this.db.prepare('SELECT id, name, created_at FROM projects ORDER BY id').all() as any[];
  }

  // ---- 清单 ----
  importManifest(projectId: number, deps: DependencyInput[]): { manifestId: number; duplicated: boolean; count: number } {
    this.getProject(projectId);
    if (!Array.isArray(deps)) throw new ApiError('VALIDATION_ERROR', 'dependencies 必须是数组');
    deps.forEach((d, i) => {
      if (!d || typeof d.name !== 'string' || !d.name.trim()) {
        throw new ApiError('VALIDATION_ERROR', `第 ${i} 条依赖缺少 name`);
      }
      if (typeof d.version !== 'string') {
        throw new ApiError('VALIDATION_ERROR', `第 ${i} 条依赖 (${d.name}) 缺少 version 文本`);
      }
      if (typeof d.expression !== 'string') {
        throw new ApiError('VALIDATION_ERROR', `第 ${i} 条依赖 (${d.name}) 缺少 expression 文本`);
      }
    });
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify({ projectId, deps }))
      .digest('hex');
    const existing = this.db.prepare('SELECT id FROM manifests WHERE content_hash = ?').get(hash) as any;
    if (existing) {
      return { manifestId: existing.id, duplicated: true, count: deps.length };
    }
    const r = this.db.prepare('INSERT INTO manifests (project_id, content_hash) VALUES (?, ?)')
      .run(projectId, hash);
    const manifestId = Number(r.lastInsertRowid);
    const stmt = this.db.prepare(
      'INSERT INTO dependencies (manifest_id, position, name, version, expression) VALUES (?, ?, ?, ?, ?)');
    deps.forEach((d, i) => stmt.run(manifestId, i, d.name.trim(), d.version, d.expression));
    return { manifestId, duplicated: false, count: deps.length };
  }

  getManifestDeps(manifestId: number): any[] {
    const m = this.db.prepare('SELECT id FROM manifests WHERE id = ?').get(manifestId);
    if (!m) throw new ApiError('NOT_FOUND', `清单 ${manifestId} 不存在`, 404);
    return this.db.prepare(
      'SELECT id, position, name, version, expression FROM dependencies WHERE manifest_id = ? ORDER BY position')
      .all(manifestId) as any[];
  }

  // ---- 策略 ----
  createPolicy(name: string, rules: PolicyRules): { id: number; name: string; version: number } {
    if (!name || !name.trim()) throw new ApiError('VALIDATION_ERROR', '策略名称不能为空');
    if (!Array.isArray(rules.allowedLicenses) || !Array.isArray(rules.allowedCombos)) {
      throw new ApiError('VALIDATION_ERROR', 'allowedLicenses 与 allowedCombos 必须是数组');
    }
    const catalog = this.listCatalog();
    for (const lic of rules.allowedLicenses) {
      if (!catalog.licenses.includes(lic)) {
        throw new ApiError('VALIDATION_ERROR', `策略引用了目录外许可证: '${lic}'`);
      }
    }
    for (const c of rules.allowedCombos) {
      if (!c || !catalog.licenses.includes(c.license)) {
        throw new ApiError('VALIDATION_ERROR', `策略组合引用了目录外许可证: '${c && c.license}'`);
      }
      if (!catalog.exceptions.includes(c.exception)) {
        throw new ApiError('VALIDATION_ERROR', `策略组合引用了目录外例外: '${c.exception}'`);
      }
    }
    const prev = this.db.prepare('SELECT MAX(version) AS v FROM policies WHERE name = ?')
      .get(name.trim()) as any;
    const version = (prev.v ?? 0) + 1;
    const r = this.db.prepare('INSERT INTO policies (name, version, rules_json) VALUES (?, ?, ?)')
      .run(name.trim(), version, JSON.stringify(rules));
    return { id: Number(r.lastInsertRowid), name: name.trim(), version };
  }

  getPolicy(id: number): { id: number; name: string; version: number; rules: PolicyRules } {
    const row = this.db.prepare('SELECT id, name, version, rules_json FROM policies WHERE id = ?').get(id) as any;
    if (!row) throw new ApiError('NOT_FOUND', `策略 ${id} 不存在`, 404);
    return { id: row.id, name: row.name, version: row.version, rules: JSON.parse(row.rules_json) };
  }

  listPolicies(): any[] {
    return (this.db.prepare('SELECT id, name, version, rules_json, created_at FROM policies ORDER BY name, version')
      .all() as any[])
      .map((r) => ({ ...r, rules: JSON.parse(r.rules_json), rules_json: undefined }));
  }

  // ---- 报告 ----
  saveReport(manifestId: number, policyId: number, items: Array<{
    dependencyId: number; status: string; ast: unknown; detail: unknown;
  }>): { reportId: number; summary: any } {
    const summary: Record<string, number> = { PASS: 0, REJECTED: 0, SYNTAX_ERROR: 0, UNKNOWN_IDENTIFIER: 0 };
    for (const it of items) summary[it.status] = (summary[it.status] ?? 0) + 1;
    const r = this.db.prepare(
      'INSERT INTO reports (manifest_id, policy_id, summary_json) VALUES (?, ?, ?)')
      .run(manifestId, policyId, JSON.stringify(summary));
    const reportId = Number(r.lastInsertRowid);
    const stmt = this.db.prepare(
      'INSERT INTO report_items (report_id, dependency_id, status, ast_json, detail_json) VALUES (?, ?, ?, ?, ?)');
    for (const it of items) {
      stmt.run(reportId, it.dependencyId, it.status,
        it.ast ? JSON.stringify(it.ast) : null, JSON.stringify(it.detail));
    }
    return { reportId, summary };
  }

  getReport(reportId: number): any {
    const rep = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId) as any;
    if (!rep) throw new ApiError('NOT_FOUND', `报告 ${reportId} 不存在`, 404);
    const items = this.db.prepare(`
      SELECT ri.id, ri.status, ri.ast_json, ri.detail_json,
             d.position, d.name, d.version, d.expression
      FROM report_items ri JOIN dependencies d ON d.id = ri.dependency_id
      WHERE ri.report_id = ? ORDER BY d.position`).all(reportId) as any[];
    return {
      id: rep.id,
      manifestId: rep.manifest_id,
      policyId: rep.policy_id,
      createdAt: rep.created_at,
      summary: JSON.parse(rep.summary_json),
      items: items.map((it) => ({
        itemId: it.id,
        dependency: { name: it.name, version: it.version, expression: it.expression, position: it.position },
        status: it.status,
        ast: it.ast_json ? JSON.parse(it.ast_json) : null,
        detail: JSON.parse(it.detail_json),
      })),
    };
  }

  listReports(manifestId?: number): any[] {
    const sql = manifestId != null
      ? 'SELECT id, manifest_id, policy_id, summary_json, created_at FROM reports WHERE manifest_id = ? ORDER BY id'
      : 'SELECT id, manifest_id, policy_id, summary_json, created_at FROM reports ORDER BY id';
    const rows = (manifestId != null
      ? this.db.prepare(sql).all(manifestId)
      : this.db.prepare(sql).all()) as any[];
    return rows.map((r) => ({
      id: r.id, manifestId: r.manifest_id, policyId: r.policy_id,
      summary: JSON.parse(r.summary_json), createdAt: r.created_at,
    }));
  }
}
