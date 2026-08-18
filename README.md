# DeepSeek Harness OTEL Plugin

`dsh-otel-plugin` 是 DeepSeek Harness 的原生可观测 bundle。它将 DSH 的终态 turn 转换为符合 GTrace AI 语义规范的 OTLP/HTTP Protobuf Trace 与 Metrics。

## 数据模型

```text
invoke_agent
├── llm
├── tool:<name>
│   └── skill:<name>
├── llm
└── assistant
```

插件只处理带 `turn/end` 的终态请求。未完成 turn、空白 turn、插件注入上下文和未闭合工具不会生成 Trace。Metrics 从同批 span 派生：

- `gen_ai.workflow.duration`
- `gen_ai.agent.operation.count`
- `gen_ai.agent.operation.duration`
- `gen_ai.client.token.usage`

## 兼容性

- DeepSeek Harness：`>=0.1.0-rc.7 <0.2.0`
- Node.js：`^22.19.0 || >=24.0.0`
- 平台：Linux、macOS、Windows；安装器会临时通过 Corepack 或 npm 提供 `pnpm`

上游仍处于 developer preview。插件锚定并验证于 `deepseek-harness` 提交 `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`。

## 安装

从 GitHub Release 安装最新版到 Web profile（Linux/macOS）：

```bash
curl -fsSL https://github.com/GuanceCloud/dsh-otel-plugin/releases/latest/download/install-release.sh \
  -o /tmp/dsh-otel-plugin-install.sh
chmod +x /tmp/dsh-otel-plugin-install.sh
/tmp/dsh-otel-plugin-install.sh latest \
  --profile web \
  --endpoint 'https://llm-openway.guance.com' \
  --x-token '<client_token>' \
  --tag 'agent_id=<agent_id>' \
  --tag 'agent_name=<agent_name>'
```

安装特定版本时，将 `latest` 改为 `v0.1.2`。如果只安装插件文件、不修改 `gtrace.json`，增加 `--no-config`。

Windows PowerShell：

```powershell
& ([scriptblock]::Create((irm https://github.com/GuanceCloud/dsh-otel-plugin/releases/latest/download/install-release.ps1))) `
  -Version latest `
  -Profile web `
  -Endpoint "https://llm-openway.guance.com" `
  -XToken "<client_token>" `
  -Tag @("agent_id=<agent_id>", "agent_name=<agent_name>")
```

源码开发安装：

```bash
npm install
npm run build
bash scripts/install.sh --profile web
```

本包声明了 `dsh.bundle.patch`。安装后会禁用内置的 `session-telemetry-otel`，并插入 `dsh-gtrace-otel` backend，避免两个 backend 同时注册和重复采集。检查最终配置：

```bash
dsh --profile web --dump-config
```

卸载：

```bash
dsh plugin --profile web remove dsh-otel-plugin
```

## 配置

优先级从高到低：

```text
Cordis config > DSH_OTEL_* / 标准 OTEL 环境变量 > .dsh/gtrace.json
> ~/.dsh/gtrace.json > 默认值
```

默认连接本机 DataKit：

- endpoint：`http://127.0.0.1:9529`
- Trace：`otel/v1/traces`
- Metrics：`otel/v1/metrics`

最小环境配置：

```bash
export DSH_OTEL_ENDPOINT='https://llm-openway.guance.com'
export DSH_OTEL_HEADERS='X-Token=replace-me,To-Headless=true'
dsh --profile headless 'inspect this project'
```

常用变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_OTEL_ENABLED` | `true` | 最早关闭采集和网络初始化 |
| `DSH_OTEL_ENDPOINT` | `http://127.0.0.1:9529` | OTLP 基础地址 |
| `DSH_OTEL_TRACES_URL` | 自动拼接 | 完整 Trace URL |
| `DSH_OTEL_METRICS_URL` | 自动拼接 | 完整 Metrics URL |
| `DSH_OTEL_HEADERS` | 空 | JSON 或 `KEY=VALUE` 列表 |
| `DSH_OTEL_CAPTURE_CONTENT` | `preview` | `none`、`preview`、`full` |
| `DSH_OTEL_MAX_ATTRIBUTE_LENGTH` | `4096` | 单属性最大字符数 |
| `DSH_OTEL_METRICS_ENABLED` | `true` | 是否发送 Metrics |
| `DSH_OTEL_EXPORT_TIMEOUT_MS` | `10000` | 单次导出超时 |
| `DSH_OTEL_SHUTDOWN_TIMEOUT_MS` | `4000` | 关闭总时限 |
| `DSH_OTEL_RESOURCE_ATTRIBUTES` | 空 | JSON 或 OTEL 键值列表 |
| `DSH_OTEL_DEBUG` | `false` | 输出去敏诊断 |

同时支持 `OTEL_EXPORTER_OTLP_ENDPOINT`、`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`、`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`、`OTEL_EXPORTER_OTLP_HEADERS`、`OTEL_SERVICE_NAME` 和 `OTEL_RESOURCE_ATTRIBUTES`。

插件默认会写入不含消息正文、工具参数和结果的诊断日志：启动时记录最终上报地址；每个终态 turn 记录导出的 span 数量、状态和耗时；网络失败记录 warning。设置 `DSH_OTEL_DEBUG=true` 可额外输出配置警告和禁用状态。

插件自己的诊断日志位于 `$DSH_HOME/gtrace-hooks.log`；未设置 `DSH_HOME` 时是 `~/.dsh/gtrace-hooks.log`。文件日志独立于 DSH console logger，写入失败不会阻塞 Agent。

全局配置文件位于 `$DSH_HOME/gtrace.json`；未设置 `DSH_HOME` 时是 `~/.dsh/gtrace.json`。项目配置位于当前工作目录的 `.dsh/gtrace.json`。

配置文件示例：

```json
{
  "enabled": true,
  "endpoint": "http://127.0.0.1:9529",
  "captureContent": "preview",
  "maxAttributeLength": 4096,
  "environment": "dev",
  "headers": {
    "X-Token": "replace-me"
  }
}
```

## 隐私

默认 `preview` 最多保留 1024 字符；所有内容在进入 span 前递归脱敏并裁剪。键名匹配 authorization、cookie、password、secret、token、API key、private key 或 credential 时整值屏蔽，正文中的 Bearer token 和常见 `sk-*`/`pk-*`/`ak-*` 密钥也会屏蔽。`captureContent=none` 不上传消息、参数、结果、命令和 preview，只保留长度、状态、模型和计数。

Session、turn、call ID 只存在于 Trace，不进入 Resource Attributes。Metric tag 不含 prompt、output、路径、命令、结果和堆栈。

## 开发验证

```bash
npm run check
npm test
npm run smoke:otlp
npm run package:release
```

产品事实、已知限制和字段证据见 [docs/product-research.md](docs/product-research.md)。
