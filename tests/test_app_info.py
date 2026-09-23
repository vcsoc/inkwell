"""About returns the revision of the running application."""

import re

from inkwell.app_info import details


def test_about_exposes_version_commit_and_project(client):
    info = client.get("/api/about").json()
    assert info == details()
    assert info["name"] == "inkwell"
    assert re.fullmatch(r"\d+\.\d+\.\d+", info["version"])
    assert re.fullmatch(r"[a-fA-F0-9]{40}", info["commit"])
    assert info["developer"] == "Chris Visser"
    assert info["repository"] == "https://github.com/vcsoc/inkwell"
