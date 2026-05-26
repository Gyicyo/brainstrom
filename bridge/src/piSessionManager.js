import { Agent } from '@earendil-works/pi-agent-core';
import { streamSimple } from '@earendil-works/pi-ai';
import { buildModel } from './model.js';
import { logger } from './logger.js';

class PiSessionManager {
  #sessions = new Map();

  createSession(sessionId, { agents, apiConfig }) {
    if (this.#sessions.has(sessionId)) {
      this.deleteSession(sessionId);
    }

    const model = buildModel(apiConfig);
    const agentMap = new Map();

    for (const a of agents) {
      const piAgent = this.#createAgent(a, model, apiConfig);
      agentMap.set(a.name, { agent: piAgent, config: a });
    }

    this.#sessions.set(sessionId, { agents: agentMap, apiConfig, model });
    logger.info('piSession.create', 'Session created', {
      sessionId,
      agentCount: agents.length,
      agents: agents.map(a => a.name),
    });
  }

  #createAgent({ name, systemPrompt, skillContent }, model, apiConfig) {
    const prompt = systemPrompt || (skillContent
      ? `You are ${name}. Use the following skill to guide your responses:\n\n${skillContent}`
      : `You are ${name}. Respond concisely and helpfully.`
    );

    return new Agent({
      name,
      initialState: {
        systemPrompt: prompt,
        model,
      },
      streamFn: async (_m, ctx, opts) => {
        return streamSimple(model, ctx, { ...opts, apiKey: apiConfig.apiKey, maxTokens: opts?.maxTokens ?? 4096 });
      },
    });
  }

  #getAgent(sessionId, agentName) {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const entry = session.agents.get(agentName);
    if (!entry) throw new Error(`Agent ${agentName} not found in session ${sessionId}`);
    return entry.agent;
  }

  async chat(sessionId, agentName, message) {
    const agent = this.#getAgent(sessionId, agentName);
    const start = Date.now();
    logger.debug('piSession.chat', 'Sending message', { sessionId, agentName, msgLength: message.length });

    let text = '';
    let streamError = null;
    const unsub = agent.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        text += event.assistantMessageEvent.delta;
      }
      if (event.type === 'turn_end' && event.message?.errorMessage) {
        streamError = event.message.errorMessage;
      }
    });

    const promptStart = Date.now();
    try {
      await agent.prompt({ role: 'user', content: message, timestamp: Date.now() });
      await agent.waitForIdle();
      logger.debug('piSession.chat', 'Prompt completed', {
        sessionId, agentName, textLength: text.length, promptElapsedMs: Date.now() - promptStart,
      });
    } catch (err) {
      logger.error('piSession.chat', 'Prompt failed', { sessionId, agentName, error: err.message });
      unsub();
      throw err;
    }

    unsub();
    if (streamError) {
      logger.error('piSession.chat', 'Stream error', { sessionId, agentName, error: streamError });
      throw new Error(streamError);
    }

    logger.debug('piSession.chat', 'Done', { sessionId, agentName, textLength: text.length, elapsedMs: Date.now() - start });
    return text;
  }

  async *chatStream(sessionId, agentName, message) {
    const agent = this.#getAgent(sessionId, agentName);
    const start = Date.now();
    logger.debug('piSession.chatStream', 'Start', { sessionId, agentName, msgLength: message.length });

    let resolveNext = null;
    let nextPromise = new Promise(r => { resolveNext = r; });
    const queue = [];
    let finished = false;
    let streamError = null;

    const unsub = agent.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        queue.push(event.assistantMessageEvent.delta);
        if (resolveNext) resolveNext();
      }
      if (event.type === 'agent_end') {
        finished = true;
        if (resolveNext) resolveNext();
      }
      if (event.type === 'error') {
        streamError = event.error?.errorMessage || 'Agent error';
        finished = true;
        if (resolveNext) resolveNext();
      }
    });

    agent.prompt({ role: 'user', content: message, timestamp: Date.now() }).catch(err => {
      streamError = err.message;
      finished = true;
      if (resolveNext) resolveNext();
    });

    try {
      while (!finished) {
        await nextPromise;
        nextPromise = new Promise(r => { resolveNext = r; });
        while (queue.length > 0) {
          yield { type: 'text_delta', text: queue.shift() };
        }
      }
      while (queue.length > 0) {
        yield { type: 'text_delta', text: queue.shift() };
      }
      if (streamError) throw new Error(streamError);
      yield { type: 'done' };
      logger.debug('piSession.chatStream', 'Done', { sessionId, agentName, elapsedMs: Date.now() - start });
    } finally {
      unsub();
    }
  }

  addSkill(sessionId, agentName, skillContent) {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const entry = session.agents.get(agentName);
    if (!entry) throw new Error(`Agent ${agentName} not found`);

    const newAgent = this.#createAgent(
      { name: agentName, systemPrompt: entry.config.systemPrompt, skillContent },
      session.model,
      session.apiConfig,
    );
    entry.agent = newAgent;
    entry.config.skillContent = skillContent;

    logger.info('piSession.addSkill', 'Skill updated', { sessionId, agentName, skillLength: skillContent.length });
  }

  hasSession(sessionId) {
    return this.#sessions.has(sessionId);
  }

  getAgentNames(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) return [];
    return [...session.agents.keys()];
  }

  deleteSession(sessionId) {
    this.#sessions.delete(sessionId);
    logger.info('piSession.delete', 'Session deleted', { sessionId });
  }

  static async oneShot(systemPrompt, userMessage, apiConfig) {
    const model = buildModel(apiConfig);
    const ctx = {
      systemPrompt: systemPrompt || 'You are a helpful assistant.',
      messages: [{ role: 'user', content: userMessage }],
    };

    const start = Date.now();
    let content = '';
    const stream = streamSimple(model, ctx, { apiKey: apiConfig.apiKey, maxTokens: 4096 });
    for await (const chunk of stream) {
      if (chunk.type === 'text_delta') {
        content += chunk.delta;
      }
    }
    logger.debug('piSession.oneShot', 'Done', { elapsedMs: Date.now() - start, responseLength: content.length });
    return content;
  }
}

export { PiSessionManager };
export const piSessionManager = new PiSessionManager();
