import { Router } from 'express';
import { piSessionManager } from '../piSessionManager.js';
import { saveSession, loadSession, deleteSessionDir, sessionDirExists } from '../sessionStore.js';
import { sendSSE, setupSSE } from '../sse.js';
import { logger } from '../logger.js';

const router = Router();
const ns = 'route.rooms';

router.post('/create', async (req, res) => {
  try {
    const { sessionId, topic, agents, apiConfig } = req.body;
    if (!sessionId || !topic || !agents || !apiConfig?.apiKey) {
      return res.status(400).json({ error: '缺少必填参数：sessionId、topic、agents、apiConfig.apiKey' });
    }

    const allAgents = [
      ...agents,
      {
        name: '__scribe__',
        skillContent: '你是一名中立的书记官。简洁地总结讨论内容。记录关键观点、共识和分歧。保持中立。',
      },
    ];

    piSessionManager.createSession(sessionId, { agents: allAgents, apiConfig });
    saveSession(sessionId, { topic, agents: allAgents, apiConfig });

    logger.info(ns, 'Room created', { sessionId, topic, agentCount: agents.length });
    res.json({ ok: true });
  } catch (err) {
    logger.error(ns, 'Create failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/chat', async (req, res) => {
  const { agentName, message } = req.body;
  const roomId = req.params.id;

  if (!piSessionManager.hasSession(roomId)) {
    const stored = loadSession(roomId);
    if (stored) {
      piSessionManager.createSession(roomId, { agents: stored.agents, apiConfig: stored.apiConfig });
    } else {
      return res.status(404).json({ error: `房间 ${roomId} 未找到` });
    }
  }

  try {
    setupSSE(req, res);
    const stream = piSessionManager.chatStream(roomId, agentName, message);
    for await (const ev of stream) {
      if (ev.type === 'text_delta') sendSSE(res, 'text_delta', { text: ev.text });
      if (ev.type === 'done') { sendSSE(res, 'done', {}); res.end(); }
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { sendSSE(res, 'error', { message: err.message }); res.end(); }
  }
});

router.post('/:id/summarize', async (req, res) => {
  const roomId = req.params.id;
  const { discussion } = req.body;
  const promptText = '简洁地总结这场讨论。记录关键观点、共识和分歧。保持中立。\n\n' +
    (discussion || []).map(d => `${d.name}: ${d.content}`).join('\n\n');

  if (!piSessionManager.hasSession(roomId)) {
    const stored = loadSession(roomId);
    if (stored) {
      piSessionManager.createSession(roomId, { agents: stored.agents, apiConfig: stored.apiConfig });
    } else {
      return res.status(404).json({ error: `房间 ${roomId} 未找到` });
    }
  }

  try {
    setupSSE(req, res);
    const stream = piSessionManager.chatStream(roomId, '__scribe__', promptText);
    for await (const ev of stream) {
      if (ev.type === 'text_delta') sendSSE(res, 'text_delta', { text: ev.text });
      if (ev.type === 'done') { sendSSE(res, 'done', {}); res.end(); }
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { sendSSE(res, 'error', { message: err.message }); res.end(); }
  }
});

router.delete('/:id', async (req, res) => {
  piSessionManager.deleteSession(req.params.id);
  deleteSessionDir(req.params.id);
  res.json({ ok: true });
});

router.post('/resume', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: '缺少必填参数：sessionId' });

  const stored = loadSession(sessionId);
  if (!stored) return res.status(404).json({ error: `会话 ${sessionId} 在磁盘上未找到` });

  piSessionManager.createSession(sessionId, { agents: stored.agents, apiConfig: stored.apiConfig });
  logger.info(ns, 'Room resumed', { sessionId, agentCount: stored.agents.length });
  res.json({ ok: true, agents: stored.agents.map(a => ({ name: a.name, hasSkill: !!a.skillContent })) });
});

export default router;
