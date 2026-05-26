import { Router } from 'express';
import { PiSessionManager } from '../piSessionManager.js';
import { logger } from '../logger.js';

const router = Router();
const ns = 'route.suggest-roles';

router.post('/', async (req, res) => {
  const { topic, content, count, apiConfig } = req.body;

  if (!topic || !apiConfig?.apiKey) {
    return res.status(400).json({ error: '缺少必填参数：topic 和 apiConfig.apiKey' });
  }

  try {
    const systemPrompt = `You are a role research agent. Given a topic, suggest real historical or contemporary figures who would be valuable discussion participants in a brainstorming session about that topic.

For each figure, provide:
- name: the well-known name
- bio: 1-2 sentences identifying who they are and why they're relevant to the topic

Rank by relevance to the topic. Include figures from different eras or perspectives when possible.

Respond ONLY with valid JSON in this format (no markdown, no explanation):
{"roles":[{"name":"...","bio":"..."}]}`;

    const userMessage = [
      `Topic: ${topic}`,
      `Content: ${content || '(not specified)'}`,
      `Number of roles: ${count || 5}`,
    ].join('\n');

    const response = await PiSessionManager.oneShot(systemPrompt, userMessage, apiConfig);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : { roles: [] };

    logger.info(ns, 'Roles suggested', { topic, count: data.roles?.length });
    res.json(data);
  } catch (err) {
    logger.error(ns, 'Failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
