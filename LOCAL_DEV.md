# OpenClaw（本仓库）本地启动与配置说明

本文档面向“从源码在本仓库内启动/调试 OpenClaw Gateway + CLI/TUI”的场景，汇总常用启动命令、配置文件位置、Bytedance LLM（自定义 Provider）接入方式与常见排障手册。

## 1. 术语与约定

- **Gateway**：本地控制平面（WebSocket 服务），默认监听 `ws://127.0.0.1:<port>`。
- **CLI**：`openclaw ...` 命令行入口（本仓库通过 `pnpm openclaw` 或 `./bin/cli.sh` 运行）。
- **TUI**：终端 UI（`openclaw tui`）。
- **Model Ref**：模型引用格式 `provider/model`，例如 `bytedance-dev1/gpt-5.2`。

## 2. 依赖与构建

前置：

- Node.js ≥ 22
- 推荐 pnpm

在仓库根目录执行：

```bash
pnpm install
pnpm ui:build
pnpm build
```

说明：

- `pnpm openclaw ...` 通过 `tsx` 直接执行 TypeScript，更适合开发调试。
- `pnpm build` 生成 `dist/`，更接近“发布版运行方式”。

## 3. 推荐启动方式：使用 ./bin/cli.sh（repo-local 隔离）

本仓库提供 `./bin/cli.sh` 作为开发用包装脚本，用于：

- 将状态与配置隔离在仓库内，避免污染或受 `~/.openclaw` 影响
- 自动读取本地配置中的 Gateway port/token，减少 TUI/CLI 连接错误

### 3.1 状态目录与配置文件

默认路径（仓库内）：

- 状态目录：`./.openclaw-local/`
- 主配置文件：`./.openclaw-local/openclaw.json`

脚本默认会设置：

- `OPENCLAW_STATE_DIR=./.openclaw-local`
- `OPENCLAW_CONFIG_PATH=./.openclaw-local/openclaw.json`

并从 `openclaw.json` 自动导出（仅当 shell 未显式设置时）：

- `OPENCLAW_GATEWAY_TOKEN`（用于本地 Gateway / TUI / gateway call）
- `OPENCLAW_TUI_PORT`（用于生成默认 `--url ws://127.0.0.1:<port>`）

因此开发时优先使用：

```bash
./bin/cli.sh <command> ...
```

而不是直接：

```bash
pnpm openclaw <command> ...
```

## 4. 启动 Gateway

### 4.1 启动（本地）

```bash
./bin/cli.sh gateway --force
```

常用说明：

- `--force`：如果端口上已有旧进程占用，会尝试清理/抢占（用于开发时快速重启）。
- Gateway 端口/token 以 `./.openclaw-local/openclaw.json` 为准（当前约定：`18789` + `localdev`）。

### 4.2 健康检查

```bash
./bin/cli.sh gateway call health --json
```

如果返回 `{ "ok": true, ... }`，说明 CLI ↔ Gateway 的连接与鉴权正常。

## 5. 启动 TUI

```bash
./bin/cli.sh tui
```

说明：

- TUI 默认会连接到配置的本地端口，并使用配置中的 token（如果启用了 token auth）。
- 如果你手工用 `openclaw tui --url ... --token ...` 运行，务必保证 token 与 Gateway 一致，否则会出现 `token_mismatch` / `unauthorized`。

## 6. 运行一次 Agent（验证模型链路）

用一个固定的 session-id 做最小验证：

```bash
./bin/cli.sh agent --session-id smoke --message "Say OK" --timeout 60
```

若能正常输出 `OK`（或模型回复），说明“Gateway ↔ 模型 Provider ↔ Agent”链路可用。

## 7. Bytedance LLM（自定义 Provider）配置

本仓库以自定义 Provider `bytedance-dev1` 作为示例，通过：

- `baseUrl`（例如 `http://dev1.bytedance.net:8000`）
- 自定义 headers（例如 `api-version`、`auth-token`）

对接 OpenAI-compatible 的 `openai-completions` API。

### 7.1 环境变量（建议放在本地 .env 或 shell，不要提交）

示例变量：

- `BYTEDANCE_LLM_BASE_URL`：`http://dev1.bytedance.net:8000`
- `BYTEDANCE_LLM_API_VERSION`：`2024-02-01`
- `BYTEDANCE_LLM_AUTH_TOKEN`：鉴权 token（敏感信息）

建议用 shell export（或通过你的进程管理方式注入到 Gateway 环境）：

```bash
export BYTEDANCE_LLM_BASE_URL="http://dev1.bytedance.net:8000"
export BYTEDANCE_LLM_API_VERSION="2024-02-01"
export BYTEDANCE_LLM_AUTH_TOKEN="<YOUR_TOKEN>"
```

### 7.2 OpenClaw 配置（.openclaw-local/openclaw.json）

关键点：

1) 默认模型指向：

- `agents.defaults.model.primary = "bytedance-dev1/gpt-5.2"`

2) 必须在 `models.providers` 中声明 provider 与 model catalog，否则会报：

- `Unknown model: bytedance-dev1/gpt-5.2`

当前本地配置使用 env 注入 provider 参数（示意）：

- `models.providers.bytedance-dev1.baseUrl = "${BYTEDANCE_LLM_BASE_URL}"`
- `models.providers.bytedance-dev1.headers["api-version"] = "2024-02-01"`
- `models.providers.bytedance-dev1.headers["auth-token"] = "${BYTEDANCE_LLM_AUTH_TOKEN}"`
- `models.providers.bytedance-dev1.models[]` 中包含 `{ id: "gpt-5.2", ... }`

并额外设置：

- `apiKey: "${BYTEDANCE_LLM_AUTH_TOKEN}"`
- `authHeader: false`

目的：让 OpenClaw 的“provider auth 解析”认为该 provider 有凭据（不会因缺少 apiKey 直接 fail），同时实际鉴权仍由自定义 header 的 `auth-token` 完成。

### 7.3 校验 provider/model 是否生效

```bash
./bin/cli.sh models list --provider bytedance-dev1 --plain
```

预期输出包含：

```text
bytedance-dev1/gpt-5.2
```

## 8. 常见问题排查（Troubleshooting）

### 8.1 `Unknown model: bytedance-dev1/gpt-5.2`

原因通常是：

- `agents.defaults.model.primary` 指向了某 model ref，但 `models.providers` 没有把该 provider/model 声明进 catalog；或
- Gateway 进程启动时没有加载到 `BYTEDANCE_LLM_*` 环境变量，导致 provider 构建失败或为空。

排查顺序：

1) `./bin/cli.sh models list --provider bytedance-dev1 --plain`
2) 检查 `./.openclaw-local/openclaw.json` 中是否存在 `models.providers.bytedance-dev1`
3) 确认 Gateway 的运行环境里能读取到 `BYTEDANCE_LLM_AUTH_TOKEN`（最常见缺失项）

### 8.2 `gateway not connected`

常见原因：

- Gateway 未启动或端口不对
- TUI 默认连接到了另一个端口（例如 dev profile 19001），或 url 参数错误

建议先跑：

```bash
./bin/cli.sh gateway call health --json
```

### 8.3 `unauthorized token mismatch`

含义：客户端传的 token 与 Gateway 的 `gateway.auth.token` 不一致。

解决：

- 优先使用 `./bin/cli.sh tui` / `./bin/cli.sh gateway call ...`（脚本会自动对齐 token）
- 或确保你手工传入的 `--token` 与 `./.openclaw-local/openclaw.json` 中的 token 一致

## 9. 常用命令清单（速查）

```bash
# 依赖与构建
pnpm install
pnpm ui:build
pnpm build

# 启动 gateway
./bin/cli.sh gateway --force

# 健康检查
./bin/cli.sh gateway call health --json

# 启动 TUI
./bin/cli.sh tui

# 跑一次 agent（验证模型）
./bin/cli.sh agent --session-id smoke --message "Say OK" --timeout 60

# 查看 provider 下的模型列表
./bin/cli.sh models list --provider bytedance-dev1 --plain
```

