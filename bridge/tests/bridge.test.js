import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { rmSync } from 'fs';
import path from 'path';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mock external dependencies before any source imports
// ---------------------------------------------------------------------------

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: function () {
    const callbacks = [];
    return {
      subscribe: (cb) => {
        callbacks.push(cb);
        return () => {
          const idx = callbacks.indexOf(cb);
          if (idx >= 0) callbacks.splice(idx, 1);
        };
      },
      prompt: async () => {
        callbacks.forEach((cb) => cb({ type: 'agent_end' }));
      },
      reset: () => {},
      abort: () => {},
      state: {},
      steeringMode: () => {},
      waitForIdle: () => {},
    };
  },
}));

vi.mock('@earendil-works/pi-ai', () => ({
  AssistantMessageEventStream: function () {
    return { push: () => {}, end: () => {} };
  },
  streamSimple: async () => ({
    [Symbol.asyncIterator]() { return this; },
    next: async () => ({ done: true, value: undefined }),
    push: () => {},
    end: () => {},
    result: async () => ({ role: 'assistant', content: [], stopReason: 'stop' }),
  }),
  getModel: () => ({ id: 'gpt-4', provider: 'openai' }),
}));

// ---------------------------------------------------------------------------
// Source imports
// ---------------------------------------------------------------------------

import { sendSSE, setupSSE } from '../src/sse.js';
import { promptAndCollect, distillExperts } from '../src/distill.js';
import { app } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSIONS_DIR = path.resolve('sessions');

function cleanSessions() {
  if (existsSync(SESSIONS_DIR)) {
    rmSync(SESSIONS_DIR, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Unit: SSE utilities
// ---------------------------------------------------------------------------

describe('SSE utilities', () => {
  it('sendSSE writes a formatted SSE event', () => {
    const res = { write: vi.fn() };
    sendSSE(res, 'my_event', { hello: 'world' });
    expect(res.write).toHaveBeenCalledWith('event: my_event\n');
    expect(res.write).toHaveBeenCalledWith('data: {"hello":"world"}\n\n');
  });

  it('setupSSE sets headers, writes leading newline, returns res', () => {
    const headers = {};
    const res = {
      writeHead: vi.fn((status, h) => Object.assign(headers, h)),
      write: vi.fn(),
    };
    const returned = setupSSE({}, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    expect(res.write).toHaveBeenCalledWith('\n');
    expect(returned).toBe(res);
  });
});

// ---------------------------------------------------------------------------
// Integration: Health
// ---------------------------------------------------------------------------

describe('HTTP — Health', () => {
  it('GET /api/health returns 200 with ok true', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('uptime');
  });
});

// ---------------------------------------------------------------------------
// Integration: Room CRUD
// ---------------------------------------------------------------------------

describe('HTTP — Room CRUD', () => {
  const apiConfig = {
    apiKey: 'sk-test',
    apiBaseUrl: 'https://api.openai.com',
    modelName: 'gpt-4',
  };

  afterEach(() => {
    cleanSessions();
  });

  it('POST /api/room/create with valid body returns 200', async () => {
    const res = await request(app)
      .post('/api/room/create')
      .send({
        sessionId: 'test-session',
        topic: 'AI Safety',
        agents: [{ name: 'bob', skillContent: 'You are Bob.' }],
        apiConfig,
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /api/room/create with missing fields returns 400', async () => {
    const res = await request(app)
      .post('/api/room/create')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/room/create without apiKey returns 400', async () => {
    const res = await request(app)
      .post('/api/room/create')
      .send({ sessionId: 'x', topic: 'x', agents: [{ name: 'bob' }], apiConfig: {} });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/room/:id/chat returns 404 for non-existent room', async () => {
    const res = await request(app)
      .post('/api/room/nonexistent/chat')
      .send({ agentName: 'bob', message: 'hello' });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('DELETE /api/room/:id returns 200 even for non-existent room', async () => {
    const res = await request(app).delete('/api/room/ghost-room');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Integration: Distill endpoint
// ---------------------------------------------------------------------------

describe('HTTP — Distill endpoint', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch-mock')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /api/distill without API key returns 400', async () => {
    const res = await request(app)
      .post('/api/distill')
      .send({ topic: 'AI', apiConfig: {} });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/distill with valid body returns SSE headers', async () => {
    const res = await request(app)
      .post('/api/distill')
      .send({
        topic: 'AI Safety',
        apiConfig: {
          apiKey: 'sk-test',
          apiBaseUrl: 'https://api.openai.com',
          modelName: 'gpt-4',
        },
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  });
});

// ---------------------------------------------------------------------------
// Distill module
// ---------------------------------------------------------------------------

describe('Distill module', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch-mock')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('distillExperts returns empty array when search agent returns no experts', async () => {
    const onProgress = vi.fn();
    const result = await distillExperts(
      'Quantum Physics',
      {
        apiKey: 'sk-test',
        apiBaseUrl: 'https://api.openai.com',
        modelName: 'gpt-4',
      },
      onProgress,
    );
    expect(result).toEqual([]);
    expect(onProgress).toHaveBeenCalledWith({
      phase: 'search',
      status: expect.any(String),
    });
    expect(onProgress).toHaveBeenCalledWith({
      phase: 'search_result',
      experts: [],
    });
  });

  it('promptAndCollect resolves when agent completes', async () => {
    const { Agent } = await import('@earendil-works/pi-agent-core');
    const agent = new Agent();
    const result = await promptAndCollect(agent, 'Say hello');
    expect(typeof result).toBe('string');
  });
});
