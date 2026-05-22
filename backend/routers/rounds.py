import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, selectinload
from database import get_db
from models import Session as SessionModel, Round, Message, Thread, ThreadMessage, Agent, SessionAgent
from schemas import (
    RoundResponse, RoundDetailResponse, SessionResponse,
    MessageResponse, ThreadResponse, ThreadMessageResponse,
    DivergentRequest, MentionRequest, StartRoundRequest, EndRoundRequest,
)
from services.agent_proxy import build_system_prompt, stream_agent

router = APIRouter(prefix="/api/sessions/{session_id}/rounds", tags=["rounds"])


def _get_session(session_id: int, db: Session) -> SessionModel:
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    return session


def _build_divergent_context(session, db, round_obj) -> str:
    """Build accumulated context: topic + initial msg + past summaries + current msgs."""
    parts = []
    if session.topic:
        parts.append(f"## Session Topic\n{session.topic}")

    # User's initial message from round 1
    first_round = db.query(Round).filter(
        Round.session_id == session.id, Round.round_number == 1
    ).first()
    if first_round:
        initial_msg = db.query(Message).filter(
            Message.round_id == first_round.id, Message.is_human == True
        ).order_by(Message.created_at).first()
        if initial_msg and initial_msg.content:
            parts.append(f"## Initial Context\n{initial_msg.content}")

    # Previous rounds' scribe summaries
    prev_rounds = db.query(Round).filter(
        Round.session_id == session.id,
        Round.round_number < round_obj.round_number,
        Round.scribe_summary.isnot(None),
        Round.scribe_summary != "",
    ).order_by(Round.round_number).all()
    for pr in prev_rounds:
        parts.append(f"## Round {pr.round_number} Summary\n{pr.scribe_summary}")

    # Current round discussion
    current_msgs = db.query(Message).options(
        selectinload(Message.agent)
    ).filter(Message.round_id == round_obj.id).order_by(Message.created_at).all()
    msg_lines = []
    for m in current_msgs:
        if m.is_human:
            msg_lines.append(f"Human: {m.content}")
        elif m.content and m.agent:
            msg_lines.append(f"{m.agent.name}: {m.content}")
    if msg_lines:
        parts.append(f"## Current Discussion\n" + "\n".join(msg_lines))

    return "\n\n".join(parts)


def _get_round_detail(db: Session, session: SessionModel, round_obj: Round) -> RoundDetailResponse:
    # Eager-load all relationships to avoid N+1 queries
    agents_attached = db.query(SessionAgent).options(
        selectinload(SessionAgent.agent)
    ).filter(SessionAgent.session_id == session.id).all()

    agent_list = []
    for sa in agents_attached:
        if sa.agent:
            agent_list.append({
                "id": sa.agent.id,
                "name": sa.agent.name,
                "is_scribe": sa.is_scribe,
            })

    messages = db.query(Message).options(
        selectinload(Message.agent)
    ).filter(Message.round_id == round_obj.id).order_by(Message.created_at).all()

    msg_responses = []
    for m in messages:
        msg_responses.append(MessageResponse(
            id=m.id, agent_id=m.agent_id,
            agent_name=m.agent.name if m.agent else "",
            is_human=m.is_human, content=m.content, created_at=m.created_at,
        ))

    threads = db.query(Thread).options(
        selectinload(Thread.agent),
        selectinload(Thread.messages),
    ).filter(Thread.round_id == round_obj.id).all()

    thread_responses = []
    for t in threads:
        thread_responses.append(ThreadResponse(
            id=t.id, agent_id=t.agent_id,
            agent_name=t.agent.name if t.agent else "",
            messages=[ThreadMessageResponse(id=tm.id, is_human=tm.is_human, content=tm.content, created_at=tm.created_at)
                      for tm in t.messages],
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


@router.get("/summaries")
def list_round_summaries(session_id: int, db: Session = Depends(get_db)):
    """Return all rounds' scribe summaries for a session."""
    session = _get_session(session_id, db)
    rounds = db.query(Round).filter(
        Round.session_id == session.id,
    ).order_by(Round.round_number).all()
    return [
        {
            "round_number": r.round_number,
            "summary": r.scribe_summary or "",
            "created_at": r.created_at.isoformat(),
        }
        for r in rounds if r.scribe_summary
    ]


@router.post("/start", response_model=RoundDetailResponse, status_code=201)
def start_new_round(session_id: int, data: StartRoundRequest, db: Session = Depends(get_db)):
    session = _get_session(session_id, db)
    if session.status == "completed":
        raise HTTPException(400, "Session is already completed")

    next_round_num = session.current_round + 1
    round_obj = Round(session_id=session.id, round_number=next_round_num)
    db.add(round_obj)
    session.current_round = next_round_num
    db.flush()

    if data.initial_message:
        human_msg = Message(
            round_id=round_obj.id,
            agent_id=None,
            is_human=True,
            content=data.initial_message,
        )
        db.add(human_msg)

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
def divergent_round(session_id: int, data: DivergentRequest, db: Session = Depends(get_db)):
    """Trigger each non-scribe agent to produce a divergent statement."""
    session = _get_session(session_id, db)
    round_obj = db.query(Round).filter(Round.id == data.round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")

    session_agents = db.query(SessionAgent).options(
        selectinload(SessionAgent.agent)
    ).filter(
        SessionAgent.session_id == session.id,
        SessionAgent.is_scribe == False,
    ).all()

    for sa in session_agents:
        if sa.agent:
            msg = Message(round_id=round_obj.id, agent_id=sa.agent.id, is_human=False, content="")
            db.add(msg)

    db.commit()
    return _get_round_detail(db, session, round_obj)


@router.get("/{round_id}/stream-divergent")
async def stream_divergent(session_id: int, round_id: int, db: Session = Depends(get_db)):
    """SSE endpoint: stream each non-scribe agent's LLM response token-by-token."""
    session = _get_session(session_id, db)
    round_obj = db.query(Round).filter(Round.id == round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")

    # Pre-fetch all data while the DB session is active
    session_agents = db.query(SessionAgent).options(
        selectinload(SessionAgent.agent)
    ).filter(
        SessionAgent.session_id == session.id,
        SessionAgent.is_scribe == False,
    ).all()

    context = _build_divergent_context(session, db, round_obj)

    # Pre-fetch all messages for this round (avoids N+1 in agent loop)
    existing_messages = db.query(Message).filter(
        Message.round_id == round_id
    ).order_by(Message.created_at).all()

    agent_tasks = []
    for sa in session_agents:
        if sa.agent:
            msg = next((m for m in existing_messages if m.agent_id == sa.agent.id), None)
            if msg:
                prompt = build_system_prompt(
                    sa.agent, context,
                    "Provide your unique perspective on this topic. Be creative and specific.",
                )
                agent_tasks.append((sa.agent, msg, prompt))

    async def event_generator():
        from database import SessionLocal
        gen_db = SessionLocal()
        try:
            for agent, msg, prompt in agent_tasks:
                try:
                    yield f"event: agent_start\ndata: {json.dumps({'agent_id': agent.id, 'agent_name': agent.name, 'message_id': msg.id})}\n\n"

                    full_content = ""
                    async for token in stream_agent(agent, prompt):
                        full_content += token
                        yield f"event: token\ndata: {json.dumps({'agent_id': agent.id, 'token': token})}\n\n"

                    # Persist full content to DB
                    db_msg = gen_db.query(Message).filter(Message.id == msg.id).first()
                    if db_msg:
                        db_msg.content = full_content
                        gen_db.commit()

                    yield f"event: agent_done\ndata: {json.dumps({'agent_id': agent.id})}\n\n"
                except Exception as e:
                    yield f"event: agent_error\ndata: {json.dumps({'agent_id': agent.id, 'error': str(e)})}\n\n"

            yield f"event: complete\ndata: {{}}\n\n"
        finally:
            gen_db.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/mention", response_model=RoundDetailResponse)
def mention_agent(session_id: int, data: MentionRequest, db: Session = Depends(get_db)):
    """Human @mentions an agent, starting a private thread."""
    session = _get_session(session_id, db)
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
async def end_round(session_id: int, data: EndRoundRequest, db: Session = Depends(get_db)):
    """End the round and generate scribe summary."""
    session = _get_session(session_id, db)
    round_obj = db.query(Round).filter(Round.id == data.round_id).first()
    if not round_obj:
        raise HTTPException(404, "Round not found")

    from services.scribe import generate_scribe_summary
    await generate_scribe_summary(db, session, round_obj)
    db.commit()

    return _get_round_detail(db, session, round_obj)


@router.post("/final-report")
async def final_report(session_id: int, db: Session = Depends(get_db)):
    """Generate the final synthesis report for the entire session."""
    session = _get_session(session_id, db)
    from services.scribe import generate_final_report
    report = await generate_final_report(db, session)
    return {"report": report}
