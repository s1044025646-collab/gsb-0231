# license-gate：本地依赖许可证表达式与准入核对后端

一个纯本地运行的许可证**准入核对**服务：管理项目、依赖清单、本地许可证目录、
准入策略版本与检查报告。仅提供 **HTTP API 与 CLI**，无界面、无 Docker、无外部在线服务。

> 重要声明：本工具只按**用户自定义的允许列表**做机械核对，报告仅表示
> “是否符合这些自定义规则”，**不构成真实法律兼容性结论**，也不签发或激活任何
> 商业软件许可证，不解析软件包、不求解版本依赖。

## 技术栈与运行要求

- TypeScript + Node.js（建议 >= 22，开发使用 Node 25）
- SQLite 使用 Node 内置 `node:sqlite`（**零运行时依赖**，无需编译原生模块）
- Windows 本地直接运行（任何支持 Node 的平台均可）

## 快速开始

```powershell
npm install        # 仅安装开发依赖 typescript / @types/node
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm run demo       # 运行内置演示（AND / OR / 括号 / WITH + 策略版本比较）
npm start          # 启动 API 服务（默认自动选择空闲端口）
npm run cli -- help  # 查看 CLI 用法（需先 npm run build）
```

数据保存在项目内 `data/` 目录（可用环境变量 `LICENSE_GATE_DATA` 覆盖），
数据库文件为 `license-gate.db`。端口用 `--port` 或环境变量 `PORT` 指定，
默认 `0` 表示自动选择空闲端口。

## 受限表达式语法

自行实现的递归下降解析器（仅分词使用正则），语法：

```
expr     := orExpr
orExpr   := andExpr (OR andExpr)*
andExpr  := withExpr (AND withExpr)*
withExpr := primary (WITH IDENT)?     # WITH 只绑定单个许可证
primary  := IDENT | '(' orExpr ')'
```

- 关键字 `AND` / `OR` / `WITH` 大小写不敏感；标识符字符集 `[A-Za-z0-9.+-]+`
- 优先级：**括号 > WITH > AND > OR**
- 求值语义：`AND` 所有分支都须满足；`OR` 至少一条分支满足
- `OR` 多分支可满足时按**稳定顺序从左到右**取第一个满足的分支并记录在报告中，
  不搜索全局最优方案
- `许可证 WITH 例外` 是**独立组合**：必须出现在策略的允许组合列表中；
  基础许可证被允许**不能**豁免未获准的例外，组合获准也**不**等于裸许可证获准

## 准入规则与错误分类

每条依赖依次经过三层判定，任何一层失败都**不默认放行**：

| 状态 | 含义 | 错误码 |
| --- | --- | --- |
| `PASS` | 表达式有效且满足策略 | - |
| `REJECTED` | 表达式有效但被策略拒绝 | `POLICY_REJECTED` |
| `SYNTAX_ERROR` | 空表达式、括号不匹配、连续运算符等，带输入位置 | `SYNTAX_ERROR` |
| `UNKNOWN_IDENTIFIER` | 引用了本地目录之外的许可证/例外 | `UNKNOWN_IDENTIFIER` |

API 层参数校验失败返回 `VALIDATION_ERROR`（400），资源不存在返回 `NOT_FOUND`（404），
项目重名返回 `CONFLICT`（409）。

## 数据与版本模型

- 清单导入时保存**输入快照**（名称、版本文本、表达式原文），按内容哈希去重：
  重复导入返回已有清单并标记 `duplicated: true`
- 策略每次修改生成**新版本**（同名策略版本号递增），旧版本与既有报告**不被覆盖**
- 每次检查生成**新报告**，记录所用清单与策略版本，可比较两份报告（通常为同一
  清单在两个策略版本下的结果）查看受影响依赖

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/catalog` | 查看许可证/例外目录 |
| POST | `/api/catalog/licenses` `{id, name?}` | 添加许可证标识 |
| POST | `/api/catalog/exceptions` `{id, name?}` | 添加例外标识 |
| GET/POST | `/api/projects` | 列出 / 创建项目 `{name}` |
| POST | `/api/projects/:id/manifests` `{dependencies:[{name,version,expression}]}` | 导入清单（幂等去重） |
| GET/POST | `/api/policies` | 列出 / 创建策略新版本 `{name, allowedLicenses, allowedCombos:[{license,exception}]}` |
| POST | `/api/checks` `{manifestId, policyId}` | 执行批量检查，生成报告 |
| GET | `/api/reports/:id`、`/api/reports?manifestId=` | 查看报告 |
| GET | `/api/compare?a=<报告A>&b=<报告B>` | 比较两份报告 |

## CLI

```powershell
node dist/src/cli.js serve [--port 8080]
node dist/src/cli.js catalog
node dist/src/cli.js add-license MIT "MIT License"
node dist/src/cli.js project-create my-app
node dist/src/cli.js policy-create default --licenses "MIT,ISC,Apache-2.0" --combos "GPL-2.0-only+Classpath-exception-2.0"
node dist/src/cli.js policy-list
node dist/src/cli.js import 1 manifest.json     # manifest.json: {"dependencies":[...]} 或直接数组
node dist/src/cli.js check 1 1                  # -> 生成报告
node dist/src/cli.js report 1
node dist/src/cli.js compare 1 2                # 比较两个策略版本下的结果
```

## 演示场景（npm run demo）

内置 8 条依赖覆盖：AND 同时满足、OR 可选分支、括号改变结果
（`MIT OR GPL-3.0-only AND Apache-2.0` 通过，而 `(MIT OR GPL-3.0-only) AND GPL-2.0-only` 被拒绝）、
WITH 组合单独获准（组合获准但裸 `GPL-2.0-only` 仍被拒绝）、未知例外、语法错误；
随后创建策略 v2（移除 Apache-2.0）重新检查并比较两份报告，展示受影响依赖。

## 测试

`npm test` 运行 27 个用例，覆盖：运算符优先级、嵌套括号、WITH 绑定、未知例外、
空表达式/连续运算符/括号不匹配定位、空清单、重复导入去重、策略版本比较、
重启后（重新打开数据库文件）读取报告、HTTP API 端到端。

## 明确限制

- 不连接在线许可证数据库，目录为本地演示用的有限集合（可用 CLI/API 扩展）
- 不解析软件包格式、不求解版本依赖、不做传递依赖分析
- 表达式为受限 SPDX 风格子集：不支持 `+` 后缀、LicenseRef、完整 SPDX 规范
- 报告不构成法律意见
