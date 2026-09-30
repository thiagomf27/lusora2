"""LLM provider adapter — one client, several backends.

Backends are OpenAI-compatible chat APIs (deepseek, openai, and any
compatible endpoint), Anthropic's native messages API, Google's Gemini API
(D116), and the Claude CLI on the operator's own subscription (D103). The
provider name is also the price-table key; usage (tokens) is returned so the
budget gate records actuals. Missing API key = actionable StageError.

`chat` answers text; `see` answers text about images, and only a provider
that declares `vision` may be asked. Either takes a plain provider name or a
fallback chain (a list, D116), walked against the quota ledger in `quota.py`.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import httpx

from lusora_contracts.prompts import HOUSE_TEMPERATURE

from ..errors import StageError
from . import quota


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
    provider a channel picked (D85). `vision` is the same kind of declaration
    (D103): DeepSeek is text-only, and a shot judge pointed at it must be
    refused by name rather than answer about pictures it never saw.
    """

    kind: str
    base_url: str
    default_model: str
    env_var: str
    json_mode: bool
    max_temperature: float
    vision: bool


PROVIDERS: dict[str, Provider] = {
    "deepseek": Provider(
        # v4-flash rather than v4-pro: the overlay eval runs the planner four
        # times per case and the pro model spent 10-20k output tokens thinking
        # before a ~600-token answer. Changing this INVALIDATES every recorded
        # number — evals/BASELINE.md has the scar from the last time a default
        # model moved under a baseline — so both arms are retaken together.
        "openai", "https://api.deepseek.com/v1", "deepseek-v4-flash", "DEEPSEEK_API_KEY",
        json_mode=True, max_temperature=2.0, vision=False,
    ),
    "openai": Provider(
        "openai", "https://api.openai.com/v1", "gpt-4o-mini", "OPENAI_API_KEY",
        json_mode=True, max_temperature=2.0, vision=True,
    ),
    "anthropic": Provider(
        "anthropic", "https://api.anthropic.com/v1", "claude-haiku-4-5-20251001",
        "ANTHROPIC_API_KEY",
        # the Messages API has no response_format; asking for JSON is a prompt
        # instruction there, which is what the welded half already does
        json_mode=False, max_temperature=1.0, vision=True,
    ),
    # D103 — `claude -p` on the operator's own login (Dark Palace's
    # claude_esp.py). No key: the CLI's login is the credential, and a
    # subscription call costs $0 in the price table while its tokens are still
    # recorded. It takes no temperature, so the clamp is moot; 1.0 keeps the
    # table's invariant. The model is the CLI's alias ("sonnet", "haiku").
    "claude_cli": Provider(
        "claude_cli", "", "sonnet", "",
        json_mode=False, max_temperature=1.0, vision=True,
    ),
    # D116 — Google's Gemini API, keyed by GEMINI_API_KEY. `gemini-3.8-flash`
    # was the newest stable (non-preview, non-lite) Flash model GEMINI_API_KEY
    # had on its `GET /v1beta/models` listing when this was written; that
    # listing is per-key and changes over time, so GEMINI_MODEL overrides it.
    # `json_mode` is false even though the REST call DOES have a JSON mode
    # (`responseMimeType`): that flag means "send openai's response_format",
    # a key only the openai-kind branch reads — gemini's own branch asks for
    # JSON directly from `expect_json`, never through this field.
    "gemini": Provider(
        "gemini", "https://generativelanguage.googleapis.com/v1beta",
        os.environ.get("GEMINI_MODEL") or "gemini-3.8-flash", "GEMINI_API_KEY",
        json_mode=False, max_temperature=2.0, vision=True,
    ),
}


@dataclass
class LLMResult:
    text: str
    input_tokens: int
    output_tokens: int
    # D116 — which element of a chain actually answered, so a caller can bill
    # and log the real provider rather than the chain it was offered.
    provider: str = ""
    model: str = ""

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


# test seam: chat(provider, model, system, user, max_tokens, temperature) -> LLMResult
#
# Temperature is at the SEAM rather than inside the adapter so that a test can
# assert what a role called at without touching the network (D85).
ChatFn = Callable[..., LLMResult]


def chain_of(value: str | list[str] | None, default: str | list[str] = "mock") -> list[str]:
    """Normalize a channel's `llm` field into an ordered list of elements
    (D116). `None` becomes `default`; a bare string becomes a one-element
    chain; a list is returned as-is (stringified). Every caller that used to
    compare a plain string against `"mock"` compares `chain_of(value) ==
    ["mock"]` instead — a list would otherwise stringify to `"['a', 'b']"`,
    which is never `"mock"` and used to silently mean "call the real API"."""
    if value is None:
        value = default
    if isinstance(value, list):
        return [str(v) for v in value]
    return [str(value)]


def parse_element(element: str) -> tuple[str, str | None]:
    """`"provider"` or `"provider/model"` -> `(provider, model)`."""
    name, sep, model = element.partition("/")
    return name, (model or None) if sep else None


def gate_element(chain: list[str]) -> str:
    """The chain element the budget gate should price the ESTIMATE against:
    the first one the ledger does not mark out, so a channel whose first
    choice is quota-exhausted is not quoted a price for a call it was never
    going to make. When every element is out, the first one anyway — the gate
    then raises its own actionable price/budget error instead of crashing on
    an empty chain."""
    for element in chain:
        if not quota.out_reason(parse_element(element)[0]):
            return element
    return chain[0]


def gate_provider(chain: list[str]) -> str:
    """`gate_element`'s provider name, without its `/model`."""
    return parse_element(gate_element(chain))[0]


def chat(
    provider: str | list[str],
    model: str | None,
    system: str,
    user: str,
    max_tokens: int = 4000,
    temperature: float = HOUSE_TEMPERATURE,
    expect_json: bool = True,
) -> LLMResult:
    """One completion, from the first element of `provider` (a plain provider
    name, or a fallback chain — D116) that is ready and answers.

    An element out in the quota ledger is skipped without being tried; an
    element that fails moves the SAME call to the next one at once, and the
    failure is classified into the shared ledger so later calls skip it too.
    `result.provider`/`result.model` name whichever element actually
    answered. Every element failing raises one `StageError` naming each and
    why.

    A plain string is NOT a one-element chain: it never reads or writes the
    ledger, and a failure raises that provider's own error, unchanged — so a
    plain-string channel behaves exactly as it did before chains existed,
    and one per-minute 429 on it cannot lock the provider out for every
    other video on the machine.
    """
    return _run_chain(provider, model, lambda name, m: _chat_one(
        name, m, system, user, max_tokens, temperature, expect_json), "provider")


def _run_chain(provider: str | list[str], model: str | None,
               call: Callable[[str, str | None], LLMResult], what: str) -> LLMResult:
    """`chat()`'s and `see()`'s shared chain walk (D116)."""
    if not isinstance(provider, list):
        name, elem_model = parse_element(provider)
        result = call(name, elem_model or model)
        result.provider = name
        result.model = elem_model or model or PROVIDERS[name].default_model
        return result
    errors: list[str] = []
    marks: list[tuple[str, str]] = []
    for element in provider:
        name, elem_model = parse_element(str(element))
        reason = quota.out_reason(name)
        if reason:
            errors.append(f"{name}: out ({reason[:120]})")
            continue
        try:
            result = call(name, elem_model or model)
        except StageError as exc:
            out, seconds = quota.classify(name, getattr(exc, "http_detail", str(exc)), getattr(exc, "http_status", None))
            if out:
                quota.mark_out(name, str(exc), seconds)
                marks.append((name, str(exc)[:200]))
            errors.append(f"{name}: {exc}")
            continue
        result.provider = name
        result.model = elem_model or model or PROVIDERS[name].default_model
        return result
    raise StageError("llm", f"every {what} in the chain failed: " + "; ".join(errors), marks=marks)


def _chat_one(
    provider: str,
    model: str | None,
    system: str,
    user: str,
    max_tokens: int,
    temperature: float,
    expect_json: bool,
) -> LLMResult:
    """One completion from exactly ONE named provider — `chat()`'s old body,
    before chains existed. `expect_json` is the CALL's half of JSON mode
    (D90).

    The provider declares whether it CAN take `response_format`; the caller
    declares whether this answer is JSON at all. Both are needed: DeepSeek
    rejects `response_format: json_object` unless the prompt also contains the
    word "json", so asking for it on a prose role is a 400 rather than a
    harmless extra key — which is what every script generation got between D85
    and D90. Defaulting to True keeps the JSON roles exactly as they were.
    """
    if provider not in PROVIDERS:
        raise StageError(
            "llm",
            f"unknown llm provider '{provider}' — known: {sorted(PROVIDERS)} (or 'mock' for the deterministic fallback)",
        )
    spec = PROVIDERS[provider]
    if spec.kind == "claude_cli":
        return _claude_cli(model or spec.default_model, system, user, [])
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
            # provider CAN and caller WANTS (D90): a backend without JSON mode
            # answers the key with a 400 that reads like a prompt bug, and so
            # does DeepSeek when the answer it is being asked for is prose
            if spec.json_mode and expect_json:
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
        elif kind == "gemini":
            # D116 — Gemini's system text is a top-level field, not a message;
            # `expect_json` maps to `responseMimeType`, the REST equivalent of
            # the openai branch's `response_format` (never gated on
            # `spec.json_mode`, which only that branch reads).
            gen_config: dict = {"temperature": temperature, "maxOutputTokens": max_tokens}
            if expect_json:
                gen_config["responseMimeType"] = "application/json"
            resp = httpx.post(
                f"{base_url}/models/{model}:generateContent",
                headers={"x-goog-api-key": api_key},
                json={
                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                    "systemInstruction": {"parts": [{"text": system}]},
                    "generationConfig": gen_config,
                },
                timeout=180,
            )
            resp.raise_for_status()
            data = resp.json()
            usage = data.get("usageMetadata") or {}
            return LLMResult(
                text=_gemini_text(data),
                input_tokens=int(usage.get("promptTokenCount", 0)),
                output_tokens=int(usage.get("candidatesTokenCount", 0)),
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
        # the FULL body, never truncated, rides on the exception for the
        # quota ledger to classify (D116) — a retry hint can sit past the
        # 200 chars a human-readable message keeps
        err = StageError(
            "llm", f"{provider} API error {e.response.status_code}: {e.response.text[:200]}"
        )
        err.http_status = e.response.status_code
        err.http_detail = e.response.text
        raise err
    except httpx.HTTPError as e:
        raise StageError("llm", f"{provider} API unreachable: {e}")


# test seam: see(provider, model, system, user, images, max_tokens, temperature) -> LLMResult
SeeFn = Callable[..., LLMResult]


def see(
    provider: str | list[str],
    model: str | None,
    system: str,
    user: str,
    images: list[Path],
    max_tokens: int = 4000,
    temperature: float = HOUSE_TEMPERATURE,
) -> LLMResult:
    """One completion about `images` (D103), from the first ready element of
    `provider` that answers — same chain rules as `chat()` (D116)."""
    return _run_chain(provider, model, lambda name, m: _see_one(
        name, m, system, user, images, max_tokens, temperature), "vision provider")


def _see_one(
    provider: str,
    model: str | None,
    system: str,
    user: str,
    images: list[Path],
    max_tokens: int,
    temperature: float,
) -> LLMResult:
    """One completion about `images` from exactly ONE named provider (D103).
    Refused, by name, on a provider that does not declare `vision`."""
    spec = PROVIDERS.get(provider)
    if spec is None:
        raise StageError("llm", f"unknown llm provider '{provider}' — known: {sorted(PROVIDERS)}")
    if not spec.vision:
        able = sorted(n for n, p in PROVIDERS.items() if p.vision)
        raise StageError("llm", f"provider '{provider}' cannot see images — use one of {able}")
    model = model or spec.default_model
    if spec.kind == "claude_cli":
        return _claude_cli(model, system, user, images)
    api_key = os.environ.get(spec.env_var)
    if not api_key:
        raise StageError("llm", f"provider '{provider}' needs {spec.env_var} in .env")
    temperature = max(0.0, min(float(temperature), spec.max_temperature))
    encoded = [(_media_type(p), base64.b64encode(Path(p).read_bytes()).decode()) for p in images]
    try:
        if spec.kind == "openai":
            content: list[dict] = [{"type": "text", "text": user}]
            content += [{"type": "image_url", "image_url": {"url": f"data:{mt};base64,{b64}"}}
                        for mt, b64 in encoded]
            resp = httpx.post(
                f"{spec.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "max_tokens": max_tokens, "temperature": temperature,
                      "messages": [{"role": "system", "content": system},
                                   {"role": "user", "content": content}]},
                timeout=300,
            )
            resp.raise_for_status()
            data = resp.json()
            usage = data.get("usage") or {}
            return LLMResult(text=data["choices"][0]["message"]["content"] or "",
                             input_tokens=int(usage.get("prompt_tokens", 0)),
                             output_tokens=int(usage.get("completion_tokens", 0)))
        if spec.kind == "gemini":
            parts: list[dict] = [{"inlineData": {"mimeType": mt, "data": b64}} for mt, b64 in encoded]
            parts.append({"text": user})
            resp = httpx.post(
                f"{spec.base_url}/models/{model}:generateContent",
                headers={"x-goog-api-key": api_key},
                json={
                    "contents": [{"role": "user", "parts": parts}],
                    "systemInstruction": {"parts": [{"text": system}]},
                    "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
                },
                timeout=300,
            )
            resp.raise_for_status()
            data = resp.json()
            usage = data.get("usageMetadata") or {}
            return LLMResult(
                text=_gemini_text(data),
                input_tokens=int(usage.get("promptTokenCount", 0)),
                output_tokens=int(usage.get("candidatesTokenCount", 0)),
            )
        blocks: list[dict] = [{"type": "image", "source": {"type": "base64", "media_type": mt, "data": b64}}
                              for mt, b64 in encoded]
        blocks.append({"type": "text", "text": user})
        resp = httpx.post(
            f"{spec.base_url}/messages",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            json={"model": model, "system": system, "max_tokens": max_tokens,
                  "temperature": temperature, "messages": [{"role": "user", "content": blocks}]},
            timeout=300,
        )
        resp.raise_for_status()
        data = resp.json()
        usage = data.get("usage") or {}
        return LLMResult(text="".join(b.get("text", "") for b in data.get("content", [])),
                         input_tokens=int(usage.get("input_tokens", 0)),
                         output_tokens=int(usage.get("output_tokens", 0)))
    except httpx.HTTPStatusError as e:
        err = StageError("llm", f"{provider} API error {e.response.status_code}: {e.response.text[:200]}")
        err.http_status = e.response.status_code
        err.http_detail = e.response.text
        raise err
    except httpx.HTTPError as e:
        raise StageError("llm", f"{provider} API unreachable: {e}")


def _gemini_text(data: dict) -> str:
    """Concatenate every non-thought text part across all candidates (Dark
    Palace's `_texto_da_resposta`) — harmless today (no `thinkingConfig` is
    sent, so nothing comes back marked `thought`), and cheap insurance against
    a model that starts including reasoning text by default."""
    return "".join(
        p.get("text", "")
        for c in data.get("candidates") or []
        for p in (c.get("content") or {}).get("parts") or []
        if isinstance(p.get("text"), str) and not p.get("thought")
    )


def _media_type(path: Path) -> str:
    return "image/png" if str(path).lower().endswith(".png") else "image/jpeg"


# ---------------- the Claude CLI (D103) ----------------

# Each `claude -p` is a Node process of a few hundred MB; on the 7.5 GB laptop
# two at once is the ceiling that leaves room for everything else.
_CLI_SLOTS = threading.BoundedSemaphore(max(1, int(os.environ.get("CLAUDE_CLI_CONCURRENCY", "2") or "2")))
_CLI_TIMEOUT_S = 300


def _cli_env() -> dict[str, str]:
    """The environment minus a parent Claude session's own variables: a worker
    started from inside Claude Code would otherwise hand the child that
    session's token, which is not the operator's login (Dark Palace's `_env`)."""
    env = dict(os.environ)
    for key in list(env):
        upper = key.upper()
        if upper == "CLAUDECODE" or upper.startswith(("CLAUDE_CODE_", "CLAUDE_AGENT_")):
            env.pop(key, None)
    return env


def _claude_cli(model: str, system: str, user: str, images: list[Path]) -> LLMResult:
    """`claude -p` in a scratch folder holding only the images, allowed only
    its Read tool there — the CLI's way of looking at a file. A text-only call
    gets no tools at all."""
    binary = os.environ.get("CLAUDE_BIN") or shutil.which("claude")
    if not binary:
        raise StageError("llm", "provider 'claude_cli' needs the `claude` CLI on PATH (or CLAUDE_BIN), logged in")
    with tempfile.TemporaryDirectory(prefix="lusora_cli_") as workdir:
        names = []
        for n, image in enumerate(images):
            name = f"{n:02d}_{Path(image).name}"
            shutil.copy(image, Path(workdir) / name)
            names.append(name)
        if names:
            prompt = ("Use the Read tool to look at these image files in the current folder, in this order: "
                      f"{', '.join(names)}. Then answer in a single reply, without any other tool.\n\n")
            tools = ["--tools", "Read", "--allowedTools", "Read", "--add-dir", workdir]
        else:
            prompt = "Answer directly in this single reply, without using any tool.\n\n"
            tools = ["--tools", ""]
        prompt += f"{system}\n\n{user}"
        argv = [binary, "-p", "--output-format", "json", "--model", model, *tools]
        with _CLI_SLOTS:
            try:
                proc = subprocess.run(argv, input=prompt, capture_output=True, text=True, cwd=workdir,
                                      env=_cli_env(), timeout=_CLI_TIMEOUT_S)
            except subprocess.TimeoutExpired:
                raise StageError("llm", f"claude_cli gave no answer in {_CLI_TIMEOUT_S}s")
    out = proc.stdout or ""
    try:
        data = json.loads(out[out.find("{"):])
    except ValueError:
        data = {"is_error": True, "result": out or proc.stderr}
    text = str(data.get("result") or "")
    if data.get("is_error") or proc.returncode:
        raise StageError("llm", f"claude_cli failed: {(text or proc.stderr or out)[:200]}")
    usage = data.get("usage") or {}
    return LLMResult(
        text=text.strip(),
        # the CLI sends its own (cached) system prompt too; count what was read
        input_tokens=int(usage.get("input_tokens", 0)) + int(usage.get("cache_read_input_tokens", 0))
        + int(usage.get("cache_creation_input_tokens", 0)),
        output_tokens=int(usage.get("output_tokens", 0)),
    )


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
