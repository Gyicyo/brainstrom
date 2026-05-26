import { Agent } from '@earendil-works/pi-agent-core';
import { streamSimple } from '@earendil-works/pi-ai';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import { buildModel } from './model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = path.resolve(__dirname, '../skills/nuwa-skill/SKILL.md');
const SKILL_CONTENT = readFileSync(SKILL_PATH, 'utf-8');

function parseSkill(content) {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const descMatch = content.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : 'nuwa-skill',
    description: descMatch ? descMatch[1].trim().replace(/^[>|]\s*/, '').trim() : '',
    content,
  };
}

const NUWA_SKILL = parseSkill(SKILL_CONTENT);

let searchAgent = null;

function getSearchAgent(apiConfig) {
  if (searchAgent) {
    searchAgent.reset();
    searchAgent = null;
  }
  const model = buildModel(apiConfig);
  logger.info('distill', 'Creating search agent', {
    model: apiConfig.modelName,
    baseUrl: apiConfig.apiBaseUrl,
  });
  searchAgent = new Agent({
    initialState: {
      systemPrompt: 'You are an expert finder. Identify 3-5 real experts (well-known researchers, practitioners, authors) relevant to the given topic and user context. Use your training knowledge — do not search the web. Respond ONLY with a JSON array of full names, no explanation, no prefix.',
      model,
    },
    streamFn: async (_m, ctx, opts) => streamSimple(model, ctx, { ...opts, apiKey: apiConfig.apiKey }),
    sessionId: 'search-agent',
  });
  return searchAgent;
}

function promptAndCollect(agent, userMessage, stepLabel, expertName) {
  const ns = expertName ? `distill.${expertName}` : 'distill';
  const start = Date.now();
  logger.info(ns, `promptAndCollect start: ${stepLabel}`, {
    promptPreview: userMessage.slice(0, 200) + (userMessage.length > 200 ? '...' : ''),
    promptLength: userMessage.length,
  });

  return new Promise((resolve, reject) => {
    let fullContent = '';
    let errorEvent = null;
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_update' &&
          event.assistantMessageEvent?.type === 'text_delta') {
        fullContent += event.assistantMessageEvent.delta;
      }
      if (event.type === 'message_update' &&
          event.assistantMessageEvent?.type === 'error') {
        errorEvent = event.assistantMessageEvent;
        logger.error(ns, `stream error event: ${stepLabel}`, {
          error: event.assistantMessageEvent?.error?.errorMessage || 'unknown',
          errorData: event.assistantMessageEvent?.error,
        });
      }
      if (event.type === 'tool_execution_start') {
        logger.debug(ns, `tool start: ${stepLabel}`, {
          toolName: event.toolName,
          args: event.args,
        });
      }
      if (event.type === 'tool_execution_end') {
        logger.debug(ns, `tool end: ${stepLabel}`, {
          toolName: event.toolName,
          isError: event.isError,
          result: event.result,
        });
      }
      if (event.type === 'agent_end') {
        unsubscribe();
        const elapsed = Date.now() - start;
        const lastMsg = event.messages?.[event.messages.length - 1];
        const hasError = lastMsg?.errorMessage || errorEvent;
        logger.info(ns, `promptAndCollect done: ${stepLabel}`, {
          elapsedMs: elapsed,
          responseLength: fullContent.length,
          hasError: !!hasError,
          lastMsgError: lastMsg?.errorMessage || null,
          responsePreview: fullContent.slice(0, 300) + (fullContent.length > 300 ? '...' : ''),
        });
        resolve(fullContent);
      }
    });
    agent.prompt({ role: 'user', content: userMessage, timestamp: Date.now() })
      .catch((err) => {
        unsubscribe();
        const elapsed = Date.now() - start;
        logger.error(ns, `promptAndCollect failed: ${stepLabel}`, {
          elapsedMs: elapsed,
          error: err.message,
          stack: err.stack,
        });
        reject(err);
      });
  });
}

export { promptAndCollect };

export async function distillExperts(topic, apiConfig, onProgress, context) {
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const ns = 'distill';
  const overallStart = Date.now();

  logger.info(ns, `=== Distill request ${requestId} started ===`, {
    topic,
    hasContext: !!context,
    contextLength: context?.length || 0,
    model: apiConfig.modelName,
    baseUrl: apiConfig.apiBaseUrl,
    apiKeyMasked: logger.maskKey(apiConfig.apiKey),
  });

  onProgress({ phase: 'search', status: `Searching for experts related to "${topic}"...` });

  const agent = getSearchAgent(apiConfig);

  let searchPrompt = `Identify 3-5 real experts relevant to: "${topic}". Return ONLY a JSON array of full names. Example: ["Name One", "Name Two"]`;
  if (context) {
    searchPrompt += `\n\nUser context: ${context}\n\nPrioritize experts whose thinking directly addresses this context.`;
  }

  let experts = [];
  const searchStart = Date.now();
  try {
    const response = await promptAndCollect(agent, searchPrompt, 'Search experts');
    const match = response.match(/\[[\s\S]*?\]/);
    if (match) {
      const raw = match[0];
      try {
        experts = JSON.parse(raw);
        logger.info(ns, `Search phase: experts parsed`, {
          count: Array.isArray(experts) ? experts.length : 0,
          experts: Array.isArray(experts) ? experts : null,
          elapsedMs: Date.now() - searchStart,
        });
      } catch (parseErr) {
        logger.warn(ns, `Search phase: JSON parse failed`, {
          rawJson: raw.slice(0, 500),
          error: parseErr.message,
          elapsedMs: Date.now() - searchStart,
        });
      }
    } else {
      logger.warn(ns, `Search phase: no JSON array found`, {
        responsePreview: response.slice(0, 500),
        elapsedMs: Date.now() - searchStart,
      });
    }
  } catch (err) {
    logger.error(ns, `Search phase: LLM call failed`, {
      error: err.message,
      stack: err.stack,
      elapsedMs: Date.now() - searchStart,
    });
    experts = [];
  }

  if (!Array.isArray(experts) || experts.length === 0) {
    logger.warn(ns, `No experts found, returning empty`, {
      elapsedMs: Date.now() - overallStart,
    });
    onProgress({ phase: 'search_result', experts: [] });
    return [];
  }

  onProgress({ phase: 'search_result', experts });

  const skills = [];
  const expertStart = Date.now();

  for (let i = 0; i < experts.length; i++) {
    const expert = experts[i];
    if (typeof expert !== 'string' || !expert.trim()) {
      logger.warn(ns, `Skipping invalid expert entry`, { index: i, value: expert });
      continue;
    }

    const expertLabel = `Expert ${i + 1}/${experts.length}`;
    logger.info(ns, `${expertLabel}: ${expert} — starting distillation`);
    onProgress({ phase: 'distilling', expert, progress: 'Starting distillation...' });

    const model = buildModel(apiConfig);
    const distillAgent = new Agent({
      initialState: {
        systemPrompt: `You are an expert at distilling people's thinking frameworks into structured SKILL.md files.

Below is the Nuwa distillation framework you must follow:

${NUWA_SKILL.content}

---

Your task: distill ${expert} using the Nuwa framework above.

Use your training knowledge about ${expert}: their known ideas, writings, interviews, talks, and public statements.

${context ? `Relevant context: ${context}\n\n` : ''}Output a complete SKILL.md with YAML frontmatter and all sections described in the framework. Return ONLY the raw SKILL.md content, no explanation.`,
        model,
      },
      streamFn: async (_m, ctx, opts) => streamSimple(model, ctx, { ...opts, apiKey: apiConfig.apiKey }),
    });

    try {
      // Step 1/3
      const step1 = Date.now();
      onProgress({ phase: 'distilling', expert, progress: '1/3 Surveying public materials...' });
      await promptAndCollect(distillAgent,
        `Using your training knowledge, write everything significant you know about ${expert}: their key ideas, major works, public statements, and what makes their thinking distinctive.\n\n${context ? `Focus on aspects relevant to: ${context}` : ''}`,
        '1/3 Survey', expert
      );
      logger.info(ns, `${expertLabel}: step 1/3 complete`, { elapsedMs: Date.now() - step1 });

      // Step 2/3
      const step2 = Date.now();
      onProgress({ phase: 'distilling', expert, progress: '2/3 Extracting mental models...' });
      await promptAndCollect(distillAgent,
        `Analyze ${expert}'s thinking patterns. Identify their core mental models, decision heuristics, and expression DNA.`,
        '2/3 Extract', expert
      );
      logger.info(ns, `${expertLabel}: step 2/3 complete`, { elapsedMs: Date.now() - step2 });

      // Step 3/3
      const step3 = Date.now();
      onProgress({ phase: 'distilling', expert, progress: '3/3 Generating SKILL.md...' });
      const skillContent = await promptAndCollect(distillAgent,
        `Generate the final SKILL.md file for ${expert} following the Nuwa framework. Include frontmatter, mental models, decision heuristics, expression DNA, values and anti-patterns, and honest limitations. Return ONLY the raw SKILL.md content.`,
        '3/3 Generate', expert
      );
      logger.info(ns, `${expertLabel}: step 3/3 complete`, { elapsedMs: Date.now() - step3 });

      const nameMatch = skillContent.match(/^name:\s*(.+)$/m);
      const skillName = nameMatch ? nameMatch[1].trim() : expert.toLowerCase().replace(/\s+/g, '-');
      logger.info(ns, `${expertLabel}: skill generated`, {
        skillName,
        contentLength: skillContent.length,
        totalExpertMs: Date.now() - expertStart,
      });

      skills.push({ name: skillName, displayName: expert, content: skillContent });
      onProgress({ phase: 'skill_ready', expert, name: skillName, content: skillContent });
    } catch (err) {
      logger.error(ns, `${expertLabel}: distillation failed`, {
        expert,
        error: err.message,
        stack: err.stack,
      });
    } finally {
      distillAgent.reset();
    }
  }

  logger.info(ns, `=== Distill request ${requestId} finished ===`, {
    totalElapsedMs: Date.now() - overallStart,
    totalExperts: experts.length,
    successfulSkills: skills.length,
    skills: skills.map(s => ({ name: s.name, displayName: s.displayName, contentLength: s.content.length })),
  });

  return skills;
}
