"""Explicit installed-backend/real-Laya smoke using an isolated synthetic mailbox."""

import argparse
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import tempfile
import time

import httpx

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--run-local-model", action="store_true", required=True)
parser.add_argument(
    "--backend",
    type=Path,
    default=Path.home() / ".local/opt/inkwell/current/resources/inkwell-server/inkwell-server",
)
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix="inkwell-analysis-proof-") as data:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    env = {**os.environ, "INKWELL_DATA_DIR": data, "HF_HUB_OFFLINE": "1"}
    env.pop("INKWELL_ACCESS_KEY", None)
    with tempfile.TemporaryFile() as log:
        child = subprocess.Popen(
            [str(args.backend.resolve()), "--port", str(port)],
            env=env,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
        try:
            with httpx.Client(
                base_url=origin, headers={"Origin": origin, "X-Inkwell": "1"}, timeout=20
            ) as client:
                for _ in range(100):
                    try:
                        if client.get("/").status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    if child.poll() is not None:
                        raise RuntimeError("Installed backend exited before readiness")
                    time.sleep(0.2)

                def api(method, path, body=None):
                    response = client.request(method, "/api" + path, json=body)
                    response.raise_for_status()
                    return response.json()

                current = api("GET", "/mail-analysis")
                assert not current["config"]["enabled"] and not current["counts"]
                cfg = current["config"]
                cfg["enabled"] = True
                for category in cfg["categories"]:
                    category["enabled"] = category["name"] == "Invoice"
                    category["threshold"] = 0.5
                api("PUT", "/mail-analysis", cfg)
                draft = api(
                    "POST",
                    "/drafts",
                    {
                        "subject": "Synthetic invoice 482 due Friday",
                        "body": "Please pay invoice 482 for $1250 by Friday. The outstanding balance is $1250. This is a synthetic test invoice.",
                        "from_address": "synthetic@example.test",
                    },
                )
                api("PATCH", "/messages/" + str(draft["id"]), {"folder": "inbox"})
                api("POST", "/mail-analysis/backfill", {"action": "start"})
                deadline = time.monotonic() + 240
                while time.monotonic() < deadline:
                    reviews = api("GET", "/mail-analysis/results")
                    state = api("GET", "/mail-analysis")
                    if state["last_error"]:
                        raise RuntimeError(state["last_error"])
                    if reviews:
                        break
                    if state["counts"].get("no_match"):
                        raise RuntimeError("Synthetic invoice did not meet the smoke threshold")
                    time.sleep(1)
                else:
                    raise RuntimeError("Timed out waiting for the installed local classifier")
                assert reviews[0]["message_id"] == draft["id"]
                applied = api(
                    "POST", "/mail-analysis/" + str(draft["id"]) + "/approve", {"tags": ["Invoice"]}
                )
                assert applied["provider_queued"] == 0
                saved = api("GET", "/messages/" + str(draft["id"]))
                assert saved["tags"] == ["Invoice"] or saved["tags"] == '["Invoice"]'
                done = api("GET", "/mail-analysis/results?state=applied")[0]
                assert done["outcome"] == "Local message (not provider-backed)"
                cfg["enabled"] = False
                api("PUT", "/mail-analysis", cfg)
                assert not api("GET", "/mail-analysis")["worker_active"]
                print(
                    json.dumps(
                        {
                            "installed_backend": str(args.backend),
                            "real_model": "english",
                            "synthetic_only": True,
                            "invoice_score": reviews[0]["scores"]["Invoice"],
                            "tags": ["Invoice"],
                            "provider_writes": 0,
                            "worker_idle_after_batch": True,
                        }
                    )
                )
        finally:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
