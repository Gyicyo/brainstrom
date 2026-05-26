import { mkdirSync, appendFileSync, existsSync } from 'fs';
import path from 'path';

const LOG_DIR = path.resolve('logs');

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function getDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function getTimestamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function log(level, namespace, message, data) {
  const now = new Date();
  const entry = {
    time: getTimestamp(now),
    level,
    ns: namespace,
    msg: message,
    ...(data ? { data } : {}),
  };
  const line = JSON.stringify(entry) + '\n';

  const filename = `${getDateStr(now)}.log`;
  try {
    appendFileSync(path.join(LOG_DIR, filename), line, 'utf-8');
    // Console output for immediate visibility
    const prefix = `[${level}] [${namespace}]`;
    if (data) {
      const dataStr = JSON.stringify(data).slice(0, 800);
      console.log(`${prefix} ${message} ${dataStr}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
  } catch (err) {
    console.error('Logger write failed:', err);
  }
}

export const logger = {
  debug: (ns, msg, data) => log('DEBUG', ns, msg, data),
  info: (ns, msg, data) => log('INFO', ns, msg, data),
  warn: (ns, msg, data) => log('WARN', ns, msg, data),
  error: (ns, msg, data) => log('ERROR', ns, msg, data),

  // Mask API keys for safe logging
  maskKey: (key) => {
    if (!key || key.length < 8) return '***';
    return key.slice(0, 4) + '...' + key.slice(-4);
  },
};
