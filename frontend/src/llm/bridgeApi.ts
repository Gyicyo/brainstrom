const BRIDGE_URL = 'http://localhost:3001';

export async function* streamChat(
  sessionId: number,
  agentName: string,
  message: string,
  apiConfig: { apiBaseUrl: string; apiKey: string; modelName: string },
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  const resp = await fetch(`${BRIDGE_URL}/api/room/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName, message, apiConfig }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bridge error ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.body) throw new Error('No response body');

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
    throw new Error(`Bridge error ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.body) throw new Error('No response body');

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
  apiConfig: { apiKey: string; baseUrl: string; model: string },
  signal?: AbortSignal,
): AsyncGenerator<DistillEvent, DistillResult | undefined, undefined> {
  const resp = await fetch(`${BRIDGE_URL}/api/distill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, apiConfig }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bridge error ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.body) throw new Error('No response body');

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
  agents: { name: string; skillContent: string; apiConfig: { apiBaseUrl: string; apiKey: string; modelName: string } }[],
  scribeApiConfig?: { apiBaseUrl: string; apiKey: string; modelName: string },
): Promise<void> {
  const resp = await fetch(`${BRIDGE_URL}/api/room/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, topic, agents, scribeApiConfig }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bridge error ${resp.status}: ${text.slice(0, 200)}`);
  }
}

export async function deleteRoom(sessionId: number): Promise<void> {
  const resp = await fetch(`${BRIDGE_URL}/api/room/${sessionId}`, {
    method: 'DELETE',
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bridge error ${resp.status}: ${text.slice(0, 200)}`);
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
