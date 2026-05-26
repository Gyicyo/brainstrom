import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { runNvwa } from '../nvwaRunner.js';
import { sendSSE, setupSSE } from '../sse.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
const ns = 'route.distill-roles';
const MAX_CONCURRENT = 5;

function sanitizeName(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fff-]/g, '');
}

// GET endpoint: fetch distillation results for a sessionDir
router.get('/:sessionDir', (req, res) => {
  const baseDir = path.resolve(__dirname, '../../sessions', sanitizeName(req.params.sessionDir));
  const resultsPath = path.join(baseDir, 'distill-results.json');
  if (!existsSync(resultsPath)) {
    return res.status(404).json({ error: '未找到蒸馏结果' });
  }
  res.json(JSON.parse(readFileSync(resultsPath, 'utf-8')));
});

router.post('/', async (req, res) => {
  const { sessionDir, roles, apiConfig } = req.body;

  if (!sessionDir || !roles?.length || !apiConfig?.apiKey) {
    return res.status(400).json({ error: '缺少必填参数：sessionDir、roles[]、apiConfig.apiKey' });
  }

  const baseDir = path.resolve(__dirname, '../../sessions', sanitizeName(sessionDir));
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }

  setupSSE(req, res);

  const allSkills = [];
  const allResults = []; // for distill-results.json

  logger.info(ns, '=== Distill-roles request started ===', { totalRoles: roles.length });

  // Process in batches of MAX_CONCURRENT
  for (let start = 0; start < roles.length; start += MAX_CONCURRENT) {
    const batch = roles.slice(start, start + MAX_CONCURRENT);
    logger.info(ns, `Batch ${start / MAX_CONCURRENT + 1}`, { batchSize: batch.length, names: batch.map(r => r.name) });

    // 1. Announce all roles in this batch
    sendSSE(res, 'phase', {
      phase: 'batch_start',
      roles: batch.map(r => ({ name: r.name })),
    });

    // 2. Run all concurrently
    const batchResults = await Promise.allSettled(
      batch.map(async (role) => {
        const roleDir = sanitizeName(role.name);
        sendSSE(res, 'phase', { phase: 'distill_start', expert: role.name });
        logger.debug(ns, `Starting distillation for ${role.name}`, { outputDir: path.join(baseDir, roleDir) });
        try {
          const result = await runNvwa({
            personName: role.name,
            context: role.bio || '',
            outputDir: path.join(baseDir, roleDir),
            apiConfig,
          });
          logger.info(ns, `runNvwa SUCCESS for ${role.name}`, { skillLength: result.skillContent.length, files: result.files });
          return { role, result, roleDir, success: true };
        } catch (err) {
          logger.error(ns, `runNvwa FAILED for ${role.name}`, { error: err.message || String(err) });
          return { role, roleDir, success: false, error: err.message || String(err) };
        }
      })
    );

    // 3. Process results (batchResults[i] corresponds to batch[i])
    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i];
      // The map function now always resolves (we catch errors and return { success: false })
      // So result.status is always 'fulfilled'
      const data = result.status === 'fulfilled' ? result.value : { role: batch[i], roleDir: sanitizeName(batch[i].name), success: false, error: 'Unexpected rejection in Promise.allSettled' };

      if (data.success) {
        const { role, result: nvwaResult } = data;
        allSkills.push({
          name: data.roleDir,
          displayName: role.name,
          content: nvwaResult.skillContent,
        });
        allResults.push({ name: role.name, status: 'done' });
        sendSSE(res, 'phase', {
          phase: 'skill_ready',
          expert: role.name,
        });
        logger.info(ns, `SSE sent: skill_ready for ${role.name}`, { index: i });
      } else {
        allResults.push({ name: data.role.name, status: 'error', error: data.error });
        sendSSE(res, 'phase', {
          phase: 'distill_error',
          expert: data.role.name,
          error: data.error || '未知错误',
        });
        logger.warn(ns, `SSE sent: distill_error for ${data.role.name}`, { error: data.error });
      }
    }
  }

  // Save results JSON for frontend to fetch subsequently
  const resultsPath = path.join(baseDir, 'distill-results.json');
  writeFileSync(resultsPath, JSON.stringify({ skills: allSkills, results: allResults }, null, 2), 'utf-8');
  logger.info(ns, 'Distill results saved', { resultsPath, skillCount: allSkills.length });

  sendSSE(res, 'done', { skills: allSkills.length });
  res.end();
  logger.info(ns, '=== Distill-roles complete ===', { total: roles.length, success: allSkills.length });
});

export default router;
