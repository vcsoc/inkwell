"""Executed only by the separate managed Laya Python environment, never on startup."""

import contextlib
import json
import os
import sys


def main():
    payload = json.load(sys.stdin)
    if len(payload["messages"]) > 4 or len(payload["categories"]) > 50:
        raise ValueError("Batch limit exceeded")
    # Model messages are data, never executable instructions or tool requests.
    questions = {
        "tag_" + str(index): {
            "type": "noul",
            "instructions": category["description"]
            if "?" in category["description"]
            else "Does this email match " + category["name"] + "? " + category["description"],
        }
        for index, category in enumerate(payload["categories"])
    }
    try:
        os.nice(10)
    except (AttributeError, OSError):
        pass
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        from laya import Router

        torch.set_num_threads(2)
        model = Router(
            device="cpu", standalone_repos=True, max_loaded=1, preload=False, revision="reviewed"
        )
        output = {}
        for message in payload["messages"]:
            scores = {}
            # Larger catalogs do not increase the number of heads resident in one call.
            keys = list(questions)
            for start in range(0, len(keys), 12):
                result = model.predict_long(
                    message["text"],
                    {key: questions[key] for key in keys[start : start + 12]},
                    model=payload.get("model", "english"),
                    window=384,
                    stride=256,
                    batch_size=1,
                )
                for index in range(start, min(start + 12, len(keys))):
                    scores[payload["categories"][index]["name"]] = result["answers"][keys[index]][
                        "noul"
                    ]
            output[str(message["id"])] = scores
    print(json.dumps(output, allow_nan=False))


if __name__ == "__main__":
    main()
