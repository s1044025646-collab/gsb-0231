// 演示用的有限许可证 / 例外目录（不连接任何在线数据库）。
import { Store } from './store';

export const SEED_LICENSES: Array<[string, string]> = [
  ['MIT', 'MIT License'],
  ['ISC', 'ISC License'],
  ['Apache-2.0', 'Apache License 2.0'],
  ['BSD-2-Clause', 'BSD 2-Clause License'],
  ['BSD-3-Clause', 'BSD 3-Clause License'],
  ['0BSD', 'Zero-Clause BSD'],
  ['MPL-2.0', 'Mozilla Public License 2.0'],
  ['EPL-2.0', 'Eclipse Public License 2.0'],
  ['LGPL-2.1-only', 'GNU LGPL v2.1 only'],
  ['GPL-2.0-only', 'GNU GPL v2.0 only'],
  ['GPL-3.0-only', 'GNU GPL v3.0 only'],
  ['CC0-1.0', 'Creative Commons Zero 1.0'],
  ['Unlicense', 'The Unlicense'],
];

export const SEED_EXCEPTIONS: Array<[string, string]> = [
  ['Classpath-exception-2.0', 'GNU Classpath Exception 2.0'],
  ['Bison-exception-2.2', 'Bison exception 2.2'],
  ['LLVM-exception', 'LLVM Exception'],
  ['OpenSSL-exception', 'OpenSSL Exception'],
  ['Font-exception-2.0', 'Font Exception 2.0'],
];

export function seedCatalog(store: Store): void {
  for (const [id, name] of SEED_LICENSES) store.addCatalogEntry('license', id, name);
  for (const [id, name] of SEED_EXCEPTIONS) store.addCatalogEntry('exception', id, name);
}
