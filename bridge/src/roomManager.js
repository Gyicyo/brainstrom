import { mkdir, readFile, writeFile, rm, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createDiscussionAgent } from './agentFactory.js';

const SESSIONS_DIR = path.resolve('sessions');

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  roomDir(roomId) {
    return path.join(SESSIONS_DIR, `room-${roomId}`);
  }

  async createRoom(roomId, topic, agents, scribeApiConfig) {
    const dir = this.roomDir(roomId);
    await mkdir(dir, { recursive: true });

    const agentMap = new Map();

    for (const a of agents) {
      const agent = createDiscussionAgent(a, a.apiConfig);
      agentMap.set(a.name, agent);
    }

    // Scribe
    if (scribeApiConfig) {
      const scribeAgent = createDiscussionAgent(
        { name: 'scribe', skillContent: 'You are a neutral scribe. Summarize discussions concisely.' },
        scribeApiConfig,
      );
      agentMap.set('__scribe__', scribeAgent);
    }

    await writeFile(path.join(dir, 'meta.json'), JSON.stringify({
      roomId, topic, agents: agents.map(a => ({ name: a.name })),
    }));

    this.rooms.set(roomId, { agents: agentMap, topic });
    return agentMap;
  }

  async resumeRoom(roomId, agents, scribeApiConfig) {
    const dir = this.roomDir(roomId);
    if (!existsSync(dir)) throw new Error(`Room ${roomId} not found`);

    const agentMap = new Map();
    for (const a of agents) {
      const agent = createDiscussionAgent(a, a.apiConfig);
      agentMap.set(a.name, agent);
    }

    if (scribeApiConfig) {
      const scribeAgent = createDiscussionAgent(
        { name: 'scribe', skillContent: 'You are a neutral scribe. Summarize discussions concisely.' },
        scribeApiConfig,
      );
      agentMap.set('__scribe__', scribeAgent);
    }

    this.rooms.set(roomId, { agents: agentMap, topic: '' });
    return agentMap;
  }

  async deleteRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      for (const [, agent] of room.agents) {
        agent.reset();
      }
    }
    const dir = this.roomDir(roomId);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
    this.rooms.delete(roomId);
  }

  getAgent(roomId, agentName) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    const agent = room.agents.get(agentName);
    if (!agent) throw new Error(`Agent ${agentName} not found in room ${roomId}`);
    return agent;
  }

  getScribe(roomId) {
    return this.getAgent(roomId, '__scribe__');
  }
}

export const roomManager = new RoomManager();
