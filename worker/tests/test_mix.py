"""The sound mix (D114, documentary plan slice 9).

Dark Palace's `musica.py`: one bed under the whole video, loudness-matched and
looped without a seam, breathing with the real voice (down under speech, up in
every pause, higher through the hook), with the narration normalized to -14
LUFS before anything is mixed against it. These pin the waveform reading, the
envelope's shape and levels, the crafted bed, and that a pack without the new
knobs compiles exactly as before.
"""

import json
import math
import subprocess

import pytest

from lusora_worker import mixing, validators
from lusora_worker.compiler import sound

from test_texture import compile_with


def _tone(path, seconds, gate=None, freq=440, volume=0.5):
    """A mono tone; `gate` is an ffmpeg expression in t that is 1 where it sounds."""
    expr = f"{volume}*sin(2*PI*{freq}*t)" + (f"*({gate})" if gate else "")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"aevalsrc='{expr}':s=48000:d={seconds}",
                    "-c:a", "libmp3lame", "-b:a", "128k", str(path)], check=True)
    return path


# ---------------- reading the voice ----------------


def test_speech_windows_follow_the_waveform(tmp_path):
    voice = _tone(tmp_path / "v.mp3", 6, gate="lt(t,2)+between(t,3.5,5)")
    windows = mixing.speech_windows(voice)
    assert len(windows) == 2
    (a0, a1), (b0, b1) = windows
    assert a0 < 0.1 and 2.2 < a1 < 2.5, "held 0.35 s past the last sound"
    assert 3.4 < b0 < 3.6 and 5.2 < b1 < 5.5


def test_a_breath_shorter_than_the_hold_stays_speech(tmp_path):
    voice = _tone(tmp_path / "v.mp3", 4, gate="lt(t,1.5)+gt(t,1.7)")
    assert len(mixing.speech_windows(voice)) == 1


# ---------------- the envelope ----------------


def db(x):
    return 20 * math.log10(x)


def gain_at(env, t):
    for a, b in zip(env, env[1:]):
        if a["t_s"] <= t <= b["t_s"]:
            span = b["t_s"] - a["t_s"]
            return a["gain"] + (b["gain"] - a["gain"]) * ((t - a["t_s"]) / span if span else 0)
    return env[-1]["gain"]


def test_the_bed_breathes_in_every_pause():
    env = sound.breathing_envelope([(0.0, 4.0), (4.6, 10.0)], 0.0, 10.0, pause_gain=0.2, duck_db=6)
    under = gain_at(env, 3.0)
    assert abs(db(under / 0.2) + 6) < 0.6, "6 dB down under speech"
    assert gain_at(env, 4.55) > under * 1.3, "a 0.6 s pause already lifts it (the sentence envelope needed 1.2 s)"
    assert gain_at(env, 4.8) < gain_at(env, 4.55), "and it falls fast when the narrator starts"


def test_the_hook_carries_the_bed_higher_then_settles():
    speech = [(0.0, 30.0)]
    env = sound.breathing_envelope(speech, 0.0, 30.0, pause_gain=0.1, duck_db=6,
                                   hook_end_s=10.0, hook_lift_db=6, hook_settle_s=5)
    assert abs(db(gain_at(env, 5.0) / gain_at(env, 20.0)) - 6) < 0.6
    assert gain_at(env, 20.0) < gain_at(env, 12.5) < gain_at(env, 5.0)


def test_the_envelope_is_thin_and_within_the_schema():
    speech = [(k * 3.0, k * 3.0 + 2.4) for k in range(400)]  # a 20-minute talk with a pause every 3 s
    env = sound.breathing_envelope(speech, 0.0, 1200.0, pause_gain=0.2, duck_db=6)
    assert 400 < len(env) <= 5000
    assert all(b["t_s"] > a["t_s"] for a, b in zip(env, env[1:]))


# ---------------- in the compiler ----------------

MOOD_BEDS = {m: f"{m}-01" for m in ("neutral", "somber", "tense")}
PACK = {"name": "synth-doc", "beds": {f"{m}-01": {"file": f"beds/{m}-01.mp3", "duration_s": 48, "loopable": True}
                                      for m in ("neutral", "somber", "tense")}}


def compile_music(style_music, speech=None, mix=None):
    extra = {"music": style_music, **({"mix": mix} if mix else {})}
    plan, cfg = compile_with(extra, None, speech_windows=speech, sound_pack=PACK,
                             theme={"sound": {"pack": "synth-doc", "mood_beds": MOOD_BEDS}})
    return plan, cfg


def test_one_bed_under_the_whole_video_breathing_with_the_voice(tmp_path):
    speech = [[0.0, 6.0], [9.0, 17.9]]  # a 3 s pause: long enough to rise all the way
    plan, cfg = compile_music({"one_bed": True, "duck": "waveform", "min_span_s": 1}, speech,
                              mix={"voice_lufs": -14, "master": "two_pass"})
    music = plan["tracks"]["audio"]["music"]
    assert len(music) == 1 and music[0]["loop"] is False
    assert (music[0]["fade_in_s"], music[0]["fade_out_s"]) == (2.5, 5.0)
    # -14 - 28 + 6 = -36 LUFS in a pause, against a bed crafted to -20
    peak = max(p["gain"] for p in music[0]["gain_envelope"])
    assert abs(db(peak) - (-16)) < 0.6
    assert plan["tracks"]["audio"]["master"] == {"loudness": "two_pass", "voice_lufs": -14.0}
    assert validators.validate_plan(plan, tmp_path, cfg, 18.0, require_assets=False) == []


def test_waveform_ducking_without_the_windows_is_an_error():
    with pytest.raises(sound.SoundError):
        compile_music({"duck": "waveform"}, None)


def test_a_pack_without_the_knobs_compiles_byte_identically():
    before, _ = compile_music({"min_span_s": 1})
    after, _ = compile_music({"min_span_s": 1}, [[0.0, 18.0]])
    assert json.dumps(before, sort_keys=True) == json.dumps(after, sort_keys=True)
    assert "master" not in before["tracks"]["audio"]


# ---------------- files ----------------


def test_a_crafted_bed_is_the_span_long_at_the_bed_level(tmp_path):
    track = _tone(tmp_path / "t.mp3", 12, freq=220, volume=0.1)
    out = mixing.craft_bed(track, 30.0, tmp_path / "bed.mp3", crossfade_s=2.0)
    assert abs(mixing.duration(out) - 30.0) < 0.1
    assert abs(mixing.lufs(out) - mixing.BED_LUFS) < 1.0


def test_the_voice_is_normalized_before_the_mix(tmp_path):
    voice = _tone(tmp_path / "v.mp3", 8, volume=0.05, gate="lt(mod(t,2),1.5)")
    mixing.normalize_voice(voice, tmp_path / "n.mp3", -14.0)
    assert abs(mixing.lufs(tmp_path / "n.mp3") + 14.0) < 1.0


def test_resolve_audio_crafts_the_bed_and_points_at_the_normalized_voice(tmp_path):
    from lusora_worker.pipeline import steps
    from test_gather_footage import ctx_for

    ctx = ctx_for(tmp_path)
    ctx.cfg["style_pack_doc"] = {"music": {"duck": "waveform", "loop_crossfade_s": 2}}
    ctx.cfg["sound_pack_doc"] = {"name": "synth-doc", "license": "own",
                                 "beds": {"somber-01": {"file": "beds/somber-01.mp3"}}}
    _tone(tmp_path / "audio.mp3", 6, volume=0.05, gate="lt(mod(t,2),1.5)")
    plan = {"tracks": {"visual": [], "overlays": [], "audio": {
        "voiceover": {"path": "audio.mp3", "duration_s": 6},
        "master": {"loudness": "two_pass", "voice_lufs": -14},
        "music": [{"id": "m_0_somber", "path": "audio/somber-01.mp3", "start_s": 0, "end_s": 70}]}}}
    ctx.write_json("edit_plan.json", plan)
    assert not steps.audio_resolved(ctx)
    steps.run_resolve_audio(ctx)
    plan = ctx.read_json("edit_plan.json")
    bed = plan["tracks"]["audio"]["music"][0]
    assert bed["path"] == "audio/bed-m_0_somber-70000.mp3" and bed["asset"]["id"] == "somber-01"
    assert abs(mixing.duration(tmp_path / bed["path"]) - 70) < 0.1, "longer than the 48 s pack bed: looped"
    assert plan["tracks"]["audio"]["voiceover"]["path"] == steps.VOICE_NORMALIZED
    assert steps.audio_resolved(ctx)
