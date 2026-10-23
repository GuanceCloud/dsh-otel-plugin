# dsh-otel-plugin v0.1.9

## 修复

- 支持 dsh `0.2.1-rc.2` 起的 0.2.x，保留 0.1.x 兼容性，安装无需 `allow-version` 豁免。
- 使用两代 coordinator 共有的默认 live capture，适配 0.2.x 构造参数变化。
- 支持 0.2.x 扁平工具结果中的 `toolCallId`、`isError` 和完整 content，保留旧版嵌套结果处理。
- CI 增加 `0.1.0-rc.7` / `0.2.1-rc.2` 双版本检查、测试和 OTLP smoke；发布流水线补齐类型检查与 OTLP smoke 门禁。

## 验证范围

- `npm run check`、`npm test`、`npm run smoke:otlp`：分别在两套 telemetry 包上运行。
- 原生 Cordis + Session + coordinator 向本地接收端导出 Trace/Metrics；未调用真实模型 API。
- 版本范围覆盖 npm peer 和宿主预发布规则，拒绝 0.3.x 预发布及更高版本。
- GitHub/OSS 发布与真实用户 profile 安装需在正式发布后验证。
