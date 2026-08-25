<div align="center">

# dsh-ccswitch

**把 CCSwitch 的技能与 MCP 服务一起导入 DeepSeek Harness，不改动 DSH 本身。**

[English](README.md) · [中文](README.zh.md)

![DSH plugin](https://img.shields.io/badge/DSH-plugin-blue) ![Version](https://img.shields.io/badge/version-0.1.0-2ea44f) ![License](https://img.shields.io/badge/license-MIT-green) ![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933)

</div>

---

## ✨ 功能

### 🧠 技能

- 📂 读取 `~/.cc-switch/skills/<name>/SKILL.md`（标准 SKILL.md 格式），以名为 `ccswitch` 的 `ctx.skills` 提供者注册。
- ⌨️ 输入框输入 **/** 即可弹出选择框引用（DSH 内置 ui-skill 自动列出）；选中插入 `/name`，tool-skill 会把技能正文注入提示词。
- 🛡️ 同名技能以 DSH 自带版本优先（rank 700 > 内置 600）；CCSwitch 独有的（`docx` / `xlsx` / `pdf` / `slides` / `alipay-payment-skill` 等）自动补进 / 菜单。

### 🔌 MCP

- 🗄️ 读取 CCSwitch 管理的 MCP 服务列表（`~/.cc-switch/cc-switch.db` 的 `mcp_servers` 表），用 Node 内置 `node:sqlite` 只读打开（无需原生驱动）。
- ⚙️ 每个启用服务挂载为 `@deepseek-ai/dsh-mcp-client` 实例，工具以 `mcp__服务名__工具名` 注册，可被模型调用。
- 🌐 `http` → `streamable-http`；`stdio` → `stdio`；连接失败自动重连（`failOnStartupError: false`）。

### 🤖 模型（自动导入）

- 自动把 CCSwitch 中配置的 provider/模型（`~/.cc-switch/cc-switch.db` 的 `providers` 表）导入 DSH 的 `llm-pi-ai.providers`，路由名为 **`ccswitch-*`**。
- 每条路由携带 CCSwitch 的 baseURL、模型列表（来自 `ANTHROPIC_DEFAULT_*_MODEL` / `models` / Codex `config`）与凭据引用；**API Key 存入 DSH 凭据库**（`.credentials.yaml`）。
- 按 provider 类型推导协议：Claude-Code 端点用 `anthropic-messages`，OpenAI 风格自定义 provider 用 `openai-completions`，Codex 用 `openai-responses`。导入的模型声明 `low…max` 思考档位。
- 自动携带 CCSwitch 中配置的**上下文长度**与**最大输出**到 DSH 模型配置（`contextWindow` / `maxTokens`）：模型 id 的 `[1M]`/`[200K]`/`[1G]` 后缀决定上下文，可选 `[1M/64K]` 第二段决定输出；自定义 provider 模型条目的字段（如 `contextLength`/`contextWindow`、`maxTokens`/`maxOutputTokens`，驼峰或下划线均可）优先于 id 后缀。
- 只管理 `ccswitch-` 前缀的路由——你手动配置的 `uu` / `ark` 等路由不受影响。改动即时生效，失效路由与 Key 自动清理。

### 🖥️ 设置页

- 一个「CCSwitch 导入」分区，含技能 / MCP / 模型 三张卡片：总开关、路径、按条目禁用。改动即时生效。

## ⚙️ 配置

```yaml
ccswitch:
  skills:
    enabled: true
    path: ~/.cc-switch/skills
    disabled: []
  mcp:
    enabled: true
    path: ~/.cc-switch/cc-switch.db
    disabled: []
  models:
    enabled: true
    disabled: []
```

> `models.disabled` 填要跳过的 CCSwitch provider **名称**。`models.path` 缺省沿用 `mcp.path`（同一个 cc-switch.db）。

## 🚀 安装

> **一键复制：** 悬停到下面的代码块，点击右上角的复制按钮即可。

**1. 安装依赖：**

```bash
dsh plugin --profile web add github:Elysiaqwq/dsh-ccswitch
```

**2. 追加挂载行** 到 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-ccswitch
      name: dsh-ccswitch
```

**3. 刷新浏览器**（`F5`）——设置页出现「CCSwitch 导入」分区。

> ⚠️ 不要同时用 bundle 层挂载（不要声明 `dsh.bundle.patch`，也不要加进 `dsh.profile.bundles`）。

## 🧹 卸载

```bash
dsh plugin --profile web remove dsh-ccswitch
```

再删掉 `cordis.patch.yml` 里 `- insert: … dsh-ccswitch …` 段；可选地把 `ccswitch:` 分区从 settings.yaml 删掉。

## 🧪 验证

```bash
cd dsh-ccswitch && node --no-warnings test-apply.mjs
```

不启动 dsh 的冒烟探针：真实读取 CCSwitch 技能（77 个）与 MCP 服务（4 个）、校验映射与禁用/开关，并以桩 ctx 跑 `apply()` / `reconcile`。

## 📦 依赖

- 读库用 Node 内置 `node:sqlite`（v22.5+），零额外依赖。
- 运行期经 `$DSH_HOME/profiles/node_modules` 回退路径导入 yaml、@deepseek-ai/dsh-settings、@deepseek-ai/schemastery。
- `@deepseek-ai/dsh-mcp-client` 由 loader 按名字解析。
