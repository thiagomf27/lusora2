#!/usr/bin/env python
"""
check_proxy.py — verify the yt-dlp proxy BEFORE any real download.

Run:  .venv/bin/python check_proxy.py

Prints your direct (home) exit IP and the exit IP as seen THROUGH
$YTDLP_PROXY, using the exact same proxy string yt-dlp will get.
Exits non-zero — loudly — if the proxy is unset, unreachable, or its
exit IP equals your home IP.
"""

import os
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import requests  # noqa: E402

ECHO = "https://api.ipify.org"


def die(msg: str) -> None:
    print(f"\nFAIL: {msg}", file=sys.stderr)
    sys.exit(1)


proxy = os.environ.get("YTDLP_PROXY", "").strip()
if not proxy:
    die("YTDLP_PROXY is not set in .env — refusing to proceed. "
        "Set YTDLP_PROXY=<scheme>://[user:pass@]host:port "
        "(or YTDLP_PROXY=direct to explicitly allow no proxy).")
if proxy.lower() == "direct":
    die("YTDLP_PROXY=direct — downloads would use your REAL home IP. "
        "Set a real proxy before the cold-path run.")

print(f"proxy configured: {proxy}")

try:
    home_ip = requests.get(ECHO, timeout=15).text.strip()
    print(f"direct (home) exit IP : {home_ip}")
except Exception as e:
    home_ip = None
    print(f"direct (home) exit IP : <unavailable: {e}>")

try:
    via = requests.get(ECHO, timeout=30,
                       proxies={"http": proxy, "https": proxy})
    via.raise_for_status()
    proxy_ip = via.text.strip()
    print(f"exit IP through proxy : {proxy_ip}")
except Exception as e:
    die(f"could not reach {ECHO} through the proxy: {e}")

if home_ip and proxy_ip == home_ip:
    die("the proxy's exit IP EQUALS your home IP — traffic is not actually "
        "being routed. Do not run the cold path.")

print("\nOK: proxy is live and its exit IP differs from your home IP. "
      "yt-dlp will receive this exact proxy string.")
