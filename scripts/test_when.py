#!/usr/bin/env python3
"""
Quick local test for the /when command logic.
Simulates the non-owner response: random time metric + insult.

Usage:
    python scripts/test_when.py
    python scripts/test_when.py --count 10   # print 10 examples
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

LAUNCH_DT = datetime(2026, 6, 9, 20, 0, 0, tzinfo=timezone.utc)


def load(name: str) -> dict:
    with (DATA / name).open(encoding="utf-8") as f:
        return json.load(f)


def format_count(value: float) -> str:
    if value == int(value):
        return str(int(value))
    return f"{value:.1f}"


def random_insult(insults: dict) -> str:
    w1 = random.choice(insults["column1"])
    w2 = random.choice(insults["column2"])
    w3 = random.choice(insults["column3"])
    return f"{w1} {w2} {w3}"


def random_metric(minutes: float, metrics: list) -> str:
    m = random.choice(metrics)
    count = minutes / m["duration_minutes"]
    return m["template"].format(count=format_count(count))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=1, help="Number of examples to generate")
    parser.add_argument("--user",  type=str, default="TestUser", help="Username to use in the insult")
    args = parser.parse_args()

    now     = datetime.now(timezone.utc)
    delta   = (LAUNCH_DT - now).total_seconds()
    minutes = delta / 60

    if delta <= 0:
        print("🎉 The server is already live!")
        sys.exit(0)

    insults = load("insult_creator.json")
    metrics = load("time_metrics.json")["metrics"]

    for i in range(args.count):
        if args.count > 1:
            print(f"--- Example {i + 1} ---")
        metric_str = random_metric(minutes, metrics)
        insult     = random_insult(insults)
        print(f"The server launches in approximately {metric_str}.")
        print(f"You're a {insult}, {args.user}.")
        print()


if __name__ == "__main__":
    main()
