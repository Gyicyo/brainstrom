# Six Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement 6 enhancements: Markdown rendering, parallel streaming, truncation fix, multi-agent @mention, summaries sidebar, accumulated context.

**Architecture:** Backend changes in `agent_proxy.py` (max_tokens/timeout), `schemas.py` (MentionRequest), and `rounds.py` (parallel SSE, batch @mention, context builder, summaries endpoint). Frontend changes in `MessageBubble` (react-markdown), `ChatRoom` (multi-select pills), `SessionView` (sidebar), `useSession`/`client.ts` (signature updates), and `styles.css`.

**Tech Stack:** Python FastAPI, React 18 + TypeScript, react-markdown + rehype-highlight, asyncio

---

### Task 1: Backend — Increase max_tokens, timeout, add finish_reason logging

**File:** `backend/services/agent_proxy.py`

- [ ] **Step 1: Update `call_agent` and `stream_agent` defaults**

Change `call_agent`:
```python
async def call_agent(agent: Agent, system_prompt: str, max_tokens: int = 4096) -> str:
    async with httpx.AsyncClient(timeout=60.0) as client:
```

Change `stream_agent`:
```python
async def stream_agent(agent: Agent, system_prompt: str, max_tokens: int = 4096):
    async with httpx.AsyncClient(timeout=300.0) as client:
```

- [ ] **Step 2: Add finish_reason tracking in `stream_agent`**

Replace the token-yield loop to track `finish_reason`:
```python
import logging
logger = logging.getLogger(__name__)
```
Inside `stream_agent`, track finish_reason from last chunk:
```python
                try:
                    chunk = json.loads(payload)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    finish_reason = chunk.get("choices", [{}])[0].get("finish_reason")
                    content = delta.get("content", "")
                    if content:
                        yield content
                except json.JSONDecodeError:
                    continue
    # After loop
    if finish_reason == "length":
        logger.warning("Agent %s response truncated by max_tokens", agent.id)
```

- [ ] **Step 3: Commit**

```bash
git add backend/services/agent_proxy.py
git commit -m "fix: increase max_tokens to 4096, timeout to 300s, log finish_reason"
```

---

### Task 2: Backend — Update MentionRequest schema

**File:** `backend/schemas.py`

- [ ] **Step 1: Change `agent_id` to `agent_ids` list**

```python
class MentionRequest(BaseModel):
    round_id: int
    agent_ids: list[int]
    question: str
```

- [ ] **Step 2: Commit**

```bash
git add backend/schemas.py
git commit -m "feat: MentionRequest.agent_ids list[int] for multi-agent @mention"
```

---

### Task 3: Backend — Add `_build_divergent_context` helper + summaries endpoint

**File:** `backend/routers/rounds.py`

- [ ] **Step 1: Add summaries endpoint (after the existing `list_rounds` endpoint)**

Add after the `list_rounds` function (line 89):
```python
@router.get("/summaries")
def list_round_summaries(session_id: int, db: Session = Depends(get_db)):
    """Return all rounds' scribe summaries for a session."""
    session = _get_session(session_id, db)
    rounds = db.query(Round).filter(
        Round.session_id == session.id,
    ).order_by(Round.round_number).all()
    return [
        {
            "round_number": r.round_number,
            "summary": r.scribe_summary or "",
            "created_at": r.created_at.isoformat(),
        }
        for r in rounds if r.scribe_summary
    ]
```

- [ ] **Step 2: Add `_build_divergent_context` helper**

Add before the `stream_divergent` function:
```python
def _build_divergent_context(session, db, round_obj) -> str:
    """Build accumulated context: topic + initial msg + past summaries + current msgs."""
    parts = []
    if session.topic:
        parts.append(f"## Session Topic\n{session.topic}")

    # User's initial message from round 1
    first_round = db.query(Round).filter(
        Round.session_id == session.id, Round.round_number == 1
    ).first()
    if first_round:
        initial_msg = db.query(Message).filter(
            Message.round_id == first_round.id, Message.is_human == True
        ).order_by(Message.created_at).first()
        if initial_msg and initial_msg.content:
            parts.append(f"## Initial Context\n{initial_msg.content}")

    # Previous rounds' scribe summaries
    prev_rounds = db.query(Round).filter(
        Round.session_id == session.id,
        Round.round_number < round_obj.round_number,
        Round.scribe_summary.isnot(None),
        Round.scribe_summary != "",
    ).order_by(Round.round_number).all()
    for pr in prev_rounds:
        parts.append(f"## Round {pr.round_number} Summary\n{pr.scribe_summary}")

    # Current round discussion
    current_msgs = db.query(Message).options(
        selectinload(Message.agent)
    ).filter(Message.round_id == round_obj.id).order_by(Message.created_at).all()
    msg_lines = []
    for m in current_msgs:
        if m.is_human:
            msg_lines.append(f"Human: {m.content}")
        elif m.content and m.agent:
            msg_lines.append(f"{m.agent.name}: {m.content}")
    if msg_lines:
        parts.append(f"## Current Discussion\n" + "\n".join(msg_lines))

    return "\n\n".join(parts)
```

- [ ] **Step 3: Modify `stream_divergent` to use the new context**

Replace lines 175-190 (the old context_parts building):
```python
    # Build enriched context
    context = _build_divergent_context(session, db, round_obj)
```
Remove the old `context_parts` block entirely.

- [ ] **Step 4: Commit**

```bash
git add backend/routers/rounds.py
git commit -m "feat: add _build_divergent_context and summaries endpoint"
```

---

### Task 4: Backend — Parallel streaming in `stream_divergent`

**File:** `backend/routers/rounds.py` (replace `event_generator` inside `stream_divergent`)

- [ ] **Step 1: Replace the sequential event_generator with parallel version**

Add `import asyncio` at top of file. Replace `event_generator()` (lines 192-217) with:
```python
    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        sentinel = object()
        n_tasks = len(agent_tasks)

        async def run_agent(agent, msg, prompt):
            """Run one agent, pushing events to shared queue."""
            from database import SessionLocal
            gen_db = SessionLocal()
            try:
                await queue.put(("event", "agent_start", {"agent_id": agent.id, "agent_name": agent.name, "message_id": msg.id}))

                full_content = ""
                async for token in stream_agent(agent, prompt):
                    full_content += token
                    await queue.put(("event", "token", {"agent_id": agent.id, "token": token}))

                # Persist full content
                db_msg = gen_db.query(Message).filter(Message.id == msg.id).first()
                if db_msg:
                    db_msg.content = full_content
                    gen_db.commit()

                await queue.put(("event", "agent_done", {"agent_id": agent.id}))
            except Exception as e:
                await queue.put(("event", "agent_error", {"agent_id": agent.id, "error": str(e)}))
            finally:
                gen_db.close()
                await queue.put(("sentinel", None, None))

        # Launch all agent tasks concurrently
        for agent, msg, prompt in agent_tasks:
            asyncio.create_task(run_agent(agent, msg, prompt))

        # Read from queue until all agents finish
        done = 0
        while done < n_tasks:
            typ, event_type, data = await queue.get()
            if typ == "sentinel":
                done += 1
                continue
            yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"

        yield "event: complete\ndata: {}\n\n"
```

- [ ] **Step 2: Commit**

```bash
git add backend/routers/rounds.py
git commit -m "feat: parallel agent streaming via asyncio.Queue"
```

---

### Task 5: Backend — Batch @mention in `mention_agent`

**File:** `backend/routers/rounds.py`

- [ ] **Step 1: Rewrite `mention_agent` to iterate over `data.agent_ids`**

Replace the function body (lines 223-242):
```python
@router.post("/mention", response_model=RoundDetailResponse)
def mention_agent(session_id: int, data: MentionRequest, db: Session = Depends(get_db)):
    """Human @mentions one or more agents, starting private threads."""
    session = _get_session(session_id, db)
    round_obj = db.query(Round).filter(Round.id == data.round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")

    for agent_id in data.agent_ids:
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if not agent:
            continue
        thread = Thread(round_id=round_obj.id, agent_id=agent.id)
        db.add(thread)
        db.flush()
        human_msg = ThreadMessage(thread_id=thread.id, is_human=True, content=data.question)
        db.add(human_msg)

    db.commit()
    return _get_round_detail(db, session, round_obj)
```

- [ ] **Step 2: Commit**

```bash
git add backend/routers/rounds.py
git commit -m "feat: batch @mention for multiple agents"
```

---

### Task 6: Frontend — Install npm dependencies + update client.ts + useSession.ts

**Files:** `frontend/package.json`, `frontend/src/api/client.ts`, `frontend/src/hooks/useSession.ts`

- [ ] **Step 1: Install react-markdown and related packages**

```bash
cd D:/brainstorm/frontend
npm install react-markdown remark-gfm rehype-highlight
```

- [ ] **Step 2: Update `client.ts` — change `mentionAgent` signature, add `fetchSummaries`**

Replace existing `mentionAgent`:
```typescript
export const mentionAgent = (sessionId: number, roundId: number, agentIds: number[], question: string) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/mention`, {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId, agent_ids: agentIds, question }),
  });
```

Add new function:
```typescript
export const fetchSummaries = (sessionId: number) =>
  fetchJSON<{ round_number: number; summary: string; created_at: string }[]>(
    `/sessions/${sessionId}/rounds/summaries`
  );
```

- [ ] **Step 3: Update `useSession.ts` — change `handleMention` to accept array**

Replace `handleMention`:
```typescript
const handleMention = async (agentIds: number[], question: string) => {
  if (!roundDetail || agentIds.length === 0) return
  setRespondingAgentId(agentIds[0])
  try {
    const detail = await mentionAgent(sessionId, roundDetail.current_round.id, agentIds, question)
    setRoundDetail(detail)
  } catch (e: any) {
    setError(e.message)
  }
  setRespondingAgentId(null)
}
```

Update the ChatRoom props — the `onSendMention` type signature changes from `(agentId: number, question: string)` to `(agentIds: number[], question: string)`.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/api/client.ts frontend/src/hooks/useSession.ts
git commit -m "feat: install react-markdown, update mentionAgent signature + fetchSummaries"
```

---

### Task 7: Frontend — ChatRoom multi-select @mention pills + @All

**File:** `frontend/src/components/ChatRoom.tsx`

- [ ] **Step 1: Replace single-select with multi-select checkbox pills**

Change the Props interface: `onSendMention: (agentId: number, question: string) => void` → `onSendMention: (agentIds: number[], question: string) => void`

Replace `selectedAgent` state with `selectedAgentIds`:
```typescript
const [selectedAgentIds, setSelectedAgentIds] = useState<number[]>([])
const [mentionText, setMentionText] = useState('')
```

Add toggle helper:
```typescript
const toggleAgent = (id: number) => {
  setSelectedAgentIds(prev =>
    prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
  )
}

const selectAll = () => {
  setSelectedAgentIds(prev =>
    prev.length === nonScribeAgents.length ? [] : nonScribeAgents.map(a => a.id)
  )
}

const sendMention = () => {
  if (selectedAgentIds.length > 0 && mentionText.trim() && !isStreaming) {
    onSendMention(selectedAgentIds, mentionText.trim())
    setMentionText('')
    setSelectedAgentIds([])
  }
}
```

- [ ] **Step 2: Replace the @mention `<select>` with checkbox pills**

Replace lines 188-232 (the entire @mention div) with:
```tsx
          {/* @mention area — multi-select pills + text input */}
          <div style={{ marginBottom: 12, flexShrink: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {nonScribeAgents.map(a => {
                const sel = selectedAgentIds.includes(a.id)
                return (
                  <label key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 12px', borderRadius: 'var(--radius-full)',
                    background: sel ? 'var(--primary)' : 'var(--bg)',
                    color: sel ? '#fff' : 'var(--text-primary)',
                    border: sel ? 'none' : '1px solid var(--border)',
                    cursor: isStreaming ? 'not-allowed' : 'pointer',
                    fontSize: 13, userSelect: 'none', opacity: isStreaming ? 0.5 : 1,
                    transition: 'all 0.15s',
                  }}>
                    <input type="checkbox" checked={sel}
                      onChange={() => toggleAgent(a.id)}
                      disabled={!!isStreaming}
                      style={{ display: 'none' }} />
                    {a.name}
                  </label>
                )
              })}
              <button onClick={selectAll} disabled={!!isStreaming}
                style={{
                  padding: '4px 12px', borderRadius: 'var(--radius-full)',
                  background: selectedAgentIds.length === nonScribeAgents.length ? 'var(--accent)' : 'var(--accent-light)',
                  color: selectedAgentIds.length === nonScribeAgents.length ? '#fff' : 'var(--accent)',
                  border: '1px solid var(--primary-border)', fontSize: 13,
                  cursor: isStreaming ? 'not-allowed' : 'pointer', opacity: isStreaming ? 0.5 : 1,
                }}>
                {selectedAgentIds.length === nonScribeAgents.length ? 'Deselect All' : '@All'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={mentionText} onChange={e => setMentionText(e.target.value)}
                disabled={!!isStreaming}
                onKeyDown={e => {
                  if (e.key === 'Enter' && selectedAgentIds.length > 0 && mentionText.trim() && !isStreaming) {
                    sendMention()
                  }
                }}
                placeholder={isStreaming ? 'Waiting for responses...' : "Ask a follow-up..."}
                style={{
                  flex: 1, padding: '8px 12px', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', fontSize: 14, outline: 'none',
                  background: 'var(--surface)', color: 'var(--text-primary)',
                  opacity: isStreaming ? 0.5 : 1,
                }}
              />
              <button onClick={sendMention}
                disabled={!!isStreaming || selectedAgentIds.length === 0 || !mentionText.trim()}
                style={{
                  padding: '8px 20px',
                  background: isStreaming || selectedAgentIds.length === 0 || !mentionText.trim()
                    ? '#D1D5DB' : 'var(--accent)',
                  color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                  cursor: isStreaming || selectedAgentIds.length === 0 || !mentionText.trim()
                    ? 'not-allowed' : 'pointer',
                  fontSize: 14, fontWeight: 500, flexShrink: 0,
                }}>
                @Send
              </button>
            </div>
          </div>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChatRoom.tsx
git commit -m "feat: multi-select @mention pills with @All button"
```

---

### Task 8: Frontend — Markdown rendering in MessageBubble

**File:** `frontend/src/components/MessageBubble.tsx`

- [ ] **Step 1: Add ReactMarkdown import and render conditionally**

Replace plain-text rendering path with:
```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// Inside the component, replace the non-streaming render path:
              ) : streamingContent !== undefined ? (
                displayContent || ' '
              ) : (
                <div className="message-content" style={{ maxWidth: '100%', overflowX: 'auto' }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {expanded ? message.content : (showEllipsis ? `${preview}...` : message.content)}
                  </ReactMarkdown>
                  {showEllipsis && (
                    <div style={{
                      marginTop: 8, fontSize: 12, color: 'var(--primary)', fontWeight: 500,
                      display: 'flex', alignItems: 'center', gap: 4,
                      cursor: 'pointer',
                    }} onClick={(e) => { e.stopPropagation(); setExpanded(true) }}>
                      Click to expand <span>▼</span>
                    </div>
                  )}
                </div>
              )}
```

Note: Remove the outer div's `onClick` and `cursor` handler (move it inside to the "Click to expand" area only), so clicks on markdown links work.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/MessageBubble.tsx
git commit -m "feat: markdown rendering with react-markdown + syntax highlighting"
```

---

### Task 9: Frontend — Left sidebar with round summaries

**File:** `frontend/src/pages/SessionView.tsx`

- [ ] **Step 1: Add imports and sidebar state**

```typescript
import { useState, useEffect } from 'react'
import { endSession, deleteSession, fetchSummaries } from '../api/client'
```

Add state:
```typescript
const [sidebarOpen, setSidebarOpen] = useState(false)
const [summaries, setSummaries] = useState<{ round_number: number; summary: string; created_at: string }[]>([])
```

Add load effect:
```typescript
useEffect(() => {
  if (sidebarOpen) {
    fetchSummaries(sessionId).then(setSummaries).catch(() => {})
  }
}, [sidebarOpen, sessionId])
```

- [ ] **Step 2: Restructure layout with left sidebar**

Replace the outer `<div style={{ display: 'flex', flexDirection: 'column', ... }}>` with:
```tsx
    <div style={{ display: 'flex', height: 'calc(100vh - 100px)', gap: 0 }}>
      {/* Left sidebar toggle */}
      <div style={{
        display: 'flex', flexDirection: 'column',
        borderRight: sidebarOpen ? '1px solid var(--border)' : 'none',
        transition: 'width 0.2s', width: sidebarOpen ? 240 : 0, overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div style={{
          width: 240, height: '100%', display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', overflowY: 'auto',
        }}>
          <div style={{
            padding: '12px 16px', fontSize: 14, fontWeight: 600,
            borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            Round Summaries
            <button onClick={() => setSidebarOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)' }}>
              ✕
            </button>
          </div>
          {summaries.length === 0 ? (
            <p style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              No summaries yet
            </p>
          ) : (
            summaries.map(s => (
              <SummaryCard key={s.round_number} summary={s} />
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, padding: '0 0 0 16px' }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          marginBottom: 16, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 18, padding: '4px 8px', borderRadius: 'var(--radius)',
                color: 'var(--text-secondary)',
              }}>
              ☰
            </button>
            <div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
                {session?.topic || 'Brainstorm Session'}
              </h1>
              ...rest of existing header...
```

- [ ] **Step 3: Create SummaryCard component (inline in same file or as separate)**

Add before the `SessionView` component:
```tsx
function SummaryCard({ summary }: { summary: { round_number: number; summary: string; created_at: string } }) {
  const [expanded, setExpanded] = useState(false)
  const preview = summary.summary.length > 120 ? summary.summary.slice(0, 120) + '...' : summary.summary
  return (
    <div onClick={() => setExpanded(!expanded)}
      style={{
        padding: '10px 16px', borderBottom: '1px solid var(--border)',
        cursor: 'pointer', transition: 'background 0.1s',
      }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>
        Round {summary.round_number} · {new Date(summary.created_at).toLocaleDateString()}
      </div>
      <div style={{
        fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {expanded ? summary.summary : preview}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SessionView.tsx
git commit -m "feat: left sidebar with round summaries history"
```

---

### Task 10: Frontend — Update styles.css + full compile check

**File:** `frontend/src/styles.css`

- [ ] **Step 1: Add highlight.js theme import and code block styling**

```css
@import 'highlight.js/styles/github.css';

.message-content h1,
.message-content h2,
.message-content h3,
.message-content h4 {
  margin: 12px 0 6px;
  line-height: 1.3;
}

.message-content h1 { font-size: 18px; }
.message-content h2 { font-size: 16px; }
.message-content h3 { font-size: 15px; }

.message-content p {
  margin: 6px 0;
}

.message-content ul,
.message-content ol {
  margin: 4px 0;
  padding-left: 20px;
}

.message-content li {
  margin: 2px 0;
}

.message-content pre {
  background: #f6f8fa;
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
  font-size: 13px;
  line-height: 1.45;
}

.message-content code {
  background: #f0f0f0;
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 13px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

.message-content pre code {
  background: none;
  padding: 0;
}

.message-content blockquote {
  border-left: 3px solid var(--primary-border);
  margin: 8px 0;
  padding: 4px 12px;
  color: var(--text-secondary);
}

.message-content a {
  color: var(--primary);
  text-decoration: underline;
}

.message-content table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}

.message-content th,
.message-content td {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}

.message-content th {
  background: var(--bg);
  font-weight: 600;
}

.message-content hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
```

- [ ] **Step 2: Run TypeScript compile check**

```bash
cd D:/brainstorm/frontend
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles.css
git commit -m "style: add highlight.js theme and markdown content styles"
```

---

### Task 11: Verify end-to-end

- [ ] **Step 1: Kill old backend and restart**

```bash
taskkill /f /im python.exe 2>nul
cd D:/brainstorm/backend
python -m uvicorn main:app --reload --port 8000 &
```

- [ ] **Step 2: Kill old frontend and restart**

```bash
cd D:/brainstorm/frontend
npx vite --host &
```

- [ ] **Step 3: Manual verification checklist**

1. Create session with 3 agents → verify session starts
2. Enter context → Start Agent Discussion → verify all 3 agents stream concurrently (check timing in logs)
3. Verify messages render markdown (testing bold `**text**`, code blocks, lists)
4. Open sidebar ☰ → verify round summaries display (may need to end a round first)
5. Multi-select @mention: select 2+ agents, type text, @Send → verify each gets private thread
6. Click @All → verify all agents selected
7. End round → verify scribe summary generates → verify it appears in sidebar
8. Start next round → verify context includes previous summary (check agent's system prompt in backend logs)
9. Verify no truncation on long responses (generate a long test prompt)
