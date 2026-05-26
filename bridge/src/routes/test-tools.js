import { Router } from 'express';
import { Agent } from '@earendil-works/pi-agent-core';
import { streamSimple } from '@earendil-works/pi-ai';
import { logger } from '../logger.js';
import { buildModel } from '../model.js';

const router = Router();

const ns = 'route.test-tools';

router.post('/', async (req, res) => {
  const { apiConfig } = req.body;
  if (!apiConfig?.apiKey) {
    return res.status(400).json({ error: 'apiConfig.apiKey required' });
  }

  const results = { basic: null, toolCall: null, error: null, directStreamSimple: null };

  try {
    const model = buildModel(apiConfig);
    logger.info(ns, 'Model config', { modelId: model.id, baseUrl: model.baseUrl, apiKeyMasked: logger.maskKey(apiConfig.apiKey) });

    // ── 0) Direct streamSimple test (bypasses Agent entirely, still uses pi) ──
    const directStart = Date.now();
    let directContent = '';
    let directEventTypes = [];
    let directErrorMessage = null;
    try {
      const directCtx = {
        systemPrompt: 'You are a concise assistant. Reply in 1-2 sentences.',
        messages: [{ role: 'user', content: 'Say hello back.' }],
      };
      const directStream = streamSimple(model, directCtx, { apiKey: apiConfig.apiKey, maxTokens: 256 });
      const hasAsyncIter = typeof directStream?.[Symbol.asyncIterator] === 'function';
      logger.info(ns, 'Direct streamSimple', { hasAsyncIter, type: typeof directStream });

      if (!hasAsyncIter) {
        directErrorMessage = `streamSimple returned ${typeof directStream} without async iterator`;
        logger.error(ns, 'Direct streamSimple: no async iterator', { type: typeof directStream });
      } else {
        for await (const ev of directStream) {
          directEventTypes.push(ev.type);
          if (ev.type === 'text_delta') directContent += ev.delta;
          if (ev.type === 'error') {
            directErrorMessage = ev.error?.errorMessage || 'unknown stream error';
            logger.error(ns, 'Direct streamSimple: error event', { errorMsg: directErrorMessage, errorData: ev.error });
          }
        }
        logger.info(ns, 'Direct streamSimple done', {
          eventTypes: directEventTypes,
          contentLength: directContent.length,
          elapsedMs: Date.now() - directStart,
        });
      }
    } catch (err) {
      directErrorMessage = err.message;
      logger.error(ns, 'Direct streamSimple threw', { error: err.message, stack: err.stack });
    }
    results.directStreamSimple = {
      elapsedMs: Date.now() - directStart,
      eventTypes: directEventTypes,
      response: directContent || '(empty)',
      error: directErrorMessage,
    };

    // ── 1) Basic completion via Agent ──
    const basicStart = Date.now();
    const basicAgent = new Agent({
      initialState: {
        systemPrompt: 'You are a concise assistant. Reply in 1-2 sentences.',
        model,
      },
      streamFn: async (_m, ctx, opts) => {
        logger.info(ns, 'streamFn called', { hasSystemPrompt: !!ctx?.systemPrompt, msgCount: ctx?.messages?.length, hasTools: !!ctx?.tools });
        return streamSimple(model, ctx, { ...opts, apiKey: apiConfig.apiKey });
      },
    });

    const basicContent = await new Promise((resolve) => {
      let text = '';
      const unsub = basicAgent.subscribe((event) => {
        if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
          text += event.assistantMessageEvent.delta;
        }
        if (event.type === 'agent_end') {
          const lastMsg = event.messages?.[event.messages.length - 1];
          logger.info(ns, 'basic agent_end', {
            stopReason: lastMsg?.stopReason,
            errorMessage: lastMsg?.errorMessage,
            textAccumulated: text.length,
          });
          unsub();
          resolve(text);
        }
      });
      basicAgent.prompt({ role: 'user', content: 'Hello. Reply with a brief greeting.', timestamp: Date.now() });
    });

    results.basic = {
      elapsedMs: Date.now() - basicStart,
      response: basicContent || '(empty)',
    };
    logger.info(ns, 'Basic completion done', { elapsedMs: results.basic.elapsedMs, length: basicContent.length });

    // ── 2) Tool call test via Agent ──
    const toolStart = Date.now();
    const toolAgent = new Agent({
      initialState: {
        systemPrompt: 'You have access to the "uppercase" tool. When asked to transform text, call the uppercase tool.',
        model,
        tools: [{
          name: 'uppercase',
          description: 'Convert text to uppercase',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The text to uppercase' },
            },
            required: ['text'],
          },
          execute: async (_id, { text }) => ({ content: [{ type: 'text', text: text.toUpperCase() }] }),
        }],
      },
      streamFn: async (_m, ctx, opts) => streamSimple(model, ctx, { ...opts, apiKey: apiConfig.apiKey }),
      toolExecution: 'parallel',
    });

    let toolText = '';
    const toolCallsReceived = [];
    const toolResults = [];

    const toolData = await new Promise((resolve) => {
      const unsub = toolAgent.subscribe((event) => {
        if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
          toolText += event.assistantMessageEvent.delta;
        }
        if (event.type === 'tool_execution_start') {
          toolCallsReceived.push({ name: event.toolName, args: event.args });
        }
        if (event.type === 'tool_execution_end') {
          toolResults.push({ name: event.toolName, isError: event.isError, result: event.result });
        }
        if (event.type === 'agent_end') {
          const lastMsg = event.messages?.[event.messages.length - 1];
          logger.info(ns, 'tool agent_end', {
            stopReason: lastMsg?.stopReason,
            errorMessage: lastMsg?.errorMessage,
            toolCallsCollected: toolCallsReceived.length,
            textAccumulated: toolText.length,
          });
          unsub();
          resolve({ text: toolText, calls: [...toolCallsReceived], results: [...toolResults] });
        }
      });
      toolAgent.prompt({
        role: 'user',
        content: 'Use the uppercase tool on "hello world" and tell me the result.',
        timestamp: Date.now(),
      });
    });

    results.toolCall = {
      elapsedMs: Date.now() - toolStart,
      toolExecutionStartEvents: toolData.calls,
      toolExecutionEndEvents: toolData.results,
      finalResponse: toolData.text || '(no text)',
      toolWasCalled: toolData.calls.length > 0,
    };
    logger.info(ns, 'Tool test done', {
      elapsedMs: results.toolCall.elapsedMs,
      toolCalls: toolData.calls.length,
      responseLength: toolData.text.length,
    });
  } catch (err) {
    results.error = { message: err.message, stack: err.stack };
    logger.error(ns, 'Test failed', { error: err.message, stack: err.stack });
  }

  res.json(results);
});

export default router;
