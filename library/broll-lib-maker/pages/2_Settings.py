"""Settings — create/edit/select gallery profiles.

A profile is a named, self-contained gallery: its own database, its own
storage root, its own embedding model. The "default" profile mirrors .env
and is managed there, not here.
"""

from __future__ import annotations

import streamlit as st

from broll import profiles
from ui_common import profile_selector

st.set_page_config(page_title="b-roll settings", page_icon="⚙️", layout="wide")

active = profile_selector()
st.title("Settings — profiles")

all_profiles = profiles.load_profiles()

st.dataframe(
    [{"active": "✓" if p.name == active else "",
      "name": p.name, "database_url": p.database_url,
      "storage_root": p.storage_root, "embed_model": p.embed_model,
      "embed_dim": p.embed_dim}
     for p in all_profiles.values()],
    hide_index=True, width="stretch")
st.caption(f"Stored in `{profiles.profiles_path()}` — except **default**, "
           "which always mirrors the env vars in `.env` "
           "(BROLL_DATABASE_URL, BROLL_STORAGE_ROOT, BROLL_EMBED_MODEL, "
           "BROLL_EMBED_DIM) and can't be edited here.")

st.divider()

NEW = "➕ New profile…"
editable = [n for n in all_profiles if n != "default"]
pick = st.selectbox("Create or edit", [NEW, *editable])
base = all_profiles.get(pick) if pick != NEW else None

with st.form("profile_form"):
    name = st.text_input("Name (letters, digits, - and _)",
                         value=base.name if base else "",
                         disabled=base is not None)
    database_url = st.text_input(
        "Database URL", value=base.database_url if base else "",
        placeholder="postgresql://broll:broll@localhost:5432/mygallery",
        help="Postgres + pgvector. Schema is created on first connect, so "
             "pointing at an empty database just works.")
    storage_root = st.text_input(
        "Storage root", value=base.storage_root if base else "",
        placeholder="/data/broll_mygallery",
        help="Directory for clip/thumbnail bytes (the ObjectStore).")
    c1, c2 = st.columns(2)
    embed_model = c1.text_input(
        "Embedding model",
        value=base.embed_model if base else profiles.DEFAULT_EMBED_MODEL,
        help="Vectors from different models are incompatible: a gallery is "
             "only searchable with the model that built it.")
    embed_dim = c2.number_input(
        "Embedding dim", min_value=1, max_value=4096,
        value=base.embed_dim if base else 384,
        help="Must match the model's output dimension — mismatches against "
             "an existing database fail loudly.")
    if st.form_submit_button("Save profile", type="primary"):
        try:
            if not (name and database_url and storage_root and embed_model):
                raise ValueError("all fields are required")
            profiles.save_profile(profiles.Profile(
                name=name.strip(), database_url=database_url.strip(),
                storage_root=storage_root.strip(),
                embed_model=embed_model.strip(), embed_dim=int(embed_dim)))
            st.success(f"saved profile **{name.strip()}**")
            st.rerun()
        except (ValueError, OSError) as e:
            st.error(str(e))

if base is not None:
    st.divider()
    sure = st.checkbox(f"Yes, remove the profile “{base.name}”",
                       key=f"del_{base.name}")
    if st.button("Delete profile", disabled=not sure):
        profiles.delete_profile(base.name)
        st.success(f"deleted profile **{base.name}** — its database and "
                   "files were NOT touched, only the config entry")
        st.rerun()
