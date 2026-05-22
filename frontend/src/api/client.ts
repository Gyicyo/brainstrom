import type { AgentType, SessionType, RoundDetailType } from '../types';

const BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

// Agents
export const listAgents = () => fetchJSON<AgentType[]>('/agents');
export const createAgent = (data: Partial<AgentType>) =>
  fetchJSON<AgentType>('/agents', { method: 'POST', body: JSON.stringify(data) });
export const updateAgent = (id: number, data: Partial<AgentType>) =>
  fetchJSON<AgentType>(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAgent = (id: number) =>
  fetchJSON<void>(`/agents/${id}`, { method: 'DELETE' });
export const testAgent = (id: number) =>
  fetchJSON<{ success: boolean; message: string }>(`/agents/${id}/test`, { method: 'POST' });

// Sessions
export const listSessions = () => fetchJSON<SessionType[]>('/sessions');
export const createSession = (data: { topic: string; agent_ids: number[]; scribe_agent_id: number }) =>
  fetchJSON<SessionType>('/sessions', { method: 'POST', body: JSON.stringify(data) });
export const endSession = (id: number) =>
  fetchJSON<SessionType>(`/sessions/${id}/end`, { method: 'POST' });
export const deleteSession = (id: number) =>
  fetchJSON<void>(`/sessions/${id}`, { method: 'DELETE' });

// Rounds
export const startNewRound = (sessionId: number, initialMessage?: string) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/start`, {
    method: 'POST',
    body: JSON.stringify({ initial_message: initialMessage ?? '' }),
  });
export const getCurrentRound = (sessionId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/current`);
export const divergentRound = (sessionId: number, roundId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/divergent`, {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId }),
  });
export const mentionAgent = (sessionId: number, roundId: number, agentId: number, question: string) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/mention`, {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId, agent_id: agentId, question }),
  });
export const endRound = (sessionId: number, roundId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/end-round`, {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId }),
  });

// SSE streaming for divergent phase
interface StreamCallbacks {
  onAgentStart: (data: { agent_id: number; agent_name: string; message_id: number }) => void;
  onToken: (data: { agent_id: number; token: string }) => void;
  onAgentDone: (data: { agent_id: number }) => void;
  onAgentError: (data: { agent_id: number; error: string }) => void;
  onComplete: () => void;
  onConnectionError: (error: string) => void;
}

export function streamDivergent(
  sessionId: number, roundId: number,
  callbacks: StreamCallbacks,
): () => void {
  const es = new EventSource(`/api/sessions/${sessionId}/rounds/${roundId}/stream-divergent`);

  // Connection timeout — EventSource can hang silently if server doesn't respond
  const timeout = setTimeout(() => {
    es.close();
    callbacks.onConnectionError('Connection timed out. Is the backend running?');
  }, 10000);

  es.addEventListener('agent_start', (e) => {
    callbacks.onAgentStart(JSON.parse(e.data));
  });
  es.addEventListener('token', (e) => {
    callbacks.onToken(JSON.parse(e.data));
  });
  es.addEventListener('agent_done', (e) => {
    callbacks.onAgentDone(JSON.parse(e.data));
  });
  es.addEventListener('agent_error', (e) => {
    callbacks.onAgentError(JSON.parse(e.data));
  });
  es.addEventListener('complete', () => {
    clearTimeout(timeout);
    es.close();
    callbacks.onComplete();
  });

  // EventSource fires onerror when it can't connect (404, network error, etc.)
  // We also need to handle the case where the first event succeeds
  // (clear the timeout) but onerror fires later (connection drops mid-stream).
  // A single successful event means the connection is alive.
  es.addEventListener('agent_start', () => clearTimeout(timeout), { once: true });

  es.onerror = () => {
    clearTimeout(timeout);
    es.close();
    callbacks.onConnectionError('Failed to connect to streaming endpoint');
  };

  return () => { clearTimeout(timeout); es.close(); };
}
