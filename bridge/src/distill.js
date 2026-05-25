import { Agent } from '@earendil-works/pi-agent-core';
import { getModel } from '@earendil-works/pi-ai';
import { createStreamFn } from './streamFn.js';
import { createSearchTool } from './searchTool.js';

let searchAgent = null;

function getSearchAgent(apiConfig) {
  if (searchAgent) return searchAgent;
  searchAgent = new Agent({
    initialState: {
      systemPrompt: 'You are an expert finder. Given a topic, identify 3-5 relevant experts (real people) who have significant knowledge or opinions on this topic. Respond with a JSON array of full names only, no explanation.',
      model: getModel('openai', apiConfig.modelName) ?? { id: apiConfig.modelName, provider: 'openai' },
      tools: [createSearchTool()],
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
          event.assistantMessageEvent.type === 'text_delta') {
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
      `Search the web and identify 3-5 real experts relevant to the topic: "${topic}". Consider who has blogged, written books, given talks, or done research on this topic. Return ONLY a JSON array of full names. Example: ["Name One", "Name Two"]`
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

Research across multiple sources: their writings, interviews, talks, social media, and what critics say.

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

Be thorough. Research deeply. Return the COMPLETE SKILL.md.`,
        model: getModel('openai', apiConfig.modelName) ?? { id: apiConfig.modelName, provider: 'openai' },
        tools: [createSearchTool()],
      },
      streamFn: createStreamFn(apiConfig),
    });

    try {
      onProgress({ phase: 'distilling', expert, progress: '1/3 Collecting public materials...' });
      await promptAndCollect(distillAgent,
        `Research ${expert} thoroughly. Search the web for their key ideas, major writings, interviews, talks, and public statements. Collect enough material to understand their unique thinking framework. Focus on how they think, not just what they've done.`
      );

      onProgress({ phase: 'distilling', expert, progress: '2/3 Extracting mental models...' });
      await promptAndCollect(distillAgent,
        `Now analyze ${expert}'s thinking patterns. Identify their core mental models (recurring frameworks they apply), decision heuristics (rules of thumb), and expression DNA (how they communicate). What makes their thinking distinctive? What patterns appear across different domains they engage with?`
      );

      onProgress({ phase: 'distilling', expert, progress: '3/3 Generating SKILL.md...' });
      const skillContent = await promptAndCollect(distillAgent,
        `Generate the final SKILL.md file for ${expert}. Include frontmatter (name, description), mental models, decision heuristics, expression DNA, values and anti-patterns, and honest limitations. Return ONLY the raw SKILL.md content. No preamble, no explanation.`
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
