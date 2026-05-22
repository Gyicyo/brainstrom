from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Session as SessionModel, Round, Message, Thread, ThreadMessage, Agent, SessionAgent
from schemas import (
    RoundResponse, RoundDetailResponse, SessionResponse,
    MessageResponse, ThreadResponse, ThreadMessageResponse,
    DivergentRequest, MentionRequest, EndRoundRequest,
)

router = APIRouter(prefix="/api/sessions/{session_id}/rounds", tags=["rounds"])


def _get_session(session_id: int, db: Session) -> SessionModel:
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    return session


def _get_round_detail(db: Session, session: SessionModel, round_obj: Round) -> RoundDetailResponse:
    agents_attached = db.query(SessionAgent).filter(
        SessionAgent.session_id == session.id
    ).all()
    agent_list = []
    for sa in agents_attached:
        agent = db.query(Agent).filter(Agent.id == sa.agent_id).first()
        if agent:
            agent_list.append({
                "id": agent.id,
                "name": agent.name,
                "is_scribe": sa.is_scribe,
            })

    messages = db.query(Message).filter(Message.round_id == round_obj.id).order_by(Message.created_at).all()
    msg_responses = []
    for m in messages:
        agent_name = ""
        if m.agent_id:
            agent = db.query(Agent).filter(Agent.id == m.agent_id).first()
            agent_name = agent.name if agent else ""
        msg_responses.append(MessageResponse(
            id=m.id, agent_id=m.agent_id, agent_name=agent_name,
            is_human=m.is_human, content=m.content, created_at=m.created_at,
        ))

    threads = db.query(Thread).filter(Thread.round_id == round_obj.id).all()
    thread_responses = []
    for t in threads:
        agent = db.query(Agent).filter(Agent.id == t.agent_id).first()
        tmsgs = db.query(ThreadMessage).filter(ThreadMessage.thread_id == t.id).order_by(ThreadMessage.created_at).all()
        thread_responses.append(ThreadResponse(
            id=t.id, agent_id=t.agent_id, agent_name=agent.name if agent else "",
            messages=[ThreadMessageResponse(id=tm.id, is_human=tm.is_human, content=tm.content, created_at=tm.created_at)
                      for tm in tmsgs],
            created_at=t.created_at,
        ))

    return RoundDetailResponse(
        session=SessionResponse.model_validate(session),
        current_round=RoundResponse(
            id=round_obj.id, round_number=round_obj.round_number,
            scribe_summary=round_obj.scribe_summary,
            public_messages=msg_responses, private_threads=thread_responses,
            created_at=round_obj.created_at,
        ),
        agents_attached=agent_list,
    )


@router.get("", response_model=list[RoundResponse])
def list_rounds(session_id: int, db: Session = Depends(get_db)):
    session = _get_session(session_id, db)
    rounds = db.query(Round).filter(Round.session_id == session_id).order_by(Round.round_number).all()
    result = []
    for r in rounds:
        result.append(RoundResponse(
            id=r.id, round_number=r.round_number, scribe_summary=r.scribe_summary,
            public_messages=[], private_threads=[], created_at=r.created_at,
        ))
    return result


@router.post("/start", response_model=RoundDetailResponse, status_code=201)
def start_new_round(session_id: int, db: Session = Depends(get_db)):
    session = _get_session(session_id, db)
    if session.status == "completed":
        raise HTTPException(400, "Session is already completed")

    next_round_num = session.current_round + 1
    round_obj = Round(session_id=session.id, round_number=next_round_num)
    db.add(round_obj)
    session.current_round = next_round_num
    db.commit()
    db.refresh(round_obj)

    return _get_round_detail(db, session, round_obj)


@router.get("/current", response_model=RoundDetailResponse)
def get_current_round(session_id: int, db: Session = Depends(get_db)):
    session = _get_session(session_id, db)
    round_obj = db.query(Round).filter(
        Round.session_id == session_id,
        Round.round_number == session.current_round,
    ).first()
    if not round_obj:
        raise HTTPException(404, "No current round")
    return _get_round_detail(db, session, round_obj)


@router.post("/divergent", response_model=RoundDetailResponse)
def divergent_round(data: DivergentRequest, db: Session = Depends(get_db)):
    """Trigger each non-scribe agent to produce a divergent statement."""
    session = _get_session(data.session_id, db)
    round_obj = db.query(Round).filter(Round.id == data.round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")

    session_agents = db.query(SessionAgent).filter(
        SessionAgent.session_id == session.id,
        SessionAgent.is_scribe == False,
    ).all()

    for sa in session_agents:
        agent = db.query(Agent).filter(Agent.id == sa.agent_id).first()
        if agent:
            msg = Message(round_id=round_obj.id, agent_id=agent.id, is_human=False, content="")
            db.add(msg)

    db.commit()
    return _get_round_detail(db, session, round_obj)


@router.post("/mention", response_model=RoundDetailResponse)
def mention_agent(data: MentionRequest, db: Session = Depends(get_db)):
    """Human @mentions an agent, starting a private thread."""
    session = _get_session(data.session_id, db)
    round_obj = db.query(Round).filter(Round.id == data.round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")

    agent = db.query(Agent).filter(Agent.id == data.agent_id).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    thread = Thread(round_id=round_obj.id, agent_id=agent.id)
    db.add(thread)
    db.flush()

    human_msg = ThreadMessage(thread_id=thread.id, is_human=True, content=data.question)
    db.add(human_msg)
    db.commit()

    return _get_round_detail(db, session, round_obj)


@router.post("/end-round", response_model=RoundDetailResponse)
def end_round(data: EndRoundRequest, db: Session = Depends(get_db)):
    """Mark round complete (scribe summary generated separately)."""
    session = _get_session(data.session_id, db)
    round_obj = db.query(Round).filter(Round.id == data.round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")
    return _get_round_detail(db, session, round_obj)
