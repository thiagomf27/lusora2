"""Shared backend singletons for the Streamlit pages."""

from __future__ import annotations

import os
import threading

import streamlit as st


@st.cache_resource
def _queue():
    """One job queue + ONE serial ingest worker per server process. The
    worker serves every profile (jobs record theirs); one download at a
    time stays a GLOBAL rule."""
    from broll import profiles
    from broll.jobs import JobQueue, run_worker
    queue = JobQueue()
    threading.Thread(target=run_worker,
                     args=(profiles.engine_for("default"), queue),
                     kwargs={"engine_for": profiles.engine_for},
                     daemon=True, name="ingest-worker").start()
    return queue


def backend(profile: str = "default"):
    """(engine, queue) for one profile; engines are cached per profile in
    broll.profiles, so switching back and forth is free."""
    from broll import profiles
    return profiles.engine_for(profile), _queue()


def profile_selector() -> str:
    """Sidebar profile picker, shared across pages via session_state."""
    from broll import profiles
    names = list(profiles.load_profiles())   # "default" is always first
    if st.session_state.get("profile") not in names:
        st.session_state["profile"] = "default"
    return st.sidebar.selectbox(
        "Profile", names, key="profile",
        help="Named gallery: its own database, storage and embedder. "
             "Manage them on the Settings page.")


def local_path(uri: str | None) -> str | None:
    if uri and uri.startswith("file://"):
        p = uri.removeprefix("file://")
        return p if os.path.exists(p) else None
    return None
