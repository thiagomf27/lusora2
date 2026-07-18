# End-to-end test of upload path + search + per-channel usage + namespace +
# profile switching, with GLM mocked (returns 2 segments) but REAL ffmpeg
# cut + real storage. Run against broll_test ONLY:
#
#   BROLL_DATABASE_URL=postgresql://broll:broll@localhost:5432/broll_test \
#   BROLL_EMBED_DIM=8 .venv/bin/python test_flows.py
import os
import subprocess

DSN = os.environ.get("BROLL_DATABASE_URL", "")
assert "broll_test" in DSN, \
    "refusing to run: point BROLL_DATABASE_URL at broll_test (see README)"
assert os.environ.get("BROLL_EMBED_DIM") == "8", "run with BROLL_EMBED_DIM=8"

# profiles config for this run lives in a throwaway file, never the real one
PROFILES_TOML = "/tmp/broll_test_profiles.toml"
os.environ["BROLL_PROFILES_FILE"] = PROFILES_TOML
if os.path.exists(PROFILES_TOML):
    os.remove(PROFILES_TOML)

# the upload path cuts with real ffmpeg — synthesize the source video once
TESTVID = "/tmp/testvid.mp4"
if not os.path.exists(TESTVID):
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i",
         "testsrc=duration=12:size=320x240:rate=10", TESTVID],
        check=True, capture_output=True)

import broll.pipeline as P

# deterministic fake embedder keyed on words
VOCAB = ["lion","sleeping","walking","cub","savanna","chef","cooking","knife"]
def fake_embed(text, model=None):
    t = text.lower()
    return [1.0 if w in t else 0.0 for w in VOCAB] or [0.0]*len(VOCAB)
P.embed_text = fake_embed

# fake fine pass: pretend GLM found 2 segments in the video (>= BROLL_MIN_CLIP_S
# each, or the ingest floor would drop them)
from broll import Segment
def fake_fine(client, path, video_id, source="youtube"):
    return [
        Segment(video_id=video_id, source=source, tags=["lion","sleeping"],
                caption="lion sleeping", start=0.0, end=5.0, duration=5.0, confidence=0.9),
        Segment(video_id=video_id, source=source, tags=["lion","walking"],
                caption="lion walking", start=5.0, end=10.0, duration=5.0, confidence=0.8),
    ]
P.fine_tag_video = fake_fine

# the synthetic test video's frames all look alike — disable perceptual-hash
# reinforcement so dedup is decided by the fake embeddings alone
P._phash_of = lambda img: None

from broll import VectorIndex, ObjectStore, GLMClient, BrollEngine
from broll.ranking import overuse_flag

eng = BrollEngine(VectorIndex(), ObjectStore("/tmp/clips_test"),
                  GLMClient("http://x","glm-4.6v-flash"), min_cache_hits=3)
eng.index._conn.execute("truncate segments")   # deterministic run

# channels/niches are lookup rows now: resolve names -> ids (get-or-create)
cats = eng.index.resolve_channel("Cats Channel")
dogs = eng.index.resolve_channel("Dogs Channel")
assert cats == eng.index.resolve_channel(" cats-channel "), "normalization merge"

# --- UPLOAD PATH: user sends a video, scoped to the cats channel ---
segs = eng.ingest_video(TESTVID, channel_id=cats,
                        niches=eng.index.resolve_niches(["wildlife"]))
print("upload -> segments created:", len(segs))
print("  stored clip_uris:", [bool(s.clip_uri) for s in segs])
print("  channel scoped:", set(s.channel_id for s in segs) == {cats})

# --- SEARCH from cache (hot path), scoped to the channel ---
hits = eng.library_search("lion sleeping", channel_id=cats)
print("search 'lion sleeping' -> top tag:", hits[0][0].tags if hits else None)

# --- NAMESPACE: a DIFFERENT channel searching, global-only, shouldn't see uploads ---
other = eng.library_search("lion sleeping", channel_id=dogs, include_global=True)
print("other channel sees the upload? ", any(h[0].channel_id==cats for h in other),
      "(expected False - uploads are channel-scoped)")

# --- PER-CHANNEL USAGE: mark used in the cats channel, overuse is per-channel ---
sid = hits[0][0].id
for _ in range(5):
    eng.mark_used(sid, project_id="vidA", channel_id=cats)
seg = eng.index.get(sid)
print("usage_by_channel:", seg.usage_by_channel, "| total:", seg.usage_count)
print("overuse badge:", overuse_flag(seg))

# ranking penalty applies for the cats channel but NOT for a fresh channel
from broll.ranking import rank_segments
q = fake_embed("lion sleeping")
new_ch = eng.index.resolve_channel("Fresh Channel")
r_cats = rank_segments(eng.index.search(q, channel_id=cats), channel_id=cats)
r_new  = rank_segments(eng.index.search(q, channel_id=new_ch), channel_id=new_ch)
def score_of(ranked):
    return next((round(sc,3) for s,sc in ranked if "sleeping" in s.tags), None)
print("same clip score  -- overused channel:", score_of(r_cats),
      " fresh channel:", score_of(r_new), "(fresh should be higher)")

# =========================================================================== #
#  IMAGES: tag -> store -> search -> media_type filter, dedup-by-similarity
# =========================================================================== #
from PIL import Image as PILImage

TESTIMG = "/tmp/testimg.png"
PILImage.new("RGB", (640, 360), (200, 30, 30)).save(TESTIMG)

def fake_tag_image(client, path):
    return ["chef", "cooking", "kitchen"], "chef cooking in a kitchen", 0.9
P.tag_image = fake_tag_image

img_segs = eng.ingest_image(TESTIMG, channel_id=cats,
                            niches=eng.index.resolve_niches(["cooking"]))
assert len(img_segs) == 1
im = img_segs[0]
assert im.media_type == "image" and im.duration == 0.0
assert im.clip_uri and "/images/" in im.clip_uri and im.thumb_uri
assert im.width == 640 and im.height == 360
assert os.path.exists(TESTIMG), "user-owned image must not be deleted"
print("image ingest -> single segment, image + thumbnail stored ✓")

# media_type filter, on search and on the browse path
hits_img = eng.library_search("chef cooking", channel_id=cats,
                              filters={"media_type": "image"})
assert hits_img and hits_img[0][0].id == im.id
assert all(h[0].media_type == "image" for h in hits_img)
hits_vid = eng.library_search("chef cooking", channel_id=cats,
                              filters={"media_type": "video_clip"})
assert all(h[0].media_type == "video_clip" for h in hits_vid)
assert im.id not in [h[0].id for h in hits_vid]
browse = eng.index.list_segments(media_type="image")
assert [s.id for s in browse] == [im.id]
print("media_type filter on search + browse ✓")

# existing rows were migrated to video_clip by the additive column default
assert all(s.media_type == "video_clip"
           for s in eng.index.list_segments(media_type="video_clip"))

# dedup: re-uploading the same image links as a duplicate, stores no bytes
dup = eng.ingest_image(TESTIMG, channel_id=cats)[0]
assert dup.duplicate_of == im.id and dup.clip_uri is None
# usage marked on the dupe credits the canonical image
eng.mark_used(dup.id, project_id="vidB", channel_id=cats)
assert eng.index.get(im.id).usage_count == 1
print("image dedup links duplicate to canonical ✓")

# =========================================================================== #
#  PROFILES: two profiles, two DBs (isolated via separate schemas on the
#  broll_test cluster — the broll role can't CREATE DATABASE), search
#  isolation, dim-mismatch fail-loud, default-profile env passthrough
# =========================================================================== #
import broll.profiles as PR

# default profile must reproduce the env-var behavior exactly
d = PR.default_profile()
assert d.database_url == DSN and d.embed_dim == 8, "default profile != env"

sep = "&" if "?" in DSN else "?"
ALPHA_DSN = f"{DSN}{sep}options=-csearch_path%3Dbroll_alpha,public"
BETA_DSN = f"{DSN}{sep}options=-csearch_path%3Dbroll_beta,public"

import psycopg
adm = psycopg.connect(DSN, autocommit=True)
for sc in ("broll_alpha", "broll_beta"):
    adm.execute(f"DROP SCHEMA IF EXISTS {sc} CASCADE")
    adm.execute(f"CREATE SCHEMA {sc}")

PR.save_profile(PR.Profile(name="alpha", database_url=ALPHA_DSN,
                           storage_root="/tmp/clips_alpha",
                           embed_model="fake-model-a", embed_dim=8))
PR.save_profile(PR.Profile(name="beta", database_url=BETA_DSN,
                           storage_root="/tmp/clips_beta",
                           embed_model="fake-model-b", embed_dim=8))
profs = PR.load_profiles()
assert set(profs) == {"default", "alpha", "beta"}, profs.keys()
assert profs["alpha"].storage_root == "/tmp/clips_alpha", "toml round-trip"

eng_a = PR.engine_for("alpha")
eng_b = PR.engine_for("beta")
assert eng_a is PR.engine_for("alpha"), "engine cache"
assert eng_a.embed_model == "fake-model-a", "per-profile embed model"

segs_a = eng_a.ingest_video(TESTVID)
assert len(segs_a) == 2 and all(s.clip_uri for s in segs_a)
assert all(s.clip_uri.startswith("file:///tmp/clips_alpha/") for s in segs_a), \
    "profile storage root not used"
hits_a = eng_a.library_search("lion sleeping")
hits_b = eng_b.library_search("lion sleeping")
assert hits_a and "sleeping" in hits_a[0][0].tags, "profile A can't see its own ingest"
assert not hits_b, "profile B sees profile A's segments — isolation broken"
print("profiles: ingest into alpha -> alpha finds it, beta sees nothing ✓")

# a profile whose embed_dim doesn't match its database must fail loudly
try:
    VectorIndex(ALPHA_DSN, embed_dim=16)
    raise SystemExit("FAIL: embed_dim mismatch was not detected")
except RuntimeError as e:
    assert "dimension mismatch" in str(e)
    print("profiles: embed_dim mismatch fails loudly ✓")

# unknown profile fails loudly too
try:
    PR.engine_for("nope")
    raise SystemExit("FAIL: unknown profile did not raise")
except KeyError:
    print("profiles: unknown profile fails loudly ✓")

# jobs record their profile
from broll.jobs import JobQueue, run_job
jq = JobQueue()
job = jq.enqueue("https://youtu.be/dQw4w9WgXcQ", profile="alpha")
assert job["profile"] == "alpha" and job["kind"] == "video"
assert jq.list(profile="alpha", status="queued")
jq._conn.execute("delete from jobs where id = %s", (job["id"],))
print("profiles: jobs carry their profile ✓")

# --- image JOB: spooled file -> kind='image' -> worker ingests + consumes it
import shutil
SPOOLED = "/tmp/testimg_spool.png"
shutil.copy(TESTIMG, SPOOLED)
job = jq.enqueue(f"file://{SPOOLED}", channel_id=cats, profile="default")
assert job["kind"] == "image" and job["video_id"] == "testimg_spool.png"
job = jq.claim_next()
run_job(eng, jq, job, engine_for=lambda name: eng)
done = jq.get(job["id"])
assert done["status"] == "done" and done["segments_created"] == 1, done["error"]
assert not os.path.exists(SPOOLED), "spooled upload should be consumed"
jq._conn.execute("delete from jobs where id = %s", (job["id"],))
print("image jobs: enqueue file:// -> tag -> store -> spool consumed ✓")

# --- local video JOB: spooled file -> kind='video_file' -> exhaustive tag
#     under a content-hash id, spool consumed; same footage again = skipped
from broll.pipeline import file_sha256
SPOOLED_VID = "/tmp/testvid_spool.mp4"
shutil.copy(TESTVID, SPOOLED_VID)
job = jq.enqueue(f"file://{SPOOLED_VID}", channel_id=cats, profile="default")
assert job["kind"] == "video_file" and job["video_id"] == "testvid_spool.mp4"
job = jq.claim_next()
run_job(eng, jq, job, engine_for=lambda name: eng)
done = jq.get(job["id"])
assert done["status"] == "done" and done["segments_created"] == 2, done["error"]
assert not os.path.exists(SPOOLED_VID), "spooled video should be consumed"
content_id = f"upload:{file_sha256(TESTVID)}"
assert eng.index.has_video(content_id), "upload should be content-addressed"
shutil.copy(TESTVID, SPOOLED_VID)
job2 = jq.enqueue(f"file://{SPOOLED_VID}", profile="default")
job2 = jq.claim_next()
run_job(eng, jq, job2, engine_for=lambda name: eng)
done2 = jq.get(job2["id"])
assert done2["status"] == "done" and done2["segments_created"] == 0, \
    "re-uploading identical footage must be skipped, not re-tagged"
assert not os.path.exists(SPOOLED_VID)
jq._conn.execute("delete from jobs where id in (%s, %s)",
                 (job["id"], job2["id"]))
print("video-file jobs: spool -> exhaustive tag -> hash-id; re-upload skipped ✓")

print("ALL FLOW TESTS PASSED")
