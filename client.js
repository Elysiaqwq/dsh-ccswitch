/**
 * dsh-ccswitch — browser half.
 *
 * Adds a "CCSwitch 导入" section to the dsh web settings page with two cards:
 * 技能 (imported skills, shown in the '/' reference menu) and MCP (mounted
 * mcp-client servers). Persists through the host's loopback
 * `POST /dsh-ccswitch/api` (the `ccswitch` namespace in settings.yaml).
 */
window.__ModuleLoader__.load({
  id: "dsh-ccswitch",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;

    var API = "/dsh-ccswitch/api";

    var s = {
      section: { fontFamily: "var(--dsw-font-family, inherit)" },
      row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "8px 0" },
      label: { fontSize: 13, color: "var(--dsw-alias-label-primary)", minWidth: 120 },
      dim: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)" },
      hint: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", margin: "2px 0 0", wordBreak: "break-word" },
      card: {
        padding: "10px 12px", borderRadius: 10, margin: "8px 0",
        border: "1px solid var(--dsw-alias-border-l3)", background: "var(--dsw-alias-bg-layer-1)",
      },
      cardTitle: { fontSize: 14, color: "var(--dsw-alias-label-primary)", fontWeight: 600, margin: "0 0 4px" },
      input: {
        padding: "5px 8px", borderRadius: 8, fontSize: 13,
        border: "1px solid var(--dsw-alias-border-l3)",
        background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)",
        minWidth: 280,
      },
      btn: {
        padding: "6px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
        border: "1px solid var(--dsw-alias-border-l3)",
        background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)",
      },
      btnPrimary: {
        padding: "6px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer", border: "none",
        background: "var(--dsw-alias-button-primary-fill)",
        color: "var(--dsw-alias-label-primary-inverted)",
      },
      ok: { color: "var(--dsw-alias-state-success-primary)", fontSize: 13, margin: "8px 0 0" },
      err: { color: "var(--dsw-alias-state-error-primary)", fontSize: 13, margin: "8px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word" },
      list: { maxHeight: 240, overflowY: "auto", marginTop: 6, borderTop: "1px solid var(--dsw-alias-border-l3)" },
      item: {
        display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 4px",
        borderBottom: "1px solid var(--dsw-alias-border-l3)",
      },
      itemName: { fontSize: 13, color: "var(--dsw-alias-label-primary)", fontWeight: 600, minWidth: 150 },
      itemDesc: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", flex: 1, wordBreak: "break-word" },
      badge: {
        display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: 11,
        border: "1px solid var(--dsw-alias-border-l3)", color: "var(--dsw-alias-label-tertiary)", whiteSpace: "nowrap", marginRight: 4,
      },
      badgeOn: {
        display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: 11,
        border: "1px solid var(--dsw-alias-state-success-secondary, #15803d)",
        color: "var(--dsw-alias-state-success-primary)", whiteSpace: "nowrap",
      },
    };

    function cleanErrText(value) {
      return String(value).replace(/,?\s*function\s*\(\s*\)\s*\{\s*\[native code\]\s*\}\s*$/, "");
    }

    function callApi(method, body) {
      return fetch(API, {
        method: method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { /* 保持 null */ }
          if (!res.ok) {
            throw new Error(
              (data && data.error) ? data.error : "HTTP " + res.status + (text ? "" : "（空响应：服务未就绪或未注册）")
            );
          }
          if (data === null || typeof data !== "object") {
            throw new Error("HTTP " + res.status + " 返回了非 JSON 响应");
          }
          return data;
        });
      });
    }

    function CcswitchSection() {
      var dataState = useState(null);
      var data = dataState[0];
      var setData = dataState[1];
      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var errorState = useState(null);
      var error = errorState[0];
      var setError = errorState[1];
      var noticeState = useState(null);
      var notice = noticeState[0];
      var setNotice = noticeState[1];
      // skills form
      var skillsOnState = useState(true);  var skillsOn = skillsOnState[0];  var setSkillsOn = skillsOnState[1];
      var skillsPathState = useState("");  var skillsPath = skillsPathState[0];  var setSkillsPath = skillsPathState[1];
      var skillsDisabledState = useState({});  var skillsDisabled = skillsDisabledState[0];  var setSkillsDisabled = skillsDisabledState[1];
      // mcp form
      var mcpOnState = useState(true);  var mcpOn = mcpOnState[0];  var setMcpOn = mcpOnState[1];
      var mcpPathState = useState("");  var mcpPath = mcpPathState[0];  var setMcpPath = mcpPathState[1];
      var mcpDisabledState = useState({});  var mcpDisabled = mcpDisabledState[0];  var setMcpDisabled = mcpDisabledState[1];
      // models form
      var modelsOnState = useState(true);  var modelsOn = modelsOnState[0];  var setModelsOn = modelsOnState[1];
      var modelsDisabledState = useState({});  var modelsDisabled = modelsDisabledState[0];  var setModelsDisabled = modelsDisabledState[1];

      function load() {
        setBusy(true);
        setError(null);
        setNotice(null);
        return callApi("GET")
          .then(function (payload) {
            setData(payload);
            var sk = payload.skills || {};
            var mc = payload.mcp || {};
            setSkillsOn(sk.enabled !== false);
            setSkillsPath(sk.path || "");
            var snext = {}; (sk.disabled || []).forEach(function (n) { snext[n] = true; }); setSkillsDisabled(snext);
            setMcpOn(mc.enabled !== false);
            setMcpPath(mc.path || "");
            var mnext = {}; (mc.disabled || []).forEach(function (n) { mnext[n] = true; }); setMcpDisabled(mnext);
            var mo = payload.models || {};
            setModelsOn(mo.enabled !== false);
            var monext = {}; (mo.disabled || []).forEach(function (n) { monext[n] = true; }); setModelsDisabled(monext);
          })
          .catch(function (e) { setError(cleanErrText(e && e.message ? e.message : String(e))); })
          .then(function () { setBusy(false); });
      }

      useEffect(function () { load(); }, []);

      function save() {
        var sDisabled = Object.keys(skillsDisabled).filter(function (n) { return skillsDisabled[n]; });
        var mDisabled = Object.keys(mcpDisabled).filter(function (n) { return mcpDisabled[n]; });
        var moDisabled = Object.keys(modelsDisabled).filter(function (n) { return modelsDisabled[n]; });
        setBusy(true);
        setError(null);
        setNotice(null);
        return callApi("POST", {
          skills: { enabled: skillsOn, path: skillsPath || null, disabled: sDisabled },
          mcp: { enabled: mcpOn, path: mcpPath || null, disabled: mDisabled },
          models: { enabled: modelsOn, path: null, disabled: moDisabled },
        })
          .then(function () {
            setNotice("已保存到 settings.yaml 的 ccswitch 分区，正在重新挂载 ...");
            return load();
          })
          .catch(function (e) { setError(cleanErrText(e && e.message ? e.message : String(e))); })
          .then(function () { setBusy(false); });
      }

      var skills = (data && data.skills && data.skills.skills) || [];
      var mcpServers = (data && data.mcp && data.mcp.servers) || [];
      var modelProviders = (data && data.models && data.models.providers) || [];
      var toggle = function (setter, map) {
        return function (name) {
          setter(Object.assign({}, map, (function () { var next = {}; next[name] = !map[name]; return next; })()));
        };
      };

      return h("div", { style: s.section },
        h("p", { style: s.dim },
          "从 CCSwitch 导入技能、MCP 服务与模型到 DSH。技能会出现在输入框的 / 菜单；MCP 服务挂载为 mcp__服务名__工具名 的工具；" +
          "模型会以 ccswitch-* 路由写入 llm-pi-ai（含 API Key，存到凭据库），出现在模型选择器。"),

        // ---- 技能卡片 ----
        h("div", { style: s.card },
          h("div", { style: s.cardTitle }, "技能"),
          h("div", { style: s.row },
            h("label", { style: s.label }, "启用导入"),
            h("input", { type: "checkbox", checked: skillsOn, disabled: busy, onChange: function (e) { setSkillsOn(e.target.checked); }, style: { width: 16, height: 16 } }),
            h("span", { style: s.dim },
              data === null ? "" : "已导入 " + (data.skills.count || 0) + " 个 · 注册表可见 " + (data.skills.registryCount || 0) + " 个")),
          h("div", { style: s.row },
            h("label", { style: s.label }, "技能目录"),
            h("input", { style: s.input, value: skillsPath, disabled: busy, placeholder: "~/.cc-switch/skills", onChange: function (e) { setSkillsPath(e.target.value); } })),
          h("div", { style: s.row },
            h("span", { style: s.label }, "技能列表"),
            h("span", { style: s.dim }, "勾选 = 从 / 菜单隐藏")),
          data === null && busy
            ? h("p", { style: s.hint }, "正在读取 ...")
            : skills.length === 0 && data !== null
            ? h("p", { style: s.hint }, "未发现技能（目录不存在、未启用，或全部被禁用）。")
            : h("div", { style: s.list },
                skills.map(function (skill) {
                  return h("div", { key: skill.name, style: s.item },
                    h("input", { type: "checkbox", checked: !!skillsDisabled[skill.name], disabled: busy, onChange: function () { toggle(setSkillsDisabled, skillsDisabled)(skill.name); }, style: { width: 14, height: 14, marginTop: 2 } }),
                    h("span", { style: s.itemName }, "/" + skill.name),
                    h("span", { style: s.itemDesc },
                      skill.description,
                      skill.modelInvocable ? null : h("span", { style: s.badge }, "仅用户")));
                }))),

        // ---- MCP 卡片 ----
        h("div", { style: s.card },
          h("div", { style: s.cardTitle }, "MCP"),
          h("div", { style: s.row },
            h("label", { style: s.label }, "启用导入"),
            h("input", { type: "checkbox", checked: mcpOn, disabled: busy, onChange: function (e) { setMcpOn(e.target.checked); }, style: { width: 16, height: 16 } }),
            h("span", { style: s.dim },
              data === null ? "" : "已挂载 " + (data.mcp.mounted || []).length + " 个服务 · mcp 工具 " + data.mcp.mcpToolCount + " 个")),
          h("div", { style: s.row },
            h("label", { style: s.label }, "数据库路径"),
            h("input", { style: s.input, value: mcpPath, disabled: busy, placeholder: "~/.cc-switch/cc-switch.db", onChange: function (e) { setMcpPath(e.target.value); } })),
          h("div", { style: s.row },
            h("span", { style: s.label }, "MCP 服务"),
            h("span", { style: s.dim }, "勾选 = 不挂载")),
          data === null && busy
            ? h("p", { style: s.hint }, "正在读取 ...")
            : mcpServers.length === 0 && data !== null
            ? h("p", { style: s.hint }, "CCSwitch 中未配置 MCP 服务或数据库不可读。")
            : h("div", { style: s.list },
                mcpServers.map(function (server) {
                  return h("div", { key: server.name, style: s.item },
                    h("input", { type: "checkbox", checked: !!mcpDisabled[server.name], disabled: busy, onChange: function () { toggle(setMcpDisabled, mcpDisabled)(server.name); }, style: { width: 14, height: 14, marginTop: 2 } }),
                    h("span", { style: s.itemName }, server.name),
                    h("span", { style: s.itemDesc },
                      server.target,
                      h("span", { style: server.mounted ? s.badgeOn : s.badge }, server.mounted ? "已挂载" : (server.disabled ? "已禁用" : "未挂载")),
                      h("span", { style: s.badge }, server.type === "stdio" ? "stdio" : "http")));
                }))),

        // ---- 模型卡片 ----
        h("div", { style: s.card },
          h("div", { style: s.cardTitle }, "模型（自动导入）"),
          h("div", { style: s.row },
            h("label", { style: s.label }, "启用导入"),
            h("input", { type: "checkbox", checked: modelsOn, disabled: busy, onChange: function (e) { setModelsOn(e.target.checked); }, style: { width: 16, height: 16 } }),
            h("span", { style: s.dim },
              data === null ? "" : "可导入 " + modelProviders.length + " 个 provider 路由（写入 llm-pi-ai，key 存入凭据库）")),
          h("div", { style: s.row },
            h("span", { style: s.label }, "Provider 路由"),
            h("span", { style: s.dim }, "勾选 = 不导入")),
          data === null && busy
            ? h("p", { style: s.hint }, "正在读取 ...")
            : modelProviders.length === 0 && data !== null
            ? h("p", { style: s.hint }, "CCSwitch 中没有可导入的模型（需要 baseURL + API Key + 至少一个模型）。")
            : h("div", { style: s.list },
                modelProviders.map(function (prov) {
                  return h("div", { key: prov.route, style: s.item },
                    h("input", { type: "checkbox", checked: !!modelsDisabled[prov.providerName], disabled: busy, onChange: function () { toggle(setModelsDisabled, modelsDisabled)(prov.providerName); }, style: { width: 14, height: 14, marginTop: 2 } }),
                    h("span", { style: s.itemName }, prov.route),
                    h("span", { style: s.itemDesc },
                      prov.displayName + " · " + prov.api,
                      h("span", { style: s.badge }, prov.models.map(function (m) {
                        if (typeof m === "string") return m;
                        var bits = [];
                        if (m.contextWindow !== undefined) bits.push((m.contextWindow / 1000) + "K ctx");
                        if (m.maxTokens !== undefined) bits.push((m.maxTokens / 1000) + "K out");
                        return bits.length > 0 ? m.id + " (" + bits.join("/") + ")" : m.id;
                      }).join(" / "))));
                }))),
        h("p", { style: s.hint },
          "导入会把每个可用的 CCSwitch provider 写成 llm-pi-ai.providers.ccswitch-* 路由，并把 API Key 存入凭据库；" +
          "只管理 ccswitch-* 前缀的路由，不会改动你手动配置的 uu/ark 等路由。"),

        h("div", { style: s.row },
          h("button", { style: s.btnPrimary, disabled: busy, onClick: function () { save(); } },
            busy ? "保存中 ..." : "保存"),
          h("button", { style: s.btn, disabled: busy, onClick: function () { load(); } },
            "刷新")),
        notice ? h("p", { style: s.ok }, notice) : null,
        error ? h("p", { style: s.err }, error) : null,
        h("p", { style: s.dim },
          "生效方式：技能经 ctx.skills 提供者注册（/ 菜单自动列出）；MCP 经 ctx.loader 创建 mcp-client 实例。改动即时生效。")
      );
    }

    function apply(ctx) {
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          {
            name: "settings.section",
            id: "dsh-ccswitch",
            order: 44,
            label: function () { return "CCSwitch 导入"; },
          },
          CcswitchSection
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
