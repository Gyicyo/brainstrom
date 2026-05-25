import { Router } from 'express';
import { roomManager } from '../roomManager.js';
import { sendSSE, setupSSE } from '../sse.js';

const router = Router();

// POST /api/room/create
router.post('/create', async (req, res) => {
  try {
    const { sessionId, topic, agents, scribeApiConfig } = req.body;
    await roomManager.createRoom(sessionId, topic, agents, scribeApiConfig);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/room/:id/chat
router.post('/:id/chat', async (req, res) => {
  const { agentName, message, apiConfig } = req.body;

  try {
    const agent = roomManager.getAgent(req.params.id, agentName);
    setupSSE(req, res);

    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_update' &&
          event.assistantMessageEvent.type === 'text_delta') {
        sendSSE(res, 'text_delta', { text: event.assistantMessageEvent.delta });
      }
      if (event.type === 'tool_execution_start') {
        sendSSE(res, 'tool_start', { name: event.toolName, args: event.args });
      }
      if (event.type === 'tool_execution_end') {
        sendSSE(res, 'tool_end', { name: event.toolName, isError: event.isError });
      }
      if (event.type === 'agent_end') {
        sendSSE(res, 'done', {});
        res.end();
        unsubscribe();
      }
    });

    await agent.prompt({ role: 'user', content: message, timestamp: Date.now() });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      sendSSE(res, 'error', { message: err.message });
      res.end();
    }
  }
});

// POST /api/room/:id/summarize
router.post('/:id/summarize', async (req, res) => {
  const { discussion } = req.body;
  const promptText = 'Summarize this discussion concisely. Capture key points, agreements, and disagreements. Be neutral.\n\n' +
    (discussion || []).map(d => `${d.name}: ${d.content}`).join('\n\n');

  try {
    const agent = roomManager.getScribe(req.params.id);
    setupSSE(req, res);

    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_update' &&
          event.assistantMessageEvent.type === 'text_delta') {
        sendSSE(res, 'text_delta', { text: event.assistantMessageEvent.delta });
      }
      if (event.type === 'agent_end') {
        sendSSE(res, 'done', {});
        res.end();
        unsubscribe();
      }
    });

    await agent.prompt({ role: 'user', content: promptText, timestamp: Date.now() });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { sendSSE(res, 'error', { message: err.message }); res.end(); }
  }
});

// GET /api/room/:id/resume
router.get('/:id/resume', async (req, res) => {
  try {
    const { agents, scribeApiConfig } = req.query;
    const parsedAgents = agents ? JSON.parse(agents) : [];
    const parsedScribe = scribeApiConfig ? JSON.parse(scribeApiConfig) : undefined;
    await roomManager.resumeRoom(req.params.id, parsedAgents, parsedScribe);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/room/:id
router.delete('/:id', async (req, res) => {
  try {
    await roomManager.deleteRoom(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
