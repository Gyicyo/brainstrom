# Brainstorm — Multi-Agent Brainstorming

## Architecture

Pure frontend app (React 18 + TypeScript + Vite). No backend — data persists in IndexedDB via Dexie.js. LLM calls go directly from browser to OpenAI-compatible APIs via `fetch()`.

## Project Structure

```
frontend/
  src/
    db/           — Dexie instance (db.ts) + typed CRUD helpers (helpers.ts)
    llm/          — stream.ts (SSE streaming + non-streaming calls), prompt.ts (system prompt builder)
    hooks/        — useSession.ts (all session/round/agent state management)
    pages/        — Dashboard, SessionView, AgentConfig
    components/   — ChatRoom, MessageBubble, AgentStatusBar, AgentAvatar, RoundDivider, TopicInput
    types/        — TypeScript interfaces
```

## Key Commands (run from `frontend/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | `tsc && vite build` — both type-check and bundle |
| `npm run preview` | Preview production build |

No lint, test, or typecheck-only scripts exist. `npm run build` is the only verification.

## Data Model (IndexedDB via Dexie)

7 tables: `agents`, `sessions`, `sessionAgents`, `rounds`, `messages`, `threads`, `threadMessages`. Schema in `frontend/src/db/db.ts`.

## Session Lifecycle

1. Create agents with API credentials (OpenAI-compatible: `api_base_url` + `api_key` + `model_name`)
2. Create session → select participant agents + one scribe agent
3. Enter initial context → click "Start Agent Discussion" (divergent phase — all agents stream in parallel)
4. @mention agents for private follow-ups (threads)
5. "End Round & Summarize" → scribe generates round summary
6. "Start Next Round" → repeat
7. "End Session" → scribe synthesizes all round summaries into final report

## API Compatibility

LLM calls go to `{api_base_url}/chat/completions` with OpenAI-style payload (Bearer auth). Tested with OpenAI, Anthropic via proxy, and local LLMs.

## Docs

Architecture specs and implementation plans in `docs/superpowers/`. The `backend/` directory is defunct (pre-migration) and not tracked in git.

## Gotchas

- `noUnusedLocals` and `noUnusedParameters` are **false** in tsconfig — unused vars won't error
- API keys stored in IndexedDB (client-side only, never sent to any server)
- `respondingAgentId` removed from `useSession` — don't add it back
- `sessionAgents` index includes `is_scribe` field
- SSE streaming: chunks parsed via `data: ` prefix; `[DONE]` signals stream end
