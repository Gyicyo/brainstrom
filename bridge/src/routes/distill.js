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
  req.on('close', () => {
    console.error('[distill-route] request closed, aborting');
    abortController.abort();
  });

  console.error('[distill-route] setupSSE start');
  setupSSE(req, res);
  console.error('[distill-route] setupSSE done');

  try {
    console.error('[distill-route] calling distillExperts...');
    const skills = await distillExperts(topic, apiConfig, (event) => {
      sendSSE(res, 'phase', event);
    }, abortController.signal);
    console.error('[distill-route] distillExperts returned, skills length:', skills?.length, 'aborted:', abortController.signal.aborted);

    if (skills && Array.isArray(skills)) {
      sendSSE(res, 'done', { skills });
    } else if (abortController.signal.aborted) {
      sendSSE(res, 'error', { message: 'Distillation cancelled' });
    } else {
      sendSSE(res, 'error', { message: 'No experts found for this topic' });
    }
  } catch (err) {
    console.error('[distill-route] caught error:', err.message);
    sendSSE(res, 'error', { message: err.message });
  }

  console.error('[distill-route] calling res.end()');
  res.end();
});

export default router;
