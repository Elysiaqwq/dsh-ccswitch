<div align="center">

# dsh-ccswitch

**Import CCSwitch's skills and MCP servers into DeepSeek Harness in one plugin — without modifying DSH itself.**

[English](README.md) · [中文](README.zh.md)

![DSH plugin](https://img.shields.io/badge/DSH-plugin-blue) ![Version](https://img.shields.io/badge/version-0.1.0-2ea44f) ![License](https://img.shields.io/badge/license-MIT-green) ![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933)

</div>

---

## ✨ Features

### 🧠 Skills

- 📂 Reads `~/.cc-switch/skills/<name>/SKILL.md` (standard SKILL.md format) and registers them as a `ctx.skills` provider named `ccswitch`.
- ⌨️ Typing **/** in the input box lists them (DSH's built-in ui-skill); picking one inserts `/name` and DSH's tool-skill injects the body into the prompt.
- 🛡️ Same-name skills keep DSH's native version (rank 700 > bundled 600); CCSwitch-only skills fill in (e.g. `docx`, `xlsx`, `pdf`, `slides`, `alipay-payment-skill`).

### 🔌 MCP

- 🗄️ Reads the MCP server list CCSwitch manages (`~/.cc-switch/cc-switch.db`, table `mcp_servers`) with Node's built-in `node:sqlite` (read-only, no native driver).
- ⚙️ Mounts each enabled server as a `@deepseek-ai/dsh-mcp-client` instance; its tools appear as `mcp__<server>__<tool>` and are callable like any other tool.
- 🌐 `http` → `streamable-http`; `stdio` → `stdio`; unreachable endpoints auto-reconnect (`failOnStartupError: false`).

### 🤖 Models

- Automatically imports the providers/models configured in CCSwitch (`~/.cc-switch/cc-switch.db`, table `providers`) into DSH's `llm-pi-ai.providers` as **`ccswitch-*`** routes.
- Each imported route carries the CCSwitch base URL, the model list (from `ANTHROPIC_DEFAULT_*_MODEL` / `models` / Codex `config`), and a credential reference; the **API keys are stored in DSH's credentials service** (`.credentials.yaml`).
- Wire protocol is derived per provider: `anthropic-messages` for Claude-Code endpoints, `openai-completions` for OpenAI-style custom providers, `openai-responses` for Codex providers. Imported models declare `low…max` reasoning efforts.
- Context length and maximum output configured in CCSwitch are carried onto the imported models automatically (`contextWindow` / `maxTokens`): a `[1M]`/`[200K]`/`[1G]` suffix on a model id sizes the context window and an optional second segment (`[1M/64K]`) sizes the output; explicit per-model fields on custom-provider entries (e.g. `contextLength`/`contextWindow`, `maxTokens`/`maxOutputTokens`, camelCase or snake_case) win over the id suffix.
- Only `ccswitch-`-prefixed routes are ever touched — your manually configured routes (e.g. `uu`, `ark`) are preserved. Changes apply immediately; stale routes/keys are removed.

### 🖥️ Settings page

- One **CCSwitch 导入** section with three cards (Skills / MCP / Models): master switches, paths, and per-item disable toggles. Changes apply immediately.

## ⚙️ Configuration

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

> `models.disabled` lists CCSwitch provider **names** to skip. `models.path` falls back to `mcp.path` (same cc-switch.db).

## 🚀 Install

> **One-click copy:** hover the code block below and click the copy button in the top-right corner.

**1. Add the dependency:**

```bash
dsh plugin --profile web add github:Elysiaqwq/dsh-ccswitch
```

**2. Append the mount row** to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-ccswitch
      name: dsh-ccswitch
```

**3. Refresh the browser** (`F5`) — the **CCSwitch 导入** section appears in Settings.

> ⚠️ Do **not** mount it via the bundle layer (no `dsh.bundle.patch`, not in `dsh.profile.bundles`).

## 🧹 Uninstall

```bash
dsh plugin --profile web remove dsh-ccswitch
```

Then remove the `- insert: … dsh-ccswitch …` block from `cordis.patch.yml`, and optionally delete the `ccswitch:` section from `settings.yaml`.

## 🧪 Verify

```bash
cd dsh-ccswitch && node --no-warnings test-apply.mjs
```

Reads the real CCSwitch skills (77) and MCP servers (4), checks mappings, and drives `apply()` / `reconcile` against a stub ctx.

## 📦 Dependencies

- Node built-in `node:sqlite` (v22.5+) for the DB — zero extra deps.
- Runtime peers (`yaml`, `@deepseek-ai/dsh-settings`, `@deepseek-ai/schemastery`) resolved through the `$DSH_HOME/profiles/node_modules` fallback.
- `@deepseek-ai/dsh-mcp-client` is resolved by name through the loader.
