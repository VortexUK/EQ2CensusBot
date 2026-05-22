#!/usr/bin/env python3
"""
Download spell icon PNGs from eq2wire into data/spells/icons/.

Icons are numbered 0–1177.  Files that already exist are skipped.

Usage:
    python scripts/download_spell_icons.py
    python scripts/download_spell_icons.py --start 500   # resume from a specific ID
"""
import argparse
import asyncio
import sys
from pathlib import Path

import aiohttp

ICONS_DIR  = Path(__file__).resolve().parent.parent / "data" / "spells" / "icons"
ICON_BASE  = "https://u.eq2wire.com/images/spell/{id}.png"
ICON_RANGE = range(0, 1178)   # 0 – 1177 inclusive

# Limit concurrent downloads to avoid hammering the server
_CONCURRENCY = 10


async def _download_icon(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    icon_id: int,
) -> str:
    dest = ICONS_DIR / f"{icon_id}.png"
    if dest.exists():
        return "skip"

    url = ICON_BASE.format(id=icon_id)
    async with sem:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 404:
                    return "missing"
                if resp.status != 200:
                    print(f"  [error] {icon_id}.png: HTTP {resp.status}")
                    return "error"
                data = await resp.read()
        except Exception as exc:
            print(f"  [error] {icon_id}.png: {type(exc).__name__}: {exc}")
            return "error"

    dest.write_bytes(data)
    return "ok"


async def main(start: int) -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    ids = [i for i in ICON_RANGE if i >= start]
    already = sum(1 for i in ICON_RANGE if (ICONS_DIR / f"{i}.png").exists())
    print(f"Spell icons 0–{ICON_RANGE.stop - 1}  ({already} already downloaded, {len(ids)} to check)\n")

    sem = asyncio.Semaphore(_CONCURRENCY)
    counts = {"ok": 0, "skip": 0, "missing": 0, "error": 0}

    async with aiohttp.ClientSession() as session:
        tasks = [_download_icon(session, sem, i) for i in ids]
        results = await asyncio.gather(*tasks)

    for r in results:
        counts[r] += 1

    print(
        f"\nDone.  Downloaded: {counts['ok']}  "
        f"Skipped: {counts['skip']}  "
        f"Missing: {counts['missing']}  "
        f"Errors: {counts['error']}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=0, help="Resume from this icon ID")
    args = parser.parse_args()
    asyncio.run(main(args.start))
