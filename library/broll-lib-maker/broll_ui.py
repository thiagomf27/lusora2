#!/usr/bin/env python
"""
broll_ui.py — Streamlit frontend for the b-roll library (internal tool).

    .venv/bin/streamlit run broll_ui.py

Main page: Upload & Queue. Gallery lives in pages/1_Gallery.py.
Imports the backend directly: this process hosts the same serial ingest
worker api.py would (SKIP LOCKED claiming means running both at once is
safe — a job is still processed exactly once).
"""

from __future__ import annotations

import datetime as dt
import os
import re
import uuid

import streamlit as st

from broll.pipeline import IMAGE_EXTS, VIDEO_EXTS
from ui_common import backend, profile_selector

SPOOL_DIR = os.environ.get("BROLL_UPLOAD_SPOOL", "/tmp/broll_uploads")

st.set_page_config(page_title="b-roll upload", page_icon="🎬", layout="wide")

profile = profile_selector()
engine, queue = backend(profile)
st.title("Upload")
if profile != "default":
    st.caption(f"Ingesting into profile **{profile}**")

# ---- links (add-more UI) ----
if "n_links" not in st.session_state:
    st.session_state.n_links = 1
urls = []
for i in range(st.session_state.n_links):
    u = st.text_input(f"Video link {i + 1}", key=f"url_{i}",
                      placeholder="https://www.youtube.com/watch?v=...")
    if u and u.strip():
        urls.append(u.strip())
if st.button("➕ Add another link"):
    st.session_state.n_links += 1
    st.rerun()

# ---- local files (image URLs can also go in the link fields above) ----
uploads = st.file_uploader(
    "Local files — images or videos",
    type=[e.lstrip(".") for e in sorted(IMAGE_EXTS | VIDEO_EXTS)],
    accept_multiple_files=True,
    help="Images become one searchable entry each; videos get the same "
         "exhaustive shot tagging as links, cut at their ORIGINAL "
         "resolution (the resolution picker only applies to YouTube "
         "downloads). Direct image URLs pasted above work too.")

# ---- channel / niches / resolution ----
c1, c2, c3 = st.columns(3)

channels = engine.index.list_channels()
ch_names = [c["name"] for c in channels]
NEW, GLOBAL = "➕ Create new…", "(global — shared pool)"
with c1:
    ch_pick = st.selectbox("Channel", [GLOBAL, *ch_names, NEW],
                           help="Which of OUR channels these clips belong to. "
                                "Global = shared by all channels.")
    new_ch = st.text_input("New channel name") if ch_pick == NEW else None

niches = engine.index.list_niches()
ni_names = [n["name"] for n in niches]
with c2:
    ni_pick = st.multiselect("Niches", ni_names,
                             help="Type to filter existing niches.")
    ni_new = st.text_input("New niches (comma-separated)",
                           placeholder="cooking, kitchen b-roll")

with c3:
    res = st.selectbox("Download resolution", [360, 480, 720, 1080], index=1)
    st.caption("⚠️ Permanent: sources are deleted after tagging — clips stay "
               "at this resolution forever.")

# ---- submit ----
if st.button("Queue ingest", type="primary",
             disabled=not (urls or uploads)):
    channel_name = new_ch if ch_pick == NEW else (
        None if ch_pick == GLOBAL else ch_pick)
    niche_names = ni_pick + [s.strip() for s in ni_new.split(",") if s.strip()]
    ch_id = engine.index.resolve_channel(channel_name)
    ni_ids = engine.index.resolve_niches(niche_names)
    jobs = [queue.enqueue(u, channel_id=ch_id, niches=ni_ids, max_res=res,
                          profile=profile)
            for u in urls]
    # spool uploaded files to disk; the worker ingests and consumes them
    os.makedirs(SPOOL_DIR, exist_ok=True)
    for up in uploads or []:
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(up.name))
        dst = os.path.join(SPOOL_DIR, f"{uuid.uuid4().hex}_{safe}")
        with open(dst, "wb") as f:
            f.write(up.getbuffer())
        jobs.append(queue.enqueue(f"file://{dst}", channel_id=ch_id,
                                  niches=ni_ids, profile=profile))
    bad = [j for j in jobs if j["status"] == "failed"]
    st.success(f"queued {len(jobs) - len(bad)} job(s)"
               + (f" — {len(bad)} invalid link(s) rejected" if bad else ""))

st.divider()
st.subheader("Queue")


@st.fragment(run_every="2.5s")
def queue_view():
    jobs = queue.list(limit=25, profile=profile)
    if not jobs:
        st.caption("No jobs yet in this profile.")
        return
    ICON = {"queued": "⏸", "downloading": "⬇️", "tagging": "🤖",
            "cutting": "✂️", "storing": "💾", "done": "✅", "failed": "❌"}
    for j in jobs:
        c1, c2, c3 = st.columns([5, 2, 3])
        label = j["video_id"] or j["url"]
        kind = {"image": "🖼 ", "video_file": "📁 "}.get(j.get("kind"), "")
        c1.markdown(f"{ICON.get(j['status'], '•')} {kind}`{label}` — "
                    f"**{j['status']}**"
                    + (f" (attempt {j['attempts']})" if j["attempts"] > 1
                       else ""))
        if j["status"] in ("downloading", "tagging", "cutting", "storing"):
            c2.progress(min(max(float(j["progress"]), 0.0), 1.0),
                        text=j.get("stage") or "")
        elif j["status"] == "done":
            c2.caption(f"{j['segments_created']} segments")
        started = dt.datetime.fromtimestamp(j["created_at"]).strftime("%H:%M")
        c3.caption(f"queued {started}"
                   + (f" · ⚠ {j['error'][:80]}" if j["error"] else ""))


queue_view()
