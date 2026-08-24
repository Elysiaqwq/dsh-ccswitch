/**
 * dsh-ccswitch — import CCSwitch skills AND MCP servers into DeepSeek Harness.
 *
 * Merged host half of the former dsh-ccswitch-skills + dsh-ccswitch-mcp
 * plugins. One plugin, one `ccswitch` settings namespace (nested `skills` and
 * `mcp` sections), one settings-page API, one hot-mount entry.
 *
 *  1. SKILLS: registers a `ctx.skills` provider named `ccswitch` that maps
 *     every directory bundle under `~/.cc-switch/skills/<name>/SKILL.md` onto
 *     the skill registry (same frontmatter grammar as DSH's built-in
 *     skill-filesystem). DSH's browser half (ui-skill) already lists
 *     user-invocable skills in the '/' reference menu and dsh-tool-skill
 *     injects the body for a leading `/name`, so no client work is needed.
 *  2. MCP: reads the MCP server list CCSwitch manages
 *     (`~/.cc-switch/cc-switch.db`, table `mcp_servers`) with Node's built-in
 *     `node:sqlite` (read-only), and mounts each enabled server as a
 *     `@deepseek-ai/dsh-mcp-client` instance through `ctx.loader.create`,
 *     whose tools become `mcp__<serverName>__<toolName>`.
 *
 * Precedence for skills: candidates rank 700 (above DSH's bundled 600), so a
 * name CCSwitch shares with a skill DSH already serves keeps DSH's own body;
 * names DSH lacks are filled in. MCP servers mount with
 * `failOnStartupError: false` (unreachable endpoints log and reconnect).
 *
 * Runtime peers (`@deepseek-ai/dsh-settings`, `@deepseek-ai/schemastery`,
 * `yaml`) are imported through the launcher-maintained flat fallback
 * `$DSH_HOME/profiles/node_modules`; `@deepseek-ai/dsh-mcp-client` is
 * referenced by name only (the loader resolves it the same way).
 *
 * @module dsh-ccswitch
 */

import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'

export const name = 'dsh-ccswitch'

/** Settings namespace owning both import configurations. */
export const NS = 'ccswitch'
/** Loopback HTTP API shared with the browser settings section. */
export const API_PATH = '/dsh-ccswitch/api'
/** HTTP request body cap. */
const HTTP_BODY_CAP = 512 * 1024

/** Public skill-name grammar, mirrored from @deepseek-ai/dsh-skill. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Origin bucket for imported skill candidates. */
export const SOURCE = 'user-dsh'
/** Skill rank: above DSH's bundled 600, so DSH-native skills win name conflicts. */
export const RANK = 700
/** Default CCSwitch skill root. */
export const DEFAULT_SKILL_ROOT = '~/.cc-switch/skills'
/** Default CCSwitch database file (MCP servers). */
export const DEFAULT_DB_PATH = '~/.cc-switch/cc-switch.db'
/** The DSH package that bridges one MCP server; created by name via the loader. */
export const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'
/** serverName grammar enforced by mcp-client. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** YAML parser installed by apply() (imported through the fallback); null until then. */
let yamlParse = null

/**
 * Install the YAML parser (a peer import cannot be a static dependency of a
 * link-installed plugin). Also lets the probe test parsing without booting.
 * @param fn - the `yaml` package's `parse` function.
 */
export function setYamlParser(fn) {
  yamlParse = fn
}

/**
 * Resolve the DeepSeek Harness home exactly as `@deepseek-ai/dsh-home-paths`
 * does for the no-explicit-config case. Inlined so this plugin imports nothing
 * that resolves through a package root.
 * @returns the normalized absolute Harness home path.
 */
export function harnessHome() {
  const fromEnv = process.env.DSH_HOME
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0
    ? (fromEnv === '~' ? homedir() : fromEnv.startsWith('~/') || fromEnv.startsWith('~\\') ? join(homedir(), fromEnv.slice(2)) : fromEnv)
    : join(homedir(), '.dsh')
  return resolve(selected)
}

/**
 * Import one peer through the launcher-maintained flat installation fallback
 * `$DSH_HOME/profiles/node_modules`, which every dsh launch heals.
 * @param packageName - the peer package to import.
 * @returns the package's resolved module namespace.
 */
async function importPeer(packageName) {
  const requirePeer = createRequire(join(harnessHome(), 'profiles', 'node_modules', 'dsh-ccswitch.cjs'))
  let entry
  try {
    entry = requirePeer.resolve(packageName)
  } catch (error) {
    throw new Error(
      `dsh-ccswitch: cannot resolve ${packageName} from the installation fallback `
      + `(${join(harnessHome(), 'profiles', 'node_modules')}); restart dsh so the launcher heals it: ${String(error)}`,
    )
  }
  return import(pathToFileURL(entry).href)
}

// ---------------------------------------------------------------------------
// Skills: path, frontmatter, provider
// ---------------------------------------------------------------------------

/**
 * Resolve the configured CCSwitch skill root, expanding `~`.
 * @param configured - the settings `skills.path` value, or undefined for the default.
 * @returns the absolute root directory.
 */
export function resolveSkillsRoot(configured) {
  const selected = typeof configured === 'string' && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_SKILL_ROOT
  const expanded = selected === '~'
    ? homedir()
    : selected.startsWith('~/') || selected.startsWith('~\\')
      ? join(homedir(), selected.slice(2))
      : selected
  return resolve(expanded)
}

/** Scalar string field, absent when not a non-empty string. */
function stringField(data, key) {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Optional scalar string field as a spreadable record. */
function optionalString(data, key) {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {}
}

/** Parse the invocation policy from frontmatter, mirroring skill-filesystem. */
export function parseInvocationPolicy(data) {
  const disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
  const userInvocable = frontmatterBoolean(data, 'user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

/** Boolean frontmatter field with lenient 1/0/true/false/yes/no spellings. */
function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true': case 'yes': case 'on': return true
      case 'false': case 'no': case 'off': return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

/** Optional `metadata` object field. */
function optionalMetadata(data) {
  const value = data.metadata
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { metadata: value }
  }
  return {}
}

/** Locate the closing `---` of a frontmatter block. */
function findClosingFrontmatter(raw, start) {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}

/**
 * Split one SKILL.md into frontmatter data and body, mirroring
 * skill-filesystem's parser. Returns undefined when there is no frontmatter
 * or it does not parse to a plain object.
 */
export function parseFrontmatter(raw) {
  if (yamlParse === null) throw new Error('dsh-ccswitch: yaml parser not installed (apply() not run or importPeer failed)')
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  const yamlText = raw.slice(start, closing.start)
  const parsed = yamlParse(yamlText)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed, body: raw.slice(closing.bodyStart) }
}

/**
 * Parse and validate one SKILL.md file. Mirrors skill-filesystem's rules:
 * frontmatter must carry a kebab-case `name` and a non-empty
 * `description`; invalid or missing files are skipped (undefined).
 */
export async function parseSkillFile(path, signal) {
  signal?.throwIfAborted()
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return undefined
    throw error
  }
  signal?.throwIfAborted()
  const parsed = parseFrontmatter(raw)
  if (parsed === undefined) return undefined
  const skillName = stringField(parsed.data, 'name')
  const description = stringField(parsed.data, 'description')
  if (skillName === undefined || description === undefined) return undefined
  if (!SKILL_NAME.test(skillName)) return undefined
  let invocation
  try {
    invocation = parseInvocationPolicy(parsed.data)
  } catch {
    return undefined
  }
  return {
    name: skillName,
    description,
    ...optionalString(parsed.data, 'whenToUse'),
    invocation,
    ...optionalMetadata(parsed.data),
    content: parsed.body.trim(),
  }
}

/**
 * Build the `ccswitch` skill provider. Reads its configuration live from
 * `state.source().skills` on every call.
 * @param state - live wiring: `source()` returns the resolved `ccswitch` section.
 * @returns a `SkillProvider`-shaped object.
 */
export function createCcswitchProvider(state) {
  return {
    name: 'ccswitch',
    async list(options) {
      const cfg = state.source()
      const skillsCfg = cfg?.skills ?? {}
      if (skillsCfg.enabled === false) return []
      const root = resolveSkillsRoot(skillsCfg.path)
      const disabled = new Set(Array.isArray(skillsCfg.disabled) ? skillsCfg.disabled : [])
      let entries
      try {
        entries = await readdir(root, { withFileTypes: true })
      } catch (error) {
        if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return []
        throw error
      }
      const skills = []
      for (const entry of entries) {
        options?.signal?.throwIfAborted()
        if (!entry.isDirectory()) continue
        if (disabled.has(entry.name)) continue
        const skillDir = join(root, entry.name)
        const skillPath = join(skillDir, 'SKILL.md')
        const parsed = await parseSkillFile(skillPath, options?.signal)
        if (parsed === undefined) continue
        skills.push({
          name: parsed.name,
          description: parsed.description,
          ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
          invocation: parsed.invocation,
          provider: 'ccswitch',
          source: SOURCE,
          rank: RANK,
          locator: { path: skillPath, directory: skillDir },
          resourceBase: { kind: 'directory', path: skillDir },
          path: skillPath,
          ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
        })
      }
      skills.sort((left, right) => left.name.localeCompare(right.name))
      return skills
    },
    async get(candidate, options) {
      const parsed = await parseSkillFile(candidate.locator.path, options?.signal)
      if (parsed === undefined) return undefined
      return {
        name: parsed.name,
        description: parsed.description,
        ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
        invocation: parsed.invocation,
        source: SOURCE,
        provider: 'ccswitch',
        resourceBase: { kind: 'directory', path: candidate.locator.directory },
        path: candidate.locator.path,
        ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
        content: parsed.content,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// MCP: db read, config mapping, reconcile
// ---------------------------------------------------------------------------

/**
 * Resolve the configured CCSwitch DB path, expanding `~`.
 * @param configured - the settings `mcp.path` value, or undefined for the default.
 * @returns the absolute DB file path.
 */
export function resolveDbPath(configured) {
  const selected = typeof configured === 'string' && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_DB_PATH
  const expanded = selected === '~'
    ? homedir()
    : selected.startsWith('~/') || selected.startsWith('~\\')
      ? join(homedir(), selected.slice(2))
      : selected
  return resolve(expanded)
}

/**
 * Read the MCP servers CCSwitch manages (`mcp_servers` table). Uses Node's
 * built-in sqlite in read-only mode; a missing/unreadable DB yields [].
 * @param dbPath - absolute path of cc-switch.db.
 * @returns the server rows, name-sorted.
 */
export function readCcswitchMcpServers(dbPath) {
  let db
  try {
    db = new DatabaseSync(resolveDbPath(dbPath), { readOnly: true })
    const rows = db.prepare(
      'SELECT name, server_config FROM mcp_servers',
    ).all()
    const servers = []
    for (const row of rows) {
      let config
      try {
        config = JSON.parse(row.server_config)
      } catch {
        continue // malformed server_config is skipped
      }
      if (!config || typeof config !== 'object') continue
      servers.push({ name: row.name, config })
    }
    servers.sort((left, right) => left.name.localeCompare(right.name))
    return servers
  } catch {
    return []
  } finally {
    try {
      db?.close()
    } catch {
      /* already closed */
    }
  }
}

/**
 * Map a CCSwitch server_config JSON onto the mcp-client `Config` union.
 * @param name - CCSwitch server name (used for the namespace).
 * @param config - parsed server_config.
 * @returns a stdio or streamable-http config, or undefined when unsupported.
 */
export function toMcpClientConfig(name, config) {
  const serverName = sanitizeServerName(name)
  if (serverName === undefined) return undefined
  if (config.type === 'http') {
    if (typeof config.url !== 'string' || config.url.length === 0) return undefined
    return {
      transport: 'streamable-http',
      serverName,
      url: config.url,
      headers: config.headers && typeof config.headers === 'object' ? config.headers : {},
      failOnStartupError: false,
    }
  }
  if (config.type === 'stdio') {
    if (typeof config.command !== 'string' || config.command.length === 0) return undefined
    return {
      transport: 'stdio',
      serverName,
      command: config.command,
      args: Array.isArray(config.args) ? config.args.map(String) : [],
      env: config.env && typeof config.env === 'object' ? config.env : {},
      failOnStartupError: false,
    }
  }
  return undefined
}

/**
 * Make a CCSwitch server name a valid mcp-client `serverName`
 * (`[A-Za-z0-9_-]{1,32}`): lowercase, invalid runs become `-`, capped at 32.
 */
export function sanitizeServerName(name) {
  const cleaned = String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  return SERVER_NAME_PATTERN.test(cleaned) ? cleaned : undefined
}

/**
 * Reconcile the mounted mcp-client instances against `state.source().mcp`
 * and the CCSwitch DB: create missing servers, remove stale ones.
 * @param state - live wiring (source/loader/mounted).
 * @param ctx - plugin context (for logging and loader access).
 */
export async function reconcile(state, ctx) {
  const cfg = state.source()
  const mcpCfg = cfg?.mcp ?? {}
  const loader = state.loader
  if (loader === null || typeof loader.create !== 'function' || mcpCfg.enabled === false) {
    // Master switch off or no loader: unmount everything.
    for (const [serverName, id] of [...state.mounted]) {
      try {
        await loader?.remove(id)
      } catch {
        /* already disposed */
      }
      state.mounted.delete(serverName)
    }
    return
  }
  const servers = readCcswitchMcpServers(mcpCfg.path)
  const disabled = new Set(Array.isArray(mcpCfg.disabled) ? mcpCfg.disabled : [])
  const desired = []
  for (const server of servers) {
    if (disabled.has(server.name)) continue
    const config = toMcpClientConfig(server.name, server.config)
    if (config === undefined) continue
    desired.push(config)
  }
  // Mount servers that should be live but are not yet mounted.
  for (const config of desired) {
    if (state.mounted.has(config.serverName)) continue
    try {
      const id = await loader.create({ name: MCP_CLIENT_PACKAGE, config })
      state.mounted.set(config.serverName, id)
      ctx.logger.info(`dsh-ccswitch: mounted MCP server "${config.serverName}"`)
    } catch (error) {
      ctx.logger.warn(`dsh-ccswitch: could not mount MCP server "${config.serverName}": ${String(error)}`)
    }
  }
  // Unmount servers no longer desired.
  const desiredNames = new Set(desired.map(config => config.serverName))
  for (const [serverName, id] of [...state.mounted]) {
    if (desiredNames.has(serverName)) continue
    try {
      await loader.remove(id)
    } catch {
      /* already disposed */
    }
    state.mounted.delete(serverName)
    ctx.logger.info(`dsh-ccswitch: unmounted MCP server "${serverName}"`)
  }
}

// ---------------------------------------------------------------------------
// Models: import CCSwitch-configured providers/models into llm-pi-ai
// ---------------------------------------------------------------------------

/** Route prefix this plugin owns inside \`llm-pi-ai.providers\`. */
export const MODEL_PREFIX = 'ccswitch-'
/** Reasoning levels declared on imported reasoning models. */
export const MODEL_REASONING_EFFORTS = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }

/**
 * Make a CCSwitch provider name a clean route slug (kebab-case).
 * @param name - raw provider name/id.
 * @returns the slug, or \`provider\` when nothing usable remains.
 */
export function sanitizeProviderSlug(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug.length > 0 ? slug : 'provider'
}

/**
 * The credential reference an imported route points at (an env-style name the
 * credentials service stores under \`.credentials.yaml\`).
 * @param slug - the route slug after \`ccswitch-\`.
 * @returns a \`^[A-Za-z_][A-Za-z0-9_]*$\` credential reference.
 */
export function credentialRefFor(slug) {
  return ('CCSWITCH_' + slug.replace(/-/g, '_').toUpperCase() + '_API_KEY').slice(0, 60)
}

/**
 * Extract the model ids a Claude-Code-style CCSwitch provider declares in its
 * \`ANTHROPIC_*\` env vars. A \`[1M]\`/\`[2M]\` suffix (or \`[N]G\`) becomes the
 * model's \`contextWindow\`.
 * @param env - the provider config's \`env\` object.
 * @returns deduplicated \`{ id, contextWindow? }\` entries.
 */
export function extractAnthropicModels(env) {
  if (!env || typeof env !== 'object') return []
  const map = new Map()
  const add = (raw) => {
    if (typeof raw !== 'string') return
    const value = raw.trim()
    if (!value) return
    const suffix = /^(.+?)\[(\d+)([MG])\]$/.exec(value)
    if (suffix !== null) {
      const id = suffix[1]
      if (!map.has(id)) {
        const size = Number(suffix[2])
        const unit = suffix[3]
        map.set(id, { id, contextWindow: unit === 'G' ? size * 1e9 : size * 1e6 })
      }
    } else if (!map.has(value)) {
      map.set(value, { id: value })
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (key === 'ANTHROPIC_MODEL') {
      add(value)
    } else if (key.startsWith('ANTHROPIC_') && key.endsWith('_MODEL') && !key.endsWith('_MODEL_NAME')) {
      add(value)
    }
  }
  return [...map.values()]
}

/**
 * Extract model ids from an OpenAI-style custom provider's \`models\` array.
 * @param config - the parsed provider config.
 * @returns \`{ id }\` entries.
 */
export function extractCustomModels(config) {
  const models = Array.isArray(config.models) ? config.models : []
  const out = []
  for (const entry of models) {
    if (entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.length > 0) {
      out.push({ id: entry.id })
    }
  }
  return out
}

/**
 * Extract \`base_url\` and \`model\` from a Codex provider's TOML-style config.
 * @param configText - the \`config\` field (TOML text).
 * @returns \`{ baseURL?, model? }\`.
 */
export function extractCodexInfo(configText) {
  const base = /^base_url\s*=\s*"([^"]+)"/m.exec(configText)
  const model = /^model\s*=\s*"([^"]+)"/m.exec(configText)
  return {
    baseURL: base?.[1],
    model: model?.[1],
  }
}

/**
 * Read the providers CCSwitch manages (\`providers\` table, \`settings_config\`
 * JSON). Read-only, missing DB yields [].
 * @param dbPath - absolute path of cc-switch.db.
 * @returns \`{ id, name, config }\` rows, name-sorted.
 */
export function readCcswitchProviders(dbPath) {
  let db
  try {
    db = new DatabaseSync(resolveDbPath(dbPath), { readOnly: true })
    const rows = db.prepare(
      'SELECT id, name, settings_config FROM providers',
    ).all()
    const out = []
    for (const row of rows) {
      let config
      try {
        config = typeof row.settings_config === 'string' ? JSON.parse(row.settings_config) : row.settings_config
      } catch {
        continue // malformed settings_config is skipped
      }
      if (!config || typeof config !== 'object') continue
      out.push({ id: row.id, name: row.name, config })
    }
    out.sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id))
    return out
  } catch {
    return []
  } finally {
    try {
      db?.close()
    } catch {
      /* already closed */
    }
  }
}

/**
 * Build the \`llm-pi-ai\` provider routes this plugin imports from CCSwitch.
 * A provider is imported only when a base URL, an API key, and at least one
 * model can all be extracted; everything else is skipped.
 * @param providers - rows from {@link readCcswitchProviders}.
 * @param disabled - provider names to skip.
 * @returns \`{ route, profile, credRef, apiKey, providerName, api }\` entries.
 */
export function buildModelProfiles(providers, disabled) {
  const disabledSet = new Set(disabled)
  const out = []
  for (const provider of providers) {
    const name = (provider.name || provider.id || 'provider').trim() || 'provider'
    if (disabledSet.has(name)) continue
    const config = provider.config || {}
    const env = config.env || {}
    const apiKey = env.ANTHROPIC_AUTH_TOKEN || config.api_key || (config.auth && config.auth.OPENAI_API_KEY)
    let api = null
    let baseURL = ''
    let models = []
    if (typeof env.ANTHROPIC_BASE_URL === 'string' && env.ANTHROPIC_BASE_URL.length > 0) {
      // Claude-Code-style provider speaking the Anthropic Messages API.
      api = 'anthropic-messages'
      baseURL = env.ANTHROPIC_BASE_URL
      models = extractAnthropicModels(env)
    } else if (typeof config.base_url === 'string' && config.base_url.length > 0) {
      // OpenAI-style custom provider with a models array.
      api = 'openai-completions'
      baseURL = config.base_url
      models = extractCustomModels(config)
      if (models.length === 0 && typeof config.model === 'string') models = [{ id: config.model }]
    } else if (typeof config.config === 'string' && config.config.includes('base_url')) {
      // Codex provider with a TOML config block.
      const info = extractCodexInfo(config.config)
      if (info.baseURL && info.model) {
        api = 'openai-responses'
        baseURL = info.baseURL
        models = [{ id: info.model }]
      }
    }
    if (api === null || baseURL.length === 0 || typeof apiKey !== 'string' || apiKey.length === 0 || models.length === 0) {
      continue
    }
    const slug = sanitizeProviderSlug(name)
    const route = MODEL_PREFIX + slug
    const credRef = credentialRefFor(slug)
    // \`compat\` reasoning switches exist only on openai-completions models;
    // anthropic-messages models keep protocol-native dispatch.
    const compat = api === 'openai-completions'
      ? { compat: { thinkingFormat: 'openai', supportsReasoningEffort: true } }
      : {}
    out.push({
      route,
      credRef,
      apiKey,
      providerName: name,
      api,
      profile: {
        apiKeyEnv: credRef,
        displayName: `${name} (CCSwitch)`,
        api,
        baseURL,
        models: models.map(model => ({
          id: model.id,
          name: model.id,
          ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
          reasoningEfforts: MODEL_REASONING_EFFORTS,
          ...compat,
        })),
      },
    })
  }
  return out
}

/** Deep equality over JSON-compatible data (used to skip no-op writes). */
function deepEqualJson(left, right) {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((entry, index) => deepEqualJson(entry, right[index]))
  }
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(key => key in right && deepEqualJson(left[key], right[key]))
}

/**
 * Reconcile the imported \`ccswitch-*\` provider routes in \`llm-pi-ai\` against
 * the current CCSwitch provider table: add/update routes, store their API keys
 * in the credentials service, and remove routes (and keys) that are no longer
 * desired or when the models import is switched off. Only this plugin's
 * \`ccswitch-\` prefixed routes are ever touched.
 * @param state - live wiring (settings/credentials/resolveProfiles/llmNs/source).
 * @param ctx - plugin context (for logging).
 */
export async function reconcileModels(state, ctx) {
  const settings = state.settings
  if (settings === null || typeof settings.update !== 'function') return
  const cfg = state.source()
  const modelsCfg = cfg?.models ?? {}
  const mcpCfg = cfg?.mcp ?? {}
  const dbPath = modelsCfg.path ?? mcpCfg.path
  const disabled = Array.isArray(modelsCfg.disabled) ? modelsCfg.disabled : []
  const llmNs = state.llmNs
  const current = settings.get(llmNs)
  const currentProviders = current && typeof current.providers === 'object' && current.providers !== null
    ? current.providers
    : {}
  const owned = Object.keys(currentProviders).filter(route => route.startsWith(MODEL_PREFIX))

  const removeRoutes = async (routes) => {
    if (routes.length === 0) return
    try {
      await settings.mutate(llmNs, routes.map(route => ({ op: 'unset', path: ['providers', route] })))
    } catch (error) {
      ctx.logger.warn(`dsh-ccswitch: could not remove model routes: ${String(error)}`)
    }
    const credentials = state.credentials
    if (credentials !== null && typeof credentials.unset === 'function') {
      for (const route of routes) {
        try {
          await credentials.unset(credentialRefFor(route.slice(MODEL_PREFIX.length)))
        } catch {
          /* absent reference is a no-op */
        }
      }
    }
  }

  if (modelsCfg.enabled === false) {
    await removeRoutes(owned)
    return
  }

  const providers = readCcswitchProviders(dbPath)
  const desired = buildModelProfiles(providers, disabled)
  const desiredByRoute = new Map(desired.map(entry => [entry.route, entry]))

  // Validate the shape of the full merged providers dict through llm-pi-ai's
  // own schema before touching settings; serviceability is additionally gated
  // by the namespace's write-time validator (caught below).
  const merged = { ...currentProviders }
  for (const entry of desired) merged[entry.route] = entry.profile
  for (const route of owned) if (!desiredByRoute.has(route)) delete merged[route]
  if (state.validateSection !== null) {
    try {
      state.validateSection(merged)
    } catch (error) {
      ctx.logger.warn(`dsh-ccswitch: model import skipped — generated llm-pi-ai providers failed validation: ${String(error)}`)
      return
    }
  }

  // Diff against the currently stored owned routes to avoid no-op writes.
  const patch = {}
  for (const entry of desired) {
    const currentProfile = currentProviders[entry.route]
    if (currentProfile === undefined || !deepEqualJson(currentProfile, entry.profile)) {
      patch[entry.route] = entry.profile
    }
  }
  const stale = owned.filter(route => !desiredByRoute.has(route))

  if (Object.keys(patch).length === 0 && stale.length === 0) return

  // Store API keys first so the routes never point at an unset reference.
  const credentials = state.credentials
  if (credentials !== null && typeof credentials.set === 'function') {
    for (const entry of desired) {
      if (patch[entry.route] === undefined) continue
      try {
        const info = await credentials.describe(entry.credRef)
        if (info?.configured !== true) await credentials.set(entry.credRef, entry.apiKey)
      } catch (error) {
        ctx.logger.warn(`dsh-ccswitch: could not store credential ${entry.credRef}: ${String(error)}`)
      }
    }
  }
  try {
    if (Object.keys(patch).length > 0) {
      await settings.update(llmNs, { providers: patch })
    }
    await removeRoutes(stale)
    ctx.logger.info(`dsh-ccswitch: imported ${desired.length} CCSwitch provider route(s) into llm-pi-ai`)
  } catch (error) {
    ctx.logger.warn(`dsh-ccswitch: model import write failed: ${String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

/** Read and parse one JSON request body, capped at {@link HTTP_BODY_CAP} bytes. */
function readJsonBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > HTTP_BODY_CAP) {
        rejectPromise(new Error('dsh-ccswitch: request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolvePromise(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        rejectPromise(new Error(`dsh-ccswitch: request body is not valid JSON: ${String(error)}`))
      }
    })
    req.on('error', rejectPromise)
  })
}

/** Whether a request's peer address is loopback (writes mutate user settings). */
function isLoopback(req) {
  const address = req.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address.startsWith('::ffff:127.') || address === '::1'
}

/** Send one JSON response. */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/**
 * The settings-page API, host half.
 *   GET  /dsh-ccswitch/api → `{ ok, skills: {...}, mcp: {...} }`
 *   POST /dsh-ccswitch/api with `{ skills?: {...}, mcp?: {...} }` → `{ ok }`
 * Loopback only.
 */
async function handleApi(req, res, deps) {
  if (!isLoopback(req)) {
    sendJson(res, 403, { error: 'dsh-ccswitch: loopback only' })
    return
  }
  try {
    const settings = deps.settings()
    if (req.method === 'GET') {
      const cfg = deps.source()
      const skillsCfg = cfg?.skills ?? {}
      const mcpCfg = cfg?.mcp ?? {}
      const modelsCfg = cfg?.models ?? {}
      const provider = deps.provider()
      let skills = []
      if (provider !== null) {
        try {
          skills = await provider.list({})
        } catch {
          skills = []
        }
      }
      let registryCount = 0
      const skillsService = deps.skills()
      if (skillsService !== null && typeof skillsService.list === 'function') {
        try {
          const merged = await skillsService.list({})
          registryCount = merged.filter(skill => skill.provider === 'ccswitch').length
        } catch {
          registryCount = 0
        }
      }
      const disabledSkills = new Set(Array.isArray(skillsCfg.disabled) ? skillsCfg.disabled : [])
      const servers = readCcswitchMcpServers(mcpCfg.path)
      const disabledMcp = new Set(Array.isArray(mcpCfg.disabled) ? mcpCfg.disabled : [])
      const modelsDbPath = modelsCfg.path ?? mcpCfg.path
      const modelProviders = buildModelProfiles(readCcswitchProviders(modelsDbPath), modelsCfg.disabled ?? [])
      const mounted = deps.mounted()
      let mcpToolCount = 0
      const tools = deps.tools()
      if (tools !== null && typeof tools.schemas === 'function') {
        try {
          mcpToolCount = tools.schemas().filter(schema => schema.name.startsWith('mcp__')).length
        } catch {
          mcpToolCount = 0
        }
      }
      sendJson(res, 200, {
        ok: true,
        skills: {
          enabled: skillsCfg.enabled !== false,
          path: resolveSkillsRoot(skillsCfg.path),
          disabled: Array.isArray(skillsCfg.disabled) ? [...skillsCfg.disabled] : [],
          count: skills.length,
          registryCount,
          skills: skills.map(skill => ({
            name: skill.name,
            description: skill.description,
            modelInvocable: skill.invocation.modelInvocable,
            userInvocable: skill.invocation.userInvocable,
            disabled: disabledSkills.has(skill.name),
          })),
        },
        mcp: {
          enabled: mcpCfg.enabled !== false,
          path: resolveDbPath(mcpCfg.path),
          disabled: Array.isArray(mcpCfg.disabled) ? [...mcpCfg.disabled] : [],
          mounted: [...mounted.keys()],
          mcpToolCount,
          servers: servers.map(server => ({
            name: server.name,
            serverName: sanitizeServerName(server.name),
            type: server.config && server.config.type === 'stdio' ? 'stdio' : 'http',
            target: server.config
              ? (server.config.type === 'stdio'
                ? `${server.config.command ?? ''} ${(server.config.args ?? []).join(' ')}`.trim()
                : server.config.url ?? '')
              : '',
            disabled: disabledMcp.has(server.name),
            mounted: mounted.has(sanitizeServerName(server.name)),
          })),
        },
        models: {
          enabled: modelsCfg.enabled !== false,
          path: resolveDbPath(modelsDbPath),
          disabled: Array.isArray(modelsCfg.disabled) ? [...modelsCfg.disabled] : [],
          providers: modelProviders.map(entry => ({
            route: entry.route,
            displayName: entry.profile.displayName,
            providerName: entry.providerName,
            api: entry.api,
            baseURL: entry.profile.baseURL,
            models: entry.profile.models.map(model => model.id),
          })),
        },
      })
      return
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'dsh-ccswitch: request body must be a JSON object' })
        return
      }
      const section = {}
      for (const part of ['skills', 'mcp', 'models']) {
        const raw = body[part]
        if (raw === undefined) continue
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
          sendJson(res, 400, { error: `dsh-ccswitch: ${part} must be an object` })
          return
        }
        const sub = {}
        if (raw.enabled !== undefined) {
          if (typeof raw.enabled !== 'boolean') {
            sendJson(res, 400, { error: `dsh-ccswitch: ${part}.enabled must be a boolean` })
            return
          }
          sub.enabled = raw.enabled
        }
        if (raw.path !== undefined && raw.path !== null) {
          if (typeof raw.path !== 'string') {
            sendJson(res, 400, { error: `dsh-ccswitch: ${part}.path must be a string` })
            return
          }
          sub.path = raw.path
        }
        if (raw.disabled !== undefined) {
          if (!Array.isArray(raw.disabled) || raw.disabled.some(value => typeof value !== 'string')) {
            sendJson(res, 400, { error: `dsh-ccswitch: ${part}.disabled must be an array of names` })
            return
          }
          sub.disabled = raw.disabled
        }
        if (Object.keys(sub).length > 0) section[part] = sub
      }
      if (settings === null) {
        sendJson(res, 503, { error: 'dsh-ccswitch: settings service is unavailable' })
        return
      }
      await settings.replace(deps.ns(NS), section)
      deps.afterSave()
      sendJson(res, 200, { ok: true })
      return
    }
    sendJson(res, 405, { error: `dsh-ccswitch: method ${req.method} not allowed` })
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/**
 * Register the `ccswitch` skill provider, the MCP reconcile, the `ccswitch`
 * settings namespace, and the loopback API route. Every service wiring is
 * optional and degrades separately.
 * @param ctx - plugin context.
 */
export async function apply(ctx) {
  // Sequential, never Promise.all: yaml and the dsh peers share a CJS/ESM
  // interop graph (cosmokit) whose concurrent dynamic import races in Node.
  const yamlMod = await importPeer('yaml')
  setYamlParser(yamlMod.parse)
  const { settingsNamespace } = await importPeer('@deepseek-ai/dsh-settings')
  const { default: z } = await importPeer('@deepseek-ai/schemastery')
  // llm-pi-ai's own schema (shape + defaults). Serviceability beyond the shape
  // is gated at write time by the namespace's registered validator, which is
  // why reconcileModels wraps the write in try/catch too.
  const { Config: LlmPiAiConfig } = await importPeer('@deepseek-ai/dsh-llm-pi-ai')

  const PartConfig = z.object({
    enabled: z.boolean().default(true),
    path: z.string(),
    disabled: z.array(z.string()).default([]),
  })
  const Schema = z.object({
    skills: PartConfig,
    mcp: PartConfig,
    models: PartConfig,
  })

  /** Live wiring shared by the provider, the reconcilers, and the API route. */
  const state = {
    settings: null,
    skills: null,
    loader: null,
    credentials: null,
    provider: null,
    control: null,
    mounted: new Map(),
    llmNs: settingsNamespace('llm-pi-ai'),
    validateSection: (providers) => { LlmPiAiConfig({ providers }) },
    source: () => ({}),
  }

  /** Serialized reconciliation queue (create/remove are async and ordered). */
  let queue = Promise.resolve()
  const scheduleReconcile = () => {
    queue = queue.then(() => reconcile(state, ctx)).catch((error) => {
      ctx.logger.warn(`dsh-ccswitch: MCP reconcile failed: ${String(error)}`)
    }).then(() => reconcileModels(state, ctx)).catch((error) => {
      ctx.logger.warn(`dsh-ccswitch: model reconcile failed: ${String(error)}`)
    })
  }
  const afterSave = () => {
    try {
      state.control?.invalidate()
    } catch (error) {
      ctx.logger.warn(`dsh-ccswitch: skill catalog invalidation failed: ${String(error)}`)
    }
    scheduleReconcile()
  }

  // Skills: the provider must register while the skills service is present.
  ctx.inject(['skills'], (sctx) => {
    state.skills = sctx.skills
    if (state.provider !== null) return // skills service reattached
    const provider = createCcswitchProvider(state)
    state.provider = provider
    sctx.skills.registerProvider((control) => {
      state.control = control
      return provider
    })
  })

  // MCP: mount/unmount mcp-client instances when the loader is present.
  ctx.inject(['loader'], (lctx) => {
    state.loader = lctx.loader
    scheduleReconcile()
  })

  // Credentials: import stores CCSwitch API keys here.
  ctx.inject(['credentials'], (cctx) => {
    state.credentials = cctx.credentials
  })

  // Settings: register the namespace, point the source at the scope, and
  // invalidate/reconcile on every committed change.
  ctx.inject(['settings'], (sctx) => {
    state.settings = sctx.settings
    const scope = sctx.settings.register(settingsNamespace(NS), Schema)
    state.source = () => scope.get()
    scope.watch(() => afterSave())
    sctx.effect(() => () => {
      state.source = () => ({})
      state.settings = null
    })
    // Kick the initial skills/MCP/models reconcile once settings are live.
    scheduleReconcile()
  })

  // Teardown: unmount every mcp-client instance this plugin created.
  ctx.effect(() => () => {
    queue = queue.then(async () => {
      for (const id of [...state.mounted.values()]) {
        try {
          await state.loader?.remove(id)
        } catch {
          /* already disposed */
        }
      }
      state.mounted.clear()
    })
  })

  // The webServer service may activate after this plugin; join through a
  // service-watching child (the dsh-auto-update pattern).
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: API_PATH,
      handler: (req, res) => handleApi(req, res, {
        settings: () => state.settings,
        source: () => state.source(),
        provider: () => state.provider,
        skills: () => state.skills,
        mounted: () => state.mounted,
        tools: () => ctx.get('tools') ?? null,
        ns: settingsNamespace,
        afterSave,
      }),
    }))
  })
}

export default apply
