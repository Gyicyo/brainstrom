import { AuthStorage, ModelRegistry, SettingsManager, SessionManager, createAgentSession, createExtensionRuntime } from '@earendil-works/pi-coding-agent';
import { registerBuiltInApiProviders } from '@earendil-works/pi-ai';
import readline from 'readline';

registerBuiltInApiProviders();

const API_BASE = process.env.API_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.MODEL || 'deepseek-v4-flash';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const API_KEY = await new Promise(resolve => {
  rl.question('API Key: ', (key) => { rl.close(); resolve(key); });
});

// Minimal in-memory plumbing
const auth = AuthStorage.create();
auth.setRuntimeApiKey('deepseek', API_KEY);
const modelRegistry = ModelRegistry.inMemory(auth);
const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const sessionManager = SessionManager.inMemory(process.cwd());

// Custom resourceLoader avoids file-system lookups
const resourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => 'You are a test agent with access to read, bash, ls, grep, find tools. Use them when needed. Be concise.',
  getAppendSystemPrompt: () => [],
  extendResources: () => {},
  reload: async () => {},
};

const model = modelRegistry.find('deepseek', MODEL);
if (!model) { console.error('Model not found in registry'); process.exit(1); }

console.log('Model:', model.id, '| api:', model.api, '| baseUrl:', model.baseUrl);

const { session } = await createAgentSession({
  cwd: process.cwd(),
  model,
  thinkingLevel: 'off',
  authStorage: auth,
  modelRegistry,
  resourceLoader,
  tools: ['read', 'bash', 'ls', 'grep', 'find'],
  sessionManager,
  settingsManager,
});

session.subscribe((event) => {
  if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
  if (event.type === 'tool_execution_start') {
    const args = typeof event.args === 'string' ? event.args : JSON.stringify(event.args);
    console.log(`\n[TOOL START] ${event.toolName}(${args.slice(0, 200)})`);
  }
  if (event.type === 'tool_execution_end') {
    const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
    console.log(`\n[TOOL END] ${event.toolName} | error:${event.isError} | result: ${result.slice(0, 300)}`);
  }
  if (event.type === 'agent_end') {
    console.log('\n--- agent done ---');
  }
});

try {
  console.log('\n=== Prompt 1: ls ===');
  await session.prompt('What files are in the current directory? Use the ls tool.');

  console.log('\n=== Prompt 2: read ===');
  await session.prompt('Read package.json and tell me what the dependencies are.');
} catch (e) {
  console.error('Error:', e.message);
}

session.dispose();
console.log('\nDone.');
