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

from lusora_contracts.prompts import HOUSE_TEMPERATURE

from ..errors import StageError


@dataclass(frozen=True)
class Provider:
    """What a backend is and what it can actually do.

    The last two fields are CAPABILITIES, and they are declared here for the
    reason D13 put prices in a table: a capability that is assumed cannot be
    told apart from one that was silently ignored. `json_mode` is an
    openai-KIND feature, not an openai-kind guarantee — a compatible endpoint
    that does not have it answers a `response_format` key with a 400 that reads
    like a prompt bug. `max_temperature` is the same mistake in the other
    direction: the prompt schema's 0-2 is OpenAI's range and Anthropic's is 1,
    so a pack that legally asks for 1.5 must be clamped by the provider that
    cannot take it rather than rejected by a schema that cannot know which
    provider a channel picked (D85).
    """

    kind: str
    base_url: str
    default_model: str
    env_var: str
    json_mode: bool
    max_temperature: float


PROVIDERS: dict[str, Provider] = {
    "deepseek": Provider(
        "openai", "https://api.deepseek.com/v1", "deepseek-v4-pro", "DEEPSEEK_API_KEY",
        json_mode=True, max_temperature=2.0,
    ),
    "openai": Provider(
        "openai", "https://api.openai.com/v1", "gpt-4o-mini", "OPENAI_API_KEY",
        json_mode=True, max_temperature=2.0,
    ),
    "anthropic": Provider(
        "anthropic", "https://api.anthropic.com/v1", "claude-haiku-4-5-20251001",
        "ANTHROPIC_API_KEY",
        # the Messages API has no response_format; asking for JSON is a prompt
        # instruction there, which is what the welded half already does
        json_mode=False, max_temperature=1.0,
    ),
}


@dataclass
class LLMResult:
    text: str
    input_tokens: int
    output_tokens: int

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


# test seam: chat(provider, model, system, user, max_tokens, temperature) -> LLMResult
#
# Temperature is at the SEAM rather than inside the adapter so that a test can
# assert what a role called at without touching the network (D85).
ChatFn = Callable[..., LLMResult]


def chat(
    provider: str,
    model: str | None,
    system: str,
    user: str,
    max_tokens: int = 4000,
    temperature: float = HOUSE_TEMPERATURE,
) -> LLMResult:
    if provider not in PROVIDERS:
        raise StageError(
            "llm",
            f"unknown llm provider '{provider}' — known: {sorted(PROVIDERS)} (or 'mock' for the deterministic fallback)",
        )
    spec = PROVIDERS[provider]
    kind, base_url, default_model, env_var = spec.kind, spec.base_url, spec.default_model, spec.env_var
    api_key = os.environ.get(env_var)
    if not api_key:
        raise StageError(
            "llm",
            f"provider '{provider}' needs {env_var} in .env — set it, or switch the channel to llm 'mock'",
        )
    model = model or default_model
    # clamped by the backend that cannot take it, never rejected by the schema
    temperature = max(0.0, min(float(temperature), spec.max_temperature))

    try:
        if kind == "openai":
            body: dict = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            # only where the provider DECLARES it: a backend that does not have
            # JSON mode answers the key with a 400 that reads like a prompt bug
            if spec.json_mode:
                body["response_format"] = {"type": "json_object"}
            resp = httpx.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=body,
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
                    # this path used to send nothing, so it ran at the API's own
                    # default of 1.0 — the loudest setting in the system, on the
                    # provider nobody had checked (D85)
                    "temperature": temperature,
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
