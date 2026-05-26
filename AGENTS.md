# Brainstorm — Multi-Agent Brainstorming

## Architecture

Three-tier: Browser ↔ Node.js Bridge ↔ LLM APIs. The bridge (`bridge/`, port 3001) is an Express server using `@earendil-works/pi-agent-core` — each brainstorming agent runs as a pi `Agent` instance with per-agent API config, skill isolation, and tool support. Old Python `backend/` is defunct (pre-migration, not tracked).

Frontend: React 18 + TypeScript + Vite. Data persists in IndexedDB via Dexie.js. Bridge API calls go through SSE streaming.

## Project Structure

```
frontend/
  src/
    db/           — Dexie instance (db.ts) + typed CRUD helpers (helpers.ts)
    llm/          — stream.ts (legacy direct-LLM wrapper), bridgeApi.ts (bridge SSE client),
                   prompt.ts (system prompt builder)
    search/       — web search: index.ts (router), duckduckgo.ts (built-in), custom.ts
    hooks/        — useSession.ts (all session/round/agent state management)
     pages/        — Dashboard (create session + generate/distill modes),
                    SessionView (round phases + summary sidebar),
                    LLMConfig (global LLM settings)
    components/   — ChatRoom, MessageBubble, AgentStatusBar, AgentAvatar,
                   RoundDivider, TopicInput, SearchIndicator, GeneratedAgentList
    types/        — TypeScript interfaces

bridge/
  src/
    index.js      — Express app (routes: /api/health, /api/room/*, /api/distill, /api/complete)
    roomManager.js— pi Agent room lifecycle (create, delete, get agents)
    agentSessionAdapter.js — wraps Agent from pi-agent-core with custom streamFn
    logger.js     — file-based JSON logger (logs/YYYY-MM-DD.log)
    routes/
      rooms.js    — POST /create, POST /:id/chat (SSE), DELETE /:id
      distill.js  — POST / (SSE) — nuwa-skill expert distillation
      complete.js — POST / — one-shot LLM completion (for generate mode)
    distill.js    — distillation logic (search experts → generate skill files)
    sse.js        — SSE send/setup helpers
  skills/         — nuwa-skill SKILL.md for distillation
  tests/          — Vitest (12 bridge tests)
```

## Key Commands

| Directory | Command | Description |
|-----------|---------|-------------|
| `frontend/` | `npm run dev` | Start Vite dev server (port 5173) |
| `frontend/` | `npm run build` | `tsc && vite build` — typecheck + bundle |
| `frontend/` | `npm run preview` | Preview production build |
| `bridge/`   | `npm start` | Start bridge server (port 3001) |
| `bridge/`   | `npm run dev` | Start with `--watch` |
| `bridge/`   | `npm test` | Run bridge test suite (Vitest) |
| `bridge/`   | `npm run test:watch` | Watch mode |

## Logging System

**`bridge/src/logger.js`** — file-based JSON logger. Writes to `bridge/logs/YYYY-MM-DD.log`, one JSON object per line.

Levels: DEBUG, INFO, WARN, ERROR. Namespaces: `route.distill`, `distill`, `distill.<expert-name>`.

Every log entry: `{ time, level, ns, msg, data? }`. API keys are masked via `logger.maskKey()`.

### Mandatory Rule

**All agent code changes (especially in bridge/ src/) MUST add appropriate logging.** Any new error path, API call, or processing step must be logged. This is non-negotiable — if a bug occurs and there are no logs to trace it, the implementation is considered incomplete.

### How to Use Logger

```js
import { logger } from './logger.js';

logger.info('namespace', 'human-readable message', { optionalData: 'any JSON' });
logger.warn('namespace', 'warning message', { reason: '...' });
logger.error('namespace', 'error message', { error: err.message, stack: err.stack });
logger.debug('namespace', 'debug detail', { variable: value });
```

**Namespacing convention**: use dot-separated hierarchy, e.g. `room.create`, `distill.search`, `distill.<expert-name>`. This makes `grep` filtering trivial.

**API keys**: always mask before logging — `logger.maskKey(rawKey)` returns `"sk-...abcd"`.

### How to View Logs

**Live tail** (while bridge is running):
```bash
cd bridge
Get-Content logs\2026-05-25.log -Wait
```

**Filter by level**:
```powershell
Select-String "ERROR" logs\2026-05-25.log | ForEach-Object { $_ | ConvertFrom-Json }
```

**Filter by namespace**:
```powershell
Select-String '"ns":"distill\.' logs\2026-05-25.log | ForEach-Object { $_ | ConvertFrom-Json }
```

**Post-mortem analysis** — load all lines into a queryable array:
```js
import { readFileSync } from 'fs';
const lines = readFileSync('logs/2026-05-25.log', 'utf-8').trim().split('\n').map(JSON.parse);
const distillErrors = lines.filter(l => l.level === 'ERROR' && l.ns.startsWith('distill'));
```

**Timeline reconstruction** — sort by time, trace a requestId through all namespaces:
```js
const reqLogs = lines.filter(l => l.data?.requestId === 'mpl8sirwgq4l');
reqLogs.forEach(l => console.log(l.time, l.level, l.ns, l.msg));
```

## Data Model (IndexedDB via Dexie)

**7 tables**: `sessions`, `sessionAgents`, `rounds`, `messages`, `threads`, `threadMessages`, `generatedAgents`. Schema in `frontend/src/db/db.ts`. The `agents` table is no longer used (replaced by global LLM config in localStorage).

Key details:
- `generatedAgents` — ephemeral agents generated per session (no API creds; use global LLM config)
- `sessionAgents` has `generated_agent_id` (nullable) + `is_scribe` index
- Global LLM config (`baseUrl`, `apiKey`, `modelName`) stored in localStorage key `brainstorm-llm-config`

## Session Lifecycle

1. **Configure global LLM** (baseUrl, apiKey, modelName in LLM 设置 page)
2. **Create session** → select topic + agent names (or use generate/distill modes)
3. **Enter initial context** → "Start Agent Discussion" (divergent phase — all agents stream in parallel via bridge SSE, all share the same global LLM config)
4. @mention agents for private follow-ups (threads)
5. **"End Round & Summarize"** → scribe generates round summary via bridge
6. **"Start Next Round"** → repeat
7. **"End Session"** → scribe synthesizes all round summaries into final report

Phases per round: Starting → Divergent (parallel streaming) → Mention (threads) → Ended (scribe summary).

## API Compatibility

LLM calls go to `{api_base_url}/chat/completions` with OpenAI-style payload (Bearer auth). The bridge abstracts this; per-agent API config is passed at room creation. Tested with OpenAI, DeepSeek, Anthropic via proxy, and local LLMs.

## Agent Behavior Rules

### Code tasks must follow the design→implement→verify pipeline

- **Design** (`docs/runtime/01-design.md`): clarify requirements, brainstorm, write plan, review plan
- **Implement** (`docs/runtime/02-implement.md`): TDD first, implement per plan, verify each step
- **Verify** (`docs/runtime/03-verify.md`): full tests, code review, completion checklist
- Pure info/QA tasks are exempt

### Required skills

| Skill | When to use |
|-------|-------------|
| **Brainstorming** | Before any design or feature work |
| **TDD** | Before any implementation (write tests first) |
| **Requesting Code Review** | Before declaring work complete |
| **Systematic Debugging** | On any bug or unexpected behavior |

### Localization notes

- Bridge tests: `cd bridge && npm test`
- Frontend build (typecheck): `cd frontend && npm run build` (`noUnusedLocals`/`noUnusedParameters` are **false**)
- API keys stored in IndexedDB (client-side, never sent to server)
- `respondingAgentId` removed from `useSession` — don't add back
- SSE streaming: events via `text_delta` event, data prefix `data: `, `[DONE]` signals stream end


## Docs

Architecture specs, plans, API docs, and testing documentation in `docs/superpowers/`:
- `specs/` — design docs for each feature
- `plans/` — implementation plans
- `api/` — bridge API reference
- `testing/` — testing guide

The `docs/runtime/` pipeline files (01-design.md, 02-implement.md, 03-verify.md) define the canonical workflow above.
