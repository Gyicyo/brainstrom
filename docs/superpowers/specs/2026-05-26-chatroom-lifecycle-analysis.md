# Chatroom Session Lifecycle — 问题分析文档 (v2)

> 更新于用户反馈后: `蒸馏专家` 废弃, 会话消失路径澄清

---

## 数据流拓扑

```
Frontend (IndexedDB via Dexie)          Bridge (Node.js: 内存 + 磁盘)
┌─────────────────────────┐            ┌─────────────────────────────────┐
│ 7 张表:                  │            │ PiSessionManager.#sessions     │
│ sessions                 │ createRoom │   (in-memory Map, 重启即空)     │
│ sessionAgents            │ ────────►  │                                 │
│ generatedAgents          │            │ Disk: sessions/{sessionId}/    │
│ rounds                   │            │   meta.json                    │
│ messages                 │            │   agents/{name}/SKILL.md       │
│ threads                  │            │                                 │
│ threadMessages           │            │ Distill 产物:                   │
│                          │            │   sessions/{topic}/            │
│ schemas: `db.ts:75-97`   │            │   distill-results.json         │
│ helpers: `helpers.ts`    │            └─────────────────────────────────┘
└─────────────────────────┘
```

**关键观察**: 前端用 IndexedDB 做主存储（浏览器持久化），桥接用 in-memory Map + 磁盘 fallback。两者通过 REST API 通信，**没有双向同步协议**。每个端独立地认为自己的数据是「权威的」。

---

## Issue 1: 旧会话消失（用户确认场景）

### 用户操作序列
```
T1: 在 Dashboard 打开 → 创建会话 A → 蒸馏 4 个角色
T2: 进讨论室 → 讨论了一段时间
T3: 关了（关闭 tab / 离开页面）
T4: 下次打开 → 创建新会话 B
T5: Dashboard 只显示会话 B，会话 A 不见了
```

### 调查结论
遍历前端全部代码，**未发现任何逻辑会在创建新会话时删除旧会话**。涉及的函数：

| 函数 | 文件 | 行为 |
|------|------|------|
| `createSessionWithRoles` | `helpers.ts:107-127` | 仅 `db.sessions.add()`，不影响已有记录 |
| `deleteSession` | `helpers.ts:51-75` | 只删指定 `id` 的单条 session，未被意外调用 |
| `SessionView.deleteCurrent` | `SessionView.tsx:68-76` | 需用户主动点击「删除」+ confirm |
| `Dashboard.handleDelete` | `Dashboard.tsx:63-67` | 同上，需主动操作 |
| `useSession.load()` | `useSession.ts:119-130` | 只读，不写 |
| `ChatRoom` 任一流转 | — | 均不触发 session 删除 |

### 最可能根因
**浏览器清除了 IndexedDB 数据**（在 T3→T4 之间）。常见触发条件：

| 条件 | 说明 |
|------|------|
| 无痕/隐私模式 | 关闭最后一个隐私标签页时清除所有 IndexedDB |
| 浏览器设置 | 某些浏览器配置为「关闭标签页时清除站点数据」 |
| 存储压力 | `localhost` 的 IndexedDB 在浏览器存储不足时优先被清除 |
| 浏览器更新 | 部分浏览器更新后重置 IndexedDB |

**为什么新会话能幸存**：新会话 B 是在 T4 创建于同一个浏览会话中的，数据从未被清除。

### 可复现性验证建议
1. 在正常（非无痕）模式下重现：创建 Session A，关闭标签页，重新打开 → Dashboard 是否显示 Session A？
2. 检查浏览器 DevTools → Application → IndexedDB → brainstorm → sessions 表是否有数据

### 缓解方案
- 对 IndexedDB 调用 `navigator.storage.persist()` 请求持久存储
- Dashboard 加载时检测 IndexedDB 是否为空 + 桥接是否有待恢复数据
- 增加 IndexedDB 健康检查和用户提示

---

## Issue 2: 「蒸馏专家」模式 → 按用户要求直接删除

Tab 按钮 + `handleDistill` + UI 状态变量 + 关联的 `Route`（如果有），全部移除。

涉及文件:
- `Dashboard.tsx`:
  - `distillStatus`, `distillSkills`, `distillPhase`, `distillContext` 状态变量（`:44-47`）
  - `handleDistill` 函数（`:189-229`）
  - 蒸馏专有 JSX（`:492-591`）
  - `TabButton` 中的 `"distill"` mode 及相关切换逻辑（`:282`）
- `bridgeApi.ts`: `distillExperts` 函数仍然保留（可能被其他功能引用？需 grep 确认）
- `bridge/src/routes/distill.js`: 桥接路由是否保留取决于前端是否还有引用

先从前端移除。如果前端没其他地方引用 `distillExperts`，桥接路由也可以删。

---

## Issue 3: Round 0 不存在导致首屏空状态

### 现象
`createSessionWithRoles` 创建 session 时设置 `current_round: 0`（`Dashboard.tsx:156`）。但 DB 中没有 round 0 记录。`useSession.load()` 在第 124 行调用 `getCurrentRound(sessionId, 0)` 返回 null → `roundDetail` 为 null → ChatRoom 显示空状态「输入初始上下文...」。

直到用户首次发消息触发 `handleCreateRound` → 创建 Round 1 → `updateSession(sessionId, { current_round: 1 })` → 才进入正常流程。

### 影响
- 首次打开 SessionView 显示的是「无内容」状态，而非 session 已就绪
- 如果用户在空状态刷新页面 → `load()` 重新执行 → 还是 null，一切正常（不影响功能）

### 建议
`createSessionWithRoles` 时直接创建 Round 1（而不是等到 `handleCreateRound`），或者让 `load()` 在 round 不存在时返回一个「空 round」而非 null。

---

## Issue 4: `ensureBridgeRoom` 竞态

`handleStartDivergent` 和 `handleMention` 都调 `ensureBridgeRoom(sessionId)`。

`ensureBridgeRoom` 内:
1. `resumeRoom(sessionId)` → 如果桥接没有 → `createRoom(sessionId, ...)`
2. 两个并发调用可能都拿到 `{ok: false}` → 都发起 `createRoom`

桥接端 `piSessionManager.createSession()`:
```javascript
if (this.#sessions.has(sessionId)) {
  this.deleteSession(sessionId);  // 后一个覆盖前一个
}
```

`saveSession` 写入同一目录也可能冲突。

### 修复方向
- `ensureBridgeRoom` 用锁或 flag 防重入
- 或者改用 `resumeRoom` 在前、仅在明确 404 时才 create 的单次尝试模式

---

## Issue 5: Dashboard 删除不清理桥接

```typescript
// useSession.ts — SessionView 删除：双删
handleDeleteSession = async () => {
  await deleteRoom(sessionId);         // 删桥接（内存 + 磁盘）
  await deleteSessionFromDb(sessionId); // 删 IndexedDB
}

// Dashboard.tsx — Dashboard 删除：只删一端
handleDelete = async (e, id) => {
  await deleteSession(id); // 只删 IndexedDB, 桥接残留!
}
```

Dashboard 的删除需要补充 `deleteRoom(id)` 调用。但桥接 `/resume` 在磁盘找不到时返回 404，所以前端会 fallback 到 `createRoom` 重建。残留数据不会导致功能异常，只是磁盘垃圾。

---

## Issue 6: 蒸馏产物路径用 topic 名而非唯一 ID

`handleDistillRoles` 用 sanitized topic 名作为 `sessionDir`:
```typescript
const sessionDir = topic.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
```

但 `handleEnterDiscussion` 用 IndexedDB auto-increment ID 作为桥接 room ID。

两个独立路径:
- `bridge/sessions/<sanitized-topic>/` — 蒸馏产物
- `bridge/sessions/<numeric-id>/` — 活跃房间

如果两次蒸馏相同主题，第一次的结果文件会被覆盖。前端 Dashboard 启动时也不检查蒸馏产物目录。

---

## 问题汇总（按用户优先级）

| # | 优先级 | 描述 | 处理 |
|---|--------|------|------|
| 1 | **高** | 旧会话消失（疑似浏览器清除 IndexedDB） | 加持久化 hint + 诊断 |
| 2 | **高** | 蒸馏专家 tab 死胡同 | 直接删除 |
| 3 | **中** | Round 0 空状态 | `createSessionWithRoles` 时预建 Round 1 |
| 4 | **低** | `ensureBridgeRoom` 竞态 | 加防重入 |
| 5 | **低** | Dashboard 删除不删桥接 | 加 `deleteRoom` 调用 |
| 6 | **低** | 蒸馏产物路径 topic-based | 改用 session ID |

---

## 下一步

根据你的反馈，优先做：
1. **删除蒸馏专家 tab** — 直接从 Dashboard.tsx 移除
2. **消失会话问题** — 先确认是否浏览器 IndexedDB 被清除，再做应对方案
