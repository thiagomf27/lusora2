"""Gallery — browse/search the clip library with server-side filters."""

from __future__ import annotations

import datetime as dt
import mimetypes

import streamlit as st

from ui_common import backend, local_path, profile_selector

st.set_page_config(page_title="b-roll gallery", page_icon="🎞", layout="wide")

profile = profile_selector()
engine, _ = backend(profile)
st.title("Gallery")
if profile != "default":
    st.caption(f"Browsing profile **{profile}**")

channels = {c["name"]: c["id"] for c in engine.index.list_channels()}
niches = {n["name"]: n["id"] for n in engine.index.list_niches()}
sources = {s["name"]: s["id"] for s in engine.index.list_source_channels()}
ANY = "(any)"

with st.container(border=True):
    q = st.text_input("Search",
                      placeholder="lion sleeping … (empty = newest first)")
    f1, f2, f3, f4 = st.columns(4)
    with f1:
        ch = st.selectbox("Channel (ours)", [ANY, *channels])
        src = st.selectbox("Origin channel (uploader)", [ANY, *sources])
    with f2:
        ni = st.multiselect("Niches", list(niches))
        tags_txt = st.text_input("Tags (comma, any-of)",
                                 placeholder="lion, savanna")
    with f3:
        media = st.selectbox("Media", ["(any)", "video clips", "images"])
        dur = st.slider("Duration (s)", 0, 120, (0, 120))
    with f4:
        dates = st.date_input("Ingested between", value=(),
                              format="YYYY-MM-DD")
    top_k = st.slider("Max results", 12, 96, 24, step=12)

filters: dict = {}
if media != "(any)":
    filters["media_type"] = {"video clips": "video_clip",
                             "images": "image"}[media]
if ch != ANY:
    filters["channel_id"] = channels[ch]
if src != ANY:
    filters["source_channel_id"] = sources[src]
if ni:
    filters["niches"] = [niches[n] for n in ni]
if tags_txt.strip():
    filters["tags"] = [t.strip().lower() for t in tags_txt.split(",")
                       if t.strip()]
if dur != (0, 120):
    filters["min_duration"], filters["max_duration"] = float(dur[0]), float(dur[1])
if isinstance(dates, tuple) and len(dates) == 2:
    filters["created_after"] = dt.datetime.combine(
        dates[0], dt.time.min).timestamp()
    filters["created_before"] = dt.datetime.combine(
        dates[1], dt.time.max).timestamp()

# server-side: filters become WHERE clauses in the pgvector query
if q.strip():
    hits = engine.library_search(q, top_k=top_k, filters=filters)
else:
    hits = [(s, None) for s in
            engine.index.list_segments(limit=top_k, **filters)]

st.caption(f"{len(hits)} clips")
id_to_ch = {v: k for k, v in channels.items()}
id_to_ni = {v: k for k, v in niches.items()}

cols = st.columns(3)
for i, (seg, score) in enumerate(hits):
    with cols[i % 3].container(border=True):
        thumb = local_path(seg.thumb_uri)
        if thumb:
            st.image(thumb, width="stretch")
        st.markdown(f"**{seg.caption or '(no caption)'}**")
        origin = seg.source_channel_name or seg.video_id
        bits = ["🖼 image" if seg.media_type == "image"
                else f"{seg.duration:.1f}s", origin,
                id_to_ch.get(seg.channel_id, "global")]
        if score is not None:
            bits.append(f"score {score:+.2f}")
        st.caption(" · ".join(bits))
        st.caption("🏷 " + ", ".join(seg.tags[:6]))
        seg_niches = [id_to_ni.get(n, n) for n in seg.niches]
        usage = f"used {seg.usage_count}×"
        if seg.usage_by_channel:
            usage += " (" + ", ".join(
                f"{id_to_ch.get(k, k)}: {v}"
                for k, v in seg.usage_by_channel.items()) + ")"
        st.caption((f"📂 {', '.join(seg_niches)} · " if seg_niches else "")
                   + usage)
        clip = local_path(seg.clip_uri)
        if clip and seg.media_type == "image":
            with st.expander("🖼 view / download"):
                st.image(clip, width="stretch")
                ext = clip.rsplit(".", 1)[-1].lower()
                with open(clip, "rb") as f:
                    st.download_button(
                        "Download image", f,
                        file_name=f"{seg.video_id.replace(':', '_')}.{ext}",
                        mime=mimetypes.guess_type(clip)[0] or
                             "application/octet-stream",
                        key=f"dl_{seg.id}")
        elif clip:
            with st.expander("▶ play / download"):
                st.video(clip)
                with open(clip, "rb") as f:
                    st.download_button(
                        "Download mp4", f,
                        file_name=f"{seg.video_id}_{seg.start:.0f}s.mp4",
                        mime="video/mp4", key=f"dl_{seg.id}")
        else:
            st.caption("⚠ clip bytes missing")
