# Pi Agent Backend Integration

> **Design document** — Replacing Brainstorm's direct LLM API calls with a Node.js bridge server powered by `@earendil-works/pi-agent-core`.

## Goal

Replace Brainstorm's current browser-to-LLM direct API calls with a Node.js bridge server that wraps pi's Agent SDK, enabling per-agent skill isolation, automatic context management, and integration with nuwa-skill generated personas.

## Architecture

```
Browser (React + Vite)         Node.js Bridge (port 3001)        LLM APIs
┌────────────────────┐   SSE   ┌─────────────────────────┐    ┌──────────┐
│  ChatRoom          │ ←──────→│  Express + pi Agent SDK │───→│ OpenAI   │
│  Dashboard         │ POST    │                         │    │ DeepSeek │
│  AgentConfig       │         │  @earendil-works/        │    │ Anthropic│
│                    │         │  pi-agent-core Agent     │    │ 本地 LLM │
│  IndexedDB (不变)   │         │  + custom streamFn       │    └──────────┘
│                    │         │  + search_web tool       │
│  stream.ts → bridge│         │  + nuwa-skill support    │
└────────────────────┘         └─────────────────────────┘
```

### Key Insight

Each brainstorming agent gets its own pi `Agent` instance with a custom `streamFn` that points at the agent's configured API endpoint (`api_base_url/chat/completions`). This bypasses pi's built-in model registry while keeping pi's agent loop (tool calls, retry, event streaming).

### Smart Cleanup Strategy

| Agent Type | Lifecycle | Cleanup Trigger |
|---|---|---|
| Search agent (find experts) | Long-lived singleton | N/A |
| Distill agents (nuwa-skill workers) | Ephemeral | Auto-deleted after skill generation completes |
| Discussion agents (participants) | Tied to discussion room | Discussion room deletion → pi session + skill files deleted |

## Directory Structure

```
D:\brainstorm\
├── frontend\                      # React code — minimal changes
├── bridge\                        # Node.js bridge server
│   ├── package.json
│   ├── index.js                   # Express entry point
│   ├── sessions\                  # All pi session persistence
│   │   └── room-{id}\             # One directory per discussion room
│   │       ├── meta.json          # Room metadata (topic, agent list)
│   │       ├── agents\            # Discussion agent sessions + skills
│   │       │   ├── {agent-name}\
│   │       │   │   ├── SKILL.md   # Nuwa-generated skill file
│   │       │   │   └── session.jsonl  # Pi session (context + memory)
│   │       │   └── ...
│   │       └── scribe\            # Scribe agent session
│   │           └── session.jsonl
│   └── .env                       # API keys etc.
└── run.bat                        # One-click start (bridge + frontend)
```

## Bridge API

### 1. Distill Experts from Topic

**`POST /api/distill`** → SSE stream

Initiates a multi-phase pipeline: search for relevant experts → concurrently run nuwa-skill on each → return generated skills.

**Request:**
```json
{
  "topic": "AI开源vs闭源的未来",
  "apiConfig": {
    "apiKey": "sk-...",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

**SSE Events:**
```
event: phase     data: { "phase": "search", "status": "..." }
event: phase     data: { "phase": "search_result", "experts": ["Andrej Karpathy", "Ilya Sutskever"] }
event: phase     data: { "phase": "distilling", "expert": "Andrej Karpathy", "progress": "1/3 采集公开资料..." }
event: phase     data: { "phase": "skill_ready", "expert": "Andrej Karpathy", "name": "karpathy" }
event: progress  data: { "done": 1, "total": 3 }
event: done      data: { "skills": ["karpathy", "ilya", "lecun"] }
```

**Distill agents** are created on demand and destroyed after skill generation completes. The **search agent** persists across requests (find expert uses it repeatedly).

### 2. Start Discussion Room

**`POST /api/room/create`**

```json
{
  "sessionId": 1,
  "topic": "AI开源vs闭源的未来",
  "agents": [
    {
      "name": "karpathy",
      "skillPath": "karpathy/SKILL.md",
      "apiConfig": { "apiKey": "...", "baseUrl": "...", "model": "..." }
    }
  ],
  "scribeApiConfig": { ... }
}
```

Creates `bridge/sessions/room-{sessionId}/agents/{name}/` with SKILL.md and initializes a pi AgentSession for each agent. Scribe gets its own session too.

### 3. Chat

**`POST /api/room/{sessionId}/chat`** → SSE stream

```json
{
  "agentName": "karpathy",
  "message": "我觉得开源模型才是未来"
}
```

Looks up the pi AgentSession for `karpathy` in `room-{sessionId}`, calls `session.prompt(message)`, streams `text_delta` events back.

Human messages (user inputs) are NOT sent to pi — they're stored in IndexedDB on the frontend side. Only agent responses flow through pi.

### 4. Scribe Summarize

**`POST /api/room/{sessionId}/summarize`** → SSE stream

```json
{
  "discussion": [
    { "name": "Karpathy", "content": "..." },
    { "name": "Ilya", "content": "..." }
  ]
}
```

Sends discussion transcript to the scribe's pi AgentSession → SSE stream of summary.

### 5. Resume Room

**`GET /api/room/{sessionId}/resume`**

Restores all pi AgentSessions from disk (`session.jsonl`). Each agent's memory and context is fully recovered.

### 6. Delete Room

**`DELETE /api/room/{sessionId}`**

Deletes `bridge/sessions/room-{sessionId}/` entirely — pi session files AND skill files. Called when user deletes a discussion room in the frontend.

## Frontend Changes

### `frontend/src/llm/stream.ts`

Replace direct `fetch` to LLM API with `fetch` to bridge. All existing callers (`useSession.ts`) stay the same — only the underlying transport changes.

- `streamAgentResponse()` → bridge SSE
- `streamAgentResponseWithTools()` → bridge SSE (tools handled by pi automatically)
- `callAgent()` → bridge POST
- `callAgentWithTools()` → bridge POST
- **New:** `distillExperts()` → bridge SSE with progress events (for Dashboard)

### `frontend/src/hooks/useSession.ts`

Simplify significantly:
- Remove the two-phase (tool check → stream) pattern
- Remove manual search execution
- Remove search result URL appending
- Agent loop (tool call → search → respond) handled by pi internally
- `searchStatus` state removed (no longer needed — pi handles search transparently)

### `frontend/src/pages/Dashboard.tsx`

Add distill-from-topic flow:
- User enters topic
- Shows real-time progress for each phase (search → distill → ready)
- User reviews generated experts, selects which to include
- Creates room with selected agents

### No Changes

- All UI components (ChatRoom, AgentConfig, etc.)
- IndexedDB schema and CRUD helpers
- Agent configuration page

## pi Integration Details

### Agent Lifecycle

```
Discussion room created
  └─ For each agent:
       ├─ Read SKILL.md → agent.state.systemPrompt
       ├─ Create pi Agent with custom streamFn → agent's API endpoint
       └─ Persist session.jsonl to bridge/sessions/room-{id}/agents/{name}/

User sends message
  └─ Bridge finds agent's pi AgentSession
  └─ session.prompt(message)
  └─ pi handles:
       ├─ LLM response (may call search_web tool)
       ├─ Tool execution (DuckDuckGo search)
       ├─ LLM final response with citations
       └─ Stream text_delta events via SSE

Room deleted
  └─ Delete bridge/sessions/room-{id}/ (sessions + skills)
```

### Custom streamFn

Each Brainstorm agent has a unique `api_base_url` + `api_key` + `model_name`. The bridge creates a custom `streamFn` for each:

```
streamFn(model, context, options) →
  fetch(`${agent.api_base_url}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agent.api_key}`, ... },
    body: { model: agent.model_name, messages: context, stream: true }
  })
```

This means pi's tool loop, retry, context management work — but the actual LLM call goes to the agent's own endpoint.

### Search Tool

Registered as a custom `AgentTool` on every discussion agent's pi instance. Uses DuckDuckGo (browserless search) or custom search API from the agent config.

## Cleanup Strategy

| Trigger | What gets deleted |
|---|---|
| Distill completes | Distill Agent sessions destroyed |
| Discussion room deleted | `bridge/sessions/room-{id}/` — all agent sessions + skill files |
| Bridge shutdown | No-op (persisted to disk, resume on next start) |
| Manual cleanup | `DELETE /api/room/{sessionId}` from frontend |

## Implementation Order

1. **Bridge server skeleton** — Express app, SSE utility, directory structure
2. **Custom streamFn** — pi Agent with agent-specific API endpoint
3. **Search tool** — DuckDuckGo integration as pi AgentTool
4. **Chat API** — /api/room/{id}/chat with SSE streaming
5. **Resume API** — pi session persistence and restoration
6. **Scribe/Summarize API** — summarize endpoint
7. **Distill API** — search experts + nuwa-skill pipeline with progress SSE
8. **Frontend stream.ts** — bridge client adapter
9. **Frontend useSession** — simplify, remove two-phase logic
10. **Dashboard distill flow** — progress UI, expert selection
11. **Delete/cleanup** — room deletion
12. **run.bat** — start both bridge and frontend
