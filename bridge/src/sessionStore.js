import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.resolve(__dirname, '../sessions');

function ensureDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

export function saveSession(sessionId, { topic, agents, apiConfig }) {
  ensureDir();
  const dir = path.join(SESSIONS_DIR, String(sessionId));
  const agentsDir = path.join(dir, 'agents');
  mkdirSync(agentsDir, { recursive: true });

  const agentMeta = [];
  for (const a of agents) {
    const safeName = a.name.replace(/[<>:"/\\|?*]/g, '_');
    if (a.skillContent) {
      const skillDir = path.join(agentsDir, safeName);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(path.join(skillDir, 'SKILL.md'), a.skillContent, 'utf-8');
    }
    agentMeta.push({ name: a.name, hasSkill: !!a.skillContent });
  }

  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    topic,
    apiConfig: { apiBaseUrl: apiConfig.apiBaseUrl, modelName: apiConfig.modelName, apiKey: apiConfig.apiKey },
    agents: agentMeta,
    createdAt: new Date().toISOString(),
  }, null, 2), 'utf-8');
}

export function loadSession(sessionId) {
  const dir = path.join(SESSIONS_DIR, String(sessionId));
  const metaPath = path.join(dir, 'meta.json');
  if (!existsSync(metaPath)) return null;

  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const agentsDir = path.join(dir, 'agents');

  const agents = [];
  for (const a of meta.agents) {
    const safeName = a.name.replace(/[<>:"/\\|?*]/g, '_');
    const skillPath = path.join(agentsDir, safeName, 'SKILL.md');
    const skillContent = existsSync(skillPath) ? readFileSync(skillPath, 'utf-8') : '';
    agents.push({ name: a.name, skillContent });
  }

  return { topic: meta.topic, apiConfig: meta.apiConfig, agents };
}

export function deleteSessionDir(sessionId) {
  const dir = path.join(SESSIONS_DIR, String(sessionId));
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function sessionDirExists(sessionId) {
  return existsSync(path.join(SESSIONS_DIR, String(sessionId), 'meta.json'));
}

export function listSessionIds() {
  ensureDir();
  return readdirSync(SESSIONS_DIR).filter(name => {
    const metaPath = path.join(SESSIONS_DIR, name, 'meta.json');
    return existsSync(metaPath);
  });
}
