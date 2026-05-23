export interface AgentType {
  id: number;
  name: string;
  personality: string;
  system_prompt: string;
  api_base_url: string;
  api_key: string;
  model_name: string;
  avatar_url: string;
  created_at: string;
}

export interface SessionType {
  id: number;
  topic: string;
  status: string;
  current_round: number;
  created_at: string;
}

export interface MessageType {
  id: number;
  agent_id: number | null;
  agent_name: string;
  is_human: boolean;
  content: string;
  created_at: string;
}

export interface ThreadMessageType {
  id: number;
  is_human: boolean;
  content: string;
  created_at: string;
}

export interface ThreadType {
  id: number;
  agent_id: number;
  agent_name: string;
  messages: ThreadMessageType[];
  created_at: string;
}

export interface RoundType {
  id: number;
  round_number: number;
  scribe_summary: string;
  public_messages: MessageType[];
  private_threads: ThreadType[];
  created_at: string;
}

export interface RoundDetailType {
  session: SessionType;
  current_round: RoundType;
  agents_attached: { id: number; name: string; is_scribe: boolean }[];
}

export interface GeneratedAgentType {
  id: number;
  name: string;
  personality: string;
  system_prompt: string;
  session_id: number;
  created_at: string;
}

export interface NewAgentInput {
  name: string;
  personality: string;
  system_prompt: string;
  api_base_url: string;
  api_key: string;
  model_name: string;
  avatar_url: string;
}

export interface NewSessionInput {
  topic: string;
  status: string;
  current_round: number;
}
