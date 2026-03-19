#!/usr/bin/env python3
"""
Checks CoinMarketCap for new coins not yet in cmc.json.
Fetches their data and saves to new_coins.json in this directory.
Optionally downloads logos to logo_new/ in this directory.

Usage:
  python check_new_coins.py --key API_KEY [--pause SECONDS]
  python check_new_coins.py -K API_KEY [-P SECONDS]
"""

import json
import os
import sys
import time
import argparse
import requests
from datetime import datetime, timezone

# ── Paths ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
CMC_JSON    = os.path.join(PROJECT_DIR, "frontend", "coinbase", "cmc.json")
OUT_FILE    = os.path.join(SCRIPT_DIR, "new_coins.json")
LOGO_DIR    = os.path.join(SCRIPT_DIR, "logo_new")

# ── API ───────────────────────────────────────────────────────────────────────

MAP_URL  = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/map"
INFO_URL = "https://pro-api.coinmarketcap.com/v2/cryptocurrency/info"

MAP_LIMIT  = 5000
INFO_BATCH = 500


def strip_proto(val):
    for prefix in ("https://", "http://"):
        if val and val.startswith(prefix):
            return val[len(prefix):]
    return val or ""


def first(lst):
    for item in (lst or []):
        if item:
            return item
    return ""


def fetch_all_ids(headers, pause):
    """Fetch all coin IDs from /map. Returns list of {id, name, symbol}."""
    coins = []
    start = 1
    page  = 1
    while True:
        print(f"  /map page {page} (start={start}) ...", flush=True)
        r = requests.get(MAP_URL, headers=headers, params={
            "start": start,
            "limit": MAP_LIMIT,
            "sort":  "id",
        }, timeout=30)
        r.raise_for_status()
        data = r.json()
        if data.get("status", {}).get("error_code", 0) != 0:
            print("API error:", data["status"]["error_message"])
            sys.exit(1)

        batch = data.get("data", [])
        if not batch:
            break

        for c in batch:
            coins.append({"id": c["id"], "name": c["name"], "symbol": c["symbol"]})

        print(f"    {len(batch)} coins (total: {len(coins)})", flush=True)

        if len(batch) < MAP_LIMIT:
            break
        start += MAP_LIMIT
        page  += 1
        time.sleep(pause)

    return coins


def fetch_info(id_list, headers, pause):
    """Fetch /info for given IDs. Returns dict {id: info}."""
    result = {}
    for offset in range(0, len(id_list), INFO_BATCH):
        batch = id_list[offset : offset + INFO_BATCH]
        print(f"  /info batch: {len(batch)} IDs ({batch[0]}..{batch[-1]}) ...", flush=True)
        r = requests.get(INFO_URL, headers=headers, params={
            "id":  ",".join(str(i) for i in batch),
            "aux": "logo,urls",
        }, timeout=60)
        r.raise_for_status()
        data = r.json()
        if data.get("status", {}).get("error_code", 0) != 0:
            print("API error:", data["status"]["error_message"])
            sys.exit(1)
        for cid_str, info in data.get("data", {}).items():
            result[int(cid_str)] = info
        print(f"    got {len(data.get('data', {}))} entries", flush=True)
        time.sleep(pause)
    return result


def download_logos(id_info_map):
    """Download logos for given coins. id_info_map: {id: info}."""
    os.makedirs(LOGO_DIR, exist_ok=True)
    ok = 0
    fail = 0
    total = len(id_info_map)
    for cid, info in sorted(id_info_map.items()):
        logo_url = info.get("logo", "")
        if not logo_url:
            print(f"  id={cid}: no logo URL")
            fail += 1
            continue
        ext  = os.path.splitext(logo_url.split("?")[0])[1] or ".png"
        path = os.path.join(LOGO_DIR, f"{cid}{ext}")
        try:
            r = requests.get(logo_url, timeout=15)
            r.raise_for_status()
            with open(path, "wb") as f:
                f.write(r.content)
            ok += 1
            print(f"  [{ok}/{total}] {cid}{ext}")
        except Exception as e:
            print(f"  id={cid}: failed — {e}")
            fail += 1
    return ok, fail


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="check_new_coins.py",
        description="Fetch new coins from CoinMarketCap not yet in cmc.json.",
        add_help=False,
    )
    parser.add_argument("--key", "--K", "-K",
                        metavar="API_KEY", required=True,
                        help="CoinMarketCap Pro API key (required)")
    parser.add_argument("--pause", "--P", "-P",
                        metavar="SECONDS", type=float, default=1.0,
                        help="Pause between API requests in seconds (default: 1)")
    parser.add_argument("--help", "-H",
                        action="help",
                        help="Show this help message and exit")
    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)

    args = parser.parse_args()

    headers = {"X-CMC_PRO_API_KEY": args.key, "Accept": "application/json"}

    # ── Load our catalog ──────────────────────────────────────────────────────

    if not os.path.exists(CMC_JSON):
        print(f"Error: catalog not found at {CMC_JSON}")
        sys.exit(1)

    with open(CMC_JSON, encoding="utf-8") as f:
        local = json.load(f)
    local_ids = {c["id"] for c in local["coins"]}
    print(f"Our catalog:  {len(local_ids)} coins")

    # ── Fetch all IDs from CMC ────────────────────────────────────────────────

    print("\n=== Fetching coin list from CMC ===")
    cmc_coins  = fetch_all_ids(headers, args.pause)
    cmc_by_id  = {c["id"]: c for c in cmc_coins}
    cmc_ids    = set(cmc_by_id)
    print(f"\nCMC total:    {len(cmc_ids)} coins")

    new_ids = sorted(cmc_ids - local_ids)
    print(f"New coins:    {len(new_ids)}")

    if not new_ids:
        print("\nNo new coins. Catalog is up to date.")
        sys.exit(0)

    # ── Fetch full info for new coins ─────────────────────────────────────────

    print(f"\n=== Fetching data for {len(new_ids)} new coins ===")
    info_map = fetch_info(new_ids, headers, args.pause)

    # ── Build output ──────────────────────────────────────────────────────────

    new_coins = []
    for cid in new_ids:
        base = cmc_by_id[cid]
        info = info_map.get(cid, {})
        urls = info.get("urls", {})
        new_coins.append({
            "id":          cid,
            "name":        base["name"],
            "symbol":      base["symbol"],
            "website":     strip_proto(first(urls.get("website", []))),
            "explorer":    strip_proto(first(urls.get("explorer", []))),
            "source_code": strip_proto(first(urls.get("source_code", []))),
        })

    output = {
        "source":       "pro-api.coinmarketcap.com",
        "importedAt":   datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "totalFetched": len(new_coins),
        "coins":        new_coins,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nSaved {len(new_coins)} new coins → {OUT_FILE}")

    # ── Ask about logos ───────────────────────────────────────────────────────

    print()
    try:
        answer = input("Download logos for new coins? [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = ""

    if answer in ("y", "yes", "д", "да"):
        print(f"\n=== Downloading logos to {LOGO_DIR}/ ===")
        ok, fail = download_logos(info_map)
        print(f"\nDone. Downloaded: {ok}, failed: {fail}")
    else:
        print("Skipped.")


if __name__ == "__main__":
    main()
