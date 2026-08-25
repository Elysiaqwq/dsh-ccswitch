// End-to-end probe for the merged dsh-ccswitch plugin without booting dsh:
// reads the real CCSwitch skills + DB, checks mappings, and drives apply()
// against a stub ctx (skills + loader + settings + webServer).
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const plugin = await import(new URL('./index.js', import.meta.url).href)

const req = createRequire(join(homedir(), '.dsh', 'profiles', 'node_modules', 'probe.cjs'))
const yamlMod = await import(pathToFileURL(req.resolve('yaml')).href)
plugin.setYamlParser(yamlMod.parse)

// --- skills: frontmatter + provider against the real CCSwitch root ---
const fm = plugin.parseFrontmatter(
  '---\nname: docx\ndescription: "Create Word docs"\n---\n\n# Body\n',
)
if (fm?.data?.name !== 'docx') throw new Error('frontmatter parse failed')
const inv = plugin.parseInvocationPolicy({ 'disable-model-invocation': true })
if (inv.modelInvocable !== false || inv.userInvocable !== true) throw new Error('invocation policy failed')

const state = { source: () => ({}) }
const provider = plugin.createCcswitchProvider(state)
const skills = await provider.list({})
console.log('skills imported:', skills.length)
if (skills.length === 0) throw new Error('no skills imported')
state.source = () => ({ skills: { disabled: ['docx'] } })
if ((await provider.list({})).some(s => s.name === 'docx')) throw new Error('disabled skill still listed')
state.source = () => ({ skills: { enabled: false } })
if ((await provider.list({})).length !== 0) throw new Error('skills.enabled:false failed')
state.source = () => ({})

// --- MCP: db read + mapping against the real CCSwitch DB ---
const servers = plugin.readCcswitchMcpServers(plugin.DEFAULT_DB_PATH)
console.log('MCP servers:', servers.map(s => s.name).join(', '))
if (servers.length === 0) throw new Error('no MCP servers read')
const c7 = plugin.toMcpClientConfig('context7', { type: 'http', url: 'https://x/mcp', headers: { A: '1' } })
if (c7.transport !== 'streamable-http' || c7.serverName !== 'context7') throw new Error('http mapping failed')
const cd = plugin.toMcpClientConfig('chrome-devtools', { type: 'stdio', command: 'npx', args: ['x'] })
if (cd.transport !== 'stdio' || cd.command !== 'npx') throw new Error('stdio mapping failed')
if (plugin.sanitizeServerName('Pixso') !== 'pixso') throw new Error('sanitize failed')

// --- Models: extraction + route generation against the real CCSwitch DB ---
const providers = plugin.readCcswitchProviders(plugin.DEFAULT_DB_PATH)
console.log('CCSwitch providers:', providers.length)
if (providers.length === 0) throw new Error('no providers read')

const anthropic = plugin.extractAnthropicModels({
  ANTHROPIC_BASE_URL: 'https://x',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5[1M]',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5[1M]',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-opus-5',
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'claude-opus-5',
})
const ids = anthropic.map(m => m.id).sort().join(',')
if (ids !== 'claude-opus-5,claude-sonnet-5') throw new Error('anthropic extraction wrong: ' + ids)
if (anthropic.find(m => m.id === 'claude-opus-5')?.contextWindow !== 1_000_000) throw new Error('contextWindow not parsed')
const sized = plugin.parseModelSizeSuffix('test-model[1M/64k]')
if (sized?.contextWindow !== 1_000_000 || sized?.maxTokens !== 64_000 || sized?.id !== 'test-model') throw new Error('size suffix parse failed')
if (plugin.parseModelSizeSuffix('plain-id') !== undefined) throw new Error('suffix parser too lenient')
const custom = plugin.extractCustomModels({ models: [
  { id: 'm-a', contextLength: 128000, maxTokens: '8192' },
  { id: 'm-b[200K]', name: 'ignored-name' },
  { id: 'm-c', context_window: 256000, max_output_tokens: 32000 },
] })
if (custom[0].contextWindow !== 128_000 || custom[0].maxTokens !== 8192) throw new Error('custom ctx/out fields not picked up')
if (custom[1].contextWindow !== 200_000) throw new Error('custom suffix ctx not parsed')
if (custom[2].contextWindow !== 256_000 || custom[2].maxTokens !== 32_000) throw new Error('snake_case fields not picked up')
console.log('extractAnthropicModels + extractCustomModels OK:', ids, '|', JSON.stringify(custom))

const toml = 'model_provider = "custom"\nmodel = "gpt-5.5"\nbase_url = "https://yunwu.ai"\n'
const codex = plugin.extractCodexInfo(toml)
if (codex.model !== 'gpt-5.5' || codex.baseURL !== 'https://yunwu.ai') throw new Error('codex extraction wrong')
console.log('extractCodexInfo OK:', codex.model)

const built = plugin.buildModelProfiles(providers, [])
console.log('importable provider routes:', built.length, '->', built.map(b => b.route).join(', '))
if (built.length === 0) throw new Error('no importable provider routes')

// Validate every generated profile through llm-pi-ai's own Config schema
// (shape + defaults; serviceability is additionally gated at write time by the
// namespace's registered validator).
const llmPiAi = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-llm-pi-ai')).href)
const mergedProviders = {}
for (const b of built) mergedProviders[b.route] = b.profile
let validated = true
try {
  llmPiAi.Config({ providers: mergedProviders })
} catch (error) {
  validated = false
  console.log('VALIDATION FAILED:', error.message)
}
if (!validated) throw new Error('generated providers failed Config schema')
const first = built[0]
if (!first.profile.apiKeyEnv || !first.profile.models || first.profile.models.length === 0) throw new Error('profile shape wrong')
if (!first.credRef.startsWith('CCSWITCH_')) throw new Error('credential ref wrong')
console.log('Config schema validation OK; sample:', first.route, '|', first.profile.api, '|', first.profile.models.map(m => m.id).join(','))

// --- apply() against a stub ctx ---
const created = []
const removed = []
const storedCreds = []
const unsetCreds = []
const updated = []
const mutated = []
let currentCfg = {}
let replaced = null
let routeRegistered = null
let registeredProvider = null
const ctx = {
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
  inject: (names, callback) => {
    if (names.includes('skills')) {
      callback({ skills: { registerProvider: (create) => { registeredProvider = create({ signal: new AbortController().signal, invalidate: () => {} }); return () => {} } } })
      return
    }
    if (names.includes('loader')) {
      callback({ loader: { create: async ({ name, config }) => { created.push({ name, config }); return 'e-' + config.serverName }, remove: async (id) => removed.push(id) } })
      return
    }
    if (names.includes('credentials')) {
      const credStore = new Map()
      callback({ credentials: {
        resolve: async (ref) => (credStore.has(ref) ? { value: credStore.get(ref), source: 'test' } : undefined),
        describe: async (ref) => ({ configured: credStore.has(ref), writable: true }),
        set: async (ref, value) => { credStore.set(ref, value); storedCreds.push({ ref, value }) },
        unset: async (ref) => { credStore.delete(ref); unsetCreds.push(ref) },
      } })
      return
    }
    if (names.includes('settings')) {
      let llmProviders = {}
      callback({ settings: {
        register: (ns, schema) => { registeredNs = ns; return { get: () => currentCfg, watch: () => () => {} } },
        replace: (ns, section) => { replaced = { ns, section }; return Promise.resolve() },
        get: (ns) => (ns === 'llm-pi-ai' ? { providers: llmProviders } : undefined),
        describe: () => [{ ns: 'llm-pi-ai', user: { providers: llmProviders } }],
        update: async (ns, patch) => {
          if (ns !== 'llm-pi-ai') return
          updated.push({ ns, patch })
          llmProviders = { ...llmProviders, ...patch.providers }
        },
        mutate: async (ns, ops) => {
          if (ns !== 'llm-pi-ai') return
          mutated.push({ ns, ops })
          for (const op of ops) {
            if (op.op === 'unset' && op.path[0] === 'providers') delete llmProviders[op.path[1]]
          }
        },
      }, effect: fn => fn() })
      return
    }
    if (names.includes('webServer')) {
      callback({ webServer: { register: route => { routeRegistered = route; return () => {} } }, effect: fn => fn() })
      return
    }
    throw new Error('probe cannot satisfy inject [' + names.join(', ') + ']')
  },
  effect: fn => fn(),
  get: (name) => (name === 'tools' ? { schemas: () => [{ name: 'mcp__context7__s' }, { name: 'other' }] } : undefined),
}
let registeredNs = null
await plugin.apply(ctx)
await new Promise(resolve => setTimeout(resolve, 600))

console.log('registered provider:', registeredProvider?.name, '| namespace:', registeredNs, '| route:', routeRegistered?.path)
if (registeredProvider?.name !== 'ccswitch') throw new Error('provider not registered')
if (registeredNs !== 'ccswitch') throw new Error('namespace not registered')
if (routeRegistered?.path !== '/dsh-ccswitch/api') throw new Error('route not registered')
console.log('mcp entries created:', created.map(c => c.config.serverName).join(', '))
if (created.length !== 4) throw new Error('expected 4 mcp-client creates, got ' + created.length)
if (!created.every(c => c.name === '@deepseek-ai/dsh-mcp-client')) throw new Error('wrong package created')

// models import should have run during apply (reconcileModels via settings inject)
if (updated.length === 0) throw new Error('reconcileModels did not write llm-pi-ai routes')
if (storedCreds.length === 0) throw new Error('reconcileModels did not store credentials')
console.log('models routes written:', updated.map(u => Object.keys(u.patch.providers).length).join(','), '| creds stored:', storedCreds.length)

// --- master-off must unmount ---
state.mounted = new Map(created.map(c => [c.config.serverName, 'e-' + c.config.serverName]))
currentCfg = { mcp: { enabled: false } }
const realLoader = { create: async () => 'x', remove: async (id) => removed.push(id) }
await plugin.reconcile({ source: () => currentCfg, loader: realLoader, mounted: state.mounted }, ctx)
if (state.mounted.size !== 0) throw new Error('master-off did not unmount')

console.log('probe OK')
