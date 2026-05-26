# Agent Role Discovery & Selection

> **Design document** — Replace Manual/Generate session creation with a pi-agent-core powered role search & selection flow.

## Goal

Remove the old `Manual` and `Generate` session creation modes. Replace with a single new flow where a pi Agent searches for relevant personas (historical/existing figures) based on the user's topic, presents them with bios for user selection, and allows custom additions — all through pi as the sole LLM gateway.

## Requirements

1. User inputs: `topic`, `content` (what they want to discuss), `count` (desired agent count)
2. A pi Agent ("Searcher") uses its training knowledge (and optional web search tools) to find famous/known figures relevant to the topic
3. Results shown as a ranked list with `name` + `bio` so user can evaluate who to include
4. User selects desired roles (checkboxes)
5. User can add custom roles manually (optionally with a bio — for future Nuwa distillation disambiguation)
6. "Start Session" creates the session in IndexedDB and navigates to SessionView
7. All LLM interactions go through pi — no direct fetch to LLM APIs

## Removals

| Item | File | Reason |
|------|------|--------|
| `Manual` mode | `Dashboard.tsx` | Replaced |
| `Generate` mode | `Dashboard.tsx` | Replaced |
| `GeneratedAgentList` component | `components/GeneratedAgentList.tsx` | Only used by Generate mode |
| `buildGeneratorPrompt` | `llm/prompt.ts` | Only used by Generate mode |
| `createSessionWithGeneratedAgents` | `db/helpers.ts` | Replaced by new session creation |
| `createGeneratedAgent` | `db/helpers.ts` | No longer needed |
| `deleteGeneratedAgent` | `db/helpers.ts` | No longer needed |
| `deleteGeneratedAgentsBySession` | `db/helpers.ts` | Superseded by deleteSession |
| `callCompletion` | `bridgeApi.ts` | Replaced by pi Agent calls |

## Architecture

```
Browser (React + Vite)                  Node.js Bridge (port 3001)
┌─────────────────────────┐    POST     ┌────────────────────────────┐
│  Dashboard.tsx          │────────────→│  POST /api/suggest-roles   │
│                         │←────────────│  (pi Agent::streamSimple)  │
│  suggestRoles()         │   JSON      └────────────────────────────┘
│  → bridgeApi.ts         │
│                         │
│  IndexedDB (Dexie)      │
│  - sessions             │
│  - generatedAgents      │
│  - sessionAgents        │
└─────────────────────────┘
```

## Bridge API

### `POST /api/suggest-roles`

**Input:**
```json
{
  "topic": "Rise and fall of ancient Egyptian civilization",
  "content": "Discuss the political, economic and cultural factors",
  "count": 5,
  "apiConfig": {
    "apiBaseUrl": "https://api.deepseek.com",
    "apiKey": "sk-...",
    "modelName": "deepseek-v4-flash"
  }
}
```

**Output:**
```json
{
  "roles": [
    { "name": "Cleopatra VII", "bio": "The last active ruler of Ptolemaic Egypt..." },
    { "name": "Ramesses II", "bio": "Also known as Ramesses the Great..." }
  ]
}
```

**Implementation:**
```js
import { Router } from 'express';
import { streamSimple } from '@earendil-works/pi-ai';
import { buildModel } from '../model.js';
import { logger } from '../logger.js';

const router = Router();
router.post('/', async (req, res) => {
  const { topic, content, count, apiConfig } = req.body;
  const model = buildModel(apiConfig);
  logger.info('route.suggest-roles', 'Searching roles', { topic, count });

  try {
    const ctx = {
      systemPrompt: `You are a role research agent. Given a topic, suggest relevant historical or contemporary figures who would be valuable participants in a brainstorming discussion. For each figure, provide: name (concise, well-known name), bio (1-2 sentences identifying who they are and their relevance to the topic). Rank by relevance to the topic.

Respond ONLY with valid JSON in this format (no markdown, no explanation):
{"roles":[{"name":"...","bio":"..."}]}`,
      messages: [{ role: 'user', content: `Topic: ${topic}\nContent: ${content}\nCount: ${count}` }],
    };

    const stream = streamSimple(model, ctx, { apiKey: apiConfig.apiKey, maxTokens: 2048 });
    let full = '';
    for await (const ev of stream) {
      if (ev.type === 'text_delta') full += ev.delta;
    }
    const json = full.match(/\{[\s\S]*\}/);
    const data = json ? JSON.parse(json[0]) : { roles: [] };
    res.json(data);
  } catch (err) {
    logger.error('route.suggest-roles', 'Failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});
export default router;
```

## Frontend

### Dashboard.tsx — New Create Flow

Replace the three-mode (`Manual`/`Generate`/`Distill`) tabs with two modes: `Search Roles` + `Distill Experts`.

**Search Roles tab layout:**

```
┌──────────────────────────────────────────────┐
│ Topic: [______________________________]      │
│                                               │
│ Content: [______________________________]     │
│          [textarea for discussion context]    │
│                                               │
│ Agent count: [5]  [Search Roles]             │
│                                               │
│ ── Search Results ──                          │
│                                               │
│ ☑ Cleopatra VII                               │
│    The last active ruler of Ptolemaic Egypt…   │
│                                               │
│ ☑ Ramesses II                                 │
│    Also known as Ramesses the Great…           │
│                                               │
│ ☐ Akhenaten                                   │
│    Ancient Egyptian pharaoh known for…         │
│                                               │
│ [+ Add Custom Agent]                          │
│                                               │
│ [Start Session (3 agents)]                    │
└──────────────────────────────────────────────┘
```

**States:**
- `idle`: Topic + Content + Count + "Search Roles" button
- `searching`: Loading spinner, "Searching for relevant roles..."
- `results`: Selectable role cards with name + bio
- `error`: Error message + retry

**Custom agent addition:**
- Modal or inline form: `name` (required), `bio` (optional)
- Bio is optional for now but important for future Nuwa distillation disambiguation

### Data flow

1. User fills topic + content + count
2. Click "Search Roles"
3. Frontend calls `suggestRoles(topic, content, count, apiConfig)` → bridge
4. Bridge pi Agent returns role list
5. Frontend displays selectable cards
6. User selects + optionally adds custom agents
7. Click "Start Session"
8. Frontend creates:
   - `session` record in IndexedDB
   - `generatedAgent` record per selected role: `{ name, personality: bio, system_prompt: 'You are {name}. {bio}...', session_id }`
   - `sessionAgent` record per role (linking session to generated_agent)
9. Create bridge room
10. Navigate to `/session/{id}`

## DB Changes

`createSessionWithGeneratedAgents` → **removed**.

New function `createSessionWithRoles`:

```typescript
async function createSessionWithRoles(
  data: Omit<SessionRecord, 'id' | 'created_at'>,
  roles: ({ name: string; bio: string } & { is_scribe: boolean })[],
): Promise<number>
```

Internally uses the same `generatedAgents` + `sessionAgents` tables, with `bio` stored as `personality` and a default `system_prompt`.

## Bridge Changes

### New file: `bridge/src/routes/suggestRoles.js`
The search endpoint using pi's `streamSimple`.

### Modified: `bridge/src/index.js`
Register the new route.

## Frontend Changes

| File | Change |
|------|--------|
| `pages/Dashboard.tsx` | Major rewrite: remove Manual/Generate, add Search flow |
| `llm/bridgeApi.ts` | Add `suggestRoles()`, remove `callCompletion` |
| `llm/prompt.ts` | Remove `buildGeneratorPrompt` |
| `db/helpers.ts` | Add `createSessionWithRoles`, remove old `create*` functions |
| `components/GeneratedAgentList.tsx` | Delete file |
| `components/` (AgentList.tsx) | New component for role selection cards (optional, can be inline) |

## Future Considerations

- **Web search tool**: When a working search provider is available, the Searcher Agent can use a `web_search` tool to find more relevant personas beyond training knowledge
- **Nuwa distillation**: Selected roles with bios feed directly into huashu-nuwa for expert distillation — the bio disambiguates same-name figures
- **Scribe selection**: Currently not in scope; first agent is scribe by default
- **Per-agent API config**: Not needed — all agents use global LLM config
