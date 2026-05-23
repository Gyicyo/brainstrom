# Dynamic Agent Generation & Web Search for Brainstorm

## Motivation

Two feature additions to Brainstorm:

1. **Dynamic Agent Generation** — A session creator can skip manually selecting preset agents. Instead, an LLM generates session-specific agent definitions (name, role, system prompt) based on the discussion topic. Generated agents are ephemeral—scoped to the session.

2. **Web Search via Function Calling** — During divergent discussion, agents can autonomously search the web for current information via OpenAI-style `tool_calls`. A default DuckDuckGo provider is built in; users can configure a custom search API per agent.

---

## Data Model Changes

### New table: `generatedAgents` (Dexie)

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

- Indexed on `session_id` for lookups and cascade delete.
- No API credentials stored here — generated agents inherit the generator agent's API config at call time.
- The scribe is always the generator agent (preset) itself — generated agents are all participants.

### Modified table: `sessionAgents`

Extend `SessionAgentRecord` to support both preset and generated agents:

```typescript
export interface SessionAgentRecord {
  id?: number;
  session_id: number;
  agent_id: number;               // always set (preset agent id)
  generated_agent_id?: number;    // set when this slot is a generated agent
  is_scribe: boolean;
}
```

- When `generated_agent_id` is set, the agent profile (name/personality/prompt) comes from `generatedAgents` table, but API config comes from the generator agent (looked up via `agent_id`).
- Existing rows have `generated_agent_id = undefined` — backward compatible.
- For generated-agent sessions, `agent_id` points to the generator agent (which is also the scribe).

### Modified table: `agents` (preset)

Add optional search configuration:

```typescript
search_provider?: string;   // 'duckduckgo' (default) | 'custom'
search_api_key?: string;    // API key for custom search providers
search_api_url?: string;    // Custom search endpoint URL
```

Generated agents inherit search config from their generator/scribe agent.

### New module: `frontend/src/search/`

```
search/
  index.ts         — unified searchWeb(query) interface + provider dispatch
  duckduckgo.ts    — DuckDuckGo Lite API (default, no API key needed)
  custom.ts        — Generic search API adapter for user-configured providers
```

---

## UI Flow: Dynamic Agent Generation

### Dashboard — New Session (modified)

**Phase 1: Input form**

- Topic input (existing)
- Initial context textarea (existing)
- Generator agent selector — pick one preset agent (replaces multi-select agent picker + scribe selector)
- **[Generate Agents]** button

**Phase 2: Generated agent preview** (new component or expanded form)

- List of generated agents, each showing: name, personality/role preview, system prompt (collapsible)
- Per-agent: [Edit] inline edit, [Regenerate] re-generate single agent
- **[Regenerate All]** — re-call LLM with same topic
- Scribe badge on one agent (always present)
- **[Start Session]** — commits to DB, navigates to session view

### Existing create flow preserved

Users can still opt out of generation and manually select preset agents via a toggle or alternative tab.

### Generator LLM prompt

The generator agent receives:

```
You are {agent.name}. Generate {N} discussion agents for a brainstorming session.
Topic: {topic}
Initial context: {initialContext}

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

I (the generator) will serve as the scribe who summarizes discussions. Generated agents are all participants.
```

---

## UI Flow: Web Search

### During divergent phase

Agent messages flow through `streamAgentResponseWithTools()` instead of `streamAgentResponse()`.

Flow per agent:

1. Send LLM request with `search_web` tool definition
2. Stream response:
   - `type: 'content'` — update MessageBubble in real time
   - `type: 'tool_call'` — pause stream, hide from UI
3. Execute `searchWeb(query)` via selected provider
4. Send second LLM request (no tools) with search results as `tool` role message
5. Stream second response → update same MessageBubble
6. If no search results or search fails, proceed without (bubble shows a subtle "search failed" indicator)

### During @mention phase

Same mechanism. Additionally, mention input gets a 🌐 toggle button. When active, the agent prompt includes "Search the web to answer this question" and the tool call is prioritized.

### Tool definition

```json
{
  "type": "function",
  "function": {
    "name": "search_web",
    "description": "Search the web for current, up-to-date information",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "The search query"
        }
      },
      "required": ["query"]
    }
  }
}
```

---

## LLM Layer Changes

### `llm/stream.ts`

New exports:

```typescript
type StreamEvent =
  | { type: 'content'; text: string }
  | { type: 'tool_call'; name: string; arguments: Record<string, any> };

type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
};

export async function* streamAgentResponseWithTools(
  agent: AgentRecord,
  systemPrompt: string,
  tools: ToolDefinition[],
  maxTokens?: number,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, undefined>;

export async function callAgentWithTools(
  agent: AgentRecord,
  messages: { role: string; content: string; tool_call_id?: string }[],
  tools: ToolDefinition[],
  maxTokens?: number,
  signal?: AbortSignal,
): Promise<{ content: string; tool_calls?: any[] }>;
```

The SSE parser already handles `delta.tool_calls` — the new function just surfaces those as typed events instead of skipping them.

### `useSession.ts`

- `handleStartDivergent` — replace `streamAgentResponse` with `streamAgentResponseWithTools`; add the two-phase search loop
- `handleMention` — same replacement for @mention threads
- New internal state: `searchStatus: Record<agentId, { status: 'idle' | 'searching' | 'done' | 'failed'; query?: string }>` for per-agent search state UI
- Generated agent resolution: when a message's `agent_id` maps to a `generated_agent_id` (via `sessionAgents`), the runtime merges the agent profile from `generatedAgents` with API config from the generator agent

---

## Error Handling & Edge Cases

| Scenario | Handling |
|----------|----------|
| Generator LLM returns invalid JSON | Show raw response for debugging; offer [Retry] and [Edit Manually] |
| Search API fails/times out (3s timeout) | Skip search, agent proceeds without results; subtle "search unavailable" indicator on bubble |
| Agent calls search_web >3 times per round | Truncate after 3 calls; agent uses results already obtained |
| Model does not support function calling | `Test` button detects compatibility; non-compatible models skip search entirely |
| Session deletion | `generatedAgents` cascade-deleted via `session_id` index |
| No generator agent configured | Phase 1 form disables [Generate Agents] until generator is selected |

---

## Files Changed

| File | Action |
|------|--------|
| `frontend/src/db/db.ts` | Add `GeneratedAgentRecord` table, extend `SessionAgentRecord`, add search fields to `AgentRecord` |
| `frontend/src/db/helpers.ts` | Add CRUD for `generatedAgents`; update `createSession` for generated agents |
| `frontend/src/llm/stream.ts` | Add `streamAgentResponseWithTools`, `callAgentWithTools`, `ToolDefinition`, `StreamEvent` types |
| `frontend/src/llm/prompt.ts` | Add `buildGeneratorPrompt()` |
| `frontend/src/search/index.ts` | New — unified `searchWeb()` |
| `frontend/src/search/duckduckgo.ts` | New — DuckDuckGo provider |
| `frontend/src/search/custom.ts` | New — Custom search provider |
| `frontend/src/hooks/useSession.ts` | Integrate search into divergent/mention flows; generated agent resolution |
| `frontend/src/pages/Dashboard.tsx` | Two-phase create flow: input form → generate → preview → commit |
| `frontend/src/pages/AgentConfig.tsx` | Add search configuration fields |
| `frontend/src/components/GeneratedAgentList.tsx` | New — preview/edit generated agents |
| `frontend/src/components/SearchIndicator.tsx` | New — per-agent search status indicator |
| `frontend/src/types/index.ts` | Add `GeneratedAgentType` |
