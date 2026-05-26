# ChatRoom 工作流程文档

## 文件位置
- `frontend/src/components/ChatRoom.tsx` — 纯展示组件（409 行）
- `frontend/src/hooks/useSession.ts` — 状态管理 + 桥接通信（394 行）
- `frontend/src/pages/SessionView.tsx` — 页面宿主

## Props 接口

```tsx
interface Props {
  sessionId: number;
  roundDetail: RoundDetailType | null;   // 核心数据（null = 未创建 round）
  onSendMention: (agentIds: number[], question: string) => void;
  onCreateRound: (initialMessage: string) => void;
  onStartDivergent: () => void;
  onStartNextRound: () => void;
  onEndRound: () => void;
  loading: boolean;
  streamingAgentIds?: Set<number>;
  streamContents?: Record<number, string>;
  isStreaming?: boolean;
  streamingScribeContent?: string | null;
}
```

所有回调都直接映射到 `useSession` 的同名 `handle*` 方法。

---

## 三段状态机

### State A — 未创建 round（`roundDetail === null`）
```
ChatRoom 第 110 行:
if (!roundDetail) { ... return }  ← 直接 return，不渲染下面的布局
```

**触发**: 用户刚进 session，或 `load()` 失败。

**UI**: 全屏居中布局，顶部 p 标签提示 + textarea + "发送"按钮。

**流转**:
```
用户输入 → 点击"发送" → onCreateRound(initialContext)
  → useSession.handleCreateRound(initialMessage)
    → createRound({ round_number: nextNum })
    → updateSession({ current_round: nextNum })
    → if (initialMessage) createMessage({ is_human: true, content: initialMessage })
    → buildDetail() → setRoundDetail(detail)
    → loading = false
  → ChatRoom 重新渲染：roundDetail 有值 → 进入 State B
```

---

### State B — Round 已创建，但发散未开始（`hasDivergentStarted === false`）
```
ChatRoom 第 148 行:
const hasDivergentStarted = current_round.public_messages.some(m => !m.is_human)

第 291 行:
{!hasDivergentStarted && ( ... )}
```

**UI**: 消息区底部居中显示提示文字 + "开始角色讨论"按钮。

**消息区布局**（第 176 行）:
1. history（上一轮的可折叠回顾）
2. RoundDivider（"第 X 轮"分割线）
3. public_messages（此时为空，显示"等待各角色回复..."）
4. private_threads（此时为空）
5. scribe_summary（此时为空）
6. **State B 内容**：开始按钮

**流转**:
```
点击"开始角色讨论" → onStartDivergent()
  → useSession.handleStartDivergent()
    → ensureBridgeRoom(resume|create)
    → 为每个 nonScribeAgent 创建 empty Message（content: ''）
    → 重新 buildDetail() 让消息区显示空占位
    → setStreamingAgentIds(all agents)
    → setStreamContents({agentId: ''})
    → Promise.allSettled(streamChat × N)
    → 流结束后 updateMessage({content: full})
    → streamingAgentIds 逐个删除
    → load() 刷新 roundDetail
    → loading = false
  → ChatRoom：public_messages 有 AI 消息 → 进入 State C
```

**streamChat 调用链路**（bridgeApi.ts 第 3 行）:
```
streamChat(sessionId, agentName, message)
  → fetch POST /api/room/{sessionId}/chat { agentName, message }
  → SSE: text_delta { text: "..." }
  → yield text, 逐 token 累加
  → [DONE] 结束
```

`message` 参数 = `roundDetail.session.topic`（session 创建时的主题）。

---

### State C — 发散已开始（`hasDivergentStarted === true`）
```
ChatRoom 第 315 行:
{hasDivergentStarted && ( ... )}
```

**UI 结构**（从下到上，flex 列）:
```
┌─────────────────────────────────────┐
│ AgentStatusBar (online/streaming 点) │  ← 折叠的，在顶部
├─────────────────────────────────────┤
│ 流式横幅 (isStreaming 时显示)        │
├─────────────────────────────────────┤
│ 滚动消息区 (flex: 1, minHeight: 0)   │
│  ├─ 历史轮次 (可折叠)                │
│  ├─ RoundDivider                    │
│  ├─ public_messages                 │
│  │  └─ MessageBubble × N            │
│  ├─ private_threads                 │
│  │  └─ MessageBubble × N            │
│  └─ scribe_summary (流式/静态)       │
├─────────────────────────────────────┤
│ @mention 区                          │
│  ├─ agent 标签 pills (checkbox 风格) │
│  ├─ 文本输入 + @发送按钮              │
│  └─ 全选/取消按钮                     │
├─────────────────────────────────────┤
│ 轮次控制                              │
│  ├─ "结束本轮并总结"                   │
│  └─ "开始下一轮"                      │
└─────────────────────────────────────┘
```

---

## 核心子组件

### AgentStatusBar（`frontend/src/components/AgentStatusBar.tsx`）
- 渲染所有 nonScribeAgent，显示在线/流式状态点
- `streamingAgentIds?.has(a.id)` → 绿色点 + thinking dots

### RoundDivider（`frontend/src/components/RoundDivider.tsx`）
- 简单的分割线 + "第 X 轮"文字

### MessageBubble（`frontend/src/components/MessageBubble.tsx`）
- 接受 `message: MessageType` + `isHuman` + `streamingContent?`
- 三种渲染模式:
  1. **Thinking**: `streamingContent === '' && !message.content` → 显示"思考中..." + 动画点
  2. **Streaming**: `streamingContent !== undefined` → 直接显示累加文本（纯文本，无 markdown）
  3. **Final**: `streamingContent === undefined` → ReactMarkdown 渲染 + 可折叠（>120 字或含换行）

---

## 数据流转细节

### 历史轮次加载（第 44-83 行）
```
依赖: [roundDetail, sessionId]
条件: current_round.round_number > 1
操作:
  1. getRounds(sessionId) → 所有轮次
  2. getSessionAgents(sessionId) → agent 映射
  3. genAgentId → genNameMap（generatedAgents）
  4. presetAgentId → presetNameMap（preset agents）
  5. 遍历 < currentNum 的轮次:
     getRoundMessages(round.id!) → messages[]
  6. setHistory(RoundHistory[])
```

作用: 让用户折叠回顾以前的轮次内容。

### 数据流图
```
SessionView
  └─ useSession(sessionId)
       ├─ state: roundDetail, loading, streaming*, streamContents
       ├─ handleCreateRound()    → DB + setRoundDetail
       ├─ handleStartDivergent() → Bridge SSE → DB update → load()
       ├─ handleMention()        → DB createThread + Bridge SSE → load()
       ├─ handleEndRound()       → Bridge SSE scribe → DB update → load()
       └─ handleStartNextRound() → handleCreateRound('')
  └─ ChatRoom
       ├─ props ← useSession states
       └─ callbacks → useSession handles
```

### 流式渲染架构

**handleStartDivergent**（useSession 第 181 行）:
```typescript
// 1. 初始化空流式 key
setStreamContents(Object.fromEntries(agentIds.map(id => [id, ''])))

// 2. 并发流
const promises = entries.map(async ({ agentId, agentName, messageId }) => {
  let full = ''
  for await (const token of streamChat(sessionId, agentName, topic)) {
    full += token
    setStreamContents(prev => ({ ...prev, [agentId]: full }))  // 每次 token 更新
  }
  await updateMessage(messageId, { content: full })
})
// 完成后 load() 刷新完整数据
```

**handleMention**（useSession 第 242 行）:
```typescript
// 每个 agent 创建一个 thread
for (const agentId of agentIds) {
  const tid = await createThread(...)
  const tmid = await createThreadMessage({ content: '' })  // placeholder

  setStreamingAgentIds(prev => new Set(prev).add(agentId))
  setStreamContents(prev => ({ ...prev, [agentId]: '' }))  // 同 key！

  (async () => {
    let full = ''
    for await (const token of streamChat(...)) {
      full += token
      setStreamContents(prev => ({ ...prev, [agentId]: full }))
    }
    await updateThreadMessage(tmid, { content: full })
    // cleanup...
  })()
}
```

**streamContents key 碰撞问题**:
- 发散消息和 thread 回复都用 `agentId` 作为 key
- 如果两者同时流（或先后流），后开始的那个会覆盖前一个的内容
- 在 ChatRoom 中渲染时（第 247 行）也是查 `streamContents?.[m.agent_id]`，无法区分

---

## 追问（@mention）流程

```
用户在 State C 底部:
  1. 勾选 agent pills（多选）
  2. 输入文本
  3. 点 "@发送" 或 Enter
→ onSendMention(selectedAgentIds, mentionText)
→ handleMention(agentIds, question)
  → ensureBridgeRoom()
  → for each agentId:
    → createThread(round_id, agent_id) → tid
    → createThreadMessage(thread_id, is_human: true)  // 用户问题
    → createThreadMessage(thread_id, is_human: false)  // 空占位
    → streamingAgentIds.add(agentId)
    → streamContents[agentId] = ''
    → streamChat(sessionId, agentName, question)
    → 逐 token 更新 streamContents[agentId]
    → 完成后 updateThreadMessage → load()
  → buildDetail() 刷新 roundDetail
```

### @mention 区的交互缺陷
- "勾选 → 输入 → 发送"三步割裂，不能直接在文本里 @人名
- 全选按钮和 pills 都在同一行，空间拥挤
- `isStreaming` 时整区 disable，包括已完成的 agent

---

## 轮次控制

### "结束本轮并总结"
```
onEndRound() → handleEndRound()
  → getRoundMessages(roundId) + getRoundThreads
  → 拼接 discussionText（人名: 内容）
  → streamScribeSummary(sessionId, discussion)
  → SSE 流式 scribe 内容 → setStreamingScribeContent(summary)
  → updateRound({ scribe_summary })
  → load()
```

### "开始下一轮"
```
onStartNextRound() → handleStartNextRound()
  → handleCreateRound('')
    → createRound({ round_number: current + 1 })
    → updateSession({ current_round: newNum })
    → setRoundDetail(detail)  ← 新 round，无消息 → State B
```

**问题**: `handleCreateRound('')` 用空字符串调用，创建 round 但无初始消息。
- 对于 round 2+，State B 的文字仍是"初始上下文已提交"，不准确
- 无法为第二轮提供新背景信息

---

## 边界情况

### 流式完成后清理
```
setStreamContents(prev => {
  const { [agentId]: _, ...rest } = prev
  return rest
})
setStreamingAgentIds(prev => {
  const next = new Set(prev)
  next.delete(agentId)
  return next
})
load()
```

### AbortController
- `abortRef` 在 `useEffect` cleanup 时调 `abortRef.current?.abort()`
- `handleStartDivergent` 和 `handleMention` 各自创建新 `AbortController`
- **问题**: 如果 `handleMention` 覆盖了 `abortRef`，会 abort 正在进行的 divergent 流

### 防重复
- 只有 `loading === false && !isStreaming` 时按钮才可点击
- State B 的 "开始角色讨论" 在 loading/isStreaming 时禁用
- State C 的全部控制按钮在 loading/isStreaming 时禁用
- mention 区全部按钮在 isStreaming 时 disable + opacity 0.5

### 错误处理
- useSession 中每个 `handle*` 都有 try-catch，设 `setError(e.message)`
- SessionView 在 header 下渲染 error 横幅（红色背景）
- ChatRoom 不直接处理 error，只通过 `loading` 状态感知

---

## 已知缺陷

| 位置 | 问题 |
|------|------|
| State A | 仅在 roundDetail === null 时触发，但 `handleCreateRound('')` 对 round 2+ 也会先设 loading=true（旧 roundDetail 闪烁），然后 setRoundDetail（新 round State B） |
| State B 文字 | "初始上下文已提交。准备开始角色讨论？" 对 round 2+ 不准确；无 input 输入新上下文 |
| @mention | 勾选 pills + 独立输入框，流程割裂；用户期望直接在文本里 @人名 |
| streamContents key | 发散 + thread 都用 agentId 做 key，后开始的覆盖前一个 |
| abortRef 覆盖 | `handleMention` 在 for 循环中每次都创建新的 AbortController 并覆盖 `abortRef.current`，可能导致旧流被误中断 |
| thread 流式渲染 | `streamContents?.[t.agent_id]` → 如果是发散流 key，会错误地显示发散内容在 thread 位置 |
| history 加载 | 全部查完后一次性 `setHistory`，多轮次时延迟明显 |
