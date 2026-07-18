#!/usr/bin/env python
"""Regenerate the local library gallery: /tmp/broll_clips/index.html

    .venv/bin/python gallery.py
"""
import html

import psycopg

from broll.storage import DEFAULT_DSN

conn = psycopg.connect(DEFAULT_DSN)
rows = conn.execute("""
    select video_id, start_s, end_s, tags, caption, clip_uri, duplicate_of,
           media_type
    from segments order by video_id, start_s
""").fetchall()

cards = []
for vid, start, end, tags, cap, uri, dup, media_type in rows:
    if uri and media_type == "image":
        media = (f'<img src="{html.escape(uri.removeprefix("file://"))}" '
                 f'style="width:100%;border-radius:4px">')
    elif uri:
        media = (f'<video src="{html.escape(uri.removeprefix("file://"))}" controls '
                 f'preload="metadata" style="width:100%;border-radius:4px"></video>')
    else:
        media = (f'<div style="background:#eee;padding:20px;text-align:center;'
                 f'border-radius:4px;font:12px sans-serif;color:#c60">no clip stored'
                 f'<br>duplicate of {dup[:8] if dup else "?"}</div>')
    badge = '<span style="color:#c60">duplicate</span> ' if dup else ""
    cards.append(f"""
    <div style="border:1px solid #ccc;border-radius:8px;padding:10px;width:260px">
      {media}
      <div style="font:13px sans-serif;margin-top:6px">
        {badge}<b>{html.escape(vid)}</b> {start:.1f}–{end:.1f}s<br>
        {html.escape(cap)}<br>
        <span style="color:#666">{html.escape(', '.join(tags))}</span>
      </div>
    </div>""")

page = f"""<!doctype html><meta charset="utf-8"><title>b-roll library</title>
<h2 style="font-family:sans-serif">b-roll library — {len(rows)} segments</h2>
<div style="display:flex;flex-wrap:wrap;gap:12px">{''.join(cards)}</div>"""
open("/tmp/broll_clips/index.html", "w").write(page)
print(f"wrote /tmp/broll_clips/index.html with {len(rows)} segments")
