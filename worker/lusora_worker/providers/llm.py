"""LLM provider adapter — one client, several backends.

Backends are OpenAI-compatible chat APIs (deepseek, openai, and any
compatible endpoint) plus Anthropic's native messages API. The provider
name is also the price-table key; usage (tokens) is returned so the
budget gate records actuals. Missing API key = actionable StageError.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Callable

import httpx

from ..errors import StageError

# provider -> (kind, base_url, default_model, env var)
PROVIDERS: dict[str, tuple[str, str, str, str]] = {
    "deepseek": ("openai", "https://api.deepseek.com/v1", "deepseek-v4-pro", "DEEPSEEK_API_KEY"),
    "openai": ("openai", "https://api.openai.com/v1", "gpt-4o-mini", "OPENAI_API_KEY"),
    "anthropic": ("anthropic", "https://api.anthropic.com/v1", "claude-haiku-4-5-20251001", "ANTHROPIC_API_KEY"),
}


@dataclass
class LLMResult:
    text: str
    input_tokens: int
    output_tokens: int

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


# test seam: chat(provider, model, system, user, max_tokens) -> LLMResult
ChatFn = Callable[[str, str | None, str, str, int], LLMResult]


def chat(provider: str, model: str | None, system: str, user: str, max_tokens: int = 4000) -> LLMResult:
    if provider not in PROVIDERS:
        raise StageError(
            "llm",
            f"unknown llm provider '{provider}' — known: {sorted(PROVIDERS)} (or 'mock' for the deterministic fallback)",
        )
    kind, base_url, default_model, env_var = PROVIDERS[provider]
    api_key = os.environ.get(env_var)
    if not api_key:
        raise StageError(
            "llm",
            f"provider '{provider}' needs {env_var} in .env — set it, or switch the channel to llm 'mock'",
        )
    model = model or default_model

    try:
        if kind == "openai":
            resp = httpx.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "max_tokens": max_tokens,
                    "temperature": 0.7,
                },
                timeout=180,
            )
            resp.raise_for_status()
            data = resp.json()
            usage = data.get("usage") or {}
            choice = data["choices"][0]
            # Reasoning models (deepseek-v4-*) spend part of max_tokens thinking
            # before the answer starts, so a budget that used to be generous now
            # truncates mid-JSON. Say so here: the caller only sees unparseable
            # output and would report "the model returned no JSON object".
            if choice.get("finish_reason") == "length":
                reasoning = int(
                    (usage.get("completion_tokens_details") or {}).get("reasoning_tokens", 0)
                )
                raise StageError(
                    "llm",
                    f"{provider} hit the {max_tokens}-token ceiling before finishing "
                    f"({usage.get('completion_tokens', 0)} completion tokens, {reasoning} of them "
                    "reasoning) — the output is truncated. Raise the caller's token budget.",
                )
            return LLMResult(
                text=choice["message"]["content"] or "",
                input_tokens=int(usage.get("prompt_tokens", 0)),
                output_tokens=int(usage.get("completion_tokens", 0)),
            )
        else:  # anthropic
            resp = httpx.post(
                f"{base_url}/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                json={
                    "model": model,
                    "system": system,
                    "messages": [{"role": "user", "content": user}],
                    "max_tokens": max_tokens,
                },
                timeout=180,
            )
            resp.raise_for_status()
            data = resp.json()
            usage = data.get("usage") or {}
            return LLMResult(
                text="".join(b.get("text", "") for b in data.get("content", [])),
                input_tokens=int(usage.get("input_tokens", 0)),
                output_tokens=int(usage.get("output_tokens", 0)),
            )
    except httpx.HTTPStatusError as e:
        raise StageError(
            "llm", f"{provider} API error {e.response.status_code}: {e.response.text[:200]}"
        )
    except httpx.HTTPError as e:
        raise StageError("llm", f"{provider} API unreachable: {e}")


def extract_json(text: str) -> dict:
    """Parse a JSON object from an LLM reply (tolerates code fences/prose)."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object found in the model output")
    return json.loads(text[start : end + 1])
