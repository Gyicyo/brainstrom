from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Session as SessionModel, SessionAgent, Agent, Round
from schemas import SessionCreate, SessionResponse

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionResponse])
def list_sessions(db: Session = Depends(get_db)):
    return db.query(SessionModel).order_by(SessionModel.created_at.desc()).all()


@router.post("", response_model=SessionResponse, status_code=201)
def create_session(data: SessionCreate, db: Session = Depends(get_db)):
    session = SessionModel(topic=data.topic)
    db.add(session)
    db.flush()

    if data.scribe_agent_id not in data.agent_ids:
        db.rollback()
        raise HTTPException(400, "scribe_agent_id must be one of agent_ids")

    for agent_id in data.agent_ids:
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if not agent:
            db.rollback()
            raise HTTPException(404, f"Agent with id {agent_id} not found")
        db.add(SessionAgent(
            session_id=session.id,
            agent_id=agent_id,
            is_scribe=(agent_id == data.scribe_agent_id),
        ))

    db.commit()
    db.refresh(session)
    return session


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@router.post("/{session_id}/end", response_model=SessionResponse)
def end_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    session.status = "completed"
    db.commit()
    db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    db.delete(session)
    db.commit()
