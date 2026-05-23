#!/usr/bin/env python3
"""
Download item icon PNGs from eq2wire for a range of icon IDs.

Saves to data/items/icons/{id}.png.  Files that already exist are skipped.
404s are recorded in data/items/icons/_missing.txt so they are not retried
on subsequent runs.

Usage:
    python scripts/download_item_icons.py              # IDs 0-4999
    python scripts/download_item_icons.py --max 9999   # IDs 0-9999
    python scripts/download_item_icons.py --start 3000 --max 3999
"""

import argparse
import asyncio
import sys
from pathlib import Path

import aiohttp

BASE_URL = "https://u.eq2wire.com/images/item"
ICONS_DIR = Path(__file__).resolve().parent.parent / "data" / "items" / "icons"
MISSING_TXT = ICONS_DIR / "_missing.txt"

CONCURRENCY = 30  # simultaneous requests
RETRY_MAX = 3  # retries on connection/timeout errors
RETRY_SLEEP = 5.0  # seconds before first retry (doubles each attempt)
REPORT_EVERY = 500  # print progress every N completions


async def _download_one(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    icon_id: int,
    missing: set[int],
) -> str:
    """Download a single icon. Returns 'ok', 'skip', 'missing', or 'error'."""
    if (ICONS_DIR / f"{icon_id}.png").exists() or icon_id in missing:
        return "skip"

    url = f"{BASE_URL}/{icon_id}.png"
    dest = ICONS_DIR / f"{icon_id}.png"
    delay = RETRY_SLEEP

    async with sem:
        for attempt in range(1, RETRY_MAX + 1):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status == 404:
                        missing.add(icon_id)
                        return "missing"
                    if resp.status == 429:
                        print(f"  [429] rate limited on {icon_id}, sleeping {delay:.0f}s…")
                        await asyncio.sleep(delay)
                        delay *= 2
                        continue
                    if resp.status != 200:
                        print(f"  [error] {icon_id}: HTTP {resp.status}")
                        return "error"
                    data = await resp.read()
                    dest.write_bytes(data)
                    return "ok"
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                if attempt < RETRY_MAX:
                    print(f"  [retry {attempt}] {icon_id}: {type(exc).__name__}, sleeping {delay:.0f}s…")
                    await asyncio.sleep(delay)
                    delay *= 2
                else:
                    print(f"  [error] {icon_id}: {type(exc).__name__} after {RETRY_MAX} attempts")
                    return "error"
    return "error"


async def main(start: int, end: int) -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    missing: set[int] = set()
    if MISSING_TXT.exists():
        for line in MISSING_TXT.read_text().splitlines():
            if line.strip().isdigit():
                missing.add(int(line.strip()))

    total = end - start + 1
    ok = skipped = not_found = errors = done = 0

    sem = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY)
    headers = {"User-Agent": "Mozilla/5.0"}

    async with aiohttp.ClientSession(connector=connector, headers=headers) as session:
        tasks = [
            asyncio.ensure_future(_download_one(session, sem, icon_id, missing)) for icon_id in range(start, end + 1)
        ]

        for coro in asyncio.as_completed(tasks):
            result = await coro
            done += 1
            if result == "ok":
                ok += 1
            elif result == "skip":
                skipped += 1
            elif result == "missing":
                not_found += 1
            else:
                errors += 1

            if done % REPORT_EVERY == 0 or done == total:
                print(f"  {done}/{total}  ok={ok}  skip={skipped}  miss={not_found}  err={errors}")

    MISSING_TXT.write_text("\n".join(str(x) for x in sorted(missing)) + "\n")

    print(f"\nDone (range {start}–{end}).")
    print(f"  Downloaded : {ok}")
    print(f"  Skipped    : {skipped}")
    print(f"  Not found  : {not_found}")
    print(f"  Errors     : {errors}")
    print(f"  Missing log: {MISSING_TXT}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--max", type=int, default=4999)
    args = parser.parse_args()
    if args.start > args.max:
        print("--start must be <= --max")
        sys.exit(1)
    asyncio.run(main(args.start, args.max))
