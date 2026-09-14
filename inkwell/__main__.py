"""Run with uv run python -m inkwell."""

import argparse
import os

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="inkwell local mail workspace")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    print(
        f"\n  inkwell · http://127.0.0.1:{args.port}\n  Keep this window open while using inkwell.\n"
    )
    if os.environ.get("INKWELL_ACCESS_KEY"):
        print("  Access key authentication enabled.\n")
    uvicorn.run(
        "inkwell.app:app",
        host="127.0.0.1",
        port=args.port,
        access_log=False,
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
    )


if __name__ == "__main__":
    main()
