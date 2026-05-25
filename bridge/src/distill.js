import { Agent } from '@earendil-works/pi-agent-core';
import { getModel } from '@earendil-works/pi-ai';
import { createStreamFn } from './streamFn.js';

let searchAgent = null;

function getSearchAgent(apiConfig) {
  if (searchAgent) {
    searchAgent.dispose();
    searchAgent = null;
  }
  searchAgent = new Agent({
    initialState: {
      systemPrompt: 'You are an expert finder. Identify 3-5 real experts (well-known researchers, practitioners, authors) relevant to the given topic. Use your training knowledge — do not search the web. Respond ONLY with a JSON array of full names, no explanation, no prefix.',
      model: getModel('openai', apiConfig.modelName) ?? { id: apiConfig.modelName, provider: 'openai' },
    },
    streamFn: createStreamFn(apiConfig),
    sessionId: 'search-agent',
  });
  return searchAgent;
}

function promptAndCollect(agent, userMessage) {
  return new Promise((resolve, reject) => {
    let fullContent = '';
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_update' &&
          event.assistantMessageEvent?.type === 'text_delta') {
        fullContent += event.assistantMessageEvent.delta;
      }
      if (event.type === 'agent_end') {
        unsubscribe();
        resolve(fullContent);
      }
    });
    agent.prompt({ role: 'user', content: userMessage, timestamp: Date.now() })
      .catch((err) => {
        unsubscribe();
        reject(err);
      });
  });
}

export async function distillExperts(topic, apiConfig, onProgress, signal) {
  onProgress({ phase: 'search', status: `Searching for experts related to "${topic}"...` });

  const agent = getSearchAgent(apiConfig);
  let experts = [];
  try {
    const response = await promptAndCollect(agent,
      `Identify 3-5 real experts relevant to: "${topic}". Return ONLY a JSON array of full names. Example: ["Name One", "Name Two"]`
    );
    const match = response.match(/\[[\s\S]*?\]/);
    if (match) {
      experts = JSON.parse(match[0]);
    }
  } catch (err) {
    experts = [];
  }

  if (!Array.isArray(experts) || experts.length === 0) {
    onProgress({ phase: 'search_result', experts: [] });
    return [];
  }

  onProgress({ phase: 'search_result', experts });
  if (signal?.aborted) return null;

  const skills = [];

  for (let i = 0; i < experts.length; i++) {
    const expert = experts[i];
    if (typeof expert !== 'string' || !expert.trim()) continue;
    onProgress({ phase: 'distilling', expert, progress: 'Starting distillation...' });

    const distillAgent = new Agent({
      initialState: {
        systemPrompt: `You are Nuwa — a cognitive framework extractor. Your task is to research ${expert} and distill their thinking into a structured SKILL.md file.

Use your training knowledge about ${expert}: their known ideas, writings, interviews, talks, and public statements.

Then produce a SKILL.md with YAML frontmatter:
---
name: ${expert.toLowerCase().replace(/\s+/g, '-')}
description: ${expert}'s thinking framework — mental models, decision heuristics, and expression DNA.
---

Body sections:
1. Core Mental Models (3-7) — their unique cognitive frameworks
2. Decision Heuristics (5-10) — their recurring rules of thumb
3. Expression DNA — tone, vocabulary patterns, rhetorical devices
4. Values and Anti-patterns — what they stand for, what they avoid
5. Honest Limitations — what this skill cannot do

Be thorough. Return the COMPLETE SKILL.md.`,
        model: getModel('openai', apiConfig.modelName) ?? { id: apiConfig.modelName, provider: 'openai' },
      },
      streamFn: createStreamFn(apiConfig),
    });

    try {
      onProgress({ phase: 'distilling', expert, progress: '1/3 Collecting public materials...' });
      await promptAndCollect(distillAgent,
        `Using your knowledge, write everything you know about ${expert}: their key ideas, major writings, public statements, and what makes their thinking distinctive.`
      );

      onProgress({ phase: 'distilling', expert, progress: '2/3 Extracting mental models...' });
      await promptAndCollect(distillAgent,
        `Now analyze ${expert}'s thinking patterns. Identify their core mental models (recurring frameworks they apply), decision heuristics (rules of thumb), and expression DNA (how they communicate).`
      );

      onProgress({ phase: 'distilling', expert, progress: '3/3 Generating SKILL.md...' });
      const skillContent = await promptAndCollect(distillAgent,
        `Generate the final SKILL.md file for ${expert}. Include frontmatter (name, description), mental models, decision heuristics, expression DNA, values and anti-patterns, and honest limitations. Return ONLY the raw SKILL.md content.`
      );

      const nameMatch = skillContent.match(/^name:\s*(.+)$/m);
      const skillName = nameMatch ? nameMatch[1].trim() : expert.toLowerCase().replace(/\s+/g, '-');

      skills.push({ name: skillName, displayName: expert, content: skillContent });
      onProgress({ phase: 'skill_ready', expert, name: skillName, content: skillContent });
    } finally {
      distillAgent.dispose();
    }

    if (signal?.aborted) break;
  }

  return skills;
}
