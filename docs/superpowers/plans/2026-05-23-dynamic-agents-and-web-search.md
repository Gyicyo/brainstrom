# Dynamic Agent Generation & Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic agent generation from topic and web search via function calling.

**Architecture:** New `generatedAgents` Dexie table for session-scoped agent definitions. Search module with DuckDuckGo default + custom provider adapter. LLM stream layer extended with tool_calls support. Two-phase create flow in Dashboard.

**Tech Stack:** React 18, TypeScript, Vite, Dexie.js

---

## File Map

| File | Action |
|------|--------|
| `frontend/src/db/db.ts` | Add `GeneratedAgentRecord`, extend `SessionAgentRecord`, add search config to `AgentRecord` |
| `frontend/src/db/helpers.ts` | Add CRUD for `generatedAgents`; add `createSessionWithGeneratedAgents` |
| `frontend/src/search/index.ts` | New — `searchWeb(query)` + provider dispatch |
| `frontend/src/search/duckduckgo.ts` | New — DuckDuckGo search provider |
| `frontend/src/search/custom.ts` | New — custom search API adapter |
| `frontend/src/llm/stream.ts` | Add `ToolDefinition`, `streamAgentResponseWithTools`, `callAgentWithTools` |
| `frontend/src/llm/prompt.ts` | Add `buildGeneratorPrompt()` |
| `frontend/src/hooks/useSession.ts` | Generated agent resolution; search integration; `searchStatus` state |
| `frontend/src/pages/Dashboard.tsx` | Two-phase create flow: generate → preview → commit |
| `frontend/src/pages/AgentConfig.tsx` | Add search config fields |
| `frontend/src/pages/SessionView.tsx` | Pass `searchStatus` to ChatRoom |
| `frontend/src/components/GeneratedAgentList.tsx` | New — preview/edit generated agents |
| `frontend/src/components/SearchIndicator.tsx` | New — per-agent search status pill |
| `frontend/src/components/ChatRoom.tsx` | Display SearchIndicator per agent message |
| `frontend/src/types/index.ts` | Add `GeneratedAgentType` |

---

### Task 1: DB schema — generatedAgents table + helpers

**Files:**
- Modify: `frontend/src/db/db.ts`
- Modify: `frontend/src/db/helpers.ts`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add GeneratedAgentRecord, extend SessionAgentRecord, add search config**

In `frontend/src/db/db.ts`:

Add interface:
```typescript
export interface GeneratedAgentRecord {
  id?: number;
  session_id: number;
  name: string;
  personality: string;
  system_prompt: string;
  created_at: string;
}
```

Extend `SessionAgentRecord`:
```typescript
export interface SessionAgentRecord {
  id?: number;
  session_id: number;
  agent_id: number;
  generated_agent_id?: number;
  is_scribe: boolean;
}
```

Add search fields to `AgentRecord`:
```typescript
export interface AgentRecord {
  id?: number;
  name: string;
  personality: string;
  system_prompt: string;
  api_base_url: string;
  api_key: string;
  model_name: string;
  avatar_url: string;
  search_provider?: string;
  search_api_key?: string;
  search_api_url?: string;
  created_at: string;
}
```

Add table to class and bump version:
```typescript
class BrainstormDB extends Dexie {
  // ...existing tables...
  generatedAgents!: Table<GeneratedAgentRecord, number>;

  constructor() {
    super('brainstorm');
    this.version(2).stores({
      agents: '++id, name',
      sessions: '++id, status',
      sessionAgents: '++id, session_id, agent_id, is_scribe',
      rounds: '++id, [session_id+round_number]',
      messages: '++id, round_id, agent_id',
      threads: '++id, round_id, agent_id',
      threadMessages: '++id, thread_id',
      generatedAgents: '++id, session_id',
    });
  }
}
```

- [ ] **Step 2: Add GeneratedAgentType to types/index.ts**

```typescript
export interface GeneratedAgentType {
  id: number;
  session_id: number;
  name: string;
  personality: string;
  system_prompt: string;
  created_at: string;
}
```

- [ ] **Step 3: Add CRUD helpers in helpers.ts**

```typescript
import type { ..., GeneratedAgentRecord } from './db';

export async function getGeneratedAgents(sessionId: number): Promise<GeneratedAgentRecord[]> {
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

export async function deleteGeneratedAgentsBySession(sessionId: number): Promise<void> {
  const ids = (await db.generatedAgents.where('session_id').equals(sessionId).toArray()).map(a => a.id!);
  if (ids.length > 0) await db.generatedAgents.bulkDelete(ids);
}
```

In `deleteSession`, add cascade delete for generated agents inside the transaction:
```typescript
await db.generatedAgents.where('session_id').equals(id).delete();
```

Add `createSessionWithGeneratedAgents`:
```typescript
export async function createSessionWithGeneratedAgents(
  data: Omit<SessionRecord, 'id' | 'created_at'>,
  generatorAgentId: number,
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
      { session_id: sid, agent_id: generatorAgentId, is_scribe: true },
      ...createdIds.map(gaid => ({ session_id: sid, agent_id: generatorAgentId, generated_agent_id: gaid, is_scribe: false })),
    ];
    await db.sessionAgents.bulkAdd(rows);
    return sid;
  });
}
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd frontend && npx --no tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/db/db.ts frontend/src/db/helpers.ts frontend/src/types/index.ts
git commit -m "feat: add generatedAgents table and extend sessionAgents/agents schema"
```

---

### Task 2: Search module — DuckDuckGo + custom provider

**Files:**
- Create: `frontend/src/search/index.ts`
- Create: `frontend/src/search/duckduckgo.ts`
- Create: `frontend/src/search/custom.ts`

- [ ] **Step 1: index.ts — unified interface**

```typescript
export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export async function searchWeb(
  query: string,
  provider?: { type: 'duckduckgo' } | { type: 'custom'; apiKey: string; apiUrl: string },
): Promise<SearchResult[]> {
  if (!provider || provider.type === 'duckduckgo') {
    const { duckduckgoSearch } = await import('./duckduckgo');
    return duckduckgoSearch(query);
  }
  const { customSearch } = await import('./custom');
  return customSearch(query, provider.apiKey, provider.apiUrl);
}
```

- [ ] **Step 2: duckduckgo.ts**

```typescript
import type { SearchResult } from './index';

export async function duckduckgoSearch(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json();
  const results: SearchResult[] = [];
  if (data.AbstractText) {
    results.push({ title: data.Headline || 'Summary', snippet: data.AbstractText, url: data.AbstractURL || '' });
  }
  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics.slice(0, 8)) {
      if (topic.Text) results.push({ title: topic.Text.split(' - ')[0], snippet: topic.Text, url: topic.FirstURL || '' });
    }
  }
  return results;
}
```

- [ ] **Step 3: custom.ts**

```typescript
import type { SearchResult } from './index';

export async function customSearch(query: string, apiKey: string, apiUrl: string): Promise<SearchResult[]> {
  const sep = apiUrl.includes('?') ? '&' : '?';
  const url = `${apiUrl}${sep}q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    const items = data.items || data.results || data.organic_results || [];
    return items.slice(0, 8).map((item: any) => ({
      title: item.title || '',
      snippet: item.snippet || item.description || '',
      url: item.link || item.url || '',
    }));
  } catch { return []; }
}
```

- [ ] **Step 4: Verify + commit**

Run: `cd frontend && npx --no tsc --noEmit`

```bash
git add frontend/src/search/
git commit -m "feat: add search module with DuckDuckGo and custom provider"
```

---

### Task 3: LLM stream — tool calling support

**Files:**
- Modify: `frontend/src/llm/stream.ts`
- Modify: `frontend/src/llm/prompt.ts`

- [ ] **Step 1: Add types and functions to stream.ts**

Add types:
```typescript
export type StreamEvent =
  | { type: 'content'; text: string }
  | { type: 'tool_call'; name: string; arguments: Record<string, any> };

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
};
```

Add `streamAgentResponseWithTools` (same as `streamAgentResponse` but sends `tools` in body and yields `StreamEvent`):

```typescript
export async function* streamAgentResponseWithTools(
  agent: AgentRecord,
  systemPrompt: string,
  tools: ToolDefinition[],
  maxTokens = 4096,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, undefined> {
  const url = `${agent.api_base_url.replace(/\/$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${agent.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: agent.model_name,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Please provide your response based on the instructions above.' }],
      max_tokens: maxTokens, stream: true, tools,
    }),
    signal,
  });
  if (!resp.ok) { const text = await resp.text(); throw new Error(`API error ${resp.status}: ${text.slice(0, 200)}`); }
  if (!resp.body) throw new Error('Response body is empty');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
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
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) yield { type: 'content', text: delta.content };
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) yield { type: 'tool_call', name: tc.function.name, arguments: {} };
            }
          }
        } catch { /* skip */ }
      }
    }
  } finally { reader.cancel(); }
}
```

Add `callAgentWithTools` (non-streaming, returns tool_calls):

```typescript
export async function callAgentWithTools(
  agent: AgentRecord,
  messages: { role: string; content: string }[],
  tools: ToolDefinition[],
  maxTokens = 4096,
  signal?: AbortSignal,
): Promise<{ content: string; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] }> {
  const url = `${agent.api_base_url.replace(/\/$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${agent.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: agent.model_name, messages, max_tokens: maxTokens, tools }),
    signal,
  });
  if (!resp.ok) { const text = await resp.text(); throw new Error(`API error ${resp.status}: ${text.slice(0, 200)}`); }
  const data = await resp.json();
  const choice = data.choices?.[0];
  return { content: choice?.message?.content || '', tool_calls: choice?.message?.tool_calls };
}
```

- [ ] **Step 2: Add generator prompt to prompt.ts**

```typescript
export function buildGeneratorPrompt(
  generatorName: string,
  topic: string,
  initialContext: string,
  count: number,
): string {
  return `You are ${generatorName}. Generate ${count} discussion agents for a brainstorming session.
Topic: ${topic}
Initial context: ${initialContext}

For each agent provide:
- name: Role name
- personality: One-sentence role description
- system_prompt: Detailed instruction prompt for this role

Respond in this JSON format:
{
  "agents": [
    { "name": "...", "personality": "...", "system_prompt": "..." }
  ]
}

I (the generator) will serve as the scribe who summarizes discussions. Generated agents are all participants.`;
}
```

- [ ] **Step 3: Verify + commit**

Run: `cd frontend && npx --no tsc --noEmit`

```bash
git add frontend/src/llm/stream.ts frontend/src/llm/prompt.ts
git commit -m "feat: add tool calling support to LLM layer and generator prompt"
```

---

### Task 4: GeneratedAgentList component

**Files:**
- Create: `frontend/src/components/GeneratedAgentList.tsx`

- [ ] **Step 1: Create component**

```typescript
import { useState } from 'react'

interface GeneratedAgent {
  name: string
  personality: string
  system_prompt: string
}

interface Props {
  agents: GeneratedAgent[]
  loading: boolean
  onEdit: (index: number, updates: Partial<GeneratedAgent>) => void
  onRegenerate: (index: number) => void
  onRegenerateAll: () => void
  onStart: () => void
}

export default function GeneratedAgentList({
  agents, loading, onEdit, onRegenerate, onRegenerateAll, onStart,
}: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Generated Agents ({agents.length})</h3>
        <button onClick={onRegenerateAll} disabled={loading}
          style={{
            padding: '6px 16px', background: loading ? '#D1D5DB' : 'var(--bg)',
            color: 'var(--text-secondary)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 500,
          }}>
          {loading ? 'Generating...' : 'Regenerate All'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {agents.map((agent, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <input value={agent.name} onChange={e => onEdit(i, { name: e.target.value })}
                  style={{ fontWeight: 600, fontSize: 15, border: 'none', background: 'transparent', outline: 'none', width: '100%', color: 'var(--text-primary)' }} />
                <textarea value={agent.personality} onChange={e => onEdit(i, { personality: e.target.value })}
                  rows={1} style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, border: 'none', background: 'transparent', outline: 'none', width: '100%', resize: 'none', fontFamily: 'inherit' }} />
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                <button onClick={() => onRegenerate(i)} disabled={loading}
                  style={{ padding: '4px 10px', background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 12, opacity: loading ? 0.5 : 1 }}>
                  Regenerate
                </button>
                <button onClick={() => setExpanded(prev => ({ ...prev, [i]: !prev[i] }))}
                  style={{ padding: '4px 10px', background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12 }}>
                  {expanded[i] ? '▲ Hide Prompt' : '▼ Show Prompt'}
                </button>
              </div>
            </div>
            {expanded[i] && (
              <textarea value={agent.system_prompt} onChange={e => onEdit(i, { system_prompt: e.target.value })}
                rows={4} style={{ marginTop: 8, width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'monospace', outline: 'none', background: 'var(--bg)', resize: 'vertical' }} />
            )}
          </div>
        ))}
      </div>

      <button onClick={onStart} disabled={loading || agents.length === 0}
        style={{ padding: '10px 28px', width: '100%', background: loading || agents.length === 0 ? '#D1D5DB' : 'var(--primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: loading || agents.length === 0 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500 }}>
        {loading ? 'Generating...' : 'Start Session'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify + commit**

Run: `cd frontend && npx --no tsc --noEmit`

```bash
git add frontend/src/components/GeneratedAgentList.tsx
git commit -m "feat: add GeneratedAgentList component for preview/edit"
```

---

### Task 5: Dashboard — two-phase create flow

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Add imports and state**

Add imports:
```typescript
import { getAgent, createSessionWithGeneratedAgents } from '../db/helpers'
import { callAgent } from '../llm/stream'
import { buildGeneratorPrompt } from '../llm/prompt'
import GeneratedAgentList from '../components/GeneratedAgentList'
```

Add state inside the component:
```typescript
const [createMode, setCreateMode] = useState<'manual' | 'generate'>('manual')
const [initialContext, setInitialContext] = useState('')
const [generatorAgentId, setGeneratorAgentId] = useState<number | null>(null)
const [generating, setGenerating] = useState(false)
const [generatedAgents, setGeneratedAgents] = useState<{ name: string; personality: string; system_prompt: string }[]>([])
const [agentCount, setAgentCount] = useState(3)
```

- [ ] **Step 2: Add handlers**

```typescript
const handleGenerateAgents = async () => {
  if (!topic.trim() || !initialContext.trim() || generatorAgentId === null) return
  setGenerating(true)
  setError(null)
  try {
    const agent = await getAgent(generatorAgentId)
    if (!agent) throw new Error('Generator agent not found')
    const prompt = buildGeneratorPrompt(agent.name, topic, initialContext, agentCount)
    const response = await callAgent(agent, prompt, 4096)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Invalid response format from generator LLM')
    const data = JSON.parse(jsonMatch[0])
    if (!Array.isArray(data.agents) || data.agents.length === 0) throw new Error('No agents generated')
    setGeneratedAgents(data.agents)
  } catch (e: any) { setError(e.message); setGeneratedAgents([]) }
  setGenerating(false)
}

const handleStartWithGenerated = async () => {
  if (generatorAgentId === null) return
  setLoading(true)
  try {
    const sid = await createSessionWithGeneratedAgents(
      { topic, status: 'active', current_round: 0 },
      generatorAgentId,
      generatedAgents,
    )
    navigate(`/session/${sid}`)
  } catch (e: any) { setError(e.message) }
  setLoading(false)
}
```

- [ ] **Step 3: Add mode toggle UI and generate-form JSX**

Inside the create form section (before the existing agent selection), add a mode toggle:

```typescript
<div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
  <button onClick={() => { setCreateMode('manual'); setGeneratedAgents([]) }}
    style={{ padding: '6px 16px', borderRadius: 'var(--radius-full)', background: createMode === 'manual' ? 'var(--primary)' : 'var(--bg)', color: createMode === 'manual' ? '#fff' : 'var(--text-primary)', border: createMode === 'manual' ? 'none' : '1px solid var(--border)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
    Manual Selection
  </button>
  <button onClick={() => setCreateMode('generate')}
    style={{ padding: '6px 16px', borderRadius: 'var(--radius-full)', background: createMode === 'generate' ? 'var(--primary)' : 'var(--bg)', color: createMode === 'generate' ? '#fff' : 'var(--text-primary)', border: createMode === 'generate' ? 'none' : '1px solid var(--border)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
    Generate from Topic
  </button>
</div>
```

When `createMode === 'generate'`:
- If `generatedAgents.length === 0`: show topic input, initial context textarea, generator agent selector (from `agents` list), agent count input, and a **[Generate Agents]** button
- If `generatedAgents.length > 0`: show `<GeneratedAgentList>` component instead of the manual form
- When `generatedAgents.length > 0`, "Cancel" and the existing create button should be hidden; the GeneratedAgentList's "Start Session" button triggers `handleStartWithGenerated`

- [ ] **Step 4: Verify + commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat: add two-phase create flow with agent generation from topic"
```

---

### Task 6: useSession — generated agent resolution + search integration

**Files:**
- Modify: `frontend/src/hooks/useSession.ts`

Key design:
- `sessionAgents.agent_id` always points to the generator agent for generated rows
- `sessionAgents.generated_agent_id` points to the `generatedAgents` row
- `buildRoundDetail` resolves names from both `agents` and `generatedAgents` tables
- A helper `resolveAgentForLLMCall` maps generated agent IDs to the generator's `AgentRecord` (which has the API config)

- [ ] **Step 1: Extend buildRoundDetail to resolve generated agents**

Replace the `agents_attached` building block:

```typescript
const saRecords = await getSessionAgents(sid);
const saAgentIds = [...new Set(saRecords.map(sa => sa.agent_id))];
const saAgents = saAgentIds.length > 0 ? await db.agents.bulkGet(saAgentIds) : [];
const saAgentMap = new Map(saAgents.filter(Boolean).map(a => [a!.id!, a!]));
const generatedAgentIds = saRecords.filter(sa => sa.generated_agent_id != null).map(sa => sa.generated_agent_id!);
const genAgents = generatedAgentIds.length > 0 ? await db.generatedAgents.bulkGet(generatedAgentIds) : [];
const genAgentMap = new Map(genAgents.filter(Boolean).map(a => [a!.id!, a!]));
const agentsAttached: { id: number; name: string; is_scribe: boolean }[] = [];
for (const sa of saRecords) {
  if (sa.generated_agent_id != null) {
    const genAgent = genAgentMap.get(sa.generated_agent_id);
    if (genAgent) agentsAttached.push({ id: genAgent.id!, name: genAgent.name, is_scribe: sa.is_scribe });
  } else {
    const agent = saAgentMap.get(sa.agent_id);
    if (agent) agentsAttached.push({ id: agent.id!, name: agent.name, is_scribe: sa.is_scribe });
  }
}
```

Note: The `RoundDetailType.agents_attached` type stays `{ id: number; name: string; is_scribe: boolean }[]`.

- [ ] **Step 2: Add resolveAgentForLLMCall helper**

Inside `useSession`, before the handler functions:

```typescript
async function resolveAgentForLLMCall(
  agentInfo: { id: number; name: string; is_scribe: boolean },
): Promise<AgentRecord | undefined> {
  const saRecords = await getSessionAgents(sessionId);
  const sa = saRecords.find(s => s.generated_agent_id === agentInfo.id);
  if (sa) return getAgent(sa.agent_id); // generated → return generator agent
  return getAgent(agentInfo.id); // preset → return itself
}
```

- [ ] **Step 3: Update handleStartDivergent with search + generated agent support**

Replace `const agent = await getAgent(a.id)` with `const agent = await resolveAgentForLLMCall(a)`.

Replace the streaming loop with a two-phase search flow. After building the prompt but before streaming, add:

```typescript
const searchToolDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_web',
    description: 'Search the web for current, up-to-date information',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query' } },
      required: ['query'],
    },
  },
};

// Phase 1: Non-streaming call with tools to check for search intent
const { tool_calls } = await callAgentWithTools(
  agent,
  [{ role: 'system', content: prompt }, { role: 'user', content: 'Please provide your response based on the instructions above.' }],
  [searchToolDef],
  4096,
  abortController.signal,
);

let augmentedPrompt = prompt;
if (tool_calls && tool_calls.length > 0) {
  setSearchStatus(prev => ({ ...prev, [agentId]: { status: 'searching', query: '' } }));
  for (const tc of tool_calls) {
    try {
      const args = JSON.parse(tc.function.arguments);
      const query = args.query || '';
      setSearchStatus(prev => ({ ...prev, [agentId]: { status: 'searching', query } }));
      const provider = agent.search_provider
        ? { type: agent.search_provider as 'duckduckgo' | 'custom', apiKey: agent.search_api_key || '', apiUrl: agent.search_api_url || '' }
        : undefined;
      const results = await searchWeb(query, provider);
      const resultsText = results.map(r => `- ${r.title}: ${r.snippet} (${r.url})`).join('\n');
      augmentedPrompt = prompt + `\n\n## Web Search Results for "${query}"\n${resultsText || '(No results found)'}`;
    } catch { /* search failed — proceed without */ }
  }
  setSearchStatus(prev => ({ ...prev, [agentId]: { status: 'done', query: '' } }));
}

// Phase 2: Stream final response (no tools, content-only)
let full = '';
for await (const token of streamAgentResponse(agent, augmentedPrompt, 4096, abortController.signal)) {
  full += token;
  setStreamContents(prev => ({ ...prev, [agentId]: full }));
}
```

- [ ] **Step 4: Add searchStatus state to useSession**

Add state alongside existing state:
```typescript
const [searchStatus, setSearchStatus] = useState<Record<number, { status: string; query?: string }>>({})
```

Add `searchStatus` to the return object:
```typescript
return {
  roundDetail, respondingAgentId, loading, error,
  streamingAgentIds, streamContents, isStreaming, searchStatus,
  handleCreateRound, handleStartDivergent, handleStartNextRound,
  handleEndRound, handleMention, handleEndSession,
  handleDeleteSession, fetchSummaries,
}
```

- [ ] **Step 5: Update handleMention and handleEndRound similarly**

In `handleMention`: replace `const agent = await getAgent(agentId)` with `resolveAgentForLLMCall` and add the same two-phase search loop.

In `handleEndRound`: replace `getAgent(scribeAgentInfo.id)` with `resolveAgentForLLMCall` (no search needed for scribe summaries).

In `handleEndSession`: same as handleEndRound.

- [ ] **Step 6: Verify + commit**

Run: `cd frontend && npx --no tsc --noEmit`

```bash
git add frontend/src/hooks/useSession.ts
git commit -m "feat: integrate generated agent resolution and web search into useSession"
```

---

### Task 7: SearchIndicator component + ChatRoom display

**Files:**
- Create: `frontend/src/components/SearchIndicator.tsx`
- Modify: `frontend/src/components/ChatRoom.tsx`

- [ ] **Step 1: Create SearchIndicator**

```typescript
interface Props {
  searchStatus?: { status: 'idle' | 'searching' | 'done' | 'failed'; query?: string }
}

export default function SearchIndicator({ searchStatus }: Props) {
  if (!searchStatus || searchStatus.status === 'idle') return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 'var(--radius)',
      background: searchStatus.status === 'searching' ? '#FEF3C7' : '#F3F4F6',
      fontSize: 11, color: searchStatus.status === 'searching' ? '#92400E' : '#6B7280',
      marginLeft: 6,
    }}>
      {searchStatus.status === 'searching' && <>🔍 Searching{searchStatus.query ? `: "${searchStatus.query.slice(0, 40)}..."` : ''}</>}
      {searchStatus.status === 'done' && '🌐 Searched'}
      {searchStatus.status === 'failed' && '🌐 Search unavailable'}
    </span>
  )
}
```

- [ ] **Step 2: Integrate into ChatRoom**

Add `searchStatus` prop to ChatRoom's `Props` interface:
```typescript
searchStatus?: Record<number, { status: string; query?: string }>
```

In the message rendering area, add the indicator next to agent names. The simplest place is near the agent name display in `MessageBubble` — render it as a sibling of the timestamp line.

In `ChatRoom`, add import and pass `searchStatus` into the context (or render it inline):

```typescript
import SearchIndicator from './SearchIndicator'
```

- [ ] **Step 3: Verify + commit**

```bash
git add frontend/src/components/SearchIndicator.tsx frontend/src/components/ChatRoom.tsx
git commit -m "feat: add SearchIndicator component and integrate into ChatRoom"
```

---

### Task 8: AgentConfig — search configuration fields

**Files:**
- Modify: `frontend/src/pages/AgentConfig.tsx`

- [ ] **Step 1: Add search config to edit form**

After the model name input in the agent edit form, add:

```typescript
<span style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Web Search</span>
<select value={editing.search_provider || 'duckduckgo'} onChange={e => setEditing({ ...editing, search_provider: e.target.value })}
  style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }}>
  <option value="duckduckgo">DuckDuckGo (default, no API key)</option>
  <option value="custom">Custom Search API</option>
</select>
{editing.search_provider === 'custom' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <input placeholder="Search API URL" value={editing.search_api_url || ''}
      onChange={e => setEditing({ ...editing, search_api_url: e.target.value })}
      style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }} />
    <input placeholder="Search API Key" type="password" value={editing.search_api_key || ''}
      onChange={e => setEditing({ ...editing, search_api_key: e.target.value })}
      style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }} />
  </div>
)}
```

Update `emptyForm`:
```typescript
const emptyForm = {
  name: '', personality: '', system_prompt: '',
  api_base_url: 'https://api.openai.com/v1', api_key: '', model_name: 'gpt-4o',
  avatar_url: '', search_provider: 'duckduckgo', search_api_key: '', search_api_url: '',
}
```

- [ ] **Step 2: Verify + commit**

```bash
git add frontend/src/pages/AgentConfig.tsx
git commit -m "feat: add search configuration fields to agent config form"
```

---

### Task 9: SessionView — pass searchStatus to ChatRoom

**Files:**
- Modify: `frontend/src/pages/SessionView.tsx`

- [ ] **Step 1: Pass searchStatus through**

If `useSession` already returns `searchStatus` (from Task 6), destructure it:
```typescript
const {
  roundDetail, loading, error,
  streamingAgentIds, streamContents, isStreaming, searchStatus,
  handleCreateRound, handleStartDivergent, handleStartNextRound,
  handleEndRound, handleMention, handleEndSession,
  handleDeleteSession, fetchSummaries,
} = useSession(sessionId)
```

Pass to ChatRoom:
```typescript
<ChatRoom
  roundDetail={roundDetail}
  onSendMention={handleMention}
  onCreateRound={handleCreateRound}
  onStartDivergent={handleStartDivergent}
  onStartNextRound={handleStartNextRound}
  onEndRound={handleEndRound}
  respondingAgentId={respondingAgentId}
  loading={loading}
  streamingAgentIds={streamingAgentIds}
  streamContents={streamContents}
  isStreaming={isStreaming}
  searchStatus={searchStatus}
/>
```

- [ ] **Step 2: Verify + commit**

```bash
git add frontend/src/pages/SessionView.tsx
git commit -m "feat: pass search status from hook to ChatRoom"
```

---

### Task 10: Build verification

- [ ] **Step 1: Full build**

Run: `cd frontend && npm run build`
Expected: `tsc` exits with no errors, `vite build` produces `dist/`

- [ ] **Step 2: Fix any compilation errors**

Common issues:
- Missing Dexie version migration for existing data — Dexie handles this automatically for additive schema changes
- Missing imports in helpers.ts
- Type mismatches from extending SessionAgentRecord — all existing code uses `session_id`, `agent_id`, `is_scribe` which are unchanged

- [ ] **Step 3: Commit final fixes**

```bash
git add -A
git commit -m "fix: post-build fixes for generatedAgents and search integration"
```
