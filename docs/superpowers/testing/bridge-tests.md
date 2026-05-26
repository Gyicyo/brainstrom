# Bridge Server 测试文档

## 运行方式

```bash
cd bridge
npm test           # 单次运行
npm run test:watch # Watch 模式
```

全部 15 个测试通过，运行时间 ~1s。

---

## 测试分类与详情

### 1. searchTool（单元测试）

测试源：`bridge/src/searchTool.js`

#### 1.1 returns a tool object with correct structure

- **输入**: 无（`createSearchTool()`）
- **预期输出**: 返回对象包含 `name: 'search_web'`、`label: 'Search Web'`、`description`、`parameters`（含 `required: ['query']`）、`execute` 函数
- **实际输出**: ✅ 全部匹配

#### 1.2 execute returns an error result when fetch fails

- **输入**: `tool.execute('call-1', {}, null, vi.fn())`，此时全局 `fetch` 被 mock 为 `mockRejectedValue(new Error('fetch-mock'))`
- **预期输出**: `result.content[0].text` 包含 `'Search failed'`
- **实际输出**: ✅ `result.content[0].text` = `"Search failed: fetch-mock"`
- **副作用**: stderr 打印 `[searchTool] error: fetch-mock`

---

### 2. SSE utilities（单元测试）

测试源：`bridge/src/sse.js`

#### 2.1 sendSSE writes a formatted SSE event

- **输入**: `sendSSE(res, 'my_event', { hello: 'world' })`，其中 `res.write` 为 vi.fn()
- **预期输出**: 依次调用 `res.write('event: my_event\n')` 和 `res.write('data: {"hello":"world"}\n\n')`
- **实际输出**: ✅ 两次 write 调用参数精确匹配

#### 2.2 setupSSE sets headers, writes leading newline, returns res

- **输入**: `setupSSE({}, res)`，其中 `res.writeHead` 和 `res.write` 为 vi.fn()
- **预期输出**:
  - `writeHead` 被调用：status=200，headers 包含 `Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`、`X-Accel-Buffering: no`
  - `write` 被调用：参数为 `'\n'`
  - 返回 `res`
- **实际输出**: ✅ 全部匹配

---

### 3. createStreamFn（单元测试）

测试源：`bridge/src/streamFn.js`

#### 3.1 returns a function

- **输入**: `createStreamFn({ apiBaseUrl, apiKey, modelName })`，`fetch` 被 mock
- **预期输出**: 返回结果 `typeof === 'function'`
- **实际输出**: ✅

#### 3.2 returned function returns an object with push and end

- **输入**: `streamFn('gpt-4', { messages: [], tools: [] }, {})`
- **预期输出**: 返回对象包含 `push` 和 `end` 属性，均为 `function`
- **实际输出**: ✅

---

### 4. HTTP — Health（集成测试）

测试源：`bridge/src/index.js`

#### 4.1 GET /api/health returns 200 with ok true

- **输入**: HTTP GET `/api/health`
- **预期输出**: status=200，body 含 `{ ok: true, uptime: <number> }`
- **实际输出**: ✅ status=200，body 含 `ok: true` 和 `uptime`（当前 Node 进程运行秒数）

---

### 5. HTTP — Room CRUD（集成测试）

测试源：`bridge/src/routes/rooms.js` + `bridge/src/roomManager.js`

**共用 payload**:

```json
{
  "name": "bob",
  "skillContent": "You are Bob.",
  "apiConfig": {
    "apiKey": "sk-test",
    "apiBaseUrl": "https://api.openai.com",
    "modelName": "gpt-4"
  }
}
```

#### 5.1 POST /api/room/create with valid body returns 200

- **输入**: HTTP POST `/api/room/create`
  ```json
  {
    "sessionId": "test-session",
    "topic": "AI Safety",
    "agents": [{ "name": "bob", "skillContent": "You are Bob.", "apiConfig": { "apiKey": "sk-test", "apiBaseUrl": "https://api.openai.com", "modelName": "gpt-4" } }],
    "scribeApiConfig": { "apiKey": "sk-test", "apiBaseUrl": "https://api.openai.com", "modelName": "gpt-4" }
  }
  ```
- **预期输出**: status=200, body = `{ ok: true }`
- **实际输出**: ✅ status=200, body = `{ ok: true }`
- **副作用**: `sessions/room-test-session/` 目录被创建，含 `meta.json`

#### 5.2 POST /api/room/create with missing fields returns 400

- **输入**: HTTP POST `/api/room/create`，body = `{}`
- **预期输出**: status=400, body 含 `error` 字段
- **实际输出**: ✅ status=400, body = `{ "error": "sessionId, topic, and agents are required" }`

#### 5.3 POST /api/room/:id/chat returns 404 for non-existent room

- **输入**: HTTP POST `/api/room/nonexistent/chat`，body = `{ "agentName": "bob", "message": "hello" }`
- **预期输出**: status=404，body 含 `error` 字段
- **实际输出**: ✅ status=404，body = `{ "error": "Room nonexistent not found" }`

#### 5.4 DELETE /api/room/:id returns 200 even for non-existent room

- **输入**: HTTP DELETE `/api/room/ghost-room`
- **预期输出**: status=200，body = `{ ok: true }`
- **实际输出**: ✅ status=200，body = `{ ok: true }`（非存在 room 的删除被静默忽略）

---

### 6. HTTP — Distill endpoint（集成测试）

测试源：`bridge/src/routes/distill.js`

#### 6.1 POST /api/distill without API key returns 400

- **输入**: HTTP POST `/api/distill`，body = `{ "topic": "AI", "apiConfig": {} }`
- **预期输出**: status=400，body 含 `error` 字段
- **实际输出**: ✅ status=400，body = `{ "error": "topic and apiConfig.apiKey required" }`

#### 6.2 POST /api/distill with valid body returns SSE headers

- **输入**: HTTP POST `/api/distill`
  ```json
  {
    "topic": "AI Safety",
    "apiConfig": { "apiKey": "sk-test", "apiBaseUrl": "https://api.openai.com", "modelName": "gpt-4" }
  }
  ```
  （`fetch` 被 mock，`Agent.prompt()` 自动触发 `agent_end`）
- **预期输出**: status=200，`content-type` = `text/event-stream`
- **实际输出**: ✅ status=200，`content-type` = `text/event-stream`；body 包含 SSE 格式的 `event: error` + `event: error`（无专家时返回错误）

---

### 7. Distill module（单元测试）

测试源：`bridge/src/distill.js`

#### 7.1 distillExperts returns empty array when search agent returns no experts

- **输入**: `distillExperts('Quantum Physics', { apiKey, apiBaseUrl, modelName }, onProgress)`，`fetch` mock 拒绝
- **预期输出**: 返回 `[]`，`onProgress` 依次被调用：
  - `{ phase: 'search', status: <任意字符串> }`
  - `{ phase: 'search_result', experts: [] }`
- **实际输出**: ✅ 返回 `[]`，两次 `onProgress` 调用匹配预期

#### 7.2 promptAndCollect resolves when agent completes

- **输入**: `promptAndCollect(agent, 'Say hello')`，其中 `agent` 从 mock 的 `@earendil-works/pi-agent-core` 创建，`agent.prompt()` 立即触发 `agent_end` 事件
- **预期输出**: 返回一个字符串（mock agent 的 text_delta 不产生内容，所以为空字符串 `''`）
- **实际输出**: ✅ 返回 `''`（`typeof result === 'string'`）

---

## 覆盖率摘要

| 模块 | 文件 | 测试数 | 覆盖内容 |
|------|------|--------|----------|
| searchTool | `src/searchTool.js` | 2 | 结构、错误处理 |
| SSE | `src/sse.js` | 2 | `sendSSE`、`setupSSE` |
| streamFn | `src/streamFn.js` | 2 | 工厂函数返回类型、stream 结构 |
| Health | `src/index.js` | 1 | Health endpoint |
| Room CRUD | `src/routes/rooms.js` + `src/roomManager.js` | 4 | 创建、缺失字段、不存在的 room、删除 |
| Distill HTTP | `src/routes/distill.js` | 2 | 缺少 API key、正常请求的 SSE headers |
| Distill 模块 | `src/distill.js` | 2 | `distillExperts`（无 expert 时返回空数组）、`promptAndCollect` |
| **总计** | 7 个源文件 | **15** | |
