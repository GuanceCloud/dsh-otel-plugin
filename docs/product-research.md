# DeepSeek Harness OTEL 插件接入调研

## 1. 产品范围

- 产品名称：DeepSeek Harness（`dsh`）
- 产品版本：`0.1.0-rc.7`
- 源码提交：`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- 支持平台：Node.js 支持的平台；验证 Linux，设计兼容 macOS/Windows
- 目标插件仓库：`dsh-otel-plugin`
- 调研日期：2026-08-18

## 2. 插件能力

| 项目 | 结论 | 证据 |
| --- | --- | --- |
| 原生插件/扩展机制 | Cordis Loader；所有功能均为插件 | `docs/architecture.md`、`docs/cordis-primer.md` |
| Hook 列表 | 使用 `SessionTelemetryBackend`，不使用进程 Hook | `packages/session/session-telemetry/src/index.ts` |
| 输入方式 | `SessionTelemetryRecord` 同步交给 `emit()` | `packages/session/session-telemetry/src/coordinator.ts` |
| 超时和失败行为 | `emit()` 必须非阻塞；捕获异常被 coordinator 包含 | Service Definition README |
| 并发/重复触发 | 每个 Session 有 handoff cursor；backend 单实例 | coordinator 模块级 `WeakMap` 与 Cordis Service |
| 重放行为 | 当前进程从 `firstLiveSeq` 采集；不回填前进程丢失事件 | coordinator `adopt()` 文档 |

## 3. 数据源

| 数据源 | 路径或入口 | 格式 | 生命周期 | 敏感性 |
| --- | --- | --- | --- | --- |
| 原生 telemetry | `ctx.sessionTelemetry` | 结构化 record | Session 常驻 | 高，body 可含消息和工具数据 |
| Session log | coordinator 内部读取 | append-only 事件 | Session 持久化 | 高 |
| assistant usage | `assistant/message.data.usage` | 单 step 计数 | 每次模型响应 | 中 |
| SQLite | 不使用 | 不适用 | 不适用 | 不适用 |

内置 `@deepseek-ai/dsh-session-telemetry-otel` 只发送 OTLP Logs。DSH patch 不允许同 ID 更换包名，因此本 bundle 禁用内置 entry，再插入唯一的 `dsh-gtrace-otel` backend，生成 Trace 与 Metrics。

## 4. 标识与关联

| 概念 | 原始字段 | 稳定性 | 回退策略 |
| --- | --- | --- | --- |
| Session ID | `attributes['session.id']` | 稳定 | 缺失则丢弃 record |
| Turn ID | `turn/start.data.turn` | 稳定、Session 内单调 | 缺失不创建 turn |
| LLM Call | `(session, turn, step)` | 稳定 | 无 assistant/usage 不生成 llm span |
| Tool Call ID | `tool/call.data.callId` | 稳定 | Code Mode 使用 `subCallId` |
| Parent/Subagent | `session.parent_id`、`session.seed_length` | 稳定种子关系 | 独立 trace 上记录父 Session，不猜测触发 tool |

## 5. 生命周期

- 用户 turn 开始证据：`turn/start`
- 完成证据：`turn/end.reason.kind=completed|max-tokens|error`
- 取消证据：`aborted|blocked|interrupted`
- 错误证据：`turn/end.reason.kind=error` 及结构化 code；工具使用 `isError`
- 内部请求识别：只接受 `user/message.source.kind=user` 作为用户输入；`session/title-llm-request` 和 `web/deepseek-search-llm-request` 不进入 turn 模型
- 写入顺序：Session append 后同步发出 `session/event`；`turn/end` 是终态证据

```text
turn/start
  user/message(kind=user)
  step/start -> request/header -> assistant/message -> tool/call -> tool/result -> step/end
  step/start -> assistant/message -> step/end
turn/end -> normalize -> spans -> metrics -> OTLP queue
```

## 6. LLM 与 Token

| 字段 | 来源 | 单次/累计 | 可用性与限制 |
| --- | --- | --- | --- |
| Provider | request header / assistant source | 单次 | 可用 |
| Request model | `request/header.config.model` | 单次 | 可用 |
| Response model | `assistant/message.source.model` | 单次 | 可用 |
| Input/output/cache/reasoning token | `assistant/message.usage` | 单次 | 可用；root 求和 |
| Finish reason | tool-call 内容 + turn 终态 | 单次推导 | 无独立 finish chunk，因为 capture 固定只保留首 chunk |
| Start/end | `step/start` 到 `assistant/message`/`step/end` | 单次 | 可用 |
| TTFT | 不上报 | 不适用 | telemetry projection 的首 chunk 可能只是 block-start，不是首 token |

## 7. Tool、Skill 与 Subagent

- Tool before/after：`tool/call` / `tool/result`
- Code Mode：`tool/code-dispatch-start` / `tool/code-dispatch`
- Command：从已解析 args 的 `cmd` 或 `command` 提取，受内容开关控制
- Skill：只有工具参数含 `.../<name>/SKILL.md` 时创建 `skill:<name>`；纯文本提及不会创建
- Subagent：子 Session 生成独立 trace；只记录可靠的 `parent_id` 和 `seed_length`

## 8. 安装与配置

| 平台 | 产品 HOME | Config root | 插件安装 | 重载/重启 |
| --- | --- | --- | --- | --- |
| Linux/macOS/Windows | `$DSH_HOME` 或 `~/.dsh` | `$DSH_HOME/profiles/<name>` | `dsh plugin --profile <name> add` | profile 下次启动；运行时 patch 可 HMR |

- 官方安装 CLI：`dsh plugin` 转发 pnpm 并维护 bundle 列表
- Marketplace：无；npm/Git/path spec
- 配置写回：pnpm 修改 profile package.json，bundle patch 由 DSH 组合
- 冲突：patch 禁用内置 `session-telemetry-otel`，再插入 `dsh-gtrace-otel`，避免两个 backend
- 敏感配置：环境变量或用户自管 `~/.dsh/gtrace.json`；release 不包含配置

## 9. 架构决策

- 选择：原生生命周期，终态聚合
- OTLP：官方 OpenTelemetry JS SDK，BatchSpanProcessor + PeriodicExportingMetricReader
- 理由：原生事件提供稳定 turn/step/tool ID；常驻 Node runtime 适合官方 SDK
- 缺失降级：缺 TTFT 不伪造；未闭合 tool 不上报；无终态不生成 trace
- 去重主键：当前进程 `(session.id, turn)`，上游 handoff cursor 防重放
- 部分信号恢复：SDK 分信号队列与重试；当前没有跨进程 outbox，崩溃时可能丢失尾部

## 10. 字段映射

| 产品事件 | 内部模型 | OTEL |
| --- | --- | --- |
| `turn/start/end` | Turn 边界与状态 | `invoke_agent` |
| `step/start` + `assistant/message` | LlmCall | `llm` |
| `tool/call/result` | ToolCall | `tool:<name>` |
| 参数内 `SKILL.md` | SkillUse | `skill:<name>` |
| `assistant/message` | AssistantOutput | `assistant` |
| `assistant/message.usage` | 单次 token | llm attributes + token metric |

## 11. Fixture

`fixtures/normal-turn.jsonl` 是合成、去敏的多 LLM + Tool + Skill + Subagent 关联样本。测试另覆盖 tool error、cancelled/error、空白、未闭合 tool、重复终态和内容关闭。真实模型 E2E 需要 `DEEPSEEK_API_KEY`，未写入仓库。

## 12. 未知项与风险

| 问题 | 影响 | 当前降级 | 后续验证 |
| --- | --- | --- | --- |
| 上游 developer preview 破坏性变更 | 事件或包 API 可能变化 | peer range 限制到 `<0.2.0` | 每个 DSH RC 跑 fixture 与 profile E2E |
| 无跨进程 outbox | 崩溃时尾部 Trace/Metrics 可丢 | SDK 队列 + 关闭 drain | 上游提供 durable backend cursor 后实现逐信号状态 |
| projection 不提供真实首 token | 无可靠 TTFT | 省略 `ttft` | 若增加 token-first 事件再接入 |
| 子 Session 无触发 tool span ID | 无法建立跨 trace 精确因果 | 只记录 parent Session | 等待稳定 delegation call ID |
