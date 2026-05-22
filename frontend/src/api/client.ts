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

// Sessions
export const listSessions = () => fetchJSON<SessionType[]>('/sessions');
export const createSession = (data: { topic: string; agent_ids: number[] }) =>
  fetchJSON<SessionType>('/sessions', { method: 'POST', body: JSON.stringify(data) });
export const endSession = (id: number) =>
  fetchJSON<SessionType>(`/sessions/${id}/end`, { method: 'POST' });

// Rounds
export const startNewRound = (sessionId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/start`, { method: 'POST' });
export const getCurrentRound = (sessionId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/current`);
export const divergentRound = (sessionId: number, roundId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/divergent`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, round_id: roundId }),
  });
export const mentionAgent = (sessionId: number, roundId: number, agentId: number, question: string) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/mention`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, round_id: roundId, agent_id: agentId, question }),
  });
export const endRound = (sessionId: number, roundId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/end-round`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, round_id: roundId }),
  });
