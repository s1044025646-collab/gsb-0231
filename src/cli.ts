// CLI 入口：维护目录/策略、导入清单、执行检查、查看报告、比较报告、启动服务。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Store } from './store';
import { seedCatalog } from './seed';
import { runCheck, compareReports } from './service';
import { startServer } from './server';

function dataDir(): string {
  return process.env.LICENSE_GATE_DATA ?? path.join(process.cwd(), 'data');
}

function openStore(): Store {
  const store = new Store(path.join(dataDir(), 'license-gate.db'));
  seedCatalog(store); // 幂等：INSERT OR IGNORE
  return store;
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function printJson(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

const USAGE = `用法: node dist/src/cli.js <命令> [参数]

命令:
  serve [--port N]                 启动 API 服务（默认自动选择空闲端口）
  catalog                          查看本地许可证/例外目录
  add-license <ID> [名称]          添加许可证标识
  add-exception <ID> [名称]        添加例外标识
  project-create <名称>            创建项目
  policy-create <名称> --licenses "MIT,ISC" --combos "GPL-2.0-only+Classpath-exception-2.0"
                                   创建策略新版本（combos 用 许可证+例外 表示，逗号分隔）
  policy-list                      列出所有策略版本
  import <项目ID> <清单JSON文件>   导入依赖清单（重复导入返回已有清单）
  check <清单ID> <策略ID>          执行批量检查，生成新报告
  report <报告ID>                  查看报告详情
  reports [清单ID]                 列出报告
  compare <报告A> <报告B>          比较两份报告（如两个策略版本的结果）
`;

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(USAGE);
    return;
  }
  const store = openStore();
  try {
    switch (cmd) {
      case 'serve': {
        const portArg = argValue(args, '--port') ?? process.env.PORT ?? '0';
        const port = Number(portArg);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new Error(`非法端口: '${portArg}'`);
        }
        const { port: actual } = await startServer(store, port);
        console.log(`API 服务已启动: http://127.0.0.1:${actual}/api （数据目录: ${dataDir()}）`);
        return; // 保持进程存活
      }
      case 'catalog':
        return printJson(store.listCatalog());
      case 'add-license':
        store.addCatalogEntry('license', args[0], args.slice(1).join(' '));
        return printJson({ added: args[0] });
      case 'add-exception':
        store.addCatalogEntry('exception', args[0], args.slice(1).join(' '));
        return printJson({ added: args[0] });
      case 'project-create':
        return printJson(store.createProject(args[0]));
      case 'policy-create': {
        const licenses = (argValue(args, '--licenses') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        const combos = (argValue(args, '--combos') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
          .map((pair) => {
            const [license, exception] = pair.split('+').map((s) => s.trim());
            if (!license || !exception) throw new Error(`非法组合 '${pair}'，格式应为 许可证+例外`);
            return { license, exception };
          });
        return printJson(store.createPolicy(args[0], { allowedLicenses: licenses, allowedCombos: combos }));
      }
      case 'policy-list':
        return printJson(store.listPolicies());
      case 'import': {
        const [projectId, file] = args;
        const deps = JSON.parse(fs.readFileSync(file, 'utf8'));
        return printJson(store.importManifest(Number(projectId), deps.dependencies ?? deps));
      }
      case 'check':
        return printJson(runCheck(store, Number(args[0]), Number(args[1])));
      case 'report':
        return printJson(store.getReport(Number(args[0])));
      case 'reports':
        return printJson(store.listReports(args[0] ? Number(args[0]) : undefined));
      case 'compare':
        return printJson(compareReports(store, Number(args[0]), Number(args[1])));
      default:
        console.error(`未知命令: ${cmd}\n`);
        console.log(USAGE);
        process.exitCode = 2;
    }
  } finally {
    if (cmd !== 'serve') store.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`错误 [${e.code ?? 'ERROR'}] ${e.message}`);
    process.exitCode = 1;
  });
}
