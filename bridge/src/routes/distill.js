import { Router } from 'express';
import { sendSSE, setupSSE } from '../sse.js';
import { distillExperts } from '../distill.js';
import { logger } from '../logger.js';

const router = Router();

router.post('/', async (req, res) => {
  const { topic, apiConfig, context } = req.body;
  const ns = 'route.distill';

  logger.info(ns, 'POST /api/distill received', {
    topic,
    hasContext: !!context,
    contextLength: context?.length || 0,
    hasApiKey: !!apiConfig?.apiKey,
    apiKeyMasked: apiConfig?.apiKey ? logger.maskKey(apiConfig.apiKey) : 'NONE',
    modelName: apiConfig?.modelName,
    baseUrl: apiConfig?.apiBaseUrl,
  });

  if (!topic || !apiConfig?.apiKey) {
    logger.warn(ns, 'Validation failed', { hasTopic: !!topic, hasApiKey: !!apiConfig?.apiKey });
    return res.status(400).json({ error: 'topic and apiConfig.apiKey required' });
  }

  setupSSE(req, res);

  let skills = [];
  const reqStart = Date.now();
  try {
    logger.info(ns, 'Calling distillExperts...');
    skills = await distillExperts(topic, apiConfig, (event) => {
      logger.info(ns, `SSE phase event`, { phase: event.phase, ...event });
      sendSSE(res, 'phase', event);
    }, context);

    const elapsed = Date.now() - reqStart;
    if (skills && skills.length > 0) {
      logger.info(ns, `Distill succeeded`, {
        count: skills.length,
        skills: skills.map(s => ({ name: s.name, displayName: s.displayName })),
        elapsedMs: elapsed,
      });
      sendSSE(res, 'done', { skills });
    } else {
      logger.warn(ns, `Distill returned no skills`, { elapsedMs: elapsed });
      sendSSE(res, 'error', { message: 'No experts found for this topic' });
    }
  } catch (err) {
    const elapsed = Date.now() - reqStart;
    logger.error(ns, `Distill request failed`, {
      error: err.message,
      stack: err.stack,
      elapsedMs: elapsed,
    });
    sendSSE(res, 'error', { message: err.message });
  }

  res.end();
  logger.info(ns, 'Response sent');
});

export default router;
