# Pure Frontend Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Python FastAPI backend entirely. Agent LLM calls go directly from the browser via fetch(). All data persists in IndexedDB via Dexie.js.

**Architecture:** Browser → fetch() → LLM endpoint. Browser → Dexie.js → IndexedDB. No server-side code. The existing component tree (ChatRoom, MessageBubble, AgentStatusBar) keeps the same props interface — only data source changes.

**Tech Stack:** React 18, TypeScript, Vite, Dexie.js, react-markdown, react-router-dom

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `frontend/src/db/db.ts` | Create | Dexie instance + 7 table definitions |
| `frontend/src/db/helpers.ts` | Create | Typed CRUD helpers for all entities |
| `frontend/src/llm/stream.ts` | Create | `fetch()` + `ReadableStream` streaming + `callAgent` non-streaming |
| `frontend/src/llm/prompt.ts` | Create | `buildSystemPrompt()` + `buildDivergentContext()` + `buildScribePrompt()` |
| `frontend/src/hooks/useSession.ts` | Rewrite | All state logic: DB reads/writes + direct LLM calls |
| `frontend/src/pages/Dashboard.tsx` | Rewrite | Replace REST calls with db helpers |
| `frontend/src/pages/AgentConfig.tsx` | Rewrite | Replace REST calls with db helpers |
| `frontend/src/pages/SessionView.tsx` | Modify | Minor — remove dead REST dependency |
| `frontend/vite.config.ts` | Modify | Remove `/api` proxy |
| `frontend/src/api/client.ts` | Delete | No more REST API |
| `frontend/src/types/index.ts` | Modify | Add optional `id` for new entities, no other changes |
| `backend/` | Delete | Entire directory |

---

### Task 1: Install Dexie.js and scaffold DB layer

**Files:**
- Create: `frontend/src/db/db.ts`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Install Dexie.js**

Run: `cd frontend && npm install dexie`
Expected: dexie added to package.json

- [ ] **Step 2: Add optional id fields to types**

In `frontend/src/types/index.ts`, add `NewAgentInput` and `NewSessionInput` types for create operations (no `id` field):

```typescript
export interface NewAgentInput {
  name: string;
  personality: string;
  system_prompt: string;
  api_base_url: string;
  api_key: string;
  model_name: string;
  avatar_url: string;
}

export interface NewSessionInput {
  topic: string;
  status: string;
  current_round: number;
}
```

- [ ] **Step 3: Create Dexie database**

Write `frontend/src/db/db.ts`:

```typescript
import Dexie, { type Table } from 'dexie';

export interface AgentRecord {
  id?: number;
  name: string;
  personality: string;
  system_prompt: string;
  api_base_url: string;
  api_key: string;
  model_name: string;
  avatar_url: string;
  created_at: string;
}

export interface SessionRecord {
  id?: number;
  topic: string;
  status: string;
  current_round: number;
  created_at: string;
}

export interface SessionAgentRecord {
  id?: number;
  session_id: number;
  agent_id: number;
  is_scribe: boolean;
}

export interface RoundRecord {
  id?: number;
  session_id: number;
  round_number: number;
  scribe_summary: string;
  created_at: string;
}

export interface MessageRecord {
  id?: number;
  round_id: number;
  agent_id: number | null;
  is_human: boolean;
  content: string;
  created_at: string;
}

export interface ThreadRecord {
  id?: number;
  round_id: number;
  agent_id: number;
  created_at: string;
}

export interface ThreadMessageRecord {
  id?: number;
  thread_id: number;
  is_human: boolean;
  content: string;
  created_at: string;
}

class BrainstormDB extends Dexie {
  agents!: Table<AgentRecord, number>;
  sessions!: Table<SessionRecord, number>;
  sessionAgents!: Table<SessionAgentRecord, number>;
  rounds!: Table<RoundRecord, number>;
  messages!: Table<MessageRecord, number>;
  threads!: Table<ThreadRecord, number>;
  threadMessages!: Table<ThreadMessageRecord, number>;

  constructor() {
    super('brainstorm');
    this.version(1).stores({
      agents: '++id, name',
      sessions: '++id, status',
      sessionAgents: '++id, session_id, agent_id',
      rounds: '++id, session_id, round_number',
      messages: '++id, round_id, agent_id',
      threads: '++id, round_id, agent_id',
      threadMessages: '++id, thread_id',
    });
  }
}

export const db = new BrainstormDB();
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd frontend && npx --no tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd D:/brainstorm && git add frontend/src/db/db.ts frontend/src/types/index.ts frontend/package.json frontend/package-lock.json && git commit -m "feat: add Dexie.js database layer"
```

---

### Task 2: Create DB helpers

**Files:**
- Create: `frontend/src/db/helpers.ts`

- [ ] **Step 1: Write agent helpers**

Write `frontend/src/db/helpers.ts`:

```typescript
import { db } from './db';
import type { AgentRecord, SessionRecord, SessionAgentRecord, RoundRecord, MessageRecord, ThreadRecord, ThreadMessageRecord } from './db';

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
  const sid = await db.sessions.add({ ...data, created_at: new Date().toISOString() });
  const rows: SessionAgentRecord[] = agentIds.map(aid => ({
    session_id: sid,
    agent_id: aid,
    is_scribe: aid === scribeAgentId,
  }));
  await db.sessionAgents.bulkAdd(rows);
  return sid;
}

export async function updateSession(id: number, data: Partial<SessionRecord>): Promise<void> {
  await db.sessions.update(id, data);
}

export async function deleteSession(id: number): Promise<void> {
  const roundIds = (await db.rounds.where('session_id').equals(id).toArray()).map(r => r.id!);
  for (const rid of roundIds) {
    const threadIds = (await db.threads.where('round_id').equals(rid).toArray()).map(t => t.id!);
    for (const tid of threadIds) {
      await db.threadMessages.where('thread_id').equals(tid).delete();
    }
    await db.threads.where('round_id').equals(rid).delete();
    await db.messages.where('round_id').equals(rid).delete();
  }
  await db.rounds.where('session_id').equals(id).delete();
  await db.sessionAgents.where('session_id').equals(id).delete();
  await db.sessions.delete(id);
}

// SessionAgent helpers
export async function getSessionAgents(sessionId: number): Promise<SessionAgentRecord[]> {
  return db.sessionAgents.where('session_id').equals(sessionId).toArray();
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
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd frontend && npx --no tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd D:/brainstorm && git add frontend/src/db/helpers.ts && git commit -m "feat: add IndexedDB CRUD helpers"
```

---

### Task 3: Create LLM streaming layer

**Files:**
- Create: `frontend/src/llm/stream.ts`
- Create: `frontend/src/llm/prompt.ts`

- [ ] **Step 1: Write streaming function**

Write `frontend/src/llm/stream.ts`:

```typescript
import type { AgentRecord } from '../db/db';

export async function* streamAgentResponse(
  agent: AgentRecord,
  systemPrompt: string,
  maxTokens = 4096,
): AsyncGenerator<string, void, undefined> {
  const url = `${agent.api_base_url.replace(/\/$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: agent.model_name,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Please provide your response based on the instructions above.' },
      ],
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') return;
      try {
        const chunk = JSON.parse(payload);
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // skip unparseable chunks
      }
    }
  }
}

export async function callAgent(
  agent: AgentRecord,
  systemPrompt: string,
  maxTokens = 4096,
): Promise<string> {
  const url = `${agent.api_base_url.replace(/\/$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: agent.model_name,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Please provide your response based on the instructions above.' },
      ],
      max_tokens: maxTokens,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}
```

- [ ] **Step 2: Write prompt builder**

Write `frontend/src/llm/prompt.ts`:

```typescript
import type { AgentRecord, MessageRecord, RoundRecord, ThreadRecord, ThreadMessageRecord } from '../db/db';
import { getAgent } from '../db/helpers';

export function buildSystemPrompt(
  agent: AgentRecord,
  context: string,
  taskDescription: string,
): string {
  return [
    `You are ${agent.name}. ${agent.personality}`,
    `Your behavior instructions: ${agent.system_prompt}`,
    `## Current Context\n${context}`,
    `## Task\n${taskDescription}`,
  ].join('\n\n');
}

export async function buildDivergentContext(
  sessionId: number,
  roundNumber: number,
  roundId: number,
  getRoundMessagesFn: (rid: number) => Promise<MessageRecord[]>,
  getRoundsFn: (sid: number) => Promise<RoundRecord[]>,
  getRoundFn: (id: number) => Promise<RoundRecord | undefined>,
): Promise<string> {
  const parts: string[] = [];
  const rounds = await getRoundsFn(sessionId);

  // Initial message from round 1
  const firstRound = rounds.find(r => r.round_number === 1);
  if (firstRound) {
    const msgs = await getRoundMessagesFn(firstRound.id!);
    const humanMsg = msgs.find(m => m.is_human);
    if (humanMsg?.content) {
      parts.push(`## Initial Context\n${humanMsg.content}`);
    }
  }

  // Previous scribe summaries
  for (const r of rounds) {
    if (r.round_number < roundNumber && r.scribe_summary) {
      parts.push(`## Round ${r.round_number} Summary\n${r.scribe_summary}`);
    }
  }

  // Current round messages
  const currentMsgs = await getRoundMessagesFn(roundId);
  const msgLines: string[] = [];
  for (const m of currentMsgs) {
    if (m.is_human) {
      msgLines.push(`Human: ${m.content}`);
    } else if (m.content && m.agent_id != null) {
      const agent = await getAgent(m.agent_id);
      msgLines.push(`${agent?.name || 'Unknown'}: ${m.content}`);
    }
  }
  if (msgLines.length) {
    parts.push('## Current Discussion\n' + msgLines.join('\n'));
  }

  return parts.join('\n\n');
}

export function buildScribeSummaryPrompt(): string {
  return 'You are the scribe. Summarize the above discussion concisely, capturing the key points and disagreements. Be neutral and factual.';
}

export function buildScribeFinalPrompt(): string {
  return 'You are the scribe. Synthesize all round summaries below into a comprehensive final report. Identify themes, conclusions, and areas of disagreement.';
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd frontend && npx --no tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd D:/brainstorm && git add frontend/src/llm/ && git commit -m "feat: add LLM streaming layer (fetch + ReadableStream)"
```

---

### Task 4: Rewrite useSession hook

**Files:**
- Modify: `frontend/src/hooks/useSession.ts` (complete rewrite)

- [ ] **Step 1: Write the new useSession hook**

Replace the entire `frontend/src/hooks/useSession.ts` with:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getSession, getCurrentRound, getRoundMessages, getRoundThreads, getThreadMessages,
  getSessionAgents, getAgent, createRound, createMessage, updateMessage,
  updateRound, createThread, createThreadMessage, updateThreadMessage,
  getRounds, updateSession,
} from '../db/helpers';
import { db } from '../db/db';
import { streamAgentResponse, callAgent } from '../llm/stream';
import { buildSystemPrompt, buildDivergentContext } from '../llm/prompt';
import type { RoundDetailType, SessionType, RoundType, MessageType, ThreadType, ThreadMessageType } from '../types';
import type { AgentRecord } from '../db/db';

interface StreamingMap {
  [messageId: number]: {
    status: 'thinking' | 'streaming' | 'done' | 'error';
    content: string;
    error?: string;
  };
}

export function useSession(sessionId: number) {
  const [roundDetail, setRoundDetail] = useState<RoundDetailType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingTokens, setStreamingTokens] = useState<StreamingMap>({});
  const abortRef = useRef<AbortController | null>(null);

  const isStreaming = Object.values(streamingTokens).some(s => s.status === 'thinking' || s.status === 'streaming');
  const streamingAgentIds = new Set(
    Object.entries(streamingTokens)
      .filter(([_, s]) => s.status === 'thinking' || s.status === 'streaming')
      .map(([k]) => Number(k))
  );
  const streamContents = Object.fromEntries(
    Object.entries(streamingTokens).map(([k, s]) => [Number(k), s.content])
  );

  async function buildDetail(sid: number, roundNum: number): Promise<RoundDetailType | null> {
    const session = await getSession(sid);
    if (!session) return null;
    const round = await getCurrentRound(sid, roundNum);
    if (!round) return null;
    return buildRoundDetail(session, round);
  }

  async function buildRoundDetail(
    session: { id?: number; topic: string; status: string; current_round: number; created_at: string },
    round: { id?: number; session_id: number; round_number: number; scribe_summary: string; created_at: string },
  ): Promise<RoundDetailType> {
    const rid = round.id!;
    const sid = session.id!;

    const saRecords = await getSessionAgents(sid);
    const agentsAttached: { id: number; name: string; is_scribe: boolean }[] = [];
    for (const sa of saRecords) {
      const agent = await getAgent(sa.agent_id);
      if (agent) {
        agentsAttached.push({ id: agent.id!, name: agent.name, is_scribe: sa.is_scribe });
      }
    }

    const msgRecords = await getRoundMessages(rid);
    const publicMessages: MessageType[] = msgRecords.map(m => {
      const agent = agentsAttached.find(a => a.id === m.agent_id);
      return {
        id: m.id!,
        agent_id: m.agent_id,
        agent_name: agent?.name || '',
        is_human: m.is_human,
        content: m.content,
        created_at: m.created_at,
      };
    });

    const threadRecords = await getRoundThreads(rid);
    const privateThreads: ThreadType[] = [];
    for (const t of threadRecords) {
      const agent = agentsAttached.find(a => a.id === t.agent_id);
      const tmRecords = await getThreadMessages(t.id!);
      const tmList: ThreadMessageType[] = tmRecords.map(tm => ({
        id: tm.id!,
        is_human: tm.is_human,
        content: tm.content,
        created_at: tm.created_at,
      }));
      privateThreads.push({
        id: t.id!,
        agent_id: t.agent_id,
        agent_name: agent?.name || '',
        messages: tmList,
        created_at: t.created_at,
      });
    }

    return {
      session: {
        id: sid,
        topic: session.topic,
        status: session.status,
        current_round: session.current_round,
        created_at: session.created_at,
      },
      current_round: {
        id: rid,
        round_number: round.round_number,
        scribe_summary: round.scribe_summary || '',
        public_messages: publicMessages,
        private_threads: privateThreads,
        created_at: round.created_at,
      },
      agents_attached: agentsAttached,
    };
  }

  const load = useCallback(async () => {
    try {
      setError(null);
      const session = await getSession(sessionId);
      if (!session) { setRoundDetail(null); return; }
      const round = await getCurrentRound(sessionId, session.current_round);
      if (!round) { setRoundDetail(null); return; }
      setRoundDetail(await buildRoundDetail(session, round));
    } catch (e: any) {
      setRoundDetail(null);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const flushStreaming = useCallback((messageId: number) => {
    setStreamingTokens(prev => {
      const { [messageId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // Create round
  const handleCreateRound = async (initialMessage: string) => {
    setLoading(true);
    try {
      const session = await getSession(sessionId);
      if (!session) throw new Error('Session not found');

      const nextNum = session.current_round + 1;
      const rid = await createRound({ session_id: sessionId, round_number: nextNum, scribe_summary: '' });
      await updateSession(sessionId, { current_round: nextNum });

      if (initialMessage) {
        await createMessage({ round_id: rid, agent_id: null, is_human: true, content: initialMessage });
      }

      const detail = await buildDetail(sessionId, nextNum);
      setRoundDetail(detail);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  // Start divergent — parallel fetch() per agent
  const handleStartDivergent = async () => {
    if (!roundDetail) return;
    setLoading(true);
    setError(null);
    try {
      const roundId = roundDetail.current_round.id;
      const nonScribeAgents = roundDetail.agents_attached.filter(a => !a.is_scribe);

      // Create empty messages for each agent
      const messageIds: { agentId: number; messageId: number; agent: AgentRecord }[] = [];
      for (const a of nonScribeAgents) {
        const agent = await getAgent(a.id);
        if (!agent) continue;
        const mid = await createMessage({
          round_id: roundId,
          agent_id: a.id,
          is_human: false,
          content: '',
        });
        messageIds.push({ agentId: a.id, messageId: mid, agent });
      }

      // Refresh detail to show empty messages
      const freshDetail = await buildDetail(sessionId, roundDetail.current_round.round_number);
      setRoundDetail(freshDetail);

      // Build context
      const context = await buildDivergentContext(sessionId, roundDetail.current_round.round_number, roundId, getRoundMessages, getRounds, getRound);

      // Set all to 'thinking'
      const initTokens: StreamingMap = {};
      for (const { messageId } of messageIds) {
        initTokens[messageId] = { status: 'thinking', content: '' };
      }
      setStreamingTokens(initTokens);

      // Launch all in parallel
      const promises = messageIds.map(async ({ agentId, messageId, agent }) => {
        try {
          const prompt = buildSystemPrompt(
            agent,
            context,
            'Provide your unique perspective on this topic. Be creative and specific.',
          );
          let full = '';
          for await (const token of streamAgentResponse(agent, prompt)) {
            full += token;
            setStreamingTokens(prev => ({
              ...prev,
              [messageId]: { status: 'streaming', content: full },
            }));
          }
          await updateMessage(messageId, { content: full });
          setStreamingTokens(prev => ({
            ...prev,
            [messageId]: { status: 'done', content: full },
          }));
          flushStreaming(messageId);
        } catch (e: any) {
          setStreamingTokens(prev => ({
            ...prev,
            [messageId]: { status: 'error', content: '', error: e.message },
          }));
        }
      });

      await Promise.allSettled(promises);

      setLoading(false);
      load();
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  // @mention — now actually calls LLM
  const handleMention = async (agentIds: number[], question: string) => {
    if (!roundDetail || agentIds.length === 0) return;
    try {
      const roundId = roundDetail.current_round.id;
      const context = await buildDivergentContext(sessionId, roundDetail.current_round.round_number, roundId, getRoundMessages, getRounds, getRound);

      for (const agentId of agentIds) {
        const agent = await getAgent(agentId);
        if (!agent) continue;

        const tid = await createThread({ round_id: roundId, agent_id: agentId });
        await createThreadMessage({ thread_id: tid, is_human: true, content: question });
        const tmid = await createThreadMessage({ thread_id: tid, is_human: false, content: '' });

        const prompt = buildSystemPrompt(
          agent,
          context + `\n\n## Private Question\n${question}`,
          'Respond to the human\'s private question thoughtfully.',
        );

        // Stream agent response (non-blocking per agent, all in parallel)
        (async () => {
          try {
            let full = '';
            for await (const token of streamAgentResponse(agent, prompt)) {
              full += token;
              setStreamingTokens(prev => ({
                ...prev,
                [tmid]: { status: 'streaming', content: full },
              }));
            }
            await updateThreadMessage(tmid, { content: full });
            flushStreaming(tmid);
            load();
          } catch (e: any) {
            setStreamingTokens(prev => ({
              ...prev,
              [tmid]: { status: 'error', content: '', error: e.message },
            }));
          }
        })();
      }

      // Refresh to show threads immediately
      const freshDetail = await buildDetail(sessionId, roundDetail.current_round.round_number);
      setRoundDetail(freshDetail);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // End round — scribe summary
  const handleEndRound = async () => {
    if (!roundDetail) return;
    setLoading(true);
    try {
      const roundId = roundDetail.current_round.id;
      const scribeAgentInfo = roundDetail.agents_attached.find(a => a.is_scribe);
      if (!scribeAgentInfo) throw new Error('No scribe agent configured');

      const scribeAgent = await getAgent(scribeAgentInfo.id);
      if (!scribeAgent) throw new Error('Scribe agent not found');

      const messages = await getRoundMessages(roundId);
      const threads = await getRoundThreads(roundId);

      let discussionText = messages.map(m => {
        const name = m.is_human ? 'Human' : roundDetail.agents_attached.find(a => a.id === m.agent_id)?.name || 'Unknown';
        return `${name}: ${m.content}`;
      }).join('\n\n');

      for (const t of threads) {
        const tms = await getThreadMessages(t.id!);
        const agentName = roundDetail.agents_attached.find(a => a.id === t.agent_id)?.name || 'Unknown';
        discussionText += '\n\n' + tms.map(tm => {
          const name = tm.is_human ? 'Human' : agentName;
          return `${name}: ${tm.content}`;
        }).join('\n');
      }

      const prompt = buildSystemPrompt(scribeAgent, discussionText, 'Summarize this round of discussion concisely. Capture key points, agreements, and disagreements. Be neutral.');
      const summary = await callAgent(scribeAgent, prompt);

      await updateRound(roundId, { scribe_summary: summary });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  // End session — final report
  const handleEndSession = async () => {
    if (!roundDetail) return '';
    try {
      const scribeAgentInfo = roundDetail.agents_attached.find(a => a.is_scribe);
      if (!scribeAgentInfo) throw new Error('No scribe agent configured');

      const scribeAgent = await getAgent(scribeAgentInfo.id);
      if (!scribeAgent) throw new Error('Scribe agent not found');

      const rounds = await getRounds(sessionId);
      const summaries = rounds.filter(r => r.scribe_summary).map(r =>
        `## Round ${r.round_number}\n${r.scribe_summary}`
      ).join('\n\n');

      const prompt = buildSystemPrompt(scribeAgent, summaries, 'Synthesize all round summaries into a comprehensive final report. Identify themes, conclusions, and open questions.');
      const report = await callAgent(scribeAgent, prompt);

      await updateSession(sessionId, { status: 'completed' });
      return report;
    } catch (e: any) {
      setError(e.message);
      return '';
    }
  };

  const handleStartNextRound = async () => {
    await handleCreateRound('');
  };

  return {
    roundDetail, loading, error,
    streamingAgentIds, streamContents, isStreaming,
    handleCreateRound, handleStartDivergent, handleStartNextRound,
    handleEndRound, handleMention, handleEndSession,
  };
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd frontend && npx --no tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd D:/brainstorm && git add frontend/src/hooks/useSession.ts && git commit -m "feat: rewrite useSession with IndexedDB + direct LLM calls"
```

---

### Task 5: Rewrite Dashboard and AgentConfig pages

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Modify: `frontend/src/pages/AgentConfig.tsx`

- [ ] **Step 1: Rewrite Dashboard.tsx**

Replace imports and data functions in `frontend/src/pages/Dashboard.tsx`:

Change lines 1-3 from:
```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSessions, createSession, deleteSession, listAgents } from '../api/client'
```
To:
```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSessions, createSession, deleteSession, listAgents } from '../db/helpers'
```

Remove `type` from AgentType import (no longer needed for `createAgent` — but `listAgents` returns `AgentRecord[]` which has `id?: number`). The component already accesses `.id` which works. No other changes needed — the function signatures match.

- [ ] **Step 2: Rewrite AgentConfig.tsx**

Replace imports in `frontend/src/pages/AgentConfig.tsx`:

Change line 2 from:
```typescript
import { listAgents, createAgent, updateAgent, deleteAgent, testAgent } from '../api/client'
```
To:
```typescript
import { listAgents, createAgent, updateAgent, deleteAgent, getAgent } from '../db/helpers'
import { callAgent } from '../llm/stream'
import { buildSystemPrompt } from '../llm/prompt'
```

Remove `testAgent` from deconstruction since it no longer comes from a single source. Replace the `handleTest` function:

```typescript
const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const agent = await getAgent(id);
      if (!agent) throw new Error('Agent not found');
      const prompt = buildSystemPrompt(agent, 'The user is testing your connection. This is a test message.', 'Please respond with a short confirmation that your connection is working.');
      const response = await callAgent(agent, prompt, 256);
      setTestResult({
        success: true,
        message: response,
      });
    } catch (e: any) {
      setTestResult({ success: false, message: e.message });
    }
    setTestingId(null);
  };
```

Update `emptyForm` to remove `avatar_url` field since it's optional:
```typescript
const emptyForm = {
  name: '', personality: '', system_prompt: '',
  api_base_url: 'https://api.openai.com/v1', api_key: '', model_name: 'gpt-4o',
  avatar_url: '',
}
```

Update `handleSave`:
```typescript
const handleSave = async () => {
    if (!editing) return;
    try {
      if (editId) {
        await updateAgent(editId, editing);
      } else {
        await createAgent(editing as any);
      }
      setEditing(null);
      setEditId(null);
      load();
    } catch (e) { console.error(e); }
  };
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd frontend && npx --no tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd D:/brainstorm && git add frontend/src/pages/Dashboard.tsx frontend/src/pages/AgentConfig.tsx && git commit -m "feat: migrate Dashboard and AgentConfig to IndexedDB + direct LLM"
```

---

### Task 6: Update SessionView, remove api/client.ts, remove proxy

**Files:**
- Modify: `frontend/src/pages/SessionView.tsx`
- Modify: `frontend/vite.config.ts`
- Delete: `frontend/src/api/client.ts`

- [ ] **Step 1: Update SessionView.tsx**

Change line 4 from:
```typescript
import { endSession, deleteSession, fetchSummaries } from '../api/client'
```
To:
```typescript
import { deleteSession, getRounds } from '../db/helpers'
```

Replace `handleEndSession` to use hook's `handleEndSession`:
```typescript
const handleEndSession = async () => {
    if (!confirm('End this session and generate final report?')) return;
    try {
      const report = await hookHandleEndSession();
      alert(report || 'Final report generated.');
      navigate('/');
    } catch (e) {
      console.error(e);
    }
  };
```

Wait — we need `handleEndSession` from the hook. Add it to destructuring:
Currently line 42-47:
```typescript
const {
    roundDetail, respondingAgentId, loading, error,
    streamingAgentIds, streamContents, isStreaming,
    handleCreateRound, handleStartDivergent, handleStartNextRound,
    handleEndRound, handleMention,
  } = useSession(sessionId)
```
Change `respondingAgentId` is removed, `handleEndSession` is added:
```typescript
const {
    roundDetail, loading, error,
    streamingAgentIds, streamContents, isStreaming,
    handleCreateRound, handleStartDivergent, handleStartNextRound,
    handleEndRound, handleMention, handleEndSession,
  } = useSession(sessionId)
```

Replace `fetchSummaries` usage — no more REST call:
Change lines 52-56 from:
```typescript
useEffect(() => {
    if (sidebarOpen) {
      fetchSummaries(sessionId).then(setSummaries).catch(() => {})
    }
  }, [sidebarOpen, sessionId])
```
To:
```typescript
useEffect(() => {
    if (sidebarOpen) {
      getRounds(sessionId).then(rounds => {
        setSummaries(rounds.filter(r => r.scribe_summary).map(r => ({
          round_number: r.round_number,
          summary: r.scribe_summary,
          created_at: r.created_at,
        })))
      }).catch(() => {})
    }
  }, [sidebarOpen, sessionId])
```

Replace `endSession` with `handleEndSession` from hook:
```typescript
const handleEndSessionClick = async () => {
    if (!confirm('End this session and generate final report?')) return;
    try {
      const report = await handleEndSession();
      alert(report || 'Final report generated.');
      navigate('/');
    } catch (e) {
      console.error(e);
    }
  };
```

And update the button to use this new handler.

Remove the `respondingAgentId` prop from ChatRoom since it's no longer in useSession:

In ChatRoom props (line 180-193), remove `respondingAgentId`:
From `respondingAgentId={respondingAgentId}` to nothing (it's unused in ChatRoom now).

Also update `handleDelete`:
```typescript
const handleDelete = async () => {
    if (!confirm('Delete this session and all its data?')) return;
    try {
      await deleteSession(sessionId);
      navigate('/');
    } catch (e) {
      console.error(e);
    }
  };
```

Full updated SessionView.tsx — the key changes are in imports, hook destructuring, and data fetching. The JSX structure remains identical.

- [ ] **Step 2: Remove Vite proxy**

In `frontend/vite.config.ts`, remove the proxy block:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
})
```

- [ ] **Step 3: Delete api/client.ts**

```bash
rm D:/brainstorm/frontend/src/api/client.ts
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd frontend && npx --no tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd D:/brainstorm && git add frontend/src/pages/SessionView.tsx frontend/vite.config.ts && git rm frontend/src/api/client.ts && git commit -m "feat: remove REST client, proxy; SessionView uses db helpers"
```

---

### Task 7: Delete backend directory

**Files:**
- Delete: `backend/` (entire directory)

- [ ] **Step 1: Delete backend**

```bash
rm -rf D:/brainstorm/backend
```

- [ ] **Step 2: Commit**

```bash
cd D:/brainstorm && git add -A && git commit -m "feat: remove Python backend — fully frontend now"
```

---

### Task 8: End-to-end verification

- [ ] **Step 1: Install dependencies and start**

```bash
cd D:/brainstorm/frontend && npm install && npm run dev
```

- [ ] **Step 2: Test agent CRUD**

- Navigate to `/agents`
- Add an agent with real API credentials
- Click "Test" — should get a confirmation response
- Edit and delete agents

- [ ] **Step 3: Test full session flow**

- Create a session with 2+ agents + 1 scribe
- Enter initial context → click "Start Agent Discussion"
- Verify all agents stream tokens in parallel (thinking dots show, then content)
- @mention an agent — verify the agent responds in a thread
- End round — verify scribe summary
- Start next round, end round again
- End session — verify final report
- Refresh page — verify all data persists

- [ ] **Step 4: Commit any fixes**

If any issues found during verification, fix and commit.
