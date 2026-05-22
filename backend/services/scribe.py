import datetime
from sqlalchemy.orm import Session
from models import Session as SessionModel, Round, Message, Thread, ThreadMessage, Agent, SessionAgent
from services.agent_proxy import call_agent, build_system_prompt


def _find_scribe(db: Session, session: SessionModel) -> Agent | None:
    """Find the scribe agent for a session, or create a default one."""
    sa = db.query(SessionAgent).filter(
        SessionAgent.session_id == session.id,
        SessionAgent.is_scribe == True,
    ).first()
    if sa:
        return db.query(Agent).filter(Agent.id == sa.agent_id).first()

    scribe = db.query(Agent).filter(Agent.name == "Scribe").first()
    if scribe:
        return scribe

    return Agent(
        name="Scribe",
        personality="Neutral, organized summarizer",
        system_prompt=(
            "You are a scribe. You do NOT participate in discussions. "
            "Your only job is to produce clear, structured summaries of brainstorming sessions."
        ),
        api_base_url="https://api.openai.com/v1",
        api_key="",
        model_name="gpt-4o",
    )


def build_round_summary_context(db: Session, round_obj: Round) -> str:
    """Build the full context of a round for the scribe."""
    lines = [f"# Round {round_obj.round_number} Summary\n"]

    public_msgs = db.query(Message).filter(Message.round_id == round_obj.id).order_by(Message.created_at).all()
    if public_msgs:
        lines.append("## Public Discussion")
        for m in public_msgs:
            speaker = "Human" if m.is_human else (m.agent.name if m.agent else "Unknown")
            lines.append(f"**{speaker}**: {m.content}")

    threads = db.query(Thread).filter(Thread.round_id == round_obj.id).all()
    for t in threads:
        agent = db.query(Agent).filter(Agent.id == t.agent_id).first()
        agent_name = agent.name if agent else "Unknown"
        lines.append(f"\n## Private thread with {agent_name}")
        tmsgs = db.query(ThreadMessage).filter(ThreadMessage.thread_id == t.id).order_by(ThreadMessage.created_at).all()
        for tm in tmsgs:
            speaker = "Human" if tm.is_human else agent_name
            lines.append(f"**{speaker}**: {tm.content}")

    return "\n".join(lines)


async def generate_scribe_summary(db: Session, session: SessionModel, round_obj: Round) -> str:
    """Call the scribe to generate a summary and store it."""
    scribe = _find_scribe(db, session)
    context = build_round_summary_context(db, round_obj)

    system_prompt = build_system_prompt(
        scribe,
        context,
        "Write a structured summary of this brainstorming round. "
        "Organize key ideas, note connections between different agents' contributions, "
        "and highlight any conclusions or action items. "
        "Keep it concise but comprehensive.",
    )

    try:
        summary = await call_agent(scribe, system_prompt)
    except Exception as e:
        summary = f"[Scribe error: {e}]"

    round_obj.scribe_summary = summary
    return summary


async def generate_final_report(db: Session, session: SessionModel) -> str:
    """Generate a final synthesis report for the entire session."""
    scribe = _find_scribe(db, session)
    rounds = db.query(Round).filter(Round.session_id == session.id).order_by(Round.round_number).all()

    all_content = [f"# Brainstorming Session: {session.topic}\n"]
    for r in rounds:
        all_content.append(f"\n---\n## Round {r.round_number}\n")
        all_content.append(r.scribe_summary or "(No summary)")

    system_prompt = build_system_prompt(
        scribe,
        "\n".join(all_content),
        "Write a comprehensive final report synthesizing all rounds of this brainstorming session. "
        "Include: main themes, key insights, areas of agreement/disagreement, and actionable conclusions.",
    )

    try:
        report = await call_agent(scribe, system_prompt)
    except Exception as e:
        report = f"[Scribe error: {e}]"

    return report
