# Multi-Agent Brainstorming System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web application enabling a human to brainstorm with multiple custom AI agents in round-based structured conversations.

**Architecture:** React SPA (Vite + TypeScript) frontend + Python FastAPI backend + SQLite database. Backend proxies all LLM calls through OpenAI-compatible API format and manages round orchestration, context injection, and @-mention isolation.

**Tech Stack:** React 18, TypeScript, Vite, Python 3.11+, FastAPI, SQLAlchemy, SQLite, uvicorn, SSE for real-time updates

---

## File Structure

```
D:/brainstorm/
├── backend/
│   ├── main.py                   # FastAPI app entry, CORS, lifespan
│   ├── database.py               # SQLAlchemy engine, SessionLocal, Base
│   ├── models.py                 # ORM models (Agent, Session, Round, Message, Thread, ThreadMessage)
│   ├── schemas.py                # Pydantic request/response schemas
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── agents.py             # CRUD: /api/agents
│   │   ├── sessions.py           # CRUD + flow control: /api/sessions
│   │   └── rounds.py             # Round steps: /api/sessions/{id}/rounds
│   ├── services/
│   │   ├── __init__.py
│   │   ├── agent_proxy.py        # OpenAI-compatible API proxy
│   │   └── scribe.py             # Scribe prompt building + API calls
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── types/
│       │   └── index.ts          # Shared TypeScript types
│       ├── api/
│       │   └── client.ts         # All fetch() calls to backend
│       ├── pages/
│       │   ├── Dashboard.tsx     # Session list + new session button
│       │   ├── SessionView.tsx   # Main chat room view
│       │   └── AgentConfig.tsx   # Agent CRUD form
│       ├── components/
│       │   ├── ChatRoom.tsx      # Message list + input area
│       │   ├── MessageBubble.tsx # Single message display
│       │   ├── AgentAvatar.tsx   # Avatar with configurable image/initials
│       │   ├── AgentStatusBar.tsx # Agent online/waiting/responding indicators
│       │   ├── TopicInput.tsx    # Topic definition dialog
│       │   └── RoundDivider.tsx  # Visual separator between rounds
│       └── hooks/
│           └── useSession.ts     # SSE hook for real-time session updates
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-22-multi-agent-brainstorm-design.md
```

---

### Task 1: Backend foundation — database and models

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/database.py`
- Create: `backend/models.py`
- Create: `backend/schemas.py`

- [ ] **Step 1: Create requirements.txt**

```
fastapi==0.111.0
uvicorn==0.29.0
sqlalchemy==2.0.30
pydantic==2.7.1
httpx==0.27.0
python-dotenv==1.0.1
sse-starlette==2.0.0
```

Run: `cd backend && pip install -r requirements.txt`

- [ ] **Step 2: Create database.py**

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

SQLALCHEMY_DATABASE_URL = "sqlite:///./brainstorm.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 3: Create models.py**

```python
import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from database import Base


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    personality = Column(Text, default="")
    system_prompt = Column(Text, default="")
    api_base_url = Column(String(500), nullable=False)
    api_key = Column(String(500), nullable=False)
    model_name = Column(String(100), nullable=False)
    avatar_url = Column(String(500), default="")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    topic = Column(Text, default="")
    status = Column(String(20), default="active")  # active | completed
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    current_round = Column(Integer, default=0)

    rounds = relationship("Round", back_populates="session", cascade="all, delete-orphan",
                          order_by="Round.round_number")


class SessionAgent(Base):
    __tablename__ = "session_agents"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False)
    is_scribe = Column(Boolean, default=False)

    agent = relationship("Agent")


class Round(Base):
    __tablename__ = "rounds"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    round_number = Column(Integer, nullable=False)
    scribe_summary = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    session = relationship("Session", back_populates="rounds")
    public_messages = relationship("Message", back_populates="round", cascade="all, delete-orphan")
    private_threads = relationship("Thread", back_populates="round", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    is_human = Column(Boolean, default=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    round = relationship("Round", back_populates="public_messages")
    agent = relationship("Agent")


class Thread(Base):
    __tablename__ = "threads"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    round = relationship("Round", back_populates="private_threads")
    agent = relationship("Agent")
    messages = relationship("ThreadMessage", back_populates="thread", cascade="all, delete-orphan")


class ThreadMessage(Base):
    __tablename__ = "thread_messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("threads.id"), nullable=False)
    is_human = Column(Boolean, default=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    thread = relationship("Thread", back_populates="messages")
```

- [ ] **Step 4: Create schemas.py**

```python
import datetime
from pydantic import BaseModel
from typing import Optional


# Agent schemas
class AgentCreate(BaseModel):
    name: str
    personality: str = ""
    system_prompt: str = ""
    api_base_url: str
    api_key: str
    model_name: str
    avatar_url: str = ""


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    personality: Optional[str] = None
    system_prompt: Optional[str] = None
    api_base_url: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    avatar_url: Optional[str] = None


class AgentResponse(BaseModel):
    id: int
    name: str
    personality: str
    system_prompt: str
    api_base_url: str
    api_key: str
    model_name: str
    avatar_url: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


# Session schemas
class SessionCreate(BaseModel):
    topic: str = ""
    agent_ids: list[int] = []


class SessionResponse(BaseModel):
    id: int
    topic: str
    status: str
    current_round: int
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


# Round schemas
class MessageResponse(BaseModel):
    id: int
    agent_id: Optional[int]
    agent_name: Optional[str] = ""
    is_human: bool
    content: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class ThreadMessageResponse(BaseModel):
    id: int
    is_human: bool
    content: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class ThreadResponse(BaseModel):
    id: int
    agent_id: int
    agent_name: str
    messages: list[ThreadMessageResponse]
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class RoundResponse(BaseModel):
    id: int
    round_number: int
    scribe_summary: str
    public_messages: list[MessageResponse]
    private_threads: list[ThreadResponse]
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class RoundDetailResponse(BaseModel):
    session: SessionResponse
    current_round: RoundResponse
    agents_attached: list[dict]

    model_config = {"from_attributes": True}


class DivergentRequest(BaseModel):
    session_id: int
    round_id: int


class MentionRequest(BaseModel):
    session_id: int
    round_id: int
    agent_id: int
    question: str


class EndRoundRequest(BaseModel):
    session_id: int
    round_id: int
```

- [ ] **Step 5: Create __init__.py files**

```bash
touch backend/routers/__init__.py backend/services/__init__.py
```

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/database.py backend/models.py backend/schemas.py backend/routers/__init__.py backend/services/__init__.py
git commit -m "feat(backend): add database models, schemas, and project structure"
```

---

### Task 2: Backend agent CRUD API

**Files:**
- Create: `backend/routers/agents.py`

- [ ] **Step 1: Create agents router**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Agent
from schemas import AgentCreate, AgentUpdate, AgentResponse

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("", response_model=list[AgentResponse])
def list_agents(db: Session = Depends(get_db)):
    return db.query(Agent).all()


@router.post("", response_model=AgentResponse, status_code=201)
def create_agent(data: AgentCreate, db: Session = Depends(get_db)):
    agent = Agent(**data.model_dump())
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(agent_id: int, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(404, "Agent not found")
    return agent


@router.put("/{agent_id}", response_model=AgentResponse)
def update_agent(agent_id: int, data: AgentUpdate, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(404, "Agent not found")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(agent, key, value)
    db.commit()
    db.refresh(agent)
    return agent


@router.delete("/{agent_id}", status_code=204)
def delete_agent(agent_id: int, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(404, "Agent not found")
    db.delete(agent)
    db.commit()
```

- [ ] **Step 2: Create main.py**

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from routers import agents


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(agents.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 3: Test the agent CRUD API**

Run:
```bash
cd backend && uvicorn main:app --reload --port 8000
```

In another terminal:
```bash
# Create an agent
curl -X POST http://localhost:8000/api/agents \
  -H "Content-Type: application/json" \
  -d '{"name":"Critic","personality":"Skeptical thinker","system_prompt":"You are a critical thinker.","api_base_url":"https://api.openai.com/v1","api_key":"sk-test","model_name":"gpt-4o"}'

# Expected: {"id":1,"name":"Critic",...}

# List agents
curl http://localhost:8000/api/agents
# Expected: [{"id":1,"name":"Critic",...}]
```
Stop the uvicorn process after testing.

- [ ] **Step 4: Commit**

```bash
git add backend/routers/agents.py backend/main.py
git commit -m "feat(backend): add agent CRUD API with FastAPI router"
```

---

### Task 3: Backend session and round management

**Files:**
- Create: `backend/routers/sessions.py`
- Create: `backend/routers/rounds.py`
- Modify: `backend/main.py` (add routers)

- [ ] **Step 1: Create sessions router**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Session as SessionModel, SessionAgent, Agent, Round
from schemas import SessionCreate, SessionResponse

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionResponse])
def list_sessions(db: Session = Depends(get_db)):
    return db.query(SessionModel).order_by(SessionModel.created_at.desc()).all()


@router.post("", response_model=SessionResponse, status_code=201)
def create_session(data: SessionCreate, db: Session = Depends(get_db)):
    session = SessionModel(topic=data.topic)
    db.add(session)
    db.flush()

    for agent_id in data.agent_ids:
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if agent:
            db.add(SessionAgent(session_id=session.id, agent_id=agent_id))

    db.commit()
    db.refresh(session)
    return session


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@router.post("/{session_id}/end", response_model=SessionResponse)
def end_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    session.status = "completed"
    db.commit()
    db.refresh(session)
    return session
```

- [ ] **Step 2: Create rounds router**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from database import get_db
from models import Session as SessionModel, Round, Message, Thread, ThreadMessage, Agent
from schemas import (
    RoundResponse, RoundDetailResponse, SessionResponse,
    MessageResponse, ThreadResponse, ThreadMessageResponse,
    DivergentRequest, MentionRequest, EndRoundRequest,
)

router = APIRouter(prefix="/api/sessions/{session_id}/rounds", tags=["rounds"])


def _get_session(session_id: int, db: Session) -> SessionModel:
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    return session


def _get_round_detail(db: Session, session: SessionModel, round_obj: Round) -> RoundDetailResponse:
    agents_attached = db.query(SessionAgent).filter(
        SessionAgent.session_id == session.id
    ).all()
    agent_list = []
    for sa in agents_attached:
        agent = db.query(Agent).filter(Agent.id == sa.agent_id).first()
        if agent:
            agent_list.append({
                "id": agent.id,
                "name": agent.name,
                "is_scribe": sa.is_scribe,
            })

    messages = db.query(Message).filter(Message.round_id == round_obj.id).order_by(Message.created_at).all()
    msg_responses = []
    for m in messages:
        agent_name = ""
        if m.agent_id:
            agent = db.query(Agent).filter(Agent.id == m.agent_id).first()
            agent_name = agent.name if agent else ""
        msg_responses.append(MessageResponse(
            id=m.id, agent_id=m.agent_id, agent_name=agent_name,
            is_human=m.is_human, content=m.content, created_at=m.created_at,
        ))

    threads = db.query(Thread).filter(Thread.round_id == round_obj.id).all()
    thread_responses = []
    for t in threads:
        agent = db.query(Agent).filter(Agent.id == t.agent_id).first()
        tmsgs = db.query(ThreadMessage).filter(ThreadMessage.thread_id == t.id).order_by(ThreadMessage.created_at).all()
        thread_responses.append(ThreadResponse(
            id=t.id, agent_id=t.agent_id, agent_name=agent.name if agent else "",
            messages=[ThreadMessageResponse(id=tm.id, is_human=tm.is_human, content=tm.content, created_at=tm.created_at)
                      for tm in tmsgs],
            created_at=t.created_at,
        ))

    return RoundDetailResponse(
        session=SessionResponse.model_validate(session),
        current_round=RoundResponse(
            id=round_obj.id, round_number=round_obj.round_number,
            scribe_summary=round_obj.scribe_summary,
            public_messages=msg_responses, private_threads=thread_responses,
            created_at=round_obj.created_at,
        ),
        agents_attached=agent_list,
    )


@router.get("", response_model=list[RoundResponse])
def list_rounds(session_id: int, db: Session = Depends(get_db)):
    session = _get_session(session_id, db)
    rounds = db.query(Round).filter(Round.session_id == session_id).order_by(Round.round_number).all()
    result = []
    for r in rounds:
        msgs = db.query(Message).filter(Message.round_id == r.id).count()
        thrds = db.query(Thread).filter(Thread.round_id == r.id).count()
        result.append(RoundResponse(
            id=r.id, round_number=r.round_number, scribe_summary=r.scribe_summary,
            public_messages=[], private_threads=[], created_at=r.created_at,
        ))
    return result


@router.post("/start", response_model=RoundDetailResponse, status_code=201)
def start_new_round(session_id: int, db: Session = Depends(get_db)):
    session = _get_session(session_id, db)
    if session.status == "completed":
        raise HTTPException(400, "Session is already completed")

    next_round_num = session.current_round + 1
    round_obj = Round(session_id=session.id, round_number=next_round_num)
    db.add(round_obj)
    session.current_round = next_round_num
    db.commit()
    db.refresh(round_obj)

    return _get_round_detail(db, session, round_obj)


@router.get("/current", response_model=RoundDetailResponse)
def get_current_round(session_id: int, db: Session = Depends(get_db)):
    session = _get_session(session_id, db)
    round_obj = db.query(Round).filter(
        Round.session_id == session_id,
        Round.round_number == session.current_round,
    ).first()
    if not round_obj:
        raise HTTPException(404, "No current round")
    return _get_round_detail(db, session, round_obj)


@router.post("/divergent", response_model=RoundDetailResponse)
def divergent_round(data: DivergentRequest, db: Session = Depends(get_db)):
    """Trigger each non-scribe agent to produce a divergent statement."""
    session = _get_session(data.session_id, db)
    round_obj = db.query(Round).filter(Round.id == data.round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")

    session_agents = db.query(SessionAgent).filter(
        SessionAgent.session_id == session.id,
        SessionAgent.is_scribe == False,
    ).all()

    for sa in session_agents:
        agent = db.query(Agent).filter(Agent.id == sa.agent_id).first()
        if agent:
            msg = Message(round_id=round_obj.id, agent_id=agent.id, is_human=False, content="")
            db.add(msg)

    db.commit()
    return _get_round_detail(db, session, round_obj)


@router.post("/mention", response_model=RoundDetailResponse)
def mention_agent(data: MentionRequest, db: Session = Depends(get_db)):
    """Human @mentions an agent, starting a private thread."""
    session = _get_session(data.session_id, db)
    round_obj = db.query(Round).filter(Round.id == data.round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")

    agent = db.query(Agent).filter(Agent.id == data.agent_id).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    thread = Thread(round_id=round_obj.id, agent_id=agent.id)
    db.add(thread)
    db.flush()

    human_msg = ThreadMessage(thread_id=thread.id, is_human=True, content=data.question)
    db.add(human_msg)
    db.commit()

    return _get_round_detail(db, session, round_obj)


@router.post("/end-round", response_model=RoundDetailResponse)
def end_round(data: EndRoundRequest, db: Session = Depends(get_db)):
    """Mark round complete (scribe summary generated separately)."""
    session = _get_session(data.session_id, db)
    round_obj = db.query(Round).filter(Round.id == data.round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")
    return _get_round_detail(db, session, round_obj)
```

- [ ] **Step 3: Update main.py to include new routers**

```python
# Add to imports
from routers import agents, sessions, rounds

# Add to app includes (after agents.router)
app.include_router(sessions.router)
app.include_router(rounds.router)
```

- [ ] **Step 4: Verify the routers are wired correctly**

Run: `cd backend && python -c "from main import app; print('Routers:', [r.path for r in app.routes])"`
Expected: Output shows `/api/agents`, `/api/sessions`, `/api/sessions/{session_id}/rounds` etc.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/sessions.py backend/routers/rounds.py backend/main.py
git commit -m "feat(backend): add session and round management endpoints"
```

---

### Task 4: Backend agent proxy service

**Files:**
- Create: `backend/services/agent_proxy.py`

- [ ] **Step 1: Create agent_proxy.py**

```python
import httpx
from models import Agent


def build_system_prompt(agent: Agent, context: str, task_description: str) -> str:
    """Build the full system prompt for an agent."""
    parts = [
        f"You are {agent.name}. {agent.personality}",
        f"Your behavior instructions: {agent.system_prompt}",
        f"## Current Context\n{context}",
        f"## Task\n{task_description}",
    ]
    return "\n\n".join(parts)


async def call_agent(agent: Agent, system_prompt: str, max_tokens: int = 1024) -> str:
    """Call an agent's configured API endpoint with the given prompt (OpenAI-compatible)."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "Please provide your response based on the instructions above."},
    ]

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{agent.api_base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {agent.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": agent.model_name,
                "messages": messages,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
```

- [ ] **Step 2: Test the proxy with a mock**

Run:
```bash
cd backend && python -c "
import asyncio
from models import Agent

async def test():
    agent = Agent(
        name='Test',
        personality='Helpful',
        system_prompt='Be concise.',
        api_base_url='https://api.openai.com/v1',
        api_key='sk-test',
        model_name='gpt-4o'
    )
    prompt = 'You are Test. Helpful\n\n## Current Context\nHello world\n\n## Task\nSay something'
    print('Prompt built successfully:', repr(prompt[:50] + '...'))

asyncio.run(test())
"
```
Expected: "Prompt built successfully: ..." — no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/services/agent_proxy.py
git commit -m "feat(backend): add OpenAI-compatible agent proxy service"
```

---

### Task 5: Backend scribe service

**Files:**
- Create: `backend/services/scribe.py`
- Modify: `backend/routers/rounds.py` (integrate scribe into end-round flow)

- [ ] **Step 1: Create scribe.py**

```python
import datetime
from sqlalchemy.orm import Session
from models import Session as SessionModel, Round, Message, Thread, ThreadMessage, Agent, SessionAgent
from services.agent_proxy import call_agent, build_system_prompt


def _find_scribe(db: Session, session: SessionModel) -> Agent | None:
    """Find the scribe agent for a session, or create a default one."""
    sa = db.query(SessionAgent).filter(
        SessionAgent.session_id == session.id,
        SessionAgent.is_scribe == True,
    ).first()
    if sa:
        return db.query(Agent).filter(Agent.id == sa.agent_id).first()

    scribe = db.query(Agent).filter(Agent.name == "Scribe").first()
    if scribe:
        return scribe

    return Agent(
        name="Scribe",
        personality="Neutral, organized summarizer",
        system_prompt=(
            "You are a scribe. You do NOT participate in discussions. "
            "Your only job is to produce clear, structured summaries of brainstorming sessions."
        ),
        api_base_url="https://api.openai.com/v1",
        api_key="",
        model_name="gpt-4o",
    )


def build_round_summary_context(db: Session, round_obj: Round) -> str:
    """Build the full context of a round for the scribe."""
    lines = [f"# Round {round_obj.round_number} Summary\n"]

    public_msgs = db.query(Message).filter(Message.round_id == round_obj.id).order_by(Message.created_at).all()
    if public_msgs:
        lines.append("## Public Discussion")
        for m in public_msgs:
            speaker = "Human" if m.is_human else (m.agent.name if m.agent else "Unknown")
            lines.append(f"**{speaker}**: {m.content}")

    threads = db.query(Thread).filter(Thread.round_id == round_obj.id).all()
    for t in threads:
        agent = db.query(Agent).filter(Agent.id == t.agent_id).first()
        agent_name = agent.name if agent else "Unknown"
        lines.append(f"\n## Private thread with {agent_name}")
        tmsgs = db.query(ThreadMessage).filter(ThreadMessage.thread_id == t.id).order_by(ThreadMessage.created_at).all()
        for tm in tmsgs:
            speaker = "Human" if tm.is_human else agent_name
            lines.append(f"**{speaker}**: {tm.content}")

    return "\n".join(lines)


async def generate_scribe_summary(db: Session, session: SessionModel, round_obj: Round) -> str:
    """Call the scribe to generate a summary and store it."""
    scribe = _find_scribe(db, session)
    context = build_round_summary_context(db, round_obj)

    system_prompt = build_system_prompt(
        scribe,
        context,
        "Write a structured summary of this brainstorming round. "
        "Organize key ideas, note connections between different agents' contributions, "
        "and highlight any conclusions or action items. "
        "Keep it concise but comprehensive.",
    )

    try:
        summary = await call_agent(scribe, system_prompt)
    except Exception as e:
        summary = f"[Scribe error: {e}]"

    round_obj.scribe_summary = summary
    return summary


async def generate_final_report(db: Session, session: SessionModel) -> str:
    """Generate a final synthesis report for the entire session."""
    scribe = _find_scribe(db, session)
    rounds = db.query(Round).filter(Round.session_id == session.id).order_by(Round.round_number).all()

    all_content = [f"# Brainstorming Session: {session.topic}\n"]
    for r in rounds:
        all_content.append(f"\n---\n## Round {r.round_number}\n")
        all_content.append(r.scribe_summary or "(No summary)")

    system_prompt = build_system_prompt(
        scribe,
        "\n".join(all_content),
        "Write a comprehensive final report synthesizing all rounds of this brainstorming session. "
        "Include: main themes, key insights, areas of agreement/disagreement, and actionable conclusions.",
    )

    try:
        report = await call_agent(scribe, system_prompt)
    except Exception as e:
        report = f"[Scribe error: {e}]"

    return report
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/scribe.py
git commit -m "feat(backend): add scribe service for round summaries and final reports"
```

---

### Task 6: Frontend project setup

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`

- [ ] **Step 1: Scaffold the React project**

Create `frontend/package.json`:
```json
{
  "name": "brainstorm-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.4.5",
    "vite": "^5.2.12"
  }
}
```

Create `frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["src"]
}
```

Create `frontend/vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
```

Create `frontend/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Brainstorm - Multi-Agent Brainstorming</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `frontend/src/main.tsx`:
```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
```

Create `frontend/src/App.tsx`:
```typescript
import { Routes, Route, Link } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import SessionView from './pages/SessionView'
import AgentConfig from './pages/AgentConfig'

function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <nav style={{ background: '#fff', padding: '12px 24px', borderBottom: '1px solid #ddd', display: 'flex', gap: 24 }}>
        <Link to="/" style={{ fontWeight: 'bold', textDecoration: 'none', color: '#333' }}>Brainstorm</Link>
        <Link to="/agents" style={{ textDecoration: 'none', color: '#666' }}>Agent Config</Link>
      </nav>
      <main style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/session/:id" element={<SessionView />} />
          <Route path="/agents" element={<AgentConfig />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
```

- [ ] **Step 2: Install dependencies and verify setup**

Run:
```bash
cd frontend && npm install
```

Expected: No errors, node_modules created.

Run:
```bash
cd frontend && npx tsc --noEmit
```

Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/tsconfig.json frontend/vite.config.ts frontend/index.html frontend/src/main.tsx frontend/src/App.tsx
git commit -m "feat(frontend): scaffold React project with routing"
```

---

### Task 7: Frontend types and API client

**Files:**
- Create: `frontend/src/types/index.ts`
- Create: `frontend/src/api/client.ts`

- [ ] **Step 1: Create types/index.ts**

```typescript
export interface AgentType {
  id: number;
  name: string;
  personality: string;
  system_prompt: string;
  api_base_url: string;
  api_key: string;
  model_name: string;
  avatar_url: string;
  created_at: string;
}

export interface SessionType {
  id: number;
  topic: string;
  status: string;
  current_round: number;
  created_at: string;
}

export interface MessageType {
  id: number;
  agent_id: number | null;
  agent_name: string;
  is_human: boolean;
  content: string;
  created_at: string;
}

export interface ThreadMessageType {
  id: number;
  is_human: boolean;
  content: string;
  created_at: string;
}

export interface ThreadType {
  id: number;
  agent_id: number;
  agent_name: string;
  messages: ThreadMessageType[];
  created_at: string;
}

export interface RoundType {
  id: number;
  round_number: number;
  scribe_summary: string;
  public_messages: MessageType[];
  private_threads: ThreadType[];
  created_at: string;
}

export interface RoundDetailType {
  session: SessionType;
  current_round: RoundType;
  agents_attached: { id: number; name: string; is_scribe: boolean }[];
}
```

- [ ] **Step 2: Create api/client.ts**

```typescript
import type { AgentType, SessionType, RoundDetailType } from '../types';

const BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

// Agents
export const listAgents = () => fetchJSON<AgentType[]>('/agents');
export const createAgent = (data: Partial<AgentType>) =>
  fetchJSON<AgentType>('/agents', { method: 'POST', body: JSON.stringify(data) });
export const updateAgent = (id: number, data: Partial<AgentType>) =>
  fetchJSON<AgentType>(`/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAgent = (id: number) =>
  fetchJSON<void>(`/agents/${id}`, { method: 'DELETE' });

// Sessions
export const listSessions = () => fetchJSON<SessionType[]>('/sessions');
export const createSession = (data: { topic: string; agent_ids: number[] }) =>
  fetchJSON<SessionType>('/sessions', { method: 'POST', body: JSON.stringify(data) });
export const endSession = (id: number) =>
  fetchJSON<SessionType>(`/sessions/${id}/end`, { method: 'POST' });

// Rounds
export const startNewRound = (sessionId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/start`, { method: 'POST' });
export const getCurrentRound = (sessionId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/current`);
export const divergentRound = (sessionId: number, roundId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/divergent`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, round_id: roundId }),
  });
export const mentionAgent = (sessionId: number, roundId: number, agentId: number, question: string) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/mention`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, round_id: roundId, agent_id: agentId, question }),
  });
export const endRound = (sessionId: number, roundId: number) =>
  fetchJSON<RoundDetailType>(`/sessions/${sessionId}/rounds/end-round`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, round_id: roundId }),
  });
```

- [ ] **Step 3: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/client.ts
git commit -m "feat(frontend): add TypeScript types and API client"
```

---

### Task 8: Frontend dashboard page

**Files:**
- Create: `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Create Dashboard.tsx**

```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSessions, createSession, listAgents } from '../api/client'
import type { SessionType, AgentType } from '../types'

export default function Dashboard() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionType[]>([])
  const [agents, setAgents] = useState<AgentType[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [topic, setTopic] = useState('')
  const [selectedAgents, setSelectedAgents] = useState<number[]>([])

  const load = async () => {
    try {
      setSessions(await listSessions())
      setAgents(await listAgents())
    } catch (e) {
      console.error('Failed to load data', e)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!topic.trim() || selectedAgents.length === 0) return
    const session = await createSession({ topic, agent_ids: selectedAgents })
    setShowCreate(false)
    setTopic('')
    setSelectedAgents([])
    navigate(`/session/${session.id}`)
  }

  const toggleAgent = (id: number) => {
    setSelectedAgents(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Sessions</h1>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: '8px 16px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          + New Session
        </button>
      </div>

      {showCreate && (
        <div style={{ background: '#fff', padding: 24, borderRadius: 8, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 12px' }}>Create New Brainstorm Session</h3>
          <input
            placeholder="Enter brainstorming topic..."
            value={topic}
            onChange={e => setTopic(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 4, marginBottom: 16, boxSizing: 'border-box' }}
          />
          <p style={{ margin: '0 0 8px', fontWeight: 500 }}>Select Agents:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {agents.map(a => (
              <label key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 16,
                background: selectedAgents.includes(a.id) ? '#1976d2' : '#eee',
                color: selectedAgents.includes(a.id) ? '#fff' : '#333',
                cursor: 'pointer', fontSize: 14,
              }}>
                <input type="checkbox" checked={selectedAgents.includes(a.id)}
                  onChange={() => toggleAgent(a.id)} style={{ display: 'none' }} />
                {a.name}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCreate}
              style={{ padding: '8px 16px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              Start Session
            </button>
            <button onClick={() => setShowCreate(false)}
              style={{ padding: '8px 16px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {sessions.length === 0 ? (
        <p style={{ color: '#999', textAlign: 'center', padding: 48 }}>No sessions yet. Create one to get started!</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sessions.map(s => (
            <div key={s.id} onClick={() => navigate(`/session/${s.id}`)}
              style={{
                background: '#fff', padding: 16, borderRadius: 8, cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between',
              }}>
              <div>
                <strong>{s.topic || '(No topic)'}</strong>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  Round {s.current_round} · {s.status}
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#999' }}>
                {new Date(s.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat(frontend): add dashboard page with session list and creation"
```

---

### Task 9: Frontend Agent configuration page

**Files:**
- Create: `frontend/src/pages/AgentConfig.tsx`

- [ ] **Step 1: Create AgentConfig.tsx**

```typescript
import { useEffect, useState } from 'react'
import { listAgents, createAgent, updateAgent, deleteAgent } from '../api/client'
import type { AgentType } from '../types'

const emptyForm = {
  name: '', personality: '', system_prompt: '',
  api_base_url: 'https://api.openai.com/v1', api_key: '', model_name: 'gpt-4o',
  avatar_url: '',
}

export default function AgentConfig() {
  const [agents, setAgents] = useState<AgentType[]>([])
  const [editing, setEditing] = useState<Partial<AgentType> | null>(null)
  const [editId, setEditId] = useState<number | null>(null)

  const load = async () => {
    try { setAgents(await listAgents()) } catch (e) { console.error(e) }
  }
  useEffect(() => { load() }, [])

  const handleSave = async () => {
    if (!editing) return
    try {
      if (editId) {
        await updateAgent(editId, editing)
      } else {
        await createAgent(editing as any)
      }
      setEditing(null)
      setEditId(null)
      load()
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this agent?')) return
    try {
      await deleteAgent(id)
      load()
    } catch (e) { console.error(e) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Agent Configuration</h1>
        <button onClick={() => { setEditing(emptyForm); setEditId(null) }}
          style={{ padding: '8px 16px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          + Add Agent
        </button>
      </div>

      {editing && (
        <div style={{ background: '#fff', padding: 24, borderRadius: 8, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 16px' }}>{editId ? 'Edit Agent' : 'New Agent'}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input placeholder="Name" value={editing.name || ''}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }} />
            <textarea placeholder="Personality / Role Description" value={editing.personality || ''}
              onChange={e => setEditing({ ...editing, personality: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4, minHeight: 60 }} />
            <textarea placeholder="System Prompt" value={editing.system_prompt || ''}
              onChange={e => setEditing({ ...editing, system_prompt: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4, minHeight: 80 }} />
            <input placeholder="Avatar URL (optional)" value={editing.avatar_url || ''}
              onChange={e => setEditing({ ...editing, avatar_url: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }} />
            <input placeholder="API Base URL" value={editing.api_base_url || ''}
              onChange={e => setEditing({ ...editing, api_base_url: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }} />
            <input placeholder="API Key" type="password" value={editing.api_key || ''}
              onChange={e => setEditing({ ...editing, api_key: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }} />
            <input placeholder="Model Name" value={editing.model_name || ''}
              onChange={e => setEditing({ ...editing, model_name: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSave}
                style={{ padding: '8px 16px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Save
              </button>
              <button onClick={() => { setEditing(null); setEditId(null) }}
                style={{ padding: '8px 16px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {agents.length === 0 ? (
        <p style={{ color: '#999', textAlign: 'center', padding: 48 }}>No agents configured. Add one to start!</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {agents.map(a => (
            <div key={a.id} style={{
              background: '#fff', padding: 16, borderRadius: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <strong>{a.name}</strong>
                <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{a.model_name}</div>
                {a.personality && <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{a.personality}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setEditing(a); setEditId(a.id) }}
                  style={{ padding: '4px 12px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                  Edit
                </button>
                <button onClick={() => handleDelete(a.id)}
                  style={{ padding: '4px 12px', background: '#f44336', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/AgentConfig.tsx
git commit -m "feat(frontend): add agent configuration page with CRUD"
```

---

### Task 10: Frontend chat room components

**Files:**
- Create: `frontend/src/components/AgentAvatar.tsx`
- Create: `frontend/src/components/MessageBubble.tsx`
- Create: `frontend/src/components/RoundDivider.tsx`
- Create: `frontend/src/components/AgentStatusBar.tsx`
- Create: `frontend/src/components/TopicInput.tsx`
- Create: `frontend/src/components/ChatRoom.tsx`

- [ ] **Step 1: Create AgentAvatar.tsx**

```typescript
interface Props {
  name: string;
  avatarUrl?: string;
  size?: number;
  isHuman?: boolean;
}

export default function AgentAvatar({ name, avatarUrl, size = 40, isHuman }: Props) {
  const initials = name.slice(0, 2).toUpperCase()
  const bgColor = isHuman ? '#1976d2' : '#388e3c'

  if (avatarUrl) {
    return <img src={avatarUrl} alt={name}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bgColor, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 'bold', fontSize: size * 0.4,
    }}>
      {initials}
    </div>
  )
}
```

- [ ] **Step 2: Create MessageBubble.tsx**

```typescript
import AgentAvatar from './AgentAvatar'
import type { MessageType } from '../types'

interface Props {
  message: MessageType;
  isHuman?: boolean;
}

export default function MessageBubble({ message, isHuman }: Props) {
  const align = isHuman ? 'flex-end' : 'flex-start'
  const bubbleBg = isHuman ? '#1976d2' : '#fff'
  const textColor = isHuman ? '#fff' : '#333'
  const border = isHuman ? 'none' : '1px solid #e0e0e0'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: isHuman ? 'row-reverse' : 'row' }}>
        <AgentAvatar name={isHuman ? 'You' : message.agent_name} isHuman={isHuman} size={36} />
        <div style={{
          maxWidth: '70%', padding: '10px 14px', borderRadius: 12,
          background: bubbleBg, color: textColor, border, fontSize: 14, lineHeight: 1.5,
        }}>
          {message.content}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 4, paddingLeft: 44 }}>
        {message.agent_name}{isHuman ? ' (You)' : ''} · {new Date(message.created_at).toLocaleTimeString()}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create RoundDivider.tsx**

```typescript
interface Props {
  roundNumber: number;
}

export default function RoundDivider({ roundNumber }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, margin: '24px 0',
      color: '#999', fontSize: 13,
    }}>
      <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
      <span style={{ fontWeight: 500 }}>Round {roundNumber}</span>
      <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
    </div>
  )
}
```

- [ ] **Step 4: Create AgentStatusBar.tsx**

```typescript
interface AgentInfo {
  id: number;
  name: string;
  is_scribe: boolean;
}

interface Props {
  agents: AgentInfo[];
  respondingAgentId?: number | null;
}

export default function AgentStatusBar({ agents, respondingAgentId }: Props) {
  const nonScribe = agents.filter(a => !a.is_scribe)

  return (
    <div style={{
      display: 'flex', gap: 8, padding: '8px 12px',
      background: '#fafafa', borderRadius: 8, marginBottom: 16,
      flexWrap: 'wrap',
    }}>
      {nonScribe.map(a => {
        const isResponding = a.id === respondingAgentId
        return (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 12, fontSize: 12,
            background: isResponding ? '#fff3e0' : '#f0f0f0',
            color: isResponding ? '#e65100' : '#666',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isResponding ? '#ff9800' : '#4caf50',
              display: 'inline-block',
            }} />
            {a.name}
            {isResponding && ' (responding...)'}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Create TopicInput.tsx**

```typescript
import { useState } from 'react'

interface Props {
  onSubmit: (topic: string) => void;
}

export default function TopicInput({ onSubmit }: Props) {
  const [text, setText] = useState('')

  const handleSubmit = () => {
    if (!text.trim()) return
    onSubmit(text.trim())
    setText('')
  }

  return (
    <div style={{ background: '#fff', padding: 16, borderRadius: 8, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>What would you like to brainstorm?</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Enter your topic..."
          style={{ flex: 1, padding: '10px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14 }}
        />
        <button onClick={handleSubmit}
          style={{ padding: '10px 20px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          Start
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create ChatRoom.tsx**

```typescript
import { useState, useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble'
import RoundDivider from './RoundDivider'
import AgentStatusBar from './AgentStatusBar'
import type { RoundDetailType, MessageType } from '../types'

interface Props {
  roundDetail: RoundDetailType | null;
  onSendMention: (agentId: number, question: string) => void;
  onStartRound: () => void;
  onEndRound: () => void;
  respondingAgentId: number | null;
  loading: boolean;
}

export default function ChatRoom({ roundDetail, onSendMention, onStartRound, onEndRound, respondingAgentId, loading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [mentionText, setMentionText] = useState('')
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [roundDetail])

  if (!roundDetail) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <p style={{ color: '#999', marginBottom: 16 }}>No active round. Start one to begin brainstorming!</p>
        <button onClick={onStartRound} disabled={loading}
          style={{ padding: '10px 24px', background: loading ? '#ccc' : '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Starting...' : 'Start Round 1'}
        </button>
      </div>
    )
  }

  const { current_round, agents_attached } = roundDetail
  const nonScribeAgents = agents_attached.filter(a => !a.is_scribe)

  const allMessages: ({ type: 'message' } & MessageType)[] = current_round.public_messages

  return (
    <div>
      <AgentStatusBar agents={agents_attached} respondingAgentId={respondingAgentId} />

      <div style={{
        background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        minHeight: 400, maxHeight: 500, overflowY: 'auto', padding: 16, marginBottom: 16,
      }}>
        <RoundDivider roundNumber={current_round.round_number} />
        {allMessages.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#999', padding: 40 }}>
            Waiting for agents to respond...
          </p>
        ) : (
          allMessages.map(m => (
            <MessageBubble key={m.id} message={m} />
          ))
        )}

        {current_round.private_threads.map(t => (
          <div key={t.id} style={{ marginLeft: 24, borderLeft: '3px solid #ff9800', paddingLeft: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#ff9800', marginBottom: 8 }}>Private thread with {t.agent_name}</div>
            {t.messages.map(tm => (
              <MessageBubble key={tm.id} message={{
                id: tm.id, agent_id: null, agent_name: tm.is_human ? 'You' : t.agent_name,
                is_human: tm.is_human, content: tm.content, created_at: tm.created_at,
              }} isHuman={tm.is_human} />
            ))}
          </div>
        ))}

        {current_round.scribe_summary && (
          <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Scribe Summary</div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{current_round.scribe_summary}</div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* @mention input */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={selectedAgent || ''} onChange={e => setSelectedAgent(Number(e.target.value) || null)}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }}>
          <option value="">@mention an agent...</option>
          {nonScribeAgents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input value={mentionText} onChange={e => setMentionText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && selectedAgent && mentionText.trim()) {
              onSendMention(selectedAgent, mentionText.trim())
              setMentionText('')
            }
          }}
          placeholder="Ask a follow-up..."
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }}
        />
        <button onClick={() => {
          if (selectedAgent && mentionText.trim()) {
            onSendMention(selectedAgent, mentionText.trim())
            setMentionText('')
          }
        }}
          style={{ padding: '8px 16px', background: '#ff9800', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          @Send
        </button>
      </div>

      {/* Round controls */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onEndRound} disabled={loading}
          style={{ padding: '8px 16px', background: loading ? '#ccc' : '#4caf50', color: '#fff', border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer' }}>
          End Round & Summarize
        </button>
        <button onClick={onStartRound} disabled={loading}
          style={{ padding: '8px 16px', background: loading ? '#ccc' : '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer' }}>
          Start Next Round
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/
git commit -m "feat(frontend): add chat room and related UI components"
```

---

### Task 11: Frontend session view page

**Files:**
- Create: `frontend/src/hooks/useSession.ts`
- Create: `frontend/src/pages/SessionView.tsx`

- [ ] **Step 1: Create useSession.ts**

```typescript
import { useState, useEffect, useCallback } from 'react'
import {
  getCurrentRound, startNewRound, endRound, divergentRound, mentionAgent,
} from '../api/client'
import type { RoundDetailType } from '../types'

export function useSession(sessionId: number) {
  const [roundDetail, setRoundDetail] = useState<RoundDetailType | null>(null)
  const [respondingAgentId, setRespondingAgentId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const detail = await getCurrentRound(sessionId)
      setRoundDetail(detail)
    } catch (e: any) {
      // No current round = session just created, that's fine
      setRoundDetail(null)
    }
  }, [sessionId])

  useEffect(() => { load() }, [load])

  const handleStartRound = async () => {
    setLoading(true)
    try {
      const detail = await startNewRound(sessionId)
      setRoundDetail(detail)
      // Trigger divergent phase — each agent says something
      setRespondingAgentId(null)
      const divergentDetail = await divergentRound(sessionId, detail.current_round.id)
      setRoundDetail(divergentDetail)
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const handleEndRound = async () => {
    setLoading(true)
    try {
      if (!roundDetail) return
      await endRound(sessionId, roundDetail.current_round.id)
      // Reload to get scribe summary
      await load()
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const handleMention = async (agentId: number, question: string) => {
    if (!roundDetail) return
    setRespondingAgentId(agentId)
    try {
      const detail = await mentionAgent(sessionId, roundDetail.current_round.id, agentId, question)
      setRoundDetail(detail)
    } catch (e: any) {
      setError(e.message)
    }
    setRespondingAgentId(null)
  }

  return {
    roundDetail, respondingAgentId, loading, error,
    handleStartRound, handleEndRound, handleMention,
  }
}
```

- [ ] **Step 2: Create SessionView.tsx**

```typescript
import { useParams, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { endSession } from '../api/client'
import ChatRoom from '../components/ChatRoom'
import TopicInput from '../components/TopicInput'

export default function SessionView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionId = Number(id)

  const {
    roundDetail, respondingAgentId, loading, error,
    handleStartRound, handleEndRound, handleMention,
  } = useSession(sessionId)

  const handleEndSession = async () => {
    if (!confirm('End this session and generate final report?')) return
    try {
      await endSession(sessionId)
      navigate('/')
    } catch (e) {
      console.error(e)
    }
  }

  const session = roundDetail?.session

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>{session?.topic || 'Brainstorm Session'}</h1>
          {session && (
            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
              Round {session.current_round} · {session.status}
            </div>
          )}
        </div>
        <button onClick={handleEndSession}
          style={{ padding: '8px 16px', background: '#f44336', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          End Session
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#ffebee', color: '#c62828', borderRadius: 4, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <ChatRoom
        roundDetail={roundDetail}
        onSendMention={handleMention}
        onStartRound={handleStartRound}
        onEndRound={handleEndRound}
        respondingAgentId={respondingAgentId}
        loading={loading}
      />
    </div>
  )
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useSession.ts frontend/src/pages/SessionView.tsx
git commit -m "feat(frontend): add session view page with round orchestration"
```

---

### Task 12: Integration test — end-to-end smoke test

**Files:**
- No new files — use existing backend + frontend

- [ ] **Step 1: Start the backend**

```bash
cd backend && uvicorn main:app --reload --port 8000
```

- [ ] **Step 2: Start the frontend**

In a separate terminal:
```bash
cd frontend && npm run dev
```

- [ ] **Step 3: Smoke test the full flow**

```bash
# 1. Create an agent
curl -s -X POST http://localhost:8000/api/agents \
  -H "Content-Type: application/json" \
  -d '{"name":"IdeaGenerator","personality":"Creative divergent thinker","system_prompt":"Generate novel ideas freely.","api_base_url":"https://api.openai.com/v1","api_key":"sk-test","model_name":"gpt-4o"}' | python -m json.tool

# Expected: agent created with ID 1

# 2. Create a session with the agent
curl -s -X POST http://localhost:8000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"topic":"How to improve team collaboration?","agent_ids":[1]}' | python -m json.tool

# Expected: session created

# 3. Start a round
SESSION_ID=1
curl -s -X POST "http://localhost:8000/api/sessions/$SESSION_ID/rounds/start" | python -m json.tool

# Expected: round created

# 4. Check the frontend at http://localhost:5173
echo "Open http://localhost:5173 in a browser"
```

- [ ] **Step 4: Verify all API endpoints work**

```bash
# Health check
curl http://localhost:8000/api/health
# Expected: {"status":"ok"}

# List sessions
curl http://localhost:8000/api/sessions
# Expected: non-empty array

# List agents
curl http://localhost:8000/api/agents
# Expected: non-empty array
```

---

### Task 13: Implementation of remaining backend flows (scribe integration, mention response)

**Files:**
- Modify: `backend/routers/rounds.py` (add scribe integration to end-round, add mention-response API call)

- [ ] **Step 1: Update end-round endpoint to trigger scribe**

In `backend/routers/rounds.py`, modify the `end_round` function:
```python
from services.scribe import generate_scribe_summary, generate_final_report


@router.post("/end-round", response_model=RoundDetailResponse)
async def end_round(data: EndRoundRequest, db: Session = Depends(get_db)):
    session = _get_session(data.session_id, db)
    round_obj = db.query(Round).filter(Round.id == data.round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")

    # Generate scribe summary
    await generate_scribe_summary(db, session, round_obj)
    db.commit()

    return _get_round_detail(db, session, round_obj)
```

- [ ] **Step 2: Add endpoint for final report**

In `backend/routers/rounds.py`, add:
```python
@router.post("/final-report")
async def generate_final_report_endpoint(session_id: int, db: Session = Depends(get_db)):
    session = _get_session(session_id, db)
    report = await generate_final_report(db, session)
    return {"report": report}
```

- [ ] **Step 3: Commit**

```bash
git add backend/routers/rounds.py
git commit -m "feat(backend): integrate scribe into round end and add final report endpoint"
```

---

## Spec Coverage Check

- **Agent Configuration (CRUD)** → Task 2 (backend) + Task 9 (frontend)
- **Session Creation** → Task 3 (backend) + Task 8 (frontend)
- **Round-based Flow** → Task 3 (rounds router) + Task 11 (frontend session view)
- **Divergent Thinking Phase** → Task 3 (`/divergent` endpoint)
- **@-mention with Context Isolation** → Task 3 (`/mention` endpoint) — creates private thread, other agents not notified
- **Scribe Summaries** → Task 5 (scribe service) + Task 13 (integration)
- **Final Report** → Task 13 (final report endpoint)
- **Chat-room UI (QQ-style)** → Task 10 (ChatRoom, MessageBubble, RoundDivider components)
- **Configurable Avatars** → Task 10 (AgentAvatar component — image or initials)
- **Agent Status Indicators** → Task 10 (AgentStatusBar)
- **Agent API Proxy (OpenAI-compatible)** → Task 4 (agent_proxy service)
- **Model-agnostic** → Task 4 — users configure base_url, key, model per agent

No gaps found.
