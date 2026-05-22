import json

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


def _build_messages(system_prompt: str) -> list[dict]:
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "Please provide your response based on the instructions above."},
    ]


async def call_agent(agent: Agent, system_prompt: str, max_tokens: int = 1024) -> str:
    """Call an agent's configured API endpoint with the given prompt (OpenAI-compatible)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{agent.api_base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {agent.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": agent.model_name,
                "messages": _build_messages(system_prompt),
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def stream_agent(agent: Agent, system_prompt: str, max_tokens: int = 1024):
    """Call an agent's API with streaming, yielding content tokens as they arrive.

    Yields:
        str: each content token/delta from the streaming response.
    """
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{agent.api_base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {agent.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": agent.model_name,
                "messages": _build_messages(system_prompt),
                "max_tokens": max_tokens,
                "stream": True,
            },
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[6:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
                except json.JSONDecodeError:
                    continue
