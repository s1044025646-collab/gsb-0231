// 基于 node:http 的 JSON API 服务（无外部依赖）。
import * as http from 'node:http';
import { Store, ApiError } from './store';
import { runCheck, compareReports } from './service';

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError('VALIDATION_ERROR', '请求体不是合法 JSON');
  }
}

function num(value: string | null, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError('VALIDATION_ERROR', `参数 ${field} 必须是正整数，收到: '${value}'`);
  }
  return n;
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';
      const body = method === 'POST' ? await readBody(req) : {};

      if (method === 'GET' && path === '/api/health') {
        return send(res, 200, { ok: true });
      }
      if (method === 'GET' && path === '/api/catalog') {
        return send(res, 200, store.listCatalog());
      }
      if (method === 'POST' && path === '/api/catalog/licenses') {
        store.addCatalogEntry('license', body.id, body.name ?? '');
        return send(res, 201, { added: body.id });
      }
      if (method === 'POST' && path === '/api/catalog/exceptions') {
        store.addCatalogEntry('exception', body.id, body.name ?? '');
        return send(res, 201, { added: body.id });
      }
      if (method === 'GET' && path === '/api/projects') {
        return send(res, 200, store.listProjects());
      }
      if (method === 'POST' && path === '/api/projects') {
        return send(res, 201, store.createProject(body.name));
      }
      const mManifest = path.match(/^\/api\/projects\/(\d+)\/manifests$/);
      if (method === 'POST' && mManifest) {
        const result = store.importManifest(Number(mManifest[1]), body.dependencies);
        return send(res, result.duplicated ? 200 : 201, result);
      }
      if (method === 'GET' && path === '/api/policies') {
        return send(res, 200, store.listPolicies());
      }
      if (method === 'POST' && path === '/api/policies') {
        const created = store.createPolicy(body.name, {
          allowedLicenses: body.allowedLicenses,
          allowedCombos: body.allowedCombos,
        });
        return send(res, 201, created);
      }
      if (method === 'POST' && path === '/api/checks') {
        const result = runCheck(store, num(String(body.manifestId), 'manifestId'), num(String(body.policyId), 'policyId'));
        return send(res, 201, result);
      }
      const mReport = path.match(/^\/api\/reports\/(\d+)$/);
      if (method === 'GET' && mReport) {
        return send(res, 200, store.getReport(Number(mReport[1])));
      }
      if (method === 'GET' && path === '/api/reports') {
        const mid = url.searchParams.get('manifestId');
        return send(res, 200, store.listReports(mid ? num(mid, 'manifestId') : undefined));
      }
      if (method === 'GET' && path === '/api/compare') {
        const a = num(url.searchParams.get('a'), 'a');
        const b = num(url.searchParams.get('b'), 'b');
        return send(res, 200, compareReports(store, a, b));
      }
      throw new ApiError('NOT_FOUND', `${method} ${path} 不存在`, 404);
    } catch (e) {
      if (e instanceof ApiError) {
        return send(res, e.status, { error: { code: e.code, message: e.message } });
      }
      return send(res, 500, { error: { code: 'INTERNAL_ERROR', message: String(e) } });
    }
  });
}

/** 启动服务；port 传 0（默认）时自动选择空闲端口。 */
export function startServer(store: Store, port = 0, host = '127.0.0.1'): Promise<{ port: number; close: () => void }> {
  const server = createServer(store);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ port: actual, close: () => server.close() });
    });
  });
}
