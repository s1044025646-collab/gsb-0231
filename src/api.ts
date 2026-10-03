import http from 'node:http';
import path from 'node:path';
import { openDb, seedCatalog } from './db.js';
import { Service, ApiError } from './service.js';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const PORT = process.env.PORT ? Number(process.env.PORT) : 0; // 0 = pick a free port

const db = openDb(DATA_DIR);
seedCatalog(db);
const svc = new Service(db);

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'request body must be valid JSON');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method ?? 'GET';
    const num = (s: string | undefined, label: string) => {
      const n = Number(s);
      if (!s || !Number.isInteger(n) || n <= 0) throw new ApiError('VALIDATION_ERROR', `invalid ${label}`);
      return n;
    };

    if (method === 'GET' && parts[0] === 'health') return send(res, 200, { ok: true });
    if (method === 'POST' && parts[0] === 'projects' && parts.length === 1) {
      return send(res, 201, svc.createProject((await readBody(req)).name));
    }
    if (method === 'GET' && parts[0] === 'projects' && parts.length === 1) {
      return send(res, 200, svc.listProjects());
    }
    if (parts[0] === 'projects' && parts[2] === 'manifest' && method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, svc.importManifest(num(parts[1], 'project id'), body.dependencies));
    }
    if (parts[0] === 'projects' && parts[2] === 'dependencies' && method === 'GET') {
      return send(res, 200, svc.listDependencies(num(parts[1], 'project id')));
    }
    if (parts[0] === 'projects' && parts[2] === 'check' && method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, svc.check(num(parts[1], 'project id'), num(String(body.policyVersionId), 'policyVersionId')));
    }
    if (parts[0] === 'projects' && parts[2] === 'reports' && method === 'GET') {
      return send(res, 200, svc.listReports(num(parts[1], 'project id')));
    }
    if (parts[0] === 'catalog' && parts.length === 1 && method === 'GET') {
      return send(res, 200, svc.catalog());
    }
    if (parts[0] === 'catalog' && parts[1] === 'licenses' && method === 'POST') {
      return send(res, 201, svc.addLicense((await readBody(req)).id));
    }
    if (parts[0] === 'catalog' && parts[1] === 'exceptions' && method === 'POST') {
      return send(res, 201, svc.addException((await readBody(req)).id));
    }
    if (parts[0] === 'policies' && parts.length === 1 && method === 'POST') {
      return send(res, 201, svc.createPolicy(await readBody(req)));
    }
    if (parts[0] === 'policies' && parts.length === 1 && method === 'GET') {
      return send(res, 200, svc.listPolicies());
    }
    if (parts[0] === 'policies' && parts.length === 2 && method === 'PUT') {
      return send(res, 200, svc.updatePolicy(num(parts[1], 'policy id'), await readBody(req)));
    }
    if (parts[0] === 'reports' && parts.length === 2 && method === 'GET') {
      return send(res, 200, svc.getReport(num(parts[1], 'report id')));
    }
    if (parts[0] === 'reports' && parts[1] === 'compare' && method === 'GET') {
      return send(res, 200, svc.compareReports(
        num(url.searchParams.get('a') ?? undefined, 'a'),
        num(url.searchParams.get('b') ?? undefined, 'b'),
      ));
    }
    throw new ApiError('NOT_FOUND', `no route for ${method} ${url.pathname}`, 404);
  } catch (e) {
    if (e instanceof ApiError) {
      return send(res, e.status, { error: { code: e.code, message: e.message, details: e.details ?? null } });
    }
    return send(res, 500, { error: { code: 'INTERNAL', message: String(e) } });
  }
});

server.listen(PORT, () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log(`license-gate API listening on http://127.0.0.1:${port} (data dir: ${DATA_DIR})`);
});
