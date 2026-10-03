# license-gate：本地许可证表达式与准入核对后端

一个纯本地运行的依赖许可证核对服务，提供 HTTP API 与 CLI。管理项目、扁平依赖清单、本地许可证目录、准入策略版本与检查报告。使用 TypeScript + Node.js + SQLite（Node 内置 `node:sqlite`，无原生依赖），不需要 Docker / WSL / 外部在线服务。

> 免责声明：报告只表示依赖是否符合**用户自定义的准入规则**，不构成真实法律兼容性结论。本工具不解析软件包、不求解版本依赖、不签发或激活商业许可证，也不接在线许可证数据库。

## 环境要求

- Windows 本地，Node.js >= 22（开发使用 Node 25 验证）
- 唯一依赖：开发期 `typescript`（编译器）

## 快速开始

```powershell
npm install        # 安装 typescript
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm run demo       # 端到端演示（数据写入 data-demo/）
npm start          # 启动 API（默认自动选择空闲端口）
npm run cli -- ... # 使用 CLI
```

- 端口：默认 `0`（自动选空闲端口），用环境变量 `PORT=8080` 指定。
- 数据目录：默认项目内 `data/`，用环境变量 `DATA_DIR` 指定。SQLite 数据库文件为 `<DATA_DIR>/license-gate.db`。

## 受限 SPDX 风格表达式语法

```
expr     := orExpr
orExpr   := andExpr (OR andExpr)*
andExpr  := withExpr (AND withExpr)*
withExpr := primary (WITH 例外标识)?
primary  := 许可证标识 | '(' expr ')'
```

- 标识符字符集：`A-Z a-z 0-9 . - +`；运算符 `AND` / `OR` / `WITH` 为大写关键字。
- 优先级：`WITH` > `AND` > `OR`；括号改变组合顺序。
- `WITH` 只能绑定**单个**许可证标识（`(MIT OR Apache-2.0) WITH Foo` 是语法错误）。
- 语法错误（空表达式、括号不匹配、连续运算符、非法字符等）都会带**字符位置**（0 起始）报错。

## 准入规则

- 策略由用户显式指定：`allowedLicenses`（许可证白名单）与 `allowedCombos`（许可证+例外组合白名单）。
- `AND`：所有分支都满足才通过；`OR`：至少一条分支满足即通过。
- **许可证+例外作为独立组合核对**：基础许可证被允许，不代表其例外被接受。`GPL-3.0-only WITH Classpath-exception-2.0` 只有在组合白名单中明确列出才通过。
- 目录外标识（未知许可证或例外）属于 `unknown_identifier` 错误，**不会默认放行**。
- 每个依赖的结果分为三类：`pass`（策略通过）、`fail`（表达式有效但被策略拒绝）、`error`（语法错误 `syntax` 或未知标识 `unknown_identifier`）。
- 报告项包含完整求值轨迹（trace）：每个节点的通过/拒绝原因。`OR` 多分支按**从左到右的稳定顺序**求值，取第一个通过的分支作为决定分支（`decidedBy`），不搜索全局最优。

## 数据与版本

- SQLite 保存：项目、依赖（输入快照原文）、许可证/例外目录、策略版本、报告与逐项结果。
- 修改策略（`PUT /policies/:id` 或 `policy update`）会生成**新版本**，不覆盖旧版本与既有报告。
- 重新检查生成新报告，报告记录对应的 `policy_version_id`，可比较任意两份报告的差异。

## 演示场景（npm run demo）

1. `MIT AND Apache-2.0` —— AND 同时满足；
2. `GPL-3.0-only OR MIT` —— OR 可选分支；
3. `MIT OR Apache-2.0 AND GPL-3.0-only` —— 优先级/括号改变结果；
4. `GPL-3.0-only WITH Classpath-exception-2.0` —— WITH 组合单独获准。

随后把策略从 v1（允许 MIT、Apache-2.0 与 Classpath 组合）改为 v2（允许 MIT、GPL-3.0-only，不允许组合），重新检查并输出受影响的依赖（`and-ok` 与 `with-combo` 由 pass 变 fail）。

## HTTP API

所有错误返回 `{"error":{"code","message","details"}}`。错误码：`VALIDATION_ERROR`、`NOT_FOUND`、`CONFLICT`、`UNKNOWN_IDENTIFIER`、`INTERNAL`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/projects` | 创建项目 `{name}` |
| GET | `/projects` | 项目列表 |
| POST | `/projects/:id/manifest` | 导入依赖 `{dependencies:[{name,version,expression}]}`，重复条目自动跳过并计数 |
| GET | `/projects/:id/dependencies` | 依赖列表 |
| POST | `/projects/:id/check` | 批量检查 `{policyVersionId}`，生成报告 |
| GET | `/projects/:id/reports` | 项目的报告列表 |
| GET | `/catalog` | 许可证与例外目录 |
| POST | `/catalog/licenses` / `/catalog/exceptions` | 追加目录条目 `{id}` |
| POST | `/policies` | 创建策略 `{name,allowedLicenses,allowedCombos:[{license,exception}]}`（生成 v1） |
| PUT | `/policies/:id` | 修改策略，生成新版本 |
| GET | `/policies` | 策略及全部版本 |
| GET | `/reports/:id` | 报告详情（含逐项 trace） |
| GET | `/reports/compare?a=1&b=2` | 比较两份报告的状态变化 |

## CLI

```powershell
npm run cli -- project create my-proj
npm run cli -- manifest import 1 manifest.json     # {"dependencies":[...]}
npm run cli -- deps list 1
npm run cli -- catalog
npm run cli -- policy create my-policy policy.json # {"allowedLicenses":[],"allowedCombos":[]}
npm run cli -- policy update 1 policy-v2.json
npm run cli -- check 1 1                            # <projectId> <policyVersionId>
npm run cli -- report show 1
npm run cli -- report list 1
npm run cli -- report compare 1 2
```

## 测试

`npm test` 覆盖：运算符优先级、括号/嵌套、WITH 组合独立核对、未知例外、各类错误输入（空表达式、括号不匹配、连续运算符、非法字符）及位置、空清单、重复导入去重、策略版本演进与报告比较、数据库重启后读取、参数校验与错误码。

## 限制

- 受限语法是 SPDX 的子集：不支持 `+` 后缀语义、`NONE`/`NOASSERTION`、许可证引用（LicenseRef）。
- 目录为演示用的有限集合，可在本地追加，但不接在线数据库。
- 报告只反映自定义准入规则，不构成法律意见。
