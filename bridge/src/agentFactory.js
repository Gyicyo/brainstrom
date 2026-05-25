import { Agent } from '@earendil-works/pi-agent-core';
import { getModel } from '@earendil-works/pi-ai';
import { createStreamFn } from './streamFn.js';

export function createDiscussionAgent(agentInfo, apiConfig) {
  const { name, skillContent } = agentInfo;
  const streamFn = createStreamFn(apiConfig);

  const systemPrompt = buildPromptFromSkill(name, skillContent);

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: getModel('openai', apiConfig.modelName) ?? {
        id: apiConfig.modelName,
        provider: 'custom',
      },
      tools: [],
    },
    streamFn,
    sessionId: `agent-${name}`,
  });

  return agent;
}

function buildPromptFromSkill(name, skillContent) {
  return `You are ${name}. Use the following skill to guide your responses:\n\n${skillContent}`;
}
