"""Test-wide settings. The suite never reaches the network on its own."""

import os

# D110: geo.lookup falls back to OpenStreetMap's geocoder in production; the
# tests keep to the offline gazetteer, so an unknown place still fails loud.
os.environ.setdefault("LUSORA_GEOCODER", "offline")
