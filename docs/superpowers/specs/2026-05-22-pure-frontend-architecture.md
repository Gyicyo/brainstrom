# Pure Frontend Architecture

## Goal

Remove the Python FastAPI backend entirely. All agent LLM calls go directly from the browser. All data persists in IndexedDB (via Dexie.js). This eliminates the asyncio/anyio contention bug, simplifies debugging, and makes the project install-and-run with zero backend setup.

## Architecture

```
Before:  Browser → Vite proxy → FastAPI → SQLite → httpx → LLM endpoint
After:   Browser → fetch() → LLM endpoint
         Browser → IndexedDB (Dexie.js) → local persistent storage
```

## Data Layer

**Library**: Dexie.js (~10KB gzip, TypeScript-native, IndexedDB wrapper)

**Tables**:

```
agents:            ++id, name, personality, system_prompt, api_base_url, api_key, model_name, created_at
sessions:          ++id, topic, status, current_round, created_at
session_agents:    ++id, session_id, agent_id, is_scribe
rounds:            ++id, session_id, round_number, scribe_summary, created_at
messages:          ++id, round_id, agent_id?, is_human, content, created_at
threads:           ++id, round_id, agent_id, created_at
thread_messages:   ++id, thread_id, is_human, content, created_at
```

JSON export/import functions for backup.

## LLM Layer

**`src/llm/stream.ts`**: Single function `streamAgentResponse(agent, systemPrompt, maxTokens)` → `AsyncGenerator<string>`. Uses `fetch()` with `stream: true` + `ReadableStream` reader. Parses SSE chunks identical to the old Python `stream_agent()`.

**`src/llm/prompt.ts`**: `buildSystemPrompt(agent, context, task)` — string concatenation, identical logic to old `agent_proxy.py:build_system_prompt()`.

## Hook Layer (`useSession` rewrite)

All state management lives in `useSession`. Direct IndexedDB reads/writes. Direct LLM fetch calls.

### Divergent phase (Start Agent Discussion)

```
1. db.messages.bulkAdd(empty messages for each non-scribe agent)
2. For each message, launch streamAgentResponse() in a separate promise
3. Each token → setStreamingTokens() → MessageBubble re-renders
4. Agent done → db.messages.update(content) + clear streaming state
5. All done → refresh round detail from DB
```

State: `streamingTokens: Map<messageId, { status, content }>`

### @mention phase

```
1. db.threads.add() + db.thread_messages.add() for each mentioned agent
2. For each, streamAgentResponse() with thread-specific prompt
3. Token → streaming state → thread message updates live
4. Done → persist to IndexedDB
```

### Round end (Scribe)

Collect round messages → build summary prompt → `streamAgentResponse(scribeAgent, prompt)` → write scribe summary to `db.rounds.update()`.

### Session end (Final report)

Collect all round summaries → `streamAgentResponse(scribeAgent, synthesisPrompt)` → return report text.

## Files to Create

| File | Purpose |
|---|---|
| `frontend/src/db/db.ts` | Dexie instance + table definitions |
| `frontend/src/db/helpers.ts` | Typed CRUD helpers |
| `frontend/src/llm/stream.ts` | `fetch()` + ReadableStream streaming |
| `frontend/src/llm/prompt.ts` | `buildSystemPrompt()` |

## Files to Rewrite

| File | Change |
|---|---|
| `frontend/src/hooks/useSession.ts` | Complete rewrite — DB + direct LLM |
| `frontend/src/pages/Dashboard.tsx` | Replace REST calls with db helpers |
| `frontend/src/pages/AgentConfig.tsx` | Replace REST calls with db helpers |
| `frontend/src/pages/SessionView.tsx` | Minimal changes — hook interface stays the same |

## Files to Delete

- `backend/` entire directory
- `frontend/src/api/client.ts`

## Files to Modify

- `frontend/vite.config.ts` — remove `/api` proxy
- `frontend/src/components/ChatRoom.tsx` — if any remaining REST references
- `frontend/src/types/index.ts` — ensure types match

## Components (unchanged)

ChatRoom, MessageBubble, AgentStatusBar, AgentAvatar, RoundDivider keep the same props interface. They receive data through the same `RoundDetailType` shape — only the source changes from REST to IndexedDB.

## Verification

1. Start `cd frontend && npm run dev` — no backend needed
2. Create agents with valid API keys
3. Create session, start round → all agents stream tokens in parallel
4. @mention an agent → agent responds in thread
5. End round → scribe summary appears
6. End session → final report
7. Refresh page → all data persists
8. Export/import JSON backup
