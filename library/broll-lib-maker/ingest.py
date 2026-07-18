#!/usr/bin/env python
"""Clip ONE specific YouTube video into the b-roll library.

    .venv/bin/python ingest.py <youtube-url-or-id> [--channel CHANNEL] [--force]

No discovery, no coarse ranking: download -> fine-tag -> cut -> dedup -> store.
"""
import argparse
import time

from broll import engine_for


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("url", help="YouTube URL or bare 11-char video id")
    ap.add_argument("--channel", default=None,
                    help="channel NAME to scope segments to (get-or-create; "
                         "default: global)")
    ap.add_argument("--niches", default=None,
                    help="comma-separated niche NAMES (get-or-create)")
    ap.add_argument("--profile", default="default",
                    help="gallery profile to ingest into (see profiles.toml)")
    ap.add_argument("--force", action="store_true",
                    help="re-ingest even if the video is already in the library")
    args = ap.parse_args()

    eng = engine_for(args.profile)
    t0 = time.time()
    segs = eng.ingest_url(
        args.url,
        channel_id=eng.index.resolve_channel(args.channel),
        niches=eng.index.resolve_niches(
            args.niches.split(",") if args.niches else None),
        force=args.force)
    print(f"\n{len(segs)} segments in {time.time() - t0:.0f}s")
    for s in segs:
        dup = f"  [duplicate of {s.duplicate_of[:8]}]" if s.duplicate_of else ""
        print(f"  {s.start:7.1f}-{s.end:7.1f}s  {s.tags}{dup}")
        print(f"      {s.caption}")
        if s.clip_uri:
            print(f"      {s.clip_uri}")


if __name__ == "__main__":
    main()
