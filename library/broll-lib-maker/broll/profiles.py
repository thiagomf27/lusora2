"""
profiles.py — named, self-contained galleries.

A profile bundles everything that makes one gallery searchable: its own
database URL, its own storage root, and its own embedding config. Vectors
from different embedding models are incompatible, so embed_model/embed_dim
are per-profile — a gallery is only searchable with the model that built it
(VectorIndex fails loudly on a dim mismatch).

Profiles live in ~/.config/broll/profiles.toml (override the path with
$BROLL_PROFILES_FILE). The "default" profile is NEVER read from or written
to that file: it is always synthesized from the existing env vars
(BROLL_DATABASE_URL, BROLL_STORAGE_ROOT, BROLL_EMBED_MODEL,
BROLL_EMBED_DIM), so pre-profile setups — and tests that override those
vars — keep working unchanged.

File format:

    [profiles.nature]
    database_url = "postgresql://broll:broll@localhost:5432/nature"
    storage_root = "/data/broll_nature"
    embed_model  = "all-MiniLM-L6-v2"
    embed_dim    = 384
"""

from __future__ import annotations

import json
import os
import re
import threading
import tomllib
from dataclasses import dataclass, asdict

DEFAULT_EMBED_MODEL = "all-MiniLM-L6-v2"

# bare TOML keys only — keeps the hand-rolled writer below trivially correct
_NAME_RE = re.compile(r"[A-Za-z0-9_-]+")


@dataclass
class Profile:
    name: str
    database_url: str
    storage_root: str
    embed_model: str = DEFAULT_EMBED_MODEL
    embed_dim: int = 384

    def to_dict(self) -> dict:
        return asdict(self)


def profiles_path() -> str:
    return (os.environ.get("BROLL_PROFILES_FILE", "").strip()
            or os.path.expanduser("~/.config/broll/profiles.toml"))


def default_profile() -> Profile:
    """Current env-var behavior, packaged as a profile — nothing breaks."""
    return Profile(
        name="default",
        database_url=(os.environ.get("BROLL_DATABASE_URL")
                      or os.environ.get("DATABASE_URL")
                      or "postgresql://broll:broll@localhost:5432/broll"),
        storage_root=os.environ.get("BROLL_STORAGE_ROOT", "/tmp/broll_clips"),
        embed_model=os.environ.get("BROLL_EMBED_MODEL", DEFAULT_EMBED_MODEL),
        embed_dim=int(os.environ.get("BROLL_EMBED_DIM", "384")),
    )


def load_profiles() -> dict[str, Profile]:
    """All profiles, keyed by name. Always includes "default" (env-derived;
    a [profiles.default] section in the file is ignored on purpose)."""
    out = {"default": default_profile()}
    path = profiles_path()
    if os.path.exists(path):
        with open(path, "rb") as f:
            data = tomllib.load(f)
        for name, p in (data.get("profiles") or {}).items():
            if name == "default":
                continue
            out[name] = Profile(
                name=name,
                database_url=str(p["database_url"]),
                storage_root=str(p["storage_root"]),
                embed_model=str(p.get("embed_model", DEFAULT_EMBED_MODEL)),
                embed_dim=int(p.get("embed_dim", 384)),
            )
    return out


def get_profile(name: str) -> Profile:
    profiles = load_profiles()
    if name not in profiles:
        raise KeyError(
            f"unknown profile {name!r} — defined: {sorted(profiles)} "
            f"(file: {profiles_path()})")
    return profiles[name]


def _dump_toml(profiles: dict[str, Profile]) -> str:
    lines = ["# broll gallery profiles — managed by the Settings page.",
             "# The \"default\" profile is env-derived (.env) and never stored here."]
    for name in sorted(profiles):
        if name == "default":
            continue
        p = profiles[name]
        lines += [
            "",
            f"[profiles.{name}]",
            f"database_url = {json.dumps(p.database_url)}",
            f"storage_root = {json.dumps(p.storage_root)}",
            f"embed_model = {json.dumps(p.embed_model)}",
            f"embed_dim = {int(p.embed_dim)}",
        ]
    return "\n".join(lines) + "\n"


def save_profile(profile: Profile) -> None:
    """Create or update one named profile in the TOML file."""
    if not _NAME_RE.fullmatch(profile.name):
        raise ValueError("profile names may only contain letters, digits, "
                         f"'-' and '_' (got {profile.name!r})")
    if profile.name == "default":
        raise ValueError("the default profile mirrors .env and cannot be "
                         "edited here — change the env vars instead")
    profiles = load_profiles()
    profiles[profile.name] = profile
    path = profiles_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(_dump_toml(profiles))
    _invalidate_engine(profile.name)   # rebuilt with the new config next use


def delete_profile(name: str) -> None:
    if name == "default":
        raise ValueError("the default profile cannot be deleted")
    profiles = load_profiles()
    profiles.pop(name, None)
    with open(profiles_path(), "w") as f:
        f.write(_dump_toml(profiles))
    _invalidate_engine(name)


# --------------------------------------------------------------------------- #
#  Engine registry — one BrollEngine per profile, built lazily and cached
# --------------------------------------------------------------------------- #
_engines: dict[str, "object"] = {}
_engines_lock = threading.Lock()


def build_engine(profile: Profile):
    """A fresh BrollEngine wired to this profile's DB/storage/embedder."""
    from .pipeline import BrollEngine
    from .storage import VectorIndex, ObjectStore
    from .tagging import GLMClient
    return BrollEngine(
        VectorIndex(profile.database_url, embed_dim=profile.embed_dim),
        ObjectStore(profile.storage_root),
        GLMClient(),
        embed_model=profile.embed_model,
    )


def engine_for(name: str):
    """Cached engine for a profile name. Raises KeyError on unknown names
    and RuntimeError when the profile's embed_dim doesn't match its DB."""
    with _engines_lock:
        if name not in _engines:
            _engines[name] = build_engine(get_profile(name))
        return _engines[name]


def _invalidate_engine(name: str) -> None:
    with _engines_lock:
        _engines.pop(name, None)
