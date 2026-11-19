"""Explicit synthetic-only Laya evaluation; never reads the user's mailbox."""

import argparse
import json
from pathlib import Path
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inkwell.mail_analysis import Config, predict_batch, validated  # noqa: E402

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--run-local-model",
    action="store_true",
    required=True,
    help="Explicitly allow model loading/downloads",
)
parser.add_argument("--model", choices=["english", "multilingual"], default="english")
args = parser.parse_args()
cfg = Config(model=args.model)
examples = json.loads(
    (Path(__file__).resolve().parents[1] / "tests/fixtures/mail-analysis.json").read_text()
)
started = time.monotonic()
report = []
for start in range(0, len(examples), 4):
    selected = examples[start : start + 4]
    messages = [
        dict(item, id=start + i + 1, sender="synthetic@example.test")
        for i, item in enumerate(selected)
    ]
    scores = validated(predict_batch(messages, cfg, threading.Event()), messages, cfg)
    for message in messages:
        values = scores[str(message["id"])]
        suggested = [c.name for c in cfg.categories if values[c.name] >= c.threshold]
        report.append(
            {
                "subject": message["subject"],
                "expected": message["expected"],
                "suggested": suggested,
                "scores": values,
            }
        )
tp = sum(len(set(r["expected"]) & set(r["suggested"])) for r in report)
fp = sum(len(set(r["suggested"]) - set(r["expected"])) for r in report)
fn = sum(len(set(r["expected"]) - set(r["suggested"])) for r in report)
print(
    json.dumps(
        {
            "model": args.model,
            "synthetic_only": True,
            "seconds": round(time.monotonic() - started, 2),
            "true_positives": tp,
            "false_positives": fp,
            "false_negatives": fn,
            "warning": "Tiny synthetic corpus, not mailbox accuracy or threshold calibration. Automatic application remains unavailable.",
            "results": report,
        },
        indent=2,
    )
)
