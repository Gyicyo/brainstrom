const BRIDGE_URL = 'http://localhost:3001';

export async function* streamChat(
  sessionId: number,
  agentName: string,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  const resp = await fetch(`${BRIDGE_URL}/api/room/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName, message }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`桥接服务器错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.body) throw new Error('无响应内容');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = parseSSEBuffer(buffer);
    buffer = events.rest;
    for (const { event, data } of events.parsed) {
      if (event === 'text_delta') yield data.text;
      if (event === 'error') throw new Error(data.message);
      if (event === 'done') return;
    }
  }
}

export async function* streamScribeSummary(
  sessionId: number,
  discussion: { name: string; content: string }[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  const resp = await fetch(`${BRIDGE_URL}/api/room/${sessionId}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ discussion }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`桥接服务器错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.body) throw new Error('无响应内容');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = parseSSEBuffer(buffer);
    buffer = events.rest;
    for (const { event, data } of events.parsed) {
      if (event === 'text_delta') yield data.text;
      if (event === 'done') return;
    }
  }
}

export async function* distillExperts(
  topic: string,
  apiConfig: { apiKey: string; apiBaseUrl: string; modelName: string },
  context?: string,
  signal?: AbortSignal,
): AsyncGenerator<DistillEvent, DistillResult | undefined, undefined> {
  const resp = await fetch(`${BRIDGE_URL}/api/distill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, apiConfig, context }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`桥接服务器错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.body) throw new Error('无响应内容');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: DistillResult | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = parseSSEBuffer(buffer);
    buffer = events.rest;
    for (const { event, data } of events.parsed) {
      if (event === 'phase') yield data as DistillEvent;
      if (event === 'done') { result = data as DistillResult; return result; }
      if (event === 'error') throw new Error(data.message);
    }
  }
  return result;
}

export async function createRoom(
  sessionId: number,
  topic: string,
  agents: { name: string; skillContent: string }[],
  apiConfig: { apiBaseUrl: string; apiKey: string; modelName: string },
): Promise<void> {
  const resp = await fetch(`${BRIDGE_URL}/api/room/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, topic, agents, apiConfig }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`桥接服务器错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
}

export async function resumeRoom(sessionId: number): Promise<{ ok: boolean; agents?: { name: string; hasSkill: boolean }[] }> {
  const resp = await fetch(`${BRIDGE_URL}/api/room/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 404) return { ok: false };
    throw new Error(`桥接服务器错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

export async function callCompletion(
  systemPrompt: string,
  userMessage: string,
  apiConfig: { apiBaseUrl: string; apiKey: string; modelName: string },
): Promise<string> {
  const resp = await fetch(`${BRIDGE_URL}/api/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userMessage, apiConfig }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`桥接服务器错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.content;
}

export async function suggestRoles(
  topic: string,
  content: string,
  count: number,
  apiConfig: { apiBaseUrl: string; apiKey: string; modelName: string },
): Promise<{ roles: { name: string; bio: string }[] }> {
  const resp = await fetch(`${BRIDGE_URL}/api/suggest-roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, content, count, apiConfig }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`桥接服务器错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

export async function deleteRoom(sessionId: number): Promise<void> {
  const resp = await fetch(`${BRIDGE_URL}/api/room/${sessionId}`, {
    method: 'DELETE',
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`桥接服务器错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
}

export type DistillEvent =
  | { phase: 'search'; status: string }
  | { phase: 'search_result'; experts: string[] }
  | { phase: 'distilling'; expert: string; progress: string }
  | { phase: 'skill_ready'; expert: string; name: string; content: string };

export interface DistillResult {
  skills: { name: string; displayName: string; content: string }[];
}

export type DistillRolesEvent =
  | { phase: 'batch_start'; roles: { name: string }[] }
  | { phase: 'skill_ready'; expert: string }
  | { phase: 'distill_error'; expert: string; error: string };

export interface DistillResults {
  skills: { name: string; displayName: string; content: string }[];
  results: { name: string; status: string; error?: string }[];
}

export async function* distillRoles(
  sessionDir: string,
  roles: { name: string; bio: string }[],
  apiConfig: { apiBaseUrl: string; apiKey: string; modelName: string },
  signal?: AbortSignal,
): AsyncGenerator<DistillRolesEvent, void, undefined> {
  const resp = await fetch(`${BRIDGE_URL}/api/distill-roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionDir, roles, apiConfig }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`桥接服务器错误 ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.body) throw new Error('无响应内容');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = parseSSEBuffer(buffer);
    buffer = events.rest;
    for (const { event, data } of events.parsed) {
      if (event === 'phase') yield data as DistillRolesEvent;
      if (event === 'done') return;
      if (event === 'error') throw new Error(data.message);
    }
  }
}

export async function fetchDistillResults(sessionDir: string): Promise<DistillResults> {
  const resp = await fetch(`${BRIDGE_URL}/api/distill-roles/${encodeURIComponent(sessionDir)}`);
  if (!resp.ok) throw new Error(`获取蒸馏结果失败: ${resp.status}`);
  return resp.json();
}

function parseSSEBuffer(buffer: string): { parsed: { event: string; data: any }[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() || '';
  const parsed: { event: string; data: any }[] = [];
  let currentEvent = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('event: ')) {
      currentEvent = trimmed.slice(7);
    } else if (trimmed.startsWith('data: ')) {
      try {
        parsed.push({ event: currentEvent, data: JSON.parse(trimmed.slice(6)) });
      } catch { /* skip */ }
      currentEvent = '';
    }
  }
  return { parsed, rest };
}
