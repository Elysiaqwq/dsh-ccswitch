// End-to-end probe for the merged dsh-ccswitch plugin without booting dsh:
// reads the real CCSwitch skills + DB, checks mappings, and drives apply()
// against a stub ctx (skills + loader + settings + webServer).
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const plugin = await import(new URL('./main.js', import.meta.url).href)

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

// --- apply() against a stub ctx ---
const created = []
const removed = []
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
    if (names.includes('settings')) {
      callback({ settings: { register: (ns, schema) => { registeredNs = ns; return { get: () => currentCfg, watch: () => () => {} } }, replace: (ns, section) => { replaced = { ns, section }; return Promise.resolve() } }, effect: fn => fn() })
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

// --- master-off must unmount ---
state.mounted = new Map(created.map(c => [c.config.serverName, 'e-' + c.config.serverName]))
currentCfg = { mcp: { enabled: false } }
const realLoader = { create: async () => 'x', remove: async (id) => removed.push(id) }
await plugin.reconcile({ source: () => currentCfg, loader: realLoader, mounted: state.mounted }, ctx)
if (state.mounted.size !== 0) throw new Error('master-off did not unmount')

console.log('probe OK')
