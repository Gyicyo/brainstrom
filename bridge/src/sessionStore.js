import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.resolve(__dirname, '../sessions');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey() {
  const key = process.env.SESSION_ENCRYPTION_KEY;
  if (key) {
    return crypto.createHash('sha256').update(key).digest();
  }
  logger.warn('sessionStore', 'SESSION_ENCRYPTION_KEY not set — using default key (not safe for production)');
  return crypto.createHash('sha256').update('brainstorm-default-dev-key').digest();
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), tag: authTag, data: encrypted });
}

function decrypt(payload) {
  try {
    const { iv, tag, data } = JSON.parse(payload);
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    let decrypted = decipher.update(data, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  } catch {
    return null;
  }
}

function sanitizeSessionId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}

function ensureDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

export function saveSession(sessionId, { topic, agents, apiConfig }) {
  ensureDir();
  const safeId = sanitizeSessionId(sessionId);
  const dir = path.join(SESSIONS_DIR, safeId);
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
    apiConfig: {
      apiBaseUrl: apiConfig.apiBaseUrl,
      modelName: apiConfig.modelName,
      apiKey: encrypt(apiConfig.apiKey),
    },
    agents: agentMeta,
    createdAt: new Date().toISOString(),
  }, null, 2), 'utf-8');
}

export function loadSession(sessionId) {
  const safeId = sanitizeSessionId(sessionId);
  const dir = path.join(SESSIONS_DIR, safeId);
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

  const decryptedKey = decrypt(meta.apiConfig.apiKey);
  return {
    topic: meta.topic,
    apiConfig: {
      apiBaseUrl: meta.apiConfig.apiBaseUrl,
      modelName: meta.apiConfig.modelName,
      apiKey: decryptedKey || '',
    },
    agents,
  };
}

export function deleteSessionDir(sessionId) {
  const safeId = sanitizeSessionId(sessionId);
  const dir = path.join(SESSIONS_DIR, safeId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function sessionDirExists(sessionId) {
  const safeId = sanitizeSessionId(sessionId);
  return existsSync(path.join(SESSIONS_DIR, safeId, 'meta.json'));
}

export function listSessionIds() {
  ensureDir();
  return readdirSync(SESSIONS_DIR).filter(name => {
    const metaPath = path.join(SESSIONS_DIR, name, 'meta.json');
    return existsSync(metaPath);
  });
}
