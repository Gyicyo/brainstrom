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
  onError: (data: { agent_id: number; error: string }) => void;
  onComplete: () => void;
}

export function streamDivergent(
  sessionId: number, roundId: number,
  callbacks: StreamCallbacks,
): () => void {
  const es = new EventSource(`/api/sessions/${sessionId}/rounds/${roundId}/stream-divergent`);

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
    callbacks.onError(JSON.parse(e.data));
  });
  es.addEventListener('complete', () => {
    es.close();
    callbacks.onComplete();
  });
  es.onerror = () => {
    es.close();
    callbacks.onError({ agent_id: -1, error: 'Connection lost' });
  };

  return () => es.close();
}
