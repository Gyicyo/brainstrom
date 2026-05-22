import httpx
from models import Agent


def build_system_prompt(agent: Agent, context: str, task_description: str) -> str:
    """Build the full system prompt for an agent."""
    parts = [
        f"You are {agent.name}. {agent.personality}",
        f"Your behavior instructions: {agent.system_prompt}",
        f"## Current Context\n{context}",
        f"## Task\n{task_description}",
    ]
    return "\n\n".join(parts)


async def call_agent(agent: Agent, system_prompt: str, max_tokens: int = 1024) -> str:
    """Call an agent's configured API endpoint with the given prompt (OpenAI-compatible)."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "Please provide your response based on the instructions above."},
    ]

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{agent.api_base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {agent.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": agent.model_name,
                "messages": messages,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
