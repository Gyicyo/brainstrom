import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship
from database import Base


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    personality = Column(Text, default="")
    system_prompt = Column(Text, default="")
    api_base_url = Column(String(500), nullable=False)
    api_key = Column(String(500), nullable=False)
    model_name = Column(String(100), nullable=False)
    avatar_url = Column(String(500), default="")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    topic = Column(Text, default="")
    status = Column(String(20), default="active")  # active | completed
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    current_round = Column(Integer, default=0)

    rounds = relationship("Round", back_populates="session", cascade="all, delete-orphan",
                          order_by="Round.round_number")
    session_agents = relationship("SessionAgent", back_populates="session", cascade="all, delete-orphan")


class SessionAgent(Base):
    __tablename__ = "session_agents"
    __table_args__ = (UniqueConstraint("session_id", "agent_id", name="uq_session_agent"),)

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False)
    is_scribe = Column(Boolean, default=False)

    agent = relationship("Agent")
    session = relationship("Session", back_populates="session_agents")


class Round(Base):
    __tablename__ = "rounds"
    __table_args__ = (UniqueConstraint("session_id", "round_number", name="uq_session_round"),)

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    round_number = Column(Integer, nullable=False)
    scribe_summary = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    session = relationship("Session", back_populates="rounds")
    public_messages = relationship("Message", back_populates="round", cascade="all, delete-orphan")
    private_threads = relationship("Thread", back_populates="round", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    is_human = Column(Boolean, default=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    round = relationship("Round", back_populates="public_messages")
    agent = relationship("Agent")


class Thread(Base):
    __tablename__ = "threads"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    round = relationship("Round", back_populates="private_threads")
    agent = relationship("Agent")
    messages = relationship("ThreadMessage", back_populates="thread", cascade="all, delete-orphan")


class ThreadMessage(Base):
    __tablename__ = "thread_messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("threads.id"), nullable=False)
    is_human = Column(Boolean, default=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    thread = relationship("Thread", back_populates="messages")
