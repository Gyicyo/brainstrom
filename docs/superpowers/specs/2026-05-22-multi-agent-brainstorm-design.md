# Multi-Agent & Human Collaborative Brainstorming System

## Overview

A web application that enables a human to brainstorm with multiple AI agents in a structured, round-based conversation flow. Users define custom agents with distinct personalities and roles, and the system orchestrates a phased discussion where agents contribute ideas, the human directs the conversation, and a dedicated scribe agent produces summaries.

## Core Design Principles

- **Every agent's view has useful parts** — no voting to eliminate ideas; all perspectives are captured and synthesized
- **Human has final control** — the human decides when to move between rounds, when to end, and which threads to pursue via @-mentions
- **Context isolation** — @-mention conversations are private between human and that agent until the next round
- **Prompt engineering only** — no complex agent frameworks; agents are driven entirely by system prompts and context injection
- **Model-agnostic** — uses OpenAI-compatible API format, supporting any provider (OpenAI, local LLMs via Ollama/vLLM, proxies)

## Agent Configuration

Users configure each agent in the system:

| Field | Description |
|-------|-------------|
| Name | Agent identifier |
| Personality/Role Description | Natural language description of the agent's persona |
| System Prompt | Instructions defining how the agent behaves in discussions |
| API Connection | OpenAI-compatible base_url + api_key + model name |

**Special role — Scribe (书记官):**
- Fixed system role, always present
- Does NOT participate in discussions
- Sole responsibility: produce summaries after each round and a final report

## Brainstorming Flow

### Phase 0: Agent Setup
User creates and configures agents. Each agent gets a name, persona description, system prompt, and API connection.

### Phase 1: Topic Definition
User inputs the brainstorming topic. The Scribe formats it into a **topic document**, which is shared with all agents.

### Phase 2: Rounds (repeated)

```
Round N:
  ├─ Step A — Context reading
  │   All agents read the latest context (Round 1: topic document;
  │   subsequent rounds: previous round's scribe summary)
  │
  ├─ Step B — Divergent thinking
  │   Each agent independently produces one statement/idea.
  │   All statements are visible to the human (public within the round).
  │
  ├─ Step C — Human @-mention follow-up (optional, repeated)
  │   Human @mentions a specific agent with a follow-up question.
  │   The full round context is sent to that agent.
  │   OTHER AGENTS ARE NOT AWARE OF THIS CONVERSATION.
  │   They remain in a waiting state.
  │
  └─ Step D — Human ends round
      Human decides the round is complete.
```

### Phase 3: Scribe Summary
When the human ends a round, the Scribe:
- Receives all public round content plus all @-mention conversations
- Produces a structured summary document
- This summary becomes the context for the next round

### Phase 4: Final Output
When the human ends the entire session, the Scribe generates a comprehensive final report synthesizing all rounds.

## Page Structure (UI)

The web application has three main views:

1. **Dashboard / Session List** — create new sessions, browse past sessions
2. **Session View** — the main brainstorming interface
   - Round timeline (public discussions)
   - Agent status indicators (which agents are waiting, which are responding)
   - Input area (type topic, @-mention agents, control flow commands)
   - Scribe summary panel
3. **Agent Configuration** — CRUD interface for agent definitions

## Data Model

```
BrainstormSession
  ├─ id
  ├─ topic
  ├─ status (active / completed)
  ├─ created_at
  ├─ agents: [Agent]
  └─ rounds: [Round]

Round
  ├─ round_number
  ├─ public_messages: [Message]  (divergent statements)
  ├─ private_threads: [Thread]   (@-mention conversations)
  └─ scribe_summary: string

Agent
  ├─ name
  ├─ personality
  ├─ system_prompt
  ├─ api_base_url
  ├─ api_key (encrypted)
  └─ model_name

Message
  ├─ agent_id
  ├─ content
  └─ timestamp

Thread
  ├─ agent_id
  ├─ messages: [Message]
  └─ created_at
```

## Technical Architecture

- **Frontend**: Web SPA (React/Vue) — session UI, agent config, real-time updates
- **Backend**: API server managing sessions, round orchestration, message routing
- **Database**: SQLite (local/lightweight) or PostgreSQL (production)
- **API Proxy**: Backend acts as a proxy to each agent's configured API — manages context injection, message routing, and isolation

### Backend Responsibilities

1. Inject correct context to each agent per phase
2. Manage @-mention context isolation
3. Call Scribe agent with appropriate inputs
4. Persist all conversation data
5. Expose REST API for the frontend
