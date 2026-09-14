import json

import pytest

from inkwell import store


def test_readable_defaults_and_legacy_theme_upgrade_preserve_customization(client):
    theme = client.get("/api/preferences").json()["theme"]
    assert theme["font_size"] == theme["sidebar_font_size"] == 16
    store.set_setting(
        "preferences",
        json.dumps({"theme": {"font_size": 14, "background": "#123456", "density": "compact"}}),
    )
    theme = client.get("/api/preferences").json()["theme"]
    assert theme["font_size"] == 16
    assert theme["background"] == "#123456"
    assert theme["density"] == "compact"
    store.set_setting("preferences", json.dumps({"theme": {"font_size": 18}}))
    assert client.get("/api/preferences").json()["theme"]["font_size"] == 18
    # Explicitly chosen 14px in the new editor must remain possible.
    theme["font_size"] = 14
    assert client.put("/api/preferences", json={"theme": theme}).status_code == 200
    assert client.get("/api/preferences").json()["theme"]["font_size"] == 14


@pytest.mark.parametrize(
    "patch",
    [
        {"sidebar_font_size": 25},
        {"sidebar_spacing": 0},
        {"spacing": 49},
        {"sidebar_font": "url(https://invalid.example/font)"},
    ],
)
def test_theme_typography_spacing_validation(client, patch):
    assert client.put("/api/preferences", json={"theme": patch}).status_code == 422
