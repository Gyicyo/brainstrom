# Brainstorm Bridge RESTful API

> Bridge server 运行在 `http://localhost:3001`，是前端与 LLM 之间的中间层。
> 所有非 SSE 端点返回 `Content-Type: application/json`。
> SSE 端点使用 `text/event-stream`，事件格式见下方通用约定。

---

## 通用约定

### 错误响应
```json
{
  "error": "描述错误的消息"
}
```
HTTP 状态码：`400`（参数错误） / `500`（服务端错误）。

### SSE（Server-Sent Events）格式
```
event: {eventName}
data: {JSON payload}

```
事件以双换行符分隔。前端可用 `ReadableStream` + `getReader()` 逐行解析。

### 路径前缀
所有 API 挂载在 `/api` 下：
- `GET /api/health`
- `/api/room/*`
- `/api/distill`

---

## 1. 健康检查

### `GET /api/health`

检查 Bridge Server 是否存活。

**Response `200`**
```json
{
  "ok": true,
  "uptime": 123.45
}
```

---

## 2. 房间管理（讨论室生命周期）
> 前缀：`/api/room`

一个 room 对应一个前端 session，包含若干 pi Agent 实例（讨论 Agent + Scribe）。

### 2.1 创建房间

#### `POST /api/room/create`

在 Bridge Server 上创建讨论室，为每个讨论 Agent 初始化 pi Agent 实例（含 SKILL.md 系统提示 + 搜索工具）。同时创建 Scribe Agent 实例。

**Request Body**
```json
{
  "sessionId": 1,
  "topic": "AI Safety in 2026",
  "agents": [
    {
      "name": "Elon Musk",
      "skillContent": "# SKILL.md\n...",
      "apiConfig": {
        "apiBaseUrl": "https://api.openai.com/v1",
        "apiKey": "sk-xxx",
        "modelName": "gpt-4o"
      }
    }
  ],
  "scribeApiConfig": {
    "apiBaseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-xxx",
    "modelName": "gpt-4o"
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `sessionId` | `number` | ✅ | 前端 DB 中的 session ID，用作 room ID |
| `topic` | `string` | ✅ | 讨论主题 |
| `agents` | `array` | ✅ | 讨论 Agent 列表（不含 Scribe） |
| `agents[].name` | `string` | ✅ | Agent 名字 |
| `agents[].skillContent` | `string` | 否 | SKILL.md 完整内容（用作 system prompt） |
| `agents[].apiConfig` | `object` | ✅ | 该 Agent 的 LLM API 凭证 |
| `agents[].apiConfig.apiBaseUrl` | `string` | ✅ | OpenAI 兼容 API 地址 |
| `agents[].apiConfig.apiKey` | `string` | ✅ | API Key |
| `agents[].apiConfig.modelName` | `string` | ✅ | 模型名（如 `gpt-4o`） |
| `scribeApiConfig` | `object` | 否 | Scribe Agent 的 API 凭证（结构与 apiConfig 相同） |

Scribe 的 system prompt 固定为 `"You are a neutral scribe. Summarize discussions concisely."`。

**Response `200`**
```json
{ "ok": true }
```

**Response `500`**
```json
{ "error": "Room 1 already exists" }
```

---

### 2.2 恢复房间

#### `GET /api/room/:id/resume?agents=...&scribeApiConfig=...`

从磁盘恢复已存在的讨论室（重启后使用）。

**Query Parameters**
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `agents` | `string` | ✅ | URL-encoded JSON，格式同 `POST /create` 的 `agents` |
| `scribeApiConfig` | `string` | 否 | URL-encoded JSON，格式同 `POST /create` 的 `scribeApiConfig` |

**Response `200`**
```json
{ "ok": true }
```

---

### 2.3 删除房间

#### `DELETE /api/room/:id`

释放所有 Agent 实例（调用 `agent.dispose()`），删除磁盘上的 `sessions/room-{id}/` 目录。

**Response `200`**
```json
{ "ok": true }
```

---

## 3. Agent 对话（SSE 流式）
> 前缀：`/api/room/:id`

### 3.1 发送消息给指定 Agent

#### `POST /api/room/:id/chat`

向 room 内指定 Agent 发送消息，返回 SSE 流式响应。

**Request Body**
```json
{
  "agentName": "Elon Musk",
  "message": "What's your take on this?",
  "apiConfig": {
    "apiBaseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-xxx",
    "modelName": "gpt-4o"
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `agentName` | `string` | ✅ | Agent 名字（需匹配创建时提供的 name） |
| `message` | `string` | ✅ | 用户消息内容 |
| `apiConfig` | `object` | 否 | 备用 API 凭证（通常创建时已配置） |

**SSE Events**

| 事件名 | 数据载荷 | 说明 |
|--------|----------|------|
| `text_delta` | `{ "text": "一部分..." }` | 文本片段 |
| `tool_start` | `{ "name": "search_web", "args": { "query": "..." } }` | Agent 开始执行工具调用 |
| `tool_end` | `{ "name": "search_web", "isError": false }` | 工具调用结束 |
| `done` | `{}` | 响应流结束 |
| `error` | `{ "message": "..." }` | 错误（可能在任何阶段出现） |

**Example SSE Output**
```
event: text_delta
data: {"text":"I think the main challenge is alignment..."}

event: done
data: {}

```

**注意**：如果请求头尚未发送即发生错误，返回 HTTP 500 JSON；如果已开始 SSE 流，错误通过 SSE `error` 事件传递。

---

### 3.2 Scribe 总结（SSE 流式）

#### `POST /api/room/:id/summarize`

让 Scribe Agent 总结讨论内容，返回 SSE 流式响应。

**Request Body**
```json
{
  "discussion": [
    { "name": "Elon Musk", "content": "..." },
    { "name": "Sam Altman", "content": "..." }
  ]
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `discussion` | `array` | ✅ | 讨论消息列表 |
| `discussion[].name` | `string` | ✅ | 发言人 |
| `discussion[].content` | `string` | ✅ | 发言内容 |

**SSE Events**

| 事件名 | 数据载荷 | 说明 |
|--------|----------|------|
| `text_delta` | `{ "text": "..." }` | 总结文本片段 |
| `done` | `{}` | 总结完成 |
| `error` | `{ "message": "..." }` | 错误 |

---

## 4. 专家蒸馏（Nuwa-skill 流水线）
> 前缀：`/api/distill`

### 4.1 启动蒸馏

#### `POST /api/distill`

分两阶段执行：
1. **搜索专家**：用搜索 Agent 识别与主题相关的 3-5 位真实专家
2. **蒸馏技能**：为每位专家创建独立 Nuwa Agent，三轮对话生成 SKILL.md

**Request Body**
```json
{
  "topic": "AI risk and safety",
  "apiConfig": {
    "apiKey": "sk-xxx",
    "apiBaseUrl": "https://api.openai.com/v1",
    "modelName": "gpt-4o"
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `topic` | `string` | ✅ | 蒸馏主题 |
| `apiConfig.apiKey` | `string` | ✅ | API Key |
| `apiConfig.apiBaseUrl` | `string` | ✅ | OpenAI 兼容 API 地址 |
| `apiConfig.modelName` | `string` | ✅ | 模型名 |

**SSE Events**

| 事件名 | 数据载荷 | 阶段 | 说明 |
|--------|----------|------|------|
| `phase` | `{ "phase": "search", "status": "..." }` | 搜索 | 搜索进度信息 |
| `phase` | `{ "phase": "search_result", "experts": ["Elon Musk", ...] }` | 搜索 | 找到的专家列表 |
| `phase` | `{ "phase": "distilling", "expert": "Elon Musk", "progress": "1/3 Collecting public materials..." }` | 蒸馏 | 每位专家的蒸馏进度 |
| `phase` | `{ "phase": "skill_ready", "expert": "Elon Musk", "name": "elon-musk", "content": "# SKILL.md\n..." }` | 蒸馏 | 每位专家的 SKILL.md 就绪 |
| `done` | `{ "skills": [{ "name": "elon-musk", "displayName": "Elon Musk", "content": "# SKILL.md\n..." }] }` | 完成 | 所有蒸馏完成，返回完整结果 |
| `error` | `{ "message": "..." }` | — | 错误 |

**Example SSE Output**
```
event: phase
data: {"phase":"search","status":"Searching for experts related to \"AI risk and safety\"..."}

event: phase
data: {"phase":"search_result","experts":["Elon Musk","Paul Christiano"]}

event: phase
data: {"phase":"distilling","expert":"Elon Musk","progress":"1/3 Collecting public materials..."}

event: phase
data: {"phase":"skill_ready","expert":"Elon Musk","name":"elon-musk","content":"# SKILL.md\n..."}

event: done
data: {"skills":[{"name":"elon-musk","displayName":"Elon Musk","content":"..."}]}
```

**前端取消**：如果客户端断开连接（`req.on('close')`），Bridge 自动调用 `AbortController.abort()` 停止所有进行中的 LLM 调用和蒸馏。

---

## 5. 架构说明

```
Browser (React)                    Bridge (Node.js)                      LLM API
     │                                  │                                  │
     │── POST /api/room/create ────────→│                                  │
     │                                  │── new Agent(streamFn) ─────────→│
     │                                  │←────── Agent instance ──────────│
     │                                   │                                  │
     │── POST /api/room/:id/chat ──────→│                                  │
     │                                  │── agent.prompt() ───────────────→│
     │←── SSE: text_delta ─────────────│←────── SSE chunks ───────────────│
     │←── SSE: tool_start/tool_end ────│←───── tool execution ────────────│
     │←── SSE: done ──────────────────│                                  │
     │                                   │                                  │
     │── POST /api/room/:id/summarize ─→│                                  │
     │                                  │── scribe.prompt() ─────────────→│
     │←── SSE: text_delta / done ──────│←────── SSE chunks ───────────────│
     │                                   │                                  │
     │── DELETE /api/room/:id ─────────→│                                  │
     │                                  │── agent.dispose() ─────────────→│
```

- Bridge 用 pi `Agent` 类管理每个 Agent 的生命周期
- 每个 Agent 有独立的 `streamFn`（指向各自的 API 地址/模型）
- 工具调用（`search_web`）在 Bridge 端由 pi Agent 内部自动执行
- 前端只需消费 SSE 事件流，无需处理工具调用逻辑
