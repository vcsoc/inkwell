"""Version and source revision of the running backend, not of a cached browser page."""

import json
import re
import subprocess
import tomllib
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api")
PROJECT = "https://github.com/vcsoc/inkwell"


def details():
    packaged = Path(__file__).with_name("build-info.json")
    if packaged.exists():
        info = json.loads(packaged.read_text(encoding="utf-8"))
        return {
            "name": "inkwell",
            "version": info["version"],
            "commit": info["commit"],
            "developer": "Chris Visser",
            "repository": PROJECT,
        }
    root = Path(__file__).resolve().parent.parent
    try:
        with (root / "pyproject.toml").open("rb") as stream:
            version = tomllib.load(stream)["project"]["version"]
    except (OSError, KeyError, tomllib.TOMLDecodeError):
        version = "unknown"
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--verify", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
        commit = result.stdout.strip()
        if not re.fullmatch(r"[a-fA-F0-9]{40}", commit):
            commit = "unknown"
    except (OSError, subprocess.SubprocessError):
        commit = "unknown"
    return {
        "name": "inkwell",
        "version": version,
        "commit": commit,
        "developer": "Chris Visser",
        "repository": PROJECT,
    }


@router.get("/about")
def about():
    return details()
