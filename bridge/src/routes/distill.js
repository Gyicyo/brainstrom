import { Router } from 'express';
import { sendSSE, setupSSE } from '../sse.js';
import { distillExperts } from '../distill.js';

const router = Router();

router.post('/', async (req, res) => {
  const { topic, apiConfig } = req.body;
  if (!topic || !apiConfig?.apiKey) {
    return res.status(400).json({ error: 'topic and apiConfig.apiKey required' });
  }

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  setupSSE(req, res);

  try {
    const skills = await distillExperts(topic, apiConfig, (event) => {
      sendSSE(res, 'phase', event);
    }, abortController.signal);

    if (skills && Array.isArray(skills)) {
      sendSSE(res, 'done', { skills });
    } else if (abortController.signal.aborted) {
      sendSSE(res, 'error', { message: 'Distillation cancelled' });
    } else {
      sendSSE(res, 'error', { message: 'No experts found for this topic' });
    }
  } catch (err) {
    sendSSE(res, 'error', { message: err.message });
  }

  res.end();
});

export default router;
