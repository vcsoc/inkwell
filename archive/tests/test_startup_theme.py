import json


def test_startup_theme_is_authenticated_validated_data_with_no_cache(client):
    prefs = client.get("/api/preferences").json()
    prefs["theme"].update(
        background="#102030", dark=True, name='</script>";window.injected=true;//'
    )
    assert client.put("/api/preferences", json=prefs).status_code == 200
    response = client.get("/api/preferences/startup.js")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/javascript")
    assert response.headers["cache-control"] == "no-store"
    assert "script-src 'self'" in response.headers["content-security-policy"]
    data = response.text.removeprefix("window.InkwellAppearance.apply(").split(
        ");window.InkwellStartupThemeApplied=true;"
    )[0]
    assert json.loads(data) == prefs["theme"]
    assert "</script>" not in response.text
    html = client.get("/").text
    assert html.index("/api/preferences/startup.js") < html.index("<body")
    assert html.count("/static/appearance.js") == 1
    client.cookies.clear()
    assert client.get("/api/preferences/startup.js").status_code == 401
