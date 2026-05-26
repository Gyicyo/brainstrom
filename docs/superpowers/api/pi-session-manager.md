# PiSessionManager — 统一的 pi-agent-core 接口

> **文件**: `bridge/src/piSessionManager.js`
>
> PiSessionManager 是 bridge 与 `@earendil-works/pi-agent-core` 之间的唯一桥梁。所有 LLM 交互（对话、补全、技能管理）都必须通过此接口，禁止直接调用 `streamSimple`、`fetch` 或 `Agent` 构造函数。

---

## 导出

| 导出名 | 类型 | 说明 |
|--------|------|------|
| `piSessionManager` | `PiSessionManager` 实例（单例） | 有状态方法（session 管理、对话） |
| `PiSessionManager` | 类本身 | 静态方法 `oneShot()` 需要类名调用 |

```js
import { piSessionManager, PiSessionManager } from '../piSessionManager.js';
```

---

## 全局配置

所有 pi Agent 使用同一套 `apiConfig`：

```js
const apiConfig = {
  apiKey: 'sk-...',
  apiBaseUrl: 'https://api.deepseek.com',
  modelName: 'deepseek-v4-flash',
};
```

Agent 的 LLM 调用通过 `buildModel(apiConfig)` 构建 model 对象，经 `streamSimple()` 发往 LLM API。`apiKey` 自动传入 `streamSimple` 的 options，不在请求载荷中暴露。

如果 Agent 提供了 `skillContent`，它变成 system prompt 的一部分；否则使用默认 prompt。

---

## 方法参考

### 1. `createSession(sessionId, { agents, apiConfig })`

创建一组 pi Agent，组成一个 session。如果 `sessionId` 已存在则先删除再重建。

**参数**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `sessionId` | `string\|number` | ✅ | 会话 ID（通常为前端 session.id） |
| `agents` | `array` | ✅ | Agent 配置列表 |
| `agents[].name` | `string` | ✅ | Agent 名称，全局唯一 |
| `agents[].systemPrompt` | `string` | 否 | 自定义 system prompt（优先级高于 skillContent） |
| `agents[].skillContent` | `string` | 否 | SKILL.md 内容，自动嵌入 system prompt |
| `apiConfig` | `object` | ✅ | 全局 LLM 配置 |
| `apiConfig.apiKey` | `string` | ✅ | |
| `apiConfig.apiBaseUrl` | `string` | ✅ | |
| `apiConfig.modelName` | `string` | ✅ | |

**示例**

```js
piSessionManager.createSession(1, {
  agents: [
    { name: 'bob', skillContent: 'You are an AI safety researcher.' },
    { name: 'scribe', systemPrompt: 'You are a neutral note-taker.' },
  ],
  apiConfig: { apiKey: 'sk-...', apiBaseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash' },
});
```

---

### 2. `chat(sessionId, agentName, message) → Promise<string>`

向 session 内指定 Agent 发送消息，等待完整响应后返回。

**参数**
- `sessionId` — 之前 `createSession` 使用的 ID
- `agentName` — 与创建时的 `name` 一致
- `message` — 用户消息文本

**返回值**: 完整的 assistant 回复文本。

**示例**

```js
const reply = await piSessionManager.chat(1, 'bob', 'What do you think?');
console.log(reply); // "I think alignment is the key challenge..."
```

---

### 3. `chatStream(sessionId, agentName, message) → AsyncGenerator`

与 `chat` 相同但返回异步生成器，逐个 yield 事件。

**yield 事件**

| `type` | `text` | 说明 |
|--------|--------|------|
| `'text_delta'` | 文本片段 | 累积到完整响应 |
| `'done'` | — | 流结束 |

出错时生成器 throw `Error`。

**示例**

```js
const stream = piSessionManager.chatStream(1, 'bob', 'Tell me more');
try {
  for await (const ev of stream) {
    if (ev.type === 'text_delta') sendSSE(res, 'text_delta', { text: ev.text });
    if (ev.type === 'done') { sendSSE(res, 'done', {}); res.end(); }
  }
} catch (err) {
  sendSSE(res, 'error', { message: err.message });
  res.end();
}
```

---

### 4. `addSkill(sessionId, agentName, skillContent)`

替换指定 Agent 的 skill。内部重新创建 pi Agent 实例。

**参数**
- `skillContent` — 新的 SKILL.md 内容

**示例**

```js
piSessionManager.addSkill(1, 'bob', '# SKILL.md\n...updated content...');
```

---

### 5. `hasSession(sessionId) → boolean`

检查 session 是否存在。

---

### 6. `getAgentNames(sessionId) → string[]`

返回 session 内所有 Agent 名称。session 不存在返回空数组。

---

### 7. `deleteSession(sessionId)`

删除 session 及其所有 Agent。

---

### 8. `PiSessionManager.oneShot(systemPrompt, userMessage, apiConfig) → Promise<string>`（静态）

无需创建 session，一次性 LLM 补全。内部直接调用 `streamSimple`，不使用 Agent 类。

**参数**
- `systemPrompt` — 系统提示（可选，默认 `'You are a helpful assistant.'`）
- `userMessage` — 用户消息
- `apiConfig` — 标准 apiConfig 对象

**返回值**: LLM 回复文本。

**示例**

```js
const result = await PiSessionManager.oneShot(
  'You are a role research agent. Return JSON.',
  'Find roles related to Egyptian history.',
  apiConfig,
);
```

---

## 内部架构

```
Route Handler                           PiSessionManager               pi-agent-core
─────────────────────────────────────────────────────────────────────────────────────
createSession()  ──────────────────→    createSession()
                                         ├── buildModel(apiConfig)
                                         ├── new Agent({ name, initialState, streamFn })
                                         │     └── streamFn → streamSimple(model, ctx, { apiKey })
                                         └── store in #sessions Map
                                             Map<sessionId, { agents: Map<name, { agent, config }>, model, apiConfig }>

chatStream()  ─────────────────────→    chatStream()
                                         ├── #getAgent(sessionId, name)  ←─ lookup in Map
                                         ├── agent.subscribe(callback)   ←─ pi event loop
                                         ├── agent.prompt(message)       ←─ triggers LLM call
                                         │     └── streamFn fires text_delta events
                                         └── yield events                ←─ bridge to HTTP SSE
```

---

## 开发规约

1. **所有新的 LLM 调用路由必须使用 PiSessionManager，禁止直接调用 `streamSimple` 或 `fetch`。**
2. 如果路由需要长时间运行且不需要 Agent 上下文（如搜索角色），使用 `PiSessionManager.oneShot()`。
3. 如果路由需要多轮对话上下文（如讨论室），使用 `createSession()` + `chat()` / `chatStream()`。
4. `addSkill()` 会重新创建 Agent 实例——频繁调用有性能开销。
5. 所有方法自带 `logger.info/debug/error` 日志（namespace `piSession.*`），无需额外打日志。
