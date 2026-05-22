import json
import logging

import httpx
from models import Agent

logger = logging.getLogger(__name__)


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


async def call_agent(agent: Agent, system_prompt: str, max_tokens: int = 4096) -> str:
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


async def stream_agent(agent: Agent, system_prompt: str, max_tokens: int = 4096):
    """Call an agent's API with streaming, yielding content tokens as they arrive.

    Yields:
        str: each content token/delta from the streaming response.
    """
    async with httpx.AsyncClient(timeout=300.0) as client:
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
            finish_reason = None
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[6:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    finish_reason = chunk.get("choices", [{}])[0].get("finish_reason") or finish_reason
                    content = delta.get("content", "")
                    if content:
                        yield content
                except json.JSONDecodeError:
                    continue

        if finish_reason == "length":
            logger.warning("Agent %s response truncated by max_tokens", agent.id)
