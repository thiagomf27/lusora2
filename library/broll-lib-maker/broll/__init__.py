"""broll — B-roll segment library package."""

# load .env before submodules read os.environ at import time
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from .schema import Segment, Candidate
from .storage import VectorIndex, ObjectStore
from .tagging import GLMClient, coarse_score, fine_tag_video, tag_image
from .pipeline import BrollEngine
from .profiles import Profile, load_profiles, get_profile, engine_for

__all__ = [
    "Segment", "Candidate",
    "VectorIndex", "ObjectStore",
    "GLMClient", "coarse_score", "fine_tag_video", "tag_image",
    "BrollEngine",
    "Profile", "load_profiles", "get_profile", "engine_for",
]
