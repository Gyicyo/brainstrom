import Dexie, { type Table } from 'dexie';

export interface AgentRecord {
  id?: number;
  name: string;
  personality: string;
  system_prompt: string;
  api_base_url: string;
  api_key: string;
  model_name: string;
  avatar_url: string;
  search_provider?: string;
  search_api_key?: string;
  search_api_url?: string;
  created_at: string;
}

export interface SessionRecord {
  id?: number;
  topic: string;
  status: string;
  current_round: number;
  created_at: string;
}

export interface SessionAgentRecord {
  id?: number;
  session_id: number;
  agent_id: number;
  generated_agent_id?: number;
  is_scribe: boolean;
}

export interface GeneratedAgentRecord {
  id?: number;
  session_id: number;
  name: string;
  personality: string;
  system_prompt: string;
  created_at: string;
}

export interface RoundRecord {
  id?: number;
  session_id: number;
  round_number: number;
  scribe_summary: string;
  created_at: string;
}

export interface MessageRecord {
  id?: number;
  round_id: number;
  agent_id: number | null;
  is_human: boolean;
  content: string;
  created_at: string;
}

export interface ThreadRecord {
  id?: number;
  round_id: number;
  agent_id: number;
  created_at: string;
}

export interface ThreadMessageRecord {
  id?: number;
  thread_id: number;
  is_human: boolean;
  content: string;
  created_at: string;
}

class BrainstormDB extends Dexie {
  agents!: Table<AgentRecord, number>;
  sessions!: Table<SessionRecord, number>;
  sessionAgents!: Table<SessionAgentRecord, number>;
  rounds!: Table<RoundRecord, number>;
  messages!: Table<MessageRecord, number>;
  threads!: Table<ThreadRecord, number>;
  threadMessages!: Table<ThreadMessageRecord, number>;
  generatedAgents!: Table<GeneratedAgentRecord, number>;

  constructor() {
    super('brainstorm');
    this.version(2).stores({
      agents: '++id, name',
      sessions: '++id, status',
      sessionAgents: '++id, session_id, agent_id, is_scribe',
      rounds: '++id, [session_id+round_number]',
      messages: '++id, round_id, agent_id',
      threads: '++id, round_id, agent_id',
      threadMessages: '++id, thread_id',
      generatedAgents: '++id, session_id',
    });
  }
}

export const db = new BrainstormDB();
