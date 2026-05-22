import datetime
from pydantic import BaseModel
from typing import Optional


# Agent schemas
class AgentCreate(BaseModel):
    name: str
    personality: str = ""
    system_prompt: str = ""
    api_base_url: str
    api_key: str
    model_name: str
    avatar_url: str = ""


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    personality: Optional[str] = None
    system_prompt: Optional[str] = None
    api_base_url: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    avatar_url: Optional[str] = None


class AgentResponse(BaseModel):
    id: int
    name: str
    personality: str
    system_prompt: str
    api_base_url: str
    api_key: str
    model_name: str
    avatar_url: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


# Session schemas
class SessionCreate(BaseModel):
    topic: str = ""
    agent_ids: list[int] = []
    scribe_agent_id: int


class SessionResponse(BaseModel):
    id: int
    topic: str
    status: str
    current_round: int
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


# Round schemas
class MessageResponse(BaseModel):
    id: int
    agent_id: Optional[int]
    agent_name: Optional[str] = ""
    is_human: bool
    content: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class ThreadMessageResponse(BaseModel):
    id: int
    is_human: bool
    content: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class ThreadResponse(BaseModel):
    id: int
    agent_id: int
    agent_name: str
    messages: list[ThreadMessageResponse]
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class RoundResponse(BaseModel):
    id: int
    round_number: int
    scribe_summary: str
    public_messages: list[MessageResponse]
    private_threads: list[ThreadResponse]
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class RoundDetailResponse(BaseModel):
    session: SessionResponse
    current_round: RoundResponse
    agents_attached: list[dict]

    model_config = {"from_attributes": True}


class DivergentRequest(BaseModel):
    round_id: int


class MentionRequest(BaseModel):
    round_id: int
    agent_id: int
    question: str


class StartRoundRequest(BaseModel):
    initial_message: str = ""


class EndRoundRequest(BaseModel):
    round_id: int


class AgentTestResponse(BaseModel):
    success: bool
    message: str
