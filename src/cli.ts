import fs from 'node:fs';
import path from 'node:path';
import { openDb, seedCatalog } from './db.js';
import { Service, ApiError } from './service.js';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const db = openDb(DATA_DIR);
seedCatalog(db);
const svc = new Service(db);

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

function readJsonFile(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ApiError('VALIDATION_ERROR', `cannot read JSON file '${file}': ${e}`);
  }
}

const USAGE = `license-gate CLI (data dir: ${DATA_DIR})
Usage:
  project create <name>
  project list
  manifest import <projectId> <file.json>   # {"dependencies":[{name,version,expression}]}
  deps list <projectId>
  catalog                                   # show licenses & exceptions
  catalog add-license <id>
  catalog add-exception <id>
  policy create <name> <file.json>          # {"allowedLicenses":[],"allowedCombos":[{license,exception}]}
  policy update <policyId> <file.json>      # creates a new version
  policy list
  check <projectId> <policyVersionId>
  report show <reportId>
  report list <projectId>
  report compare <reportIdA> <reportIdB>
`;

async function main() {
  const [cmd, sub, ...rest] = process.argv.slice(2);
  if (!cmd) { console.log(USAGE); return; }
  switch (`${cmd} ${sub ?? ''}`.trim()) {
    case 'project create': return print(svc.createProject(rest[0]));
    case 'project list': return print(svc.listProjects());
    case 'manifest import': {
      const [projectId, file] = rest;
      return print(svc.importManifest(Number(projectId), readJsonFile(file).dependencies));
    }
    case 'deps list': return print(svc.listDependencies(Number(rest[0])));
    case 'catalog': return print(svc.catalog());
    case 'catalog add-license': return print(svc.addLicense(rest[0]));
    case 'catalog add-exception': return print(svc.addException(rest[0]));
    case 'policy create': {
      const [name, file] = rest;
      return print(svc.createPolicy({ name, ...readJsonFile(file) }));
    }
    case 'policy update': {
      const [policyId, file] = rest;
      return print(svc.updatePolicy(Number(policyId), readJsonFile(file)));
    }
    case 'policy list': return print(svc.listPolicies());
    case 'check': return print(svc.check(Number(rest[0]), Number(rest[1])));
    case 'report show': return print(svc.getReport(Number(rest[0])));
    case 'report list': return print(svc.listReports(Number(rest[0])));
    case 'report compare': return print(svc.compareReports(Number(rest[0]), Number(rest[1])));
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  if (e instanceof ApiError) {
    console.error(`error [${e.code}]: ${e.message}`);
  } else {
    console.error(`error: ${e}`);
  }
  process.exitCode = 1;
});
