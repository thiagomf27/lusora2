"""The provider adapter: temperature at the seam, capabilities in the table.

D85. The two things being pinned here are both "declared, never assumed": a
backend that does not have JSON mode must receive no `response_format` key, and
one whose temperature ceiling is lower than the pack's request must be clamped
rather than sent a value it will reject. Both are properties of the PROVIDER,
so both live in the table and are read from it.
"""

import json

import pytest

from lusora_contracts.prompts import HOUSE_TEMPERATURE
from lusora_worker.errors import StageError
from lusora_worker.providers import llm


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.text = json.dumps(payload)

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx

            raise httpx.HTTPStatusError("boom", request=None, response=self)

    def json(self):
        return self._payload


def _openai_reply(text="{}", finish_reason="stop", **usage):
    return FakeResponse(
        {
            "choices": [{"message": {"content": text}, "finish_reason": finish_reason}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, **usage},
        }
    )


def _anthropic_reply(text="{}"):
    return FakeResponse(
        {"content": [{"text": text}], "usage": {"input_tokens": 10, "output_tokens": 20}}
    )


@pytest.fixture
def sent(monkeypatch):
    """Capture the request body every provider path would have posted."""
    bodies: list[dict] = []

    def fake_post(url, headers=None, json=None, timeout=None):
        bodies.append(json)
        return _anthropic_reply() if url.endswith("/messages") else _openai_reply()

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    return bodies


# ---------------- temperature ----------------


def test_the_temperature_reaches_the_wire(sent):
    llm.chat("deepseek", None, "sys", "user", 1000, 0.2)
    assert sent[0]["temperature"] == 0.2


def test_the_anthropic_path_no_longer_runs_at_the_apis_own_default(sent):
    """It used to send no temperature at all, so it ran at 1.0 — the loudest
    setting in the system, on the provider nobody had checked."""
    llm.chat("anthropic", None, "sys", "user", 1000, 0.2)
    assert sent[0]["temperature"] == 0.2


def test_a_caller_that_says_nothing_gets_the_house_default(sent):
    llm.chat("deepseek", None, "sys", "user", 1000)
    assert sent[0]["temperature"] == HOUSE_TEMPERATURE == 0.7


def test_a_temperature_above_a_providers_ceiling_is_clamped_not_rejected(sent):
    """The schema's 0-2 is OpenAI's range; Anthropic's is 1. A pack should not
    have to know which provider a channel picked, so the provider that cannot
    take the value is the one that clamps it."""
    llm.chat("anthropic", None, "sys", "user", 1000, 1.8)
    assert sent[0]["temperature"] == 1.0
    llm.chat("deepseek", None, "sys", "user", 1000, 1.8)
    assert sent[1]["temperature"] == 1.8, "a provider that can take it must get it"


def test_a_negative_temperature_is_floored(sent):
    llm.chat("deepseek", None, "sys", "user", 1000, -1)
    assert sent[0]["temperature"] == 0.0


# ---------------- json mode ----------------


def test_json_mode_is_only_requested_from_providers_that_declare_it(sent):
    """openai-KIND is not an openai-kind guarantee. A backend without JSON mode
    answers the key with a 400 that reads like a prompt bug."""
    llm.chat("deepseek", None, "sys", "user", 1000)
    assert sent[0]["response_format"] == {"type": "json_object"}

    llm.chat("anthropic", None, "sys", "user", 1000)
    assert "response_format" not in sent[1]


def test_a_provider_that_stops_declaring_json_mode_stops_asking_for_it(monkeypatch, sent):
    """The flag is load-bearing, not decorative: flipping it in the table is
    the whole mechanism for a compatible endpoint that lacks the feature."""
    import dataclasses

    monkeypatch.setitem(
        llm.PROVIDERS, "deepseek",
        dataclasses.replace(llm.PROVIDERS["deepseek"], json_mode=False),
    )
    llm.chat("deepseek", None, "sys", "user", 1000)
    assert "response_format" not in sent[0]


def test_every_provider_declares_both_capabilities():
    """A new provider added without them is the failure the table exists to
    prevent — an unset capability would read as False and be indistinguishable
    from a considered no."""
    for name, spec in llm.PROVIDERS.items():
        assert isinstance(spec.json_mode, bool), name
        assert 0 < spec.max_temperature <= 2, name
        # only openai-kind backends have the concept at all
        assert spec.kind == "openai" or not spec.json_mode, name


# ---------------- the truncation path is not masked ----------------


def test_a_truncated_reply_still_reports_an_actionable_error(monkeypatch):
    """Reasoning models spend max_tokens thinking before the answer starts.
    JSON mode does not change that, and the caller must not be told 'no JSON
    object found' when the real cause is the ceiling."""
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    monkeypatch.setattr(
        llm.httpx, "post",
        lambda *a, **k: _openai_reply(
            text="{partial", finish_reason="length",
            completion_tokens_details={"reasoning_tokens": 15800},
        ),
    )
    with pytest.raises(StageError) as exc:
        llm.chat("deepseek", None, "sys", "user", 1000, 0.2)
    message = str(exc.value)
    assert "1000-token ceiling" in message
    assert "15800" in message, "the reasoning spend is the actionable part"


def test_an_unknown_provider_names_the_ones_that_exist():
    with pytest.raises(StageError, match="unknown llm provider"):
        llm.chat("telepathy", None, "s", "u", 100)


def test_a_missing_key_says_which_variable_and_offers_the_way_out(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    with pytest.raises(StageError, match="DEEPSEEK_API_KEY"):
        llm.chat("deepseek", None, "s", "u", 100)


# ---------------- the seam itself ----------------


def test_the_seam_takes_temperature_positionally_after_max_tokens():
    """Every caller passes it positionally, so the order is part of the
    contract — a test seam that took it by keyword would not catch a swap."""
    import inspect

    params = list(inspect.signature(llm.chat).parameters)
    assert params == ["provider", "model", "system", "user", "max_tokens", "temperature"]


# ---------------- what a call actually costs ----------------


def test_llm_calls_are_billed_per_direction():
    """A reasoning model emits 3-5x more output than input and its reasoning
    tokens bill as OUTPUT. One blended rate under-reported real spend by about
    an order of magnitude — the table said $0.25 where roughly $4 had been
    billed — and a budget gate that cannot see the money cannot stop anything.
    """
    from lusora_worker.costs import token_rates

    cheap_in, cheap_out = token_rates("deepseek", "llm.plan_beats", "deepseek-v4-flash")
    dear_in, dear_out = token_rates("deepseek", "llm.plan_beats", "deepseek-v4-pro")
    assert cheap_out > cheap_in, "output must cost more than input"
    assert dear_out > cheap_out * 2, "v4-pro is materially dearer than v4-flash"
    # the real published rates, per token
    assert cheap_in == pytest.approx(0.44 / 1e6)
    assert cheap_out == pytest.approx(1.32 / 1e6)
    assert dear_out == pytest.approx(3.96 / 1e6)


def test_a_model_with_no_price_is_a_hard_error_not_a_guess():
    """D13's rule, extended to the model: a channel switching model changes
    what a video costs by more than any prompt change in this repo."""
    from lusora_worker.costs import token_rates

    with pytest.raises(StageError, match="no price for model"):
        token_rates("deepseek", "llm.plan_beats", "deepseek-v9-telepathy")


def test_a_reasoning_heavy_call_costs_what_it_really_costs(tmp_path):
    """The end-to-end shape of the bug: 2k in, 20k out on v4-flash."""
    from lusora_worker.costs import token_rates

    in_rate, out_rate = token_rates("deepseek", "llm.plan_beats", "deepseek-v4-flash")
    real = 2_000 * in_rate + 20_000 * out_rate
    blended_old = 22_000 * 2.8e-7          # what the table used to charge
    assert real > blended_old * 4, (real, blended_old)


def test_a_non_token_operation_still_prices_on_its_own_unit():
    from lusora_worker.costs import unit_price

    assert unit_price("local", "tts.narrate") == 0.0
    assert unit_price("ai33", "tts.narrate") > 0


def test_asking_for_a_flat_price_on_a_per_direction_operation_is_refused():
    """Silently returning one of the two rates is how the under-report
    happened; the call site has to say which direction it means."""
    from lusora_worker.costs import unit_price

    with pytest.raises(StageError, match="priced per direction"):
        unit_price("deepseek", "llm.plan_beats")
