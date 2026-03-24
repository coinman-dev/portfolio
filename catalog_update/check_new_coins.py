#!/usr/bin/env python3
"""
Checks CoinMarketCap for new or all coins and updates cmc.json.

Usage:
  python check_new_coins.py --key API_KEY [--update {new,full,raw}] [--pause SECONDS]
  python check_new_coins.py -K API_KEY [-U {new,full,raw}] [-P SECONDS]

  --update new    (default) fetch only new coins → new_coins.json
  --update full   fetch all coins from CMC → full_coins.json
  --update raw    fetch all coins with full raw CMC data → raw_coins.json

  --build merge   combine cmc.json + *_coins.json → cmc_newdata.json
  --build build   build cmc_newdata.json from full_coins.json directly
  --build logos   copy logos from frontend/images/logo/ → catalog_update/logo/
"""

import argparse
import json
import os
import shutil
import sys
import time
from datetime import datetime, timezone

import requests

# ── Paths ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
CMC_JSON = os.path.join(PROJECT_DIR, "frontend", "coinbase", "cmc.json")
OUT_FILE = os.path.join(SCRIPT_DIR, "new_coins.json")
OUT_FILE_FULL = os.path.join(SCRIPT_DIR, "full_coins.json")
OUT_FILE_RAW  = os.path.join(SCRIPT_DIR, "raw_coins.json")
LOGO_DIR_NEW      = os.path.join(SCRIPT_DIR, "logo_new")
LOGO_DIR_FULL     = os.path.join(SCRIPT_DIR, "logo_full")
LOGO_DIR_OUT      = os.path.join(SCRIPT_DIR, "logo")
LOGO_DIR_Q90      = os.path.join(SCRIPT_DIR, "logo_q90")
LOGO_DIR_LOSSLESS = os.path.join(SCRIPT_DIR, "logo_lossless")
LOGO_DIR_BEST     = os.path.join(SCRIPT_DIR, "logo_best")
LOGO_SRC_DIR      = os.path.join(PROJECT_DIR, "frontend", "images", "logo")
OUT_FILE_MERGE = os.path.join(SCRIPT_DIR, "cmc_newdata.json")

# ── API ───────────────────────────────────────────────────────────────────────

MAP_URL = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/map"
INFO_URL = "https://pro-api.coinmarketcap.com/v2/cryptocurrency/info"

MAP_LIMIT = 5000   # max allowed by CMC for /map limit parameter
INFO_BATCH = 500   # max safe batch for /info id parameter (URL length limit)


# ── Helpers ───────────────────────────────────────────────────────────────────


def clean_url(val):
    """Strip https:// / http:// and trailing slash."""
    for prefix in ("https://", "http://"):
        if val and val.startswith(prefix):
            val = val[len(prefix) :]
    return val.rstrip("/") if val else ""


def first(lst):
    for item in lst or []:
        if item:
            return item
    return ""


def build_platform(info):
    """
    Returns platform array for tokens, or None for coins.
    Each entry: { id, name, contract_address }
    """
    contracts = info.get("contract_address", [])
    if not contracts:
        return None
    result = []
    for entry in contracts:
        plat = entry.get("platform", {})
        coin = plat.get("coin", {})
        result.append(
            {
                "id": int(coin.get("id", 0)),
                "name": plat.get("name", ""),
                "contract_address": entry.get("contract_address", ""),
            }
        )
    return result or None


def build_coin_entry(cid, base, info):
    """Build a coin entry in the new cmc.json format."""
    urls = info.get("urls", {})
    category = info.get("category", "coin")
    platform = build_platform(info)

    if category == "token":
        # Token — lives on other blockchains, no explorer
        return {
            "id": cid,
            "name": base["name"],
            "symbol": base["symbol"],
            "category": "token",
            "website": clean_url(first(urls.get("website", []))),
            "source_code": clean_url(first(urls.get("source_code", []))),
            "platform": platform,
        }
    else:
        # Coin — has its own blockchain, platform = null or wrapped tokens
        return {
            "id": cid,
            "name": base["name"],
            "symbol": base["symbol"],
            "category": "coin",
            "website": clean_url(first(urls.get("website", []))),
            "explorer": [clean_url(u) for u in urls.get("explorer", []) if u],
            "source_code": clean_url(first(urls.get("source_code", []))),
            "platform": platform,
        }


def is_new_format(coin):
    """Check if a coin entry is already in the new format (has 'platform' key)."""
    return "platform" in coin


def convert_old_to_new(coin):
    """Convert an old-format cmc.json entry to the new format."""
    return {
        "id": coin["id"],
        "name": coin["name"],
        "symbol": coin["symbol"],
        "category": "coin",
        "website": clean_url(coin.get("website", "")),
        "explorer": [clean_url(coin.get("explorer", ""))],
        "source_code": clean_url(coin.get("source_code", "")),
        "platform": None,
    }


def finalize_for_merge(coin):
    """
    Prepare a coin entry for final cmc_newdata.json:
    - explorer: array → single string (first value)
    - For coins with platform array: filter out /token/ URLs from explorer
    """
    coin = dict(coin)  # shallow copy
    explorer = coin.get("explorer", [])

    if coin.get("category") == "coin":
        # If array, filter out /token URLs for coins with wrapped tokens
        if isinstance(explorer, list):
            if coin.get("platform"):
                explorer = [u for u in explorer if "/token" not in u]
            coin["explorer"] = explorer[0] if explorer else ""
        # Already a string — clean /token if has platform
        elif isinstance(explorer, str) and coin.get("platform") and "/token" in explorer:
            coin["explorer"] = ""

    return coin


def build_catalog():
    """Build cmc_newdata.json directly from full_coins.json (no merging)."""
    if not os.path.exists(OUT_FILE_FULL):
        print(f"Error: {OUT_FILE_FULL} not found. Run --update full first.")
        sys.exit(1)

    with open(OUT_FILE_FULL, encoding="utf-8") as f:
        data = json.load(f)

    print(f"Loaded full_coins.json: {data['totalFetched']} coins")

    built = [finalize_for_merge(c) for c in data["coins"]]

    output = {
        "source":       "pro-api.coinmarketcap.com",
        "importedAt":   datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "totalFetched": len(built),
        "coins":        built,
    }

    with open(OUT_FILE_MERGE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Built {len(built)} coins → {OUT_FILE_MERGE}")


def copy_logos():
    """Copy logos from frontend/images/logo/ to catalog_update/logo/ based on cmc_newdata.json.
    Then convert logo_new/ PNGs to WebP in two quality modes and pick the smallest."""
    if not os.path.exists(OUT_FILE_MERGE):
        print(f"Error: {OUT_FILE_MERGE} not found. Run --build build or --build merge first.")
        sys.exit(1)
    if not os.path.exists(LOGO_SRC_DIR):
        print(f"Error: source logo dir not found: {LOGO_SRC_DIR}")
        sys.exit(1)

    # ── Step 1: copy from frontend/images/logo/ ───────────────────────────────
    with open(OUT_FILE_MERGE, encoding="utf-8") as f:
        data = json.load(f)

    ids = [c["id"] for c in data["coins"]]
    print(f"Coins in cmc_newdata.json: {len(ids)}")

    os.makedirs(LOGO_DIR_OUT, exist_ok=True)

    copied = 0
    skipped = 0
    missing = 0
    for cid in ids:
        src = os.path.join(LOGO_SRC_DIR, f"{cid}.webp")
        dst = os.path.join(LOGO_DIR_OUT, f"{cid}.webp")
        if os.path.exists(dst):
            skipped += 1
            continue
        if not os.path.exists(src):
            missing += 1
            continue
        shutil.copy2(src, dst)
        copied += 1

    print(f"Copied: {copied}, skipped (exists): {skipped}, missing: {missing}")
    print(f"Output: {LOGO_DIR_OUT}")

    # ── Step 2: convert logo_new/ PNGs ────────────────────────────────────────
    png_files = [f for f in os.listdir(LOGO_DIR_NEW) if f.lower().endswith(".png")] \
        if os.path.exists(LOGO_DIR_NEW) else []

    if not png_files:
        print("\nNo PNG files in logo_new/ — skipping conversion.")
        return

    import subprocess
    result = subprocess.run(["which", "convert"], capture_output=True)
    if result.returncode != 0:
        print("\nError: ImageMagick 'convert' not found.")
        print("Install it with:  sudo apt install imagemagick")
        return

    print(f"\nFound {len(png_files)} PNG files in logo_new/ — converting...")

    for d in (LOGO_DIR_Q90, LOGO_DIR_LOSSLESS, LOGO_DIR_BEST):
        os.makedirs(d, exist_ok=True)

    converted = 0
    for fname in sorted(png_files):
        src      = os.path.join(LOGO_DIR_NEW, fname)
        base     = os.path.splitext(fname)[0]
        dst_q90  = os.path.join(LOGO_DIR_Q90,      f"{base}.webp")
        dst_ll   = os.path.join(LOGO_DIR_LOSSLESS, f"{base}.webp")
        dst_best = os.path.join(LOGO_DIR_BEST,      f"{base}.webp")

        os.system(f'convert "{src}" -quality 90 "{dst_q90}"')
        os.system(f'convert "{src}" -define webp:lossless=true -quality 100 "{dst_ll}"')

        # pick smaller
        size_q90 = os.path.getsize(dst_q90) if os.path.exists(dst_q90) else float("inf")
        size_ll  = os.path.getsize(dst_ll)  if os.path.exists(dst_ll)  else float("inf")
        src_best = dst_q90 if size_q90 <= size_ll else dst_ll
        shutil.copy2(src_best, dst_best)

        winner = "q90" if size_q90 <= size_ll else "lossless"
        print(f"  {fname} → {winner} ({min(size_q90, size_ll)} bytes)")
        converted += 1

    print(f"\nConverted: {converted}")
    print("  logo_q90/      — 90% quality")
    print("  logo_lossless/ — lossless")
    print("  logo_best/     — smallest of the two")


def merge_catalog():
    """Merge cmc.json with *_coins.json files → cmc_newdata.json."""
    # Look for cmc.json in frontend dir (primary) or catalog_update dir (fallback)
    local_fallback = os.path.join(SCRIPT_DIR, "cmc.json")
    if os.path.exists(CMC_JSON):
        catalog_path = CMC_JSON
        print(f"Using catalog: {CMC_JSON}")
    elif os.path.exists(local_fallback):
        catalog_path = local_fallback
        print(f"Using catalog: {local_fallback}")
    else:
        print(f"Error: cmc.json not found in:\n  {CMC_JSON}\n  {local_fallback}")
        sys.exit(1)

    with open(catalog_path, encoding="utf-8") as f:
        local = json.load(f)
    print(f"Loaded cmc.json: {len(local['coins'])} coins")

    # Detect available source files
    available = [(p, os.path.basename(p)) for p in (OUT_FILE_FULL, OUT_FILE)
                 if os.path.exists(p)]

    if not available:
        print("No *_coins.json files found. Run --update new or --update full first.")
        sys.exit(1)

    if len(available) == 1:
        sources = [available[0][0]]
        print(f"Using: {available[0][1]}")
    else:
        print("\nFound multiple source files:")
        print(f"  1) {available[0][1]}")
        print(f"  2) {available[1][1]}")
        print("  3) both (full_coins.json has priority)")
        try:
            choice = input("Use which? [1/2/3]: ").strip()
        except (EOFError, KeyboardInterrupt):
            choice = "3"
        if choice == "1":
            sources = [available[0][0]]
        elif choice == "2":
            sources = [available[1][0]]
        else:
            sources = [p for p, _ in available]

    # Load selected sources
    update_by_id = {}
    for path in sources:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        before = len(update_by_id)
        for c in data["coins"]:
            if c["id"] not in update_by_id:
                update_by_id[c["id"]] = c
        print(f"Loaded {os.path.basename(path)}: {len(data['coins'])} coins "
              f"(+{len(update_by_id) - before} unique)")

    # Merge: update existing + convert old format
    merged = []
    updated = 0
    converted = 0
    kept = 0
    for coin in local["coins"]:
        cid = coin["id"]
        if cid in update_by_id:
            merged.append(finalize_for_merge(update_by_id.pop(cid)))
            updated += 1
        elif is_new_format(coin):
            merged.append(finalize_for_merge(coin))
            kept += 1
        else:
            merged.append(finalize_for_merge(convert_old_to_new(coin)))
            converted += 1

    # Add new coins not in cmc.json
    added = 0
    for cid in sorted(update_by_id):
        merged.append(finalize_for_merge(update_by_id[cid]))
        added += 1

    output = {
        "source": "pro-api.coinmarketcap.com",
        "importedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "totalFetched": len(merged),
        "coins": merged,
    }

    with open(OUT_FILE_MERGE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nMerge complete → {OUT_FILE_MERGE}")
    print(f"  Updated from *_coins.json: {updated}")
    print(f"  Converted to new format:   {converted}")
    print(f"  Already new format:        {kept}")
    print(f"  Added new coins:           {added}")
    print(f"  Total:                     {len(merged)}")


# ── API calls ─────────────────────────────────────────────────────────────────


def fetch_all_ids(headers, pause):
    """Fetch all coin IDs from /map. Returns list of {id, name, symbol}."""
    coins = []
    start = 1
    page = 1
    while True:
        print(f"  /map page {page} (start={start}) ...", flush=True)
        r = requests.get(
            MAP_URL,
            headers=headers,
            params={
                "start": start,
                "limit": MAP_LIMIT,
                "sort": "id",
            },
            timeout=30,
        )
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
        page += 1
        time.sleep(pause)

    return coins


def fetch_info_raw(id_list, headers, pause):
    """Fetch /info with ALL aux fields. Returns dict {id: raw_info}."""
    result = {}
    for offset in range(0, len(id_list), INFO_BATCH):
        batch = id_list[offset : offset + INFO_BATCH]
        print(
            f"  /info batch: {len(batch)} IDs ({batch[0]}..{batch[-1]}) ...", flush=True
        )
        r = requests.get(
            INFO_URL,
            headers=headers,
            params={
                "id":  ",".join(str(i) for i in batch),
                "aux": "urls,logo,description,tags,platform,date_added,notice,status",
            },
            timeout=60,
        )
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


def fetch_info(id_list, headers, pause):
    """Fetch /info for given IDs. Returns dict {id: info}."""
    result = {}
    for offset in range(0, len(id_list), INFO_BATCH):
        batch = id_list[offset : offset + INFO_BATCH]
        print(
            f"  /info batch: {len(batch)} IDs ({batch[0]}..{batch[-1]}) ...", flush=True
        )
        r = requests.get(
            INFO_URL,
            headers=headers,
            params={
                "id": ",".join(str(i) for i in batch),
                "aux": "logo,urls,platform",
            },
            timeout=60,
        )
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


def download_logos(id_info_map, logo_dir, pause):
    """Download logos for given coins into logo_dir."""
    os.makedirs(logo_dir, exist_ok=True)
    ok = 0
    fail = 0
    total = len(id_info_map)
    for cid, info in sorted(id_info_map.items()):
        logo_url = info.get("logo", "") or \
            f"https://s2.coinmarketcap.com/static/img/coins/64x64/{cid}.png"
        ext = os.path.splitext(logo_url.split("?")[0])[1] or ".png"
        path = os.path.join(logo_dir, f"{cid}{ext}")
        if os.path.exists(path):
            print(f"  [{cid}] skip (exists)")
            ok += 1
            continue
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
        time.sleep(pause)
    return ok, fail


# ── Main ──────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        prog="check_new_coins.py",
        description="Fetch coins from CoinMarketCap and update cmc.json.",
        add_help=False,
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--key",
        "--K",
        "-K",
        metavar="API_KEY",
        help="CoinMarketCap Pro API key (required for new/full)",
    )
    parser.add_argument(
        "--update",
        "--U",
        "-U",
        metavar="MODE",
        choices=["new", "full", "raw"],
        default="new",
        help=(
            "new:  only new coins → new_coins.json (default)\n"
            "full: all coins → full_coins.json\n"
            "raw:  all coins, full CMC data → raw_coins.json"
        ),
    )
    parser.add_argument(
        "--build",
        "--B",
        "-B",
        metavar="MODE",
        choices=["merge", "build", "logos"],
        help=(
            "merge: combine cmc.json + *_coins.json → cmc_newdata.json\n"
            "build: build cmc_newdata.json from full_coins.json directly\n"
            "logos: copy logos from frontend/images/logo/ → catalog_update/logo/"
        ),
    )
    parser.add_argument(
        "--pause",
        "--P",
        "-P",
        metavar="SECONDS",
        type=float,
        default=1.0,
        help="Pause between API requests in seconds (default: 1)",
    )
    parser.add_argument(
        "--limit",
        "--L",
        "-L",
        metavar="N",
        type=int,
        default=0,
        help="Limit number of coins to fetch (default: 0 = no limit)",
    )
    parser.add_argument(
        "--help", "-H", action="help", help="Show this help message and exit"
    )
    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)

    args = parser.parse_args()

    # ── Build / Merge mode (no API key needed) ─────────────────────────────────

    if args.build == "build":
        build_catalog()
        return

    if args.build == "merge":
        merge_catalog()
        return

    if args.build == "logos":
        copy_logos()
        return

    # ── API modes require key ──────────────────────────────────────────────────

    if not args.key:
        print("Error: --key is required for --update new/full/raw")
        sys.exit(1)

    headers = {"X-CMC_PRO_API_KEY": args.key, "Accept": "application/json"}

    # ── Load catalog ──────────────────────────────────────────────────────────

    if not os.path.exists(CMC_JSON):
        print(f"Error: catalog not found at {CMC_JSON}")
        sys.exit(1)

    with open(CMC_JSON, encoding="utf-8") as f:
        local = json.load(f)
    local_ids = {c["id"] for c in local["coins"]}
    print(f"Our catalog:  {len(local_ids)} coins")

    # ── Check existing output ────────────────────────────────────────────────

    # ── Raw mode ──────────────────────────────────────────────────────────────

    if args.update == "raw":
        if os.path.exists(OUT_FILE_RAW):
            print("\nFound existing raw_coins.json, skipping API fetch.")
        else:
            print("\n=== Fetching coin list from CMC ===")
            cmc_coins = fetch_all_ids(headers, args.pause)
            cmc_by_id = {c["id"]: c for c in cmc_coins}
            target_ids = sorted(cmc_by_id)
            print(f"\nCMC total: {len(target_ids)} coins")
            if args.limit > 0:
                target_ids = target_ids[:args.limit]
                print(f"Limit:     {len(target_ids)} coins")
            print(f"\n=== Fetching raw data for {len(target_ids)} coins ===")
            raw_map = fetch_info_raw(target_ids, headers, args.pause)
            output = {
                "source":       "pro-api.coinmarketcap.com",
                "importedAt":   datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                "totalFetched": len(raw_map),
                "coins":        list(raw_map.values()),
            }
            with open(OUT_FILE_RAW, "w", encoding="utf-8") as f:
                json.dump(output, f, ensure_ascii=False, indent=2)
            print(f"\nSaved {len(raw_map)} coins → {OUT_FILE_RAW}")
        return

    # ─────────────────────────────────────────────────────────────────────────

    out_path = OUT_FILE_FULL if args.update == "full" else OUT_FILE
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            existing = json.load(f)
        print(f"\nFound existing {os.path.basename(out_path)} "
              f"({existing['totalFetched']} coins), skipping API fetch.")
        info_map = {c["id"]: c for c in existing["coins"]}
    else:
        # ── Fetch all IDs from CMC ────────────────────────────────────────────

        print("\n=== Fetching coin list from CMC ===")
        cmc_coins = fetch_all_ids(headers, args.pause)
        cmc_by_id = {c["id"]: c for c in cmc_coins}
        cmc_ids = set(cmc_by_id)
        print(f"\nCMC total:    {len(cmc_ids)} coins")

        if args.update == "new":
            target_ids = sorted(cmc_ids - local_ids)
            print(f"New coins:    {len(target_ids)}")
            if not target_ids:
                print("\nNo new coins. Catalog is up to date.")
                sys.exit(0)
        else:
            target_ids = sorted(cmc_ids)
            print(f"Full update:  {len(target_ids)} coins")

        if args.limit > 0:
            target_ids = target_ids[:args.limit]
            print(f"Limit:        {len(target_ids)} coins")

        # ── Fetch info ────────────────────────────────────────────────────────

        print(f"\n=== Fetching data for {len(target_ids)} coins ===")
        info_map = fetch_info(target_ids, headers, args.pause)

        # ── Build & save ──────────────────────────────────────────────────────

        built_coins = []
        for cid in target_ids:
            base = cmc_by_id[cid]
            info = info_map.get(cid, {})
            built_coins.append(build_coin_entry(cid, base, info))

        output = {
            "source": "pro-api.coinmarketcap.com",
            "importedAt": datetime.now(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%S.000Z"
            ),
            "totalFetched": len(built_coins),
            "coins": built_coins,
        }

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"\nSaved {len(built_coins)} coins → {out_path}")

    # ── Logos ─────────────────────────────────────────────────────────────────

    print()
    try:
        answer = input("Download logos? [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = ""

    if answer not in ("y", "yes", "д", "да"):
        print("Skipped.")
    elif args.update == "new":
        print(f"\n=== Downloading logos to {LOGO_DIR_NEW}/ ===")
        ok, fail = download_logos(info_map, LOGO_DIR_NEW, args.pause)
        print(f"\nDone. Downloaded: {ok}, failed: {fail}")
    else:
        try:
            mode = input("Download new only or all? [new/all]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            mode = ""

        new_info = {k: v for k, v in info_map.items() if k not in local_ids}
        if mode in ("all", "все"):
            print(f"\n=== Downloading all logos to {LOGO_DIR_FULL}/ ===")
            ok, fail = download_logos(info_map, LOGO_DIR_FULL, args.pause)
        else:
            print(f"\n=== Downloading {len(new_info)} new logos to {LOGO_DIR_NEW}/ ===")
            ok, fail = download_logos(new_info, LOGO_DIR_NEW, args.pause)
        print(f"\nDone. Downloaded: {ok}, failed: {fail}")


if __name__ == "__main__":
    main()
