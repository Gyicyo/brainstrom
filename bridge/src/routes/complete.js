import { Router } from 'express';
import { PiSessionManager } from '../piSessionManager.js';
import { logger } from '../logger.js';

const router = Router();

router.post('/', async (req, res) => {
  const { systemPrompt, userMessage, apiConfig } = req.body;
  if (!apiConfig?.apiKey || !userMessage) {
    return res.status(400).json({ error: '缺少必填参数：apiConfig.apiKey 和 userMessage' });
  }

  try {
    const content = await PiSessionManager.oneShot(systemPrompt, userMessage, apiConfig);
    res.json({ content });
  } catch (err) {
    logger.error('route.complete', 'Failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
