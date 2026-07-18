#!/usr/bin/env python
"""
One-time migration: string channel/niche values -> lookup-table IDs.

    .venv/bin/python migrate_lookups.py            # BROLL_DATABASE_URL respected

1. Ensures channels/niches tables exist (VectorIndex connect does that).
2. Every segments.channel_id value that is NOT already a channels.id is
   treated as a display name: get-or-create (normalizing may merge variants
   like "Cooking Shorts" / "cooking-shorts") and rewritten to the id.
3. Same for every element of segments.niches.
4. Adds the channel_id foreign-key constraint if missing.

Idempotent: values that already reference lookup rows are left alone.
"""
import sys

from broll import VectorIndex


def main() -> None:
    ix = VectorIndex()               # connect = tables + column migrations
    conn = ix._conn

    # --- channels ---
    known = {i for (i,) in conn.execute("SELECT id FROM channels").fetchall()}
    strays = [c for (c,) in conn.execute(
        "SELECT DISTINCT channel_id FROM segments "
        "WHERE channel_id IS NOT NULL").fetchall() if c not in known]
    ch_map = {s: ix.resolve_channel(s) for s in strays}
    for old, new in ch_map.items():
        n = conn.execute("UPDATE segments SET channel_id = %s "
                         "WHERE channel_id = %s", (new, old)).rowcount
        print(f"channel {old!r} -> {new} ({n} segments)")

    # --- niches (array elements) ---
    known = {i for (i,) in conn.execute("SELECT id FROM niches").fetchall()}
    rows = conn.execute("SELECT id, niches FROM segments "
                        "WHERE niches != '{}'").fetchall()
    ni_map: dict[str, str] = {}
    rewritten = 0
    for seg_id, niches in rows:
        new = []
        for v in niches:
            if v in known:
                new.append(v)
            else:
                ni_map.setdefault(v, ix.resolve_niches([v])[0])
                new.append(ni_map[v])
        deduped = list(dict.fromkeys(new))       # normalizing may merge
        if deduped != list(niches):
            conn.execute("UPDATE segments SET niches = %s WHERE id = %s",
                         (deduped, seg_id))
            rewritten += 1
    for old, new in ni_map.items():
        print(f"niche {old!r} -> {new}")
    print(f"rewrote niches on {rewritten} segments")

    # --- FK constraint (fresh installs get it via CREATE TABLE) ---
    have_fk = conn.execute(
        "SELECT 1 FROM pg_constraint WHERE conname = 'segments_channel_fk'"
    ).fetchone()
    if not have_fk:
        conn.execute(
            "ALTER TABLE segments ADD CONSTRAINT segments_channel_fk "
            "FOREIGN KEY (channel_id) REFERENCES channels(id)")
        print("added segments_channel_fk")
    else:
        print("segments_channel_fk already present")

    ch, ni = (conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
              for t in ("channels", "niches"))
    print(f"done: {ch} channels, {ni} niches")


if __name__ == "__main__":
    sys.exit(main())
