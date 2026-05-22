# Streaming, Markdown, Context Accumulation & UX Improvements

## Overview

Six enhancements to the existing multi-agent brainstorming system: markdown rendering in chat bubbles, parallel agent streaming, truncation fix, multi-agent @mention, round summary sidebar, and accumulated context across rounds.

## Change 1: Markdown Rendering in Chat Bubbles

### Goal
Agent message content (which may include markdown formatting like headings, lists, code blocks) should render visually rather than as raw text.

### Implementation

**Dependencies added:** `react-markdown`, `remark-gfm`, `rehype-highlight`

**MessageBubble.tsx:**
- Replace plain-text `{displayContent}` rendering with `<ReactMarkdown>` in non-streaming mode
- During streaming (tokens still arriving), continue rendering as plain text to avoid re-parsing on every token
- On `agent_done` / content finalization, render through markdown pipeline

```tsx
// Streaming → plain text (avoid re-parsing each token)
{streamingContent !== undefined ? (
  displayContent || thinking_indicator
) : (
  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
    {message.content}
  </ReactMarkdown>
)}
```

**styles.css:**
- Import `highlight.js/github.css` theme
- Custom styles for `pre`, `code`, `p`, `ul`, `ol` inside `.message-content`

### Files Modified
- `frontend/src/components/MessageBubble.tsx`
- `frontend/src/styles.css`

---

## Change 2: Parallel Agent Streaming

### Goal
During divergent phase, all agents should stream their responses concurrently instead of sequentially — agents finish in parallel, tokens interleave in the SSE stream.

### Implementation

**Backend — `routers/rounds.py` `stream_divergent`:**
Replace the sequential `for agent in agent_tasks` loop with `asyncio.create_task` per agent + `asyncio.Queue` interleaving:

```
Agent task 1 ──┐
Agent task 2 ──┤──▶ asyncio.Queue ──▶ SSE generator
Agent task 3 ──┘
```

Each agent task:
1. Opens its own `SessionLocal()` DB session (no shared state → no conflicts)
2. Pushes events (`agent_start`, `token`, `agent_done`/`agent_error`) to a shared queue
3. On completion, pushes a sentinel to signal task end
4. Persists full content to its own DB session on completion

The SSE generator reads from the queue until all sentinels received, then emits `complete`.

**Key details:**
- Queue maxsize=100 to bound memory
- Each agent task has independent DB session + error boundary
- Tasks created with `asyncio.create_task`, tracked via sentinel counter
- Frontend already handles interleaved tokens via `streamContents[agent_id]` — zero frontend changes

### Files Modified
- `backend/routers/rounds.py`

---

## Change 3: Truncation Fix & max_tokens Increase

### Goal
Prevent agent responses from being cut off mid-generation.

### Root Cause
`max_tokens=1024` is too low for deep analytical responses. Some agents naturally write short replies (fit within 1024), others write longer analyses and get truncated with `finish_reason="length"`.

### Implementation

**`backend/services/agent_proxy.py`:**
- `max_tokens` default: 1024 → 4096 (both `call_agent` and `stream_agent`)
- `httpx.AsyncClient` timeout: 120s → 300s
- Track `finish_reason` from the last SSE chunk; log a warning if `finish_reason == "length"` (still truncated even at 4096)

### Files Modified
- `backend/services/agent_proxy.py`

---

## Change 4: Multi-Agent @mention + @All

### Goal
Support mentioning multiple agents simultaneously (or @all non-scribe agents) in a single follow-up. Each mentioned agent gets an independent private thread.

### Backend Changes

**`schemas.py`:**
```python
class MentionRequest(BaseModel):
    round_id: int
    agent_ids: list[int]   # was agent_id: int
    question: str
```

**`routers/rounds.py`:**
- Iterate `data.agent_ids`, create one `Thread` + one `ThreadMessage` per agent
- Skip invalid agent IDs (not found) without failing the batch

### Frontend Changes

**`client.ts`:**
- `mentionAgent` signature: `(sessionId, roundId, agentIds: number[], question)` — was `agentId: number`

**`ChatRoom.tsx`:**
- Replace single `<select>` with multi-select checkbox pills (same visual pattern as Dashboard agent picker)
- Add "@All" button → selects all non-scribe agents
- `selectedAgent: number | null` → `selectedAgentIds: number[]`

**`useSession.ts`:**
- `handleMention` signature: `(agentIds: number[], question)`

### Files Modified
- `backend/schemas.py`
- `backend/routers/rounds.py`
- `frontend/src/api/client.ts`
- `frontend/src/hooks/useSession.ts`
- `frontend/src/components/ChatRoom.tsx`
- `frontend/src/pages/SessionView.tsx` (if props change)

---

## Change 5: Left Sidebar — Round Summary History

### Goal
Provide persistent access to all previous rounds' scribe summaries via a collapsible left sidebar, so the human can review what was decided/concluded earlier.

### Backend

**`routers/rounds.py` — new endpoint:**
```python
GET /api/sessions/{session_id}/summaries
→ [{round_number, summary, created_at}, ...]
```
Filters to rounds with non-empty `scribe_summary`, ordered by round_number.

### Frontend

**`SessionView.tsx`:**
- Outer layout: `display: flex` with a left sidebar area
- Toggle button (☰) in top-left corner
- Sidebar width ~240px, slides in/out with CSS transition
- On expand: fetches `GET /api/sessions/{id}/summaries`
- Each entry: round number badge + date + first 100 chars of summary
- Click to expand full summary inline
- Styled with same primary-light background as scribe bubbles

### Files Modified
- `backend/routers/rounds.py` (new endpoint)
- `frontend/src/pages/SessionView.tsx`

---

## Change 6: Accumulated Context Across Rounds

### Goal
Each round's agents should see the full conversation history: session topic, user's initial message, all previous rounds' scribe summaries, and current round context. Currently only the current round's human message is included.

### Implementation

**`routers/rounds.py` — new helper `_build_divergent_context()`:**

1. **Session topic** — `session.topic`
2. **User's initial message** — first human message from round 1
3. **Previous round summaries** — all `scribe_summary` from rounds < current, ordered
4. **Current round messages** — human + agent messages so far

```python
def _build_divergent_context(session, db, round_obj) -> str:
    parts = []
    if session.topic:
        parts.append(f"## Session Topic\n{session.topic}")
    
    first_round = db.query(Round).filter(
        Round.session_id == session.id, Round.round_number == 1
    ).first()
    if first_round:
        initial_msg = db.query(Message).filter(
            Message.round_id == first_round.id, Message.is_human == True
        ).order_by(Message.created_at).first()
        if initial_msg:
            parts.append(f"## Initial Context\n{initial_msg.content}")
    
    prev_rounds = db.query(Round).filter(
        Round.session_id == session.id,
        Round.round_number < round_obj.round_number,
        Round.scribe_summary.isnot(None), Round.scribe_summary != "",
    ).order_by(Round.round_number).all()
    for pr in prev_rounds:
        parts.append(f"## Round {pr.round_number} Summary\n{pr.scribe_summary}")
    
    current_msgs = db.query(Message).filter(
        Message.round_id == round_obj.id
    ).order_by(Message.created_at).all()
    msg_lines = []
    for m in current_msgs:
        if m.is_human:
            msg_lines.append(f"Human: {m.content}")
        elif m.content:
            msg_lines.append(f"{m.agent.name}: {m.content}")
    if msg_lines:
        parts.append(f"## Current Discussion\n" + "\n".join(msg_lines))
    
    return "\n\n".join(parts)
```

Replace the simple context construction in `stream_divergent` with a call to this helper.

### Files Modified
- `backend/routers/rounds.py`

---

## Files Summary (Total: 9 files, 0 new)

| File | Changes |
|---|---|
| `backend/services/agent_proxy.py` | max_tokens 1024→4096, timeout 120s→300s, finish_reason logging |
| `backend/schemas.py` | MentionRequest.agent_ids list[int] |
| `backend/routers/rounds.py` | Parallel streaming, summaries endpoint, _build_divergent_context, @batch |
| `frontend/src/api/client.ts` | mentionAgent agentIds[] |
| `frontend/src/hooks/useSession.ts` | handleMention agentIds[] |
| `frontend/src/components/ChatRoom.tsx` | Multi-select @mention pills + @All button |
| `frontend/src/components/MessageBubble.tsx` | react-markdown rendering |
| `frontend/src/pages/SessionView.tsx` | Left sidebar with round summaries |
| `frontend/src/styles.css` | highlight.js theme + code styles + sidebar styles |

## Verification

1. `npx tsc --noEmit` — zero errors
2. Start backend + frontend
3. Create session with 3 agents, start discussion
4. Verify all three agents stream tokens concurrently (check timing)
5. Verify messages render markdown (bold, lists, code blocks with syntax highlighting)
6. Verify @mention multi-select works, @All selects all, each agent gets private thread
7. End round → verify summaries appear in left sidebar
8. Start next round → verify context includes previous summary (check agent sees it)
9. Verify no truncation on long responses (4096 tokens)
