import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const SEED_LICENSES = [
  'MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'GPL-3.0-only', 'LGPL-2.1-only',
];
export const SEED_EXCEPTIONS = [
  'Classpath-exception-2.0', 'Bison-exception-2.2',
];

export function openDb(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'license-gate.db'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      expression TEXT NOT NULL,
      UNIQUE (project_id, name, version, expression)
    );
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS exceptions (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS policy_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_id INTEGER NOT NULL REFERENCES policies(id),
      version INTEGER NOT NULL,
      allowed_licenses TEXT NOT NULL,
      allowed_combos TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (policy_id, version)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      policy_version_id INTEGER NOT NULL REFERENCES policy_versions(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS report_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id),
      dep_name TEXT NOT NULL,
      dep_version TEXT NOT NULL,
      expression TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pass','fail','error')),
      error_kind TEXT CHECK (error_kind IN ('syntax','unknown_identifier') OR error_kind IS NULL),
      error_message TEXT,
      error_position INTEGER,
      trace TEXT
    );
  `);
  return db;
}

export function seedCatalog(db: DatabaseSync): void {
  const insL = db.prepare('INSERT OR IGNORE INTO licenses (id) VALUES (?)');
  const insE = db.prepare('INSERT OR IGNORE INTO exceptions (id) VALUES (?)');
  for (const l of SEED_LICENSES) insL.run(l);
  for (const e of SEED_EXCEPTIONS) insE.run(e);
}
