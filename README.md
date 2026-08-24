# dsh-ccswitch

把 CCSwitch 的 **技能** 与 **MCP 服务** 一起导入 DeepSeek Harness 的合并插件（原 dsh-ccswitch-skills + dsh-ccswitch-mcp 的合并）。

- 不改动 DSH 本身：只通过插件机制挂载（ctx.skills 技能提供者 + ctx.loader 动态创建 mcp-client 实例 + settings 命名空间 + 一个设置页分区）。
- **技能**：读取 \`~/.cc-switch/skills/<name>/SKILL.md\`（77 个），注册进技能注册表。
  输入框输入 **/** 即可弹出选择框引用（/技能名 → tool-skill 注入正文），与 DSH 自带技能体验一致。
  同名技能以 DSH 自带版本优先（rank 700 > 内置 600）。
- **MCP**：读取 \`~/.cc-switch/cc-switch.db\` 的 \`mcp_servers\` 表（Node 内置 node:sqlite 只读），
  每个启用服务挂载为 \`@deepseek-ai/dsh-mcp-client\` 实例，工具以 \`mcp__服务名__工具名\` 注册，可被模型调用。
  http → streamable-http；stdio → stdio；连接失败自动重连（failOnStartupError: false）。

## 配置

写入 settings.yaml 的 \`ccswitch\` 分区，改动即时生效（技能目录热失效、MCP 重新挂载）：

    ccswitch:
      skills:
        enabled: true
        path: ~/.cc-switch/skills
        disabled:
          - some-skill
      mcp:
        enabled: true
        path: ~/.cc-switch/cc-switch.db
        disabled:
          - node_repl

设置页「CCSwitch 导入」分区含两张卡片（技能 / MCP），可分别开关、改路径、按条目禁用。

## 安装（热生效，无需重启 dsh）

1. 安装依赖：

       dsh plugin --profile web add link:d:/DSH/deepseek-harness/.local-plugins/dsh-ccswitch

2. 在 \`~/.dsh/profiles/web/cordis.patch.yml\` 末尾追加挂载行（DSH 会热应用）：

       - insert:
           - id: dsh-ccswitch
             name: dsh-ccswitch

3. **刷新浏览器页面**（F5）。设置页出现「CCSwitch 导入」分区；/ 菜单出现技能、MCP 工具随后可用。

> 注意：不要同时用 bundle 层挂载（不要声明 dsh.bundle.patch，也不要加进 dsh.profile.bundles）。

## 从旧插件迁移

合并前是 \`dsh-ccswitch-skills\` 和 \`dsh-ccswitch-mcp\` 两个插件。迁移步骤：

1. 先按上面安装并热挂载 \`dsh-ccswitch\`。
2. 从 \`cordis.patch.yml\` 删掉两个旧插件的 \`- insert:\` 段（DSH 热应用后旧实例退出）。
3. \`dsh plugin --profile web remove dsh-ccswitch-skills dsh-ccswitch-mcp\` 移除旧依赖。

## 卸载

1. 删掉 \`~/.dsh/profiles/web/cordis.patch.yml\` 里 \`- insert: … dsh-ccswitch …\` 段。
2. \`dsh plugin --profile web remove dsh-ccswitch\`。
3. \`ccswitch\` 分区可手动从 settings.yaml 删掉。

## 验证

    cd .local-plugins/dsh-ccswitch && node --no-warnings test-apply.mjs

不启动 dsh 的冒烟探针：真实读取 CCSwitch 技能（77 个）与 MCP 服务（4 个）、校验映射与禁用/开关、
以桩 ctx（skills + loader 记录 create/remove）跑 apply() 与 reconcile。

## 依赖

- 读库用 Node 内置 \`node:sqlite\`（v22.5+），零额外依赖。
- 运行期经 \`$DSH_HOME/profiles/node_modules\` 回退路径导入 yaml、@deepseek-ai/dsh-settings、@deepseek-ai/schemastery。
- \`@deepseek-ai/dsh-mcp-client\` 由 loader 按名字解析。

