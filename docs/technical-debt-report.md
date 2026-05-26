# Technical Debt Report — 2026-05-26

## 1. Test Code Leaking into Production (HIGH)

### 1.1 `/api/test-tools` Route Exposed in Production
**File**: `bridge/src/routes/test-tools.js`
**Issue**: A full LLM test harness (`/api/test-tools`) is mounted unconditionally in the production Express server (`bridge/src/index.js:27`). This endpoint makes LLM API calls, tests tool execution, etc. — it's a dev-only utility that should be guarded by `NODE_ENV`.

- `bridge/src/index.js:27`: `app.use('/api/test-tools', testToolsRoutes);` — no `if (dev)` guard
- `LLMConfig.tsx:62`: Frontend hardcodes a call to this endpoint as the "test connection" feature

### 1.2 Empty Tests Directory
**File**: `bridge/tests/` (empty directory)
**Issue**: The `bridge/tests/` directory exists but contains zero test files. `package.json` declares `vitest` as a devDependency and `test` script, but no tests exist. Dead configuration weight.

### 1.3 `test-tools.mjs` at Bridge Root
**File**: `bridge/test-tools.mjs`
**Issue**: Standalone test script at bridge root not tracked in gitignore or package.json scripts.

---

## 2. Hardcoded Sensitive Data / Secrets (CRITICAL)

### 2.1 API Keys Persisted to Disk Unencrypted
**File**: `bridge/src/sessionStore.js:31-36`
**Issue**: `saveSession()` writes `apiConfig` (including `apiKey`) to `bridge/sessions/<id>/meta.json` as plaintext JSON. Anyone with filesystem access to the server can read all API keys:

```js
writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
  topic,
  apiConfig: { apiBaseUrl: apiConfig.apiBaseUrl, modelName: apiConfig.modelName, apiKey: apiConfig.apiKey },
  // apiKey stored in cleartext ⚠️
}));
```

### 2.2 API Key in URL Query String
**File**: `frontend/src/search/custom.ts:5`
**Issue**: Custom search API key is passed as a query parameter in the URL, which is logged by servers, proxies, and browser history:

```ts
const url = `${apiUrl}${sep}q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}`;
```

### 2.3 AgentRecord Stores API Keys in IndexedDB
**Files**: `frontend/src/db/db.ts:9-10`, `frontend/src/types/index.ts:7-8`
**Issue**: The `agents` table (now deprecated per AGENTS.md) stores `api_key` and `search_api_key` in IndexedDB. While client-side, IndexedDB is accessible to any JS running on the same origin via XSS. The UI (`AgentConfig.tsx`) still exposes these fields.

### 2.4 Hardcoded Bridge URL
**Files**: `frontend/src/llm/bridgeApi.ts:1`, `frontend/src/pages/LLMConfig.tsx:62`
**Issue**: `const BRIDGE_URL = 'http://localhost:3001'` is hardcoded. Cannot target a remote bridge without modifying source code. Same hardcoded URL replicated in `LLMConfig.tsx`.

---

## 3. Architecture / Logic Issues (MEDIUM)

### 3.1 Dead Code — Old Direct-LLM Functions
**File**: `frontend/src/llm/stream.ts`
**Issue**: 4 exported functions (`streamAgentResponse`, `callAgent`, `streamAgentResponseWithTools`, `callAgentWithTools`) all throw errors. They exist only to tell the developer to use bridge API. Dead code that should be removed:

```ts
throw new Error('请改用 streamAgentChat，传入 sessionId 和 agentName');
```

### 3.2 Deprecated AgentConfig Page Still Wired
**File**: `frontend/src/pages/AgentConfig.tsx` + `frontend/src/App.tsx`
**Issue**: AGENTS.md states "The `agents` table is no longer used (replaced by global LLM config in localStorage)". Yet `AgentConfig.tsx` is a full CRUD UI for per-agent config (includes API keys, search providers, etc.). Not imported in `App.tsx` routes, but the file and associated types (`AgentType`, `NewAgentInput`) remain as dead weight.

### 3.3 Global Module-Level State (Not Request-Safe)
**File**: `bridge/src/distill.js:25-26`
**Issue**: `let searchAgent = null` is a module-level singleton. When `getSearchAgent()` is called, it mutates and reassigns the global. Under concurrent requests, this will cause cross-request state pollution:

```js
function getSearchAgent(apiConfig) {
  if (searchAgent) { searchAgent.reset(); searchAgent = null; } // race condition ⚠️
  searchAgent = new Agent({ ... });   // shared mutable global
  return searchAgent;
}
```

### 3.4 Session ID Not Sanitized (Path Traversal Risk)
**File**: `bridge/src/sessionStore.js`
**Issue**: `saveSession(sessionId, ...)` uses `sessionId` directly in `path.join(SESSIONS_DIR, String(sessionId))`. No sanitization — a sessionId like `../../etc` could traverse outside the sessions directory.

### 3.5 API Config Validation Is Incomplete
**Files**: Multiple route files
**Issue**: All routes check `apiConfig?.apiKey`, but none validate `apiBaseUrl` format. `model.js` silently falls through to defaults if fields are missing, which could silently misconfigure.

### 3.6 `NODE_ENV` Check Pattern Misused
**File**: `bridge/src/index.js:31`
**Issue**: The `NODE_ENV !== 'test'` guard prevents the server from listening in test mode, but the test-tools route is loaded regardless. Also, `NODE_ENV` is never set in `.env` or defaulted.

---

## 4. Code Quality / Maintainability (LOW)

### 4.1 `console.log` in Production Code
**Files**: `frontend/src/hooks/useSession.ts:170,183,380`, `bridge/src/logger.js:40-41`
**Issue**: Diagnostic `console.log` calls remain in production hook code. The logger also falls back to `console.log` — acceptable for a logger, but the `useSession` calls are debug artifacts.

### 4.2 Hardcoded Colors Outside CSS Variables
**File**: `frontend/src/styles.css`
**Issue**: Inline `var()` references are fine, but `frontend/src/pages/Dashboard.tsx` uses raw `#F0F9FF`, `#FEF3C7`, `#F0FDF4` etc. directly in JSX styles.

### 4.3 Type Duplication
**Files**: `frontend/src/db/db.ts` (DB records), `frontend/src/types/index.ts` (UI types)
**Issue**: Similar interfaces are defined twice — `AgentRecord`/`AgentType`, `SessionRecord`/`SessionType`, `GeneratedAgentRecord`/`GeneratedAgentType` — causing drift risk.

### 4.4 Unused Imports
**Files**: Multiple frontend files
**Issue**: `frontend/src/pages/Dashboard.tsx` imports `deleteRoom` but only uses it in a try block. Various `React` imports in files not using JSX factories.

### 4.5 Nuwa Skill Files in Bridge Skills Directory
**Issue**: `bridge/skills/nuwa-skill/` contains example persona skills (Karpathy, Musk, etc.) that are part of the nuwa-skill distribution, not project-specific code. These bloat the repo with multi-MB image assets (`6-agents-parallel.png`, `wechat-qrcode.jpg`, etc.).

### 4.6 No Frontend Tests
**Issue**: Frontend has zero test files — no Vitest, Jest, or React Testing Library setup. The entire UI logic (Dexie CRUD, session lifecycle, streaming) is untested.

---

## 5. Summary by Priority

| Priority | Issues | Action |
|----------|--------|--------|
| **HIGH** | Test route in production, plaintext API keys on disk, session ID path traversal, global mutable state, API key in URL query string | Fix immediately |
| **MEDIUM** | Dead code, deprecated AgentConfig, hardcoded bridge URL, no input validation, `console.log` remnants | Fix this sprint |
| **LOW** | Type duplication, unused imports, hardcoded colors, missing frontend tests | Fix opportunistically |
