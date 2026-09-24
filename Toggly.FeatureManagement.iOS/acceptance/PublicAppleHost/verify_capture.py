"""Assert compact, credential-free public Apple packets from collector JSONL."""
import argparse
import json
from pathlib import Path


def verify(path: Path, mode: str) -> None:
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    posts = [row for row in rows if row["method"] == "POST"]
    if mode == "silent":
        assert not posts, posts
        return
    assert posts, "no telemetry POST observed"
    for packet in posts:
        assert packet["path"] == "/base/api/frontend/telemetry", packet
        assert all(value is None for value in packet["headers"].values()), packet
        assert set(packet["body"]).issubset({"k", "e", "f", "m", "i", "u"}), packet
        assert packet["body"]["k"] == "local-apple-fixture", packet
        assert packet["body"]["e"] == "Fixture", packet
    if mode == "baseline":
        ordinary = next(packet for packet in posts if "m" in packet["body"])
        assert ordinary["encoding"] == "gzip", ordinary
        assert ordinary["body"]["f"]["OrderGate"]["enabled"] == [1]
        assert ordinary["body"]["f"]["OrderGate"]["disabled"] == [1]
        assert ordinary["body"]["m"] == {"cart": 3.5, "orders": 2.0}
    elif mode == "variant":
        assert any("Treatment" in packet["body"].get("f", {}).get("Checkout", {}) for packet in posts)
    elif mode in {"retry429", "retry503"}:
        assert len(posts) >= 2, posts
        assert posts[0]["status"] == int(mode[-3:]), posts
        assert posts[1]["status"] == 202, posts
        assert posts[0]["body"] == posts[1]["body"], posts
    elif mode == "ambiguous":
        assert posts[0]["status"] == "dropped", posts
        # A subsequent SwiftUI render can create a new check batch. The
        # ambiguous original body itself must occur only once.
        assert sum(packet["body"] == posts[0]["body"] for packet in posts) == 1, posts
    else:
        raise ValueError(mode)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["silent", "baseline", "variant", "retry429", "retry503", "ambiguous"])
    parser.add_argument("capture", type=Path)
    args = parser.parse_args()
    verify(args.capture, args.mode)
    print(f"verified {args.mode}: {args.capture}")
