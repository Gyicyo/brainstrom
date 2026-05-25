import { db } from './db';
import type { AgentRecord, SessionRecord, SessionAgentRecord, RoundRecord, MessageRecord, ThreadRecord, ThreadMessageRecord, GeneratedAgentRecord } from './db';

// Agent helpers
export async function listAgents(): Promise<AgentRecord[]> {
  return db.agents.orderBy('id').toArray();
}

export async function getAgent(id: number): Promise<AgentRecord | undefined> {
  return db.agents.get(id);
}

export async function createAgent(data: Omit<AgentRecord, 'id' | 'created_at'>): Promise<number> {
  return db.agents.add({ ...data, created_at: new Date().toISOString() });
}

export async function updateAgent(id: number, data: Partial<AgentRecord>): Promise<void> {
  await db.agents.update(id, data);
}

export async function deleteAgent(id: number): Promise<void> {
  await db.agents.delete(id);
}

// Session helpers
export async function listSessions(): Promise<SessionRecord[]> {
  return db.sessions.orderBy('id').toArray();
}

export async function getSession(id: number): Promise<SessionRecord | undefined> {
  return db.sessions.get(id);
}

export async function createSession(data: Omit<SessionRecord, 'id' | 'created_at'>, agentIds: number[], scribeAgentId: number): Promise<number> {
  return db.transaction('rw', db.sessions, db.sessionAgents, async () => {
    const sid = await db.sessions.add({ ...data, created_at: new Date().toISOString() });
    const rows: SessionAgentRecord[] = agentIds.map(aid => ({
      session_id: sid,
      agent_id: aid,
      is_scribe: aid === scribeAgentId,
    }));
    await db.sessionAgents.bulkAdd(rows);
    return sid;
  });
}

export async function updateSession(id: number, data: Partial<SessionRecord>): Promise<void> {
  await db.sessions.update(id, data);
}

export async function deleteSession(id: number): Promise<void> {
  await db.transaction('rw', [db.rounds, db.threads, db.threadMessages, db.messages, db.generatedAgents, db.sessionAgents, db.sessions], async () => {
    const rounds = await db.rounds.where('session_id').equals(id).toArray();
    const roundIds = rounds.map(r => r.id!);

    // Collect all thread IDs for batched threadMessage delete
    const allThreadIds: number[] = [];
    for (const rid of roundIds) {
      const threadIds = (await db.threads.where('round_id').equals(rid).toArray()).map(t => t.id!);
      allThreadIds.push(...threadIds);
    }
    if (allThreadIds.length > 0) {
      await db.threadMessages.where('thread_id').anyOf(allThreadIds).delete();
    }

    for (const rid of roundIds) {
      await db.threads.where('round_id').equals(rid).delete();
      await db.messages.where('round_id').equals(rid).delete();
    }
    await db.rounds.where('session_id').equals(id).delete();
    await db.sessionAgents.where('session_id').equals(id).delete();
    await db.generatedAgents.where('session_id').equals(id).delete();
    await db.sessions.delete(id);
  });
}

// SessionAgent helpers
export async function getSessionAgents(sessionId: number): Promise<SessionAgentRecord[]> {
  return db.sessionAgents.where('session_id').equals(sessionId).toArray();
}

// GeneratedAgent helpers
export async function listGeneratedAgents(sessionId: number): Promise<GeneratedAgentRecord[]> {
  return db.generatedAgents.where('session_id').equals(sessionId).toArray();
}

export async function getGeneratedAgent(id: number): Promise<GeneratedAgentRecord | undefined> {
  return db.generatedAgents.get(id);
}

export async function createGeneratedAgent(data: Omit<GeneratedAgentRecord, 'id' | 'created_at'>): Promise<number> {
  return db.generatedAgents.add({ ...data, created_at: new Date().toISOString() });
}

export async function updateGeneratedAgent(id: number, data: Partial<GeneratedAgentRecord>): Promise<void> {
  await db.generatedAgents.update(id, data);
}

export async function deleteGeneratedAgent(id: number): Promise<void> {
  await db.generatedAgents.delete(id);
}

export async function deleteGeneratedAgentsBySession(sessionId: number): Promise<void> {
  await db.generatedAgents.where('session_id').equals(sessionId).delete();
}

export async function createSessionWithGeneratedAgents(
  data: Omit<SessionRecord, 'id' | 'created_at'>,
  generatorAgentId: number,
  scribeAgentId: number,
  generatedAgents: Omit<GeneratedAgentRecord, 'id' | 'created_at' | 'session_id'>[],
): Promise<number> {
  return db.transaction('rw', db.sessions, db.sessionAgents, db.generatedAgents, async () => {
    const sid = await db.sessions.add({ ...data, created_at: new Date().toISOString() });
    const createdIds: number[] = [];
    for (const ga of generatedAgents) {
      const gaid = await db.generatedAgents.add({ ...ga, session_id: sid, created_at: new Date().toISOString() });
      createdIds.push(gaid);
    }
    const rows: SessionAgentRecord[] = [
      { session_id: sid, agent_id: scribeAgentId, is_scribe: true },
    ];
    rows.push(...createdIds.map(gaid => ({ session_id: sid, agent_id: generatorAgentId, generated_agent_id: gaid, is_scribe: false })));
    await db.sessionAgents.bulkAdd(rows);
    return sid;
  });
}

// Round helpers
export async function getRounds(sessionId: number): Promise<RoundRecord[]> {
  return db.rounds.where('session_id').equals(sessionId).sortBy('round_number');
}

export async function getRound(id: number): Promise<RoundRecord | undefined> {
  return db.rounds.get(id);
}

export async function getCurrentRound(sessionId: number, roundNumber: number): Promise<RoundRecord | undefined> {
  return db.rounds.where({ session_id: sessionId, round_number: roundNumber }).first();
}

export async function createRound(data: Omit<RoundRecord, 'id' | 'created_at'>): Promise<number> {
  return db.rounds.add({ ...data, created_at: new Date().toISOString() });
}

export async function updateRound(id: number, data: Partial<RoundRecord>): Promise<void> {
  await db.rounds.update(id, data);
}

// Message helpers
export async function getRoundMessages(roundId: number): Promise<MessageRecord[]> {
  return db.messages.where('round_id').equals(roundId).sortBy('created_at');
}

export async function createMessage(data: Omit<MessageRecord, 'id' | 'created_at'>): Promise<number> {
  return db.messages.add({ ...data, created_at: new Date().toISOString() });
}

export async function updateMessage(id: number, data: Partial<MessageRecord>): Promise<void> {
  await db.messages.update(id, data);
}

// Thread helpers
export async function getRoundThreads(roundId: number): Promise<ThreadRecord[]> {
  return db.threads.where('round_id').equals(roundId).toArray();
}

export async function createThread(data: Omit<ThreadRecord, 'id' | 'created_at'>): Promise<number> {
  return db.threads.add({ ...data, created_at: new Date().toISOString() });
}

// ThreadMessage helpers
export async function getThreadMessages(threadId: number): Promise<ThreadMessageRecord[]> {
  return db.threadMessages.where('thread_id').equals(threadId).sortBy('created_at');
}

export async function createThreadMessage(data: Omit<ThreadMessageRecord, 'id' | 'created_at'>): Promise<number> {
  return db.threadMessages.add({ ...data, created_at: new Date().toISOString() });
}

export async function updateThreadMessage(id: number, data: Partial<ThreadMessageRecord>): Promise<void> {
  await db.threadMessages.update(id, data);
}
