#!/usr/bin/env python3
"""
Checks CoinMarketCap for new or all coins and updates cmc.json.

Usage:
  python check_new_coins.py --key API_KEY [--update {new,full,raw}] [--pause SECONDS]
  python check_new_coins.py -K API_KEY [-U {new,full,raw}] [-P SECONDS]
  python check_new_coins.py -K API_KEY -I 1 2 3

  --update new    (default) fetch only new coins → new_coins.json
  --update full   fetch all coins from CMC → full_coins.json
  --update raw    fetch all coins with full raw CMC data → raw_coins.json

  --id ID [ID …]  fetch specific coins by CMC ID

  --build merge   combine cmc.json + *_coins.json → cmc_newdata.json
  --build build   build cmc_newdata.json from full_coins.json directly
  --build logos   copy logos from frontend/images/logo/ → catalog_update/logo/
  --build check   verify logos in logo/ match cmc_newdata.json
  --build gecko   fetch CoinGecko IDs → cmc_geckoid.json
"""

import argparse
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone

import requests

# ── Configurable constants ────────────────────────────────────────────────────

MAP_LIMIT = 5000       # max allowed by CMC for /map limit parameter
INFO_BATCH = 500       # max safe batch for /info id parameter (URL length limit)
LOGO_EXTENSIONS = (".webp", ".png", ".jpg", ".jpeg")
YES_ANSWERS = ("y", "yes", "д", "да")
TIMESTAMP_FMT = "%Y-%m-%dT%H:%M:%S.000Z"
CMC_SOURCE = "pro-api.coinmarketcap.com"

# ── Paths ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
CMC_JSON = os.path.join(PROJECT_DIR, "frontend", "coinbase", "cmc.json")
LOGO_SRC_DIR = os.path.join(PROJECT_DIR, "frontend", "images", "logo")

OUT_FILE = os.path.join(SCRIPT_DIR, "new_coins.json")
OUT_FILE_FULL = os.path.join(SCRIPT_DIR, "full_coins.json")
OUT_FILE_RAW = os.path.join(SCRIPT_DIR, "raw_coins.json")
OUT_FILE_MERGE = os.path.join(SCRIPT_DIR, "cmc_newdata.json")
OUT_FILE_GECKO = os.path.join(SCRIPT_DIR, "cmc_geckoid.json")

LOGO_DIR_OUT = os.path.join(SCRIPT_DIR, "logo")
LOGO_DIR_NEW = os.path.join(SCRIPT_DIR, "logo_new")
LOGO_DIR_FULL = os.path.join(SCRIPT_DIR, "logo_full")
LOGO_DIR_Q90 = os.path.join(SCRIPT_DIR, "logo_q90")
LOGO_DIR_LOSSLESS = os.path.join(SCRIPT_DIR, "logo_lossless")
LOGO_DIR_BEST = os.path.join(SCRIPT_DIR, "logo_best")

# ── API ───────────────────────────────────────────────────────────────────────

MAP_URL = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/map"
INFO_URL = "https://pro-api.coinmarketcap.com/v2/cryptocurrency/info"
CG_LIST_URL = "https://api.coingecko.com/api/v3/coins/list"
CG_MARKETS_URL = "https://api.coingecko.com/api/v3/coins/markets"

AUX_NORMAL = "logo,urls,platform"
AUX_RAW = "urls,logo,description,tags,platform,date_added,notice,status"


# ── Helpers ───────────────────────────────────────────────────────────────────


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, coins):
    output = {
        "source": CMC_SOURCE,
        "importedAt": datetime.now(timezone.utc).strftime(TIMESTAMP_FMT),
        "totalFetched": len(coins),
        "coins": coins,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    return output


def ask_yes(prompt):
    try:
        return input(prompt).strip().lower() in YES_ANSWERS
    except (EOFError, KeyboardInterrupt):
        return False


def clean_url(val):
    """Strip https:// / http:// and trailing slash."""
    for prefix in ("https://", "http://"):
        if val and val.startswith(prefix):
            val = val[len(prefix):]
    return val.rstrip("/") if val else ""


def first(lst):
    for item in lst or []:
        if item:
            return item
    return ""


def strip_token_path(url):
    """Strip /token/... suffix: 'arbiscan.io/token/0x...' → 'arbiscan.io'."""
    idx = url.find("/token")
    return url[:idx] if idx != -1 else url


def build_platform(info):
    """Returns platform array for tokens, or None for coins."""
    contracts = info.get("contract_address", [])
    if not contracts:
        return None
    result = []
    for entry in contracts:
        plat = entry.get("platform", {})
        coin = plat.get("coin", {})
        result.append({
            "id": int(coin.get("id", 0)),
            "name": plat.get("name", ""),
            "contract_address": entry.get("contract_address", ""),
        })
    return result or None


def build_coin_entry(cid, base, info):
    """Build a coin entry in the new cmc.json format."""
    urls = info.get("urls", {})
    category = info.get("category", "coin")
    return {
        "id": cid,
        "name": base["name"],
        "symbol": base["symbol"],
        "category": category,
        "website": clean_url(first(urls.get("website", []))),
        "explorer": [clean_url(u) for u in urls.get("explorer", []) if u],
        "source_code": clean_url(first(urls.get("source_code", []))),
        "platform": build_platform(info),
    }


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
    - coin:  filter /token URLs from explorer, take first as string
    - token: if own id in platform[].id — strip /token, take first as string
             if own id NOT in platform[].id — remove explorer entirely
    """
    coin = dict(coin)
    explorer = coin.get("explorer", [])
    category = coin.get("category", "coin")
    platform = coin.get("platform")
    cid = coin.get("id")

    if category == "token":
        own_id_in_platform = (
            isinstance(platform, list)
            and any(int(p.get("id", 0)) == cid for p in platform)
        )
        if own_id_in_platform:
            if isinstance(explorer, list):
                explorer = [strip_token_path(u) for u in explorer]
                coin["explorer"] = explorer[0] if explorer else ""
            elif isinstance(explorer, str):
                coin["explorer"] = strip_token_path(explorer)
        else:
            coin.pop("explorer", None)

    elif category == "coin":
        if isinstance(explorer, list):
            if platform:
                explorer = [u for u in explorer if "/token" not in u]
            coin["explorer"] = explorer[0] if explorer else ""
        elif isinstance(explorer, str) and platform and "/token" in explorer:
            coin["explorer"] = ""

    return coin


# ── API calls ─────────────────────────────────────────────────────────────────


def fetch_all_ids(headers, pause):
    """Fetch all coin IDs from /map. Returns list of {id, name, symbol}."""
    coins = []
    start = 1
    page = 1
    while True:
        print(f"  /map page {page} (start={start}) ...", flush=True)
        r = requests.get(MAP_URL, headers=headers,
                         params={"start": start, "limit": MAP_LIMIT, "sort": "id"}, timeout=30)
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


def fetch_info(id_list, headers, pause, aux=AUX_NORMAL):
    """Fetch /info for given IDs. Returns dict {id: info}."""
    result = {}
    for offset in range(0, len(id_list), INFO_BATCH):
        batch = id_list[offset: offset + INFO_BATCH]
        print(f"  /info batch: {len(batch)} IDs ({batch[0]}..{batch[-1]}) ...", flush=True)
        r = requests.get(INFO_URL, headers=headers,
                         params={"id": ",".join(str(i) for i in batch), "aux": aux}, timeout=60)
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
    ok = fail = 0
    total = len(id_info_map)
    for cid, info in sorted(id_info_map.items()):
        logo_url = (
            info.get("logo", "")
            or f"https://s2.coinmarketcap.com/static/img/coins/64x64/{cid}.png"
        )
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


# ── Build commands ────────────────────────────────────────────────────────────


def build_catalog():
    """Build cmc_newdata.json directly from full_coins.json (no merging)."""
    if not os.path.exists(OUT_FILE_FULL):
        print(f"Error: {OUT_FILE_FULL} not found. Run --update full first.")
        sys.exit(1)
    data = load_json(OUT_FILE_FULL)
    print(f"Loaded full_coins.json: {data['totalFetched']} coins")
    built = [finalize_for_merge(c) for c in data["coins"]]
    save_json(OUT_FILE_MERGE, built)
    print(f"Built {len(built)} coins → {OUT_FILE_MERGE}")


def copy_logos():
    """Copy logos from frontend/images/logo/ to catalog_update/logo/.
    Then convert logo_new/ PNGs to WebP in two quality modes and pick the smallest."""
    if not os.path.exists(OUT_FILE_MERGE):
        print(f"Error: {OUT_FILE_MERGE} not found. Run --build build or --build merge first.")
        sys.exit(1)
    if not os.path.exists(LOGO_SRC_DIR):
        print(f"Error: source logo dir not found: {LOGO_SRC_DIR}")
        sys.exit(1)

    data = load_json(OUT_FILE_MERGE)
    ids = [c["id"] for c in data["coins"]]
    print(f"Coins in cmc_newdata.json: {len(ids)}")

    os.makedirs(LOGO_DIR_OUT, exist_ok=True)
    copied = skipped = missing = 0
    for cid in ids:
        src = os.path.join(LOGO_SRC_DIR, f"{cid}.webp")
        dst = os.path.join(LOGO_DIR_OUT, f"{cid}.webp")
        if os.path.exists(dst):
            skipped += 1
        elif not os.path.exists(src):
            missing += 1
        else:
            shutil.copy2(src, dst)
            copied += 1

    print(f"Copied: {copied}, skipped (exists): {skipped}, missing: {missing}")
    print(f"Output: {LOGO_DIR_OUT}")

    # Convert logo_new/ PNGs to WebP
    png_files = (
        [f for f in os.listdir(LOGO_DIR_NEW) if f.lower().endswith(".png")]
        if os.path.exists(LOGO_DIR_NEW) else []
    )
    if not png_files:
        print("\nNo PNG files in logo_new/ — skipping conversion.")
        return

    import subprocess
    if subprocess.run(["which", "convert"], capture_output=True).returncode != 0:
        print("\nError: ImageMagick 'convert' not found.")
        print("Install it with:  sudo apt install imagemagick")
        return

    print(f"\nFound {len(png_files)} PNG files in logo_new/ — converting...")
    for d in (LOGO_DIR_Q90, LOGO_DIR_LOSSLESS, LOGO_DIR_BEST):
        os.makedirs(d, exist_ok=True)

    converted = 0
    for fname in sorted(png_files):
        src = os.path.join(LOGO_DIR_NEW, fname)
        base = os.path.splitext(fname)[0]
        dst_q90 = os.path.join(LOGO_DIR_Q90, f"{base}.webp")
        dst_ll = os.path.join(LOGO_DIR_LOSSLESS, f"{base}.webp")
        dst_best = os.path.join(LOGO_DIR_BEST, f"{base}.webp")

        os.system(f'convert "{src}" -quality 90 "{dst_q90}"')
        os.system(f'convert "{src}" -define webp:lossless=true -quality 100 "{dst_ll}"')

        size_q90 = os.path.getsize(dst_q90) if os.path.exists(dst_q90) else float("inf")
        size_ll = os.path.getsize(dst_ll) if os.path.exists(dst_ll) else float("inf")
        shutil.copy2(dst_q90 if size_q90 <= size_ll else dst_ll, dst_best)

        winner = "q90" if size_q90 <= size_ll else "lossless"
        print(f"  {fname} → {winner} ({min(size_q90, size_ll)} bytes)")
        converted += 1

    print(f"\nConverted: {converted}")
    print("  logo_q90/      — 90% quality")
    print("  logo_lossless/ — lossless")
    print("  logo_best/     — smallest of the two")


def check_logos():
    """Verify logos in logo/ match cmc_newdata.json: remove extras, download missing."""
    if not os.path.exists(OUT_FILE_MERGE):
        print(f"Error: {OUT_FILE_MERGE} not found. Run --build build or --build merge first.")
        sys.exit(1)

    data = load_json(OUT_FILE_MERGE)
    catalog_ids = {c["id"] for c in data["coins"]}
    print(f"Coins in cmc_newdata.json: {len(catalog_ids)}")

    if not os.path.exists(LOGO_DIR_OUT):
        print(f"Logo directory not found: {LOGO_DIR_OUT}")
        logo_ids = set()
    else:
        logo_ids = set()
        for f in os.listdir(LOGO_DIR_OUT):
            name = os.path.splitext(f)[0]
            if name.isdigit():
                logo_ids.add(int(name))
        print(f"Logos in logo/: {len(logo_ids)}")

    missing_ids = sorted(catalog_ids - logo_ids)
    extra_ids = sorted(logo_ids - catalog_ids)
    print(f"\nMissing logos: {len(missing_ids)}")
    print(f"Extra logos (not in catalog): {len(extra_ids)}")

    # Delete extras
    if extra_ids:
        print("\n--- Extra logos to delete ---")
        for cid in extra_ids:
            for ext in LOGO_EXTENSIONS:
                path = os.path.join(LOGO_DIR_OUT, f"{cid}{ext}")
                if os.path.exists(path):
                    print(f"  {os.path.basename(path)}")

        if ask_yes(f"\nDelete {len(extra_ids)} extra logo(s)? [y/N]: "):
            deleted = 0
            for cid in extra_ids:
                for ext in LOGO_EXTENSIONS:
                    path = os.path.join(LOGO_DIR_OUT, f"{cid}{ext}")
                    if os.path.exists(path):
                        os.remove(path)
                        deleted += 1
            print(f"Deleted: {deleted} file(s)")
        else:
            print("Skipped.")

    # Download missing
    if missing_ids:
        print(f"\n--- Missing logos ({len(missing_ids)}) ---")
        coins_by_id = {c["id"]: c for c in data["coins"]}
        for cid in missing_ids[:20]:
            c = coins_by_id.get(cid, {})
            print(f"  [{cid}] {c.get('name', '?')} ({c.get('symbol', '?')})")
        if len(missing_ids) > 20:
            print(f"  ... and {len(missing_ids) - 20} more")

        if ask_yes(f"\nDownload {len(missing_ids)} missing logo(s) to logo_new/? [y/N]: "):
            os.makedirs(LOGO_DIR_NEW, exist_ok=True)
            info_map = {
                cid: {"logo": f"https://s2.coinmarketcap.com/static/img/coins/64x64/{cid}.png"}
                for cid in missing_ids
            }
            print(f"\n=== Downloading to {LOGO_DIR_NEW}/ ===")
            ok, fail = download_logos(info_map, LOGO_DIR_NEW, 0.3)
            print(f"\nDone. Downloaded: {ok}, failed: {fail}")
        else:
            print("Skipped.")
    else:
        print("\nAll logos are present!")


def merge_catalog():
    """Merge cmc.json with *_coins.json files → cmc_newdata.json."""
    local_fallback = os.path.join(SCRIPT_DIR, "cmc.json")
    if os.path.exists(CMC_JSON):
        catalog_path = CMC_JSON
    elif os.path.exists(local_fallback):
        catalog_path = local_fallback
    else:
        print(f"Error: cmc.json not found in:\n  {CMC_JSON}\n  {local_fallback}")
        sys.exit(1)

    print(f"Using catalog: {catalog_path}")
    local = load_json(catalog_path)
    print(f"Loaded cmc.json: {len(local['coins'])} coins")

    # Detect available source files
    available = [
        (p, os.path.basename(p)) for p in (OUT_FILE_FULL, OUT_FILE) if os.path.exists(p)
    ]
    if not available:
        print("No *_coins.json files found. Run --update new or --update full first.")
        sys.exit(1)

    if len(available) == 1:
        sources = [available[0][0]]
        print(f"Using: {available[0][1]}")
    else:
        print("\nFound multiple source files:")
        for i, (_, name) in enumerate(available, 1):
            print(f"  {i}) {name}")
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
        data = load_json(path)
        before = len(update_by_id)
        for c in data["coins"]:
            if c["id"] not in update_by_id:
                update_by_id[c["id"]] = c
        print(
            f"Loaded {os.path.basename(path)}: {len(data['coins'])} coins "
            f"(+{len(update_by_id) - before} unique)"
        )

    # Merge: update existing + convert old format
    merged = []
    updated = converted = kept = 0
    for coin in local["coins"]:
        cid = coin["id"]
        if cid in update_by_id:
            merged.append(finalize_for_merge(update_by_id.pop(cid)))
            updated += 1
        elif "platform" in coin:
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

    save_json(OUT_FILE_MERGE, merged)
    print(f"\nMerge complete → {OUT_FILE_MERGE}")
    print(f"  Updated from *_coins.json: {updated}")
    print(f"  Converted to new format:   {converted}")
    print(f"  Already new format:        {kept}")
    print(f"  Added new coins:           {added}")
    print(f"  Total:                     {len(merged)}")


def _name_words(name):
    """Split name into lowercase tokens by space, dash, or underscore (len >= 3)."""
    return set(w for w in re.split(r'[ \-_]', name.lower()) if len(w) >= 3)


def _soft_name_match(cmc_name, cg_name):
    """Check if names are similar: substring or shared tokens (split by space/dash/underscore)."""
    cmc_low = cmc_name.lower().strip()
    cg_low = cg_name.lower().strip()
    # Substring match (either direction)
    if cmc_low in cg_low or cg_low in cmc_low:
        return True
    # Shared tokens
    cmc_words = _name_words(cmc_name)
    cg_words = _name_words(cg_name)
    return bool(cmc_words and cmc_words & cg_words)


def _fetch_market_caps(gecko_ids, pause):
    """Batch-fetch market caps from CoinGecko /coins/markets. Returns {geckoId: cap}."""
    caps = {}
    id_list = list(gecko_ids)
    total_batches = (len(id_list) + 249) // 250
    for i in range(0, len(id_list), 250):
        chunk = id_list[i:i + 250]
        batch_num = i // 250 + 1
        print(f"  market cap batch {batch_num}/{total_batches} "
              f"({len(chunk)} ids) ...", flush=True)
        try:
            r = requests.get(CG_MARKETS_URL, params={
                "vs_currency": "usd",
                "ids": ",".join(chunk),
                "per_page": 250,
                "sparkline": "false",
            }, timeout=60)
            if r.status_code == 429:
                print("    error: HTTP 429 Too Many Requests — CoinGecko rate limit exceeded.")
                print(f"    Increase the pause between requests with --pause (current: {pause}s).")
                print("    Example: python check_new_coins.py --build gecko --pause 15")
                sys.exit(1)
            elif r.ok:
                for item in r.json():
                    caps[item["id"]] = item.get("market_cap") or 0
            else:
                print(f"    warning: HTTP {r.status_code}", flush=True)
        except Exception as e:
            print(f"    warning: {e}", flush=True)
        if i + 250 < len(id_list):
            for remaining in range(int(pause), 0, -1):
                print(f"\r    waiting {remaining}s ...  ", end="", flush=True)
                time.sleep(1)
            print("\r" + " " * 25 + "\r", end="", flush=True)
    return caps


def build_gecko(pause=1.0):
    """Fetch CoinGecko coins/list, match by name+symbol → cmc_geckoid.json.

    Source priority: cmc_newdata.json → cmc.json (frontend) → cmc.json (local)
    Pass 1: strict name + symbol (exact, case-insensitive)
    Pass 2: strict symbol + soft name (tokens by space/dash/underscore)
    Uniqueness: each gecko_id assigned to at most one CMC coin (by market cap priority)
    """
    local_newdata = os.path.join(SCRIPT_DIR, "cmc_newdata.json")
    local_fallback = os.path.join(SCRIPT_DIR, "cmc.json")
    if os.path.exists(local_newdata):
        catalog_path = local_newdata
    elif os.path.exists(CMC_JSON):
        catalog_path = CMC_JSON
    elif os.path.exists(local_fallback):
        catalog_path = local_fallback
    else:
        print(f"Error: source file not found in:\n  {local_newdata}\n  {CMC_JSON}\n  {local_fallback}")
        sys.exit(1)

    print(f"Using catalog: {catalog_path}")
    local = load_json(catalog_path)
    coins = local["coins"]
    print(f"Loaded cmc.json: {len(coins)} coins")

    # Fetch CoinGecko coins list (single request)
    print("\n=== Fetching CoinGecko coins/list ===")
    r = requests.get(CG_LIST_URL, timeout=60)
    r.raise_for_status()
    cg_list = r.json()
    print(f"CoinGecko list: {len(cg_list)} coins")

    # Index by lowercase symbol → list of {id, symbol, name}
    by_symbol = {}
    for item in cg_list:
        sym = (item.get("symbol") or "").lower()
        if sym:
            by_symbol.setdefault(sym, []).append(item)

    # ── Pass 1: exact name + symbol ──────────────────────────────────────────
    print("\n=== Pass 1: strict name + symbol ===")
    result_map = {}        # cmc_id → gecko_id (final)
    used_gecko_ids = set() # gecko_ids already assigned
    pass1_multi = {}       # cmc_id → [gecko items] (exact dupes, need market cap)
    pass1_unmatched = []   # coins for pass 2

    for coin in coins:
        cat_name = (coin.get("name") or "").lower()
        cat_sym = (coin.get("symbol") or "").lower()
        candidates = by_symbol.get(cat_sym, [])

        exact = [c for c in candidates if (c.get("name") or "").lower() == cat_name]

        if len(exact) == 1:
            gid = exact[0]["id"]
            if gid not in used_gecko_ids:
                result_map[coin["id"]] = gid
                used_gecko_ids.add(gid)
            else:
                pass1_multi[coin["id"]] = exact  # single but already taken → resolve by cap
        elif len(exact) > 1:
            pass1_multi[coin["id"]] = exact
        else:
            pass1_unmatched.append(coin)

    pass1_single = len(result_map)
    print(f"Matched (single): {pass1_single}")
    print(f"Matched (dupes):  {len(pass1_multi)}")
    print(f"Unmatched:        {len(pass1_unmatched)}")

    # ── Pass 2: strict symbol + soft name ────────────────────────────────────
    print(f"\n=== Pass 2: strict symbol + soft name ({len(pass1_unmatched)} coins) ===")

    soft_candidates = {}   # cmc_id → [gecko items]

    for coin in pass1_unmatched:
        cat_sym = (coin.get("symbol") or "").lower()
        cat_name = coin.get("name") or ""
        candidates = by_symbol.get(cat_sym, [])
        if not candidates:
            continue

        matches = [c for c in candidates if _soft_name_match(cat_name, c.get("name") or "")]
        if matches:
            soft_candidates[coin["id"]] = matches

    single_match = sum(1 for v in soft_candidates.values() if len(v) == 1)
    multi_match = sum(1 for v in soft_candidates.values() if len(v) > 1)
    print(f"Soft matches found: {len(soft_candidates)} "
          f"(single: {single_match}, multiple: {multi_match})")

    # ── Fetch market caps for ALL multi-match candidates (pass 1 + pass 2) ──
    multi_ids = set()
    for matches in pass1_multi.values():
        for c in matches:
            multi_ids.add(c["id"])
    for cmc_id, matches in soft_candidates.items():
        for c in matches:
            multi_ids.add(c["id"])

    market_caps = {}
    if multi_ids:
        print(f"\n=== Fetching market caps for {len(multi_ids)} candidates ===")
        market_caps = _fetch_market_caps(multi_ids, pause)
        print(f"Got market cap data for {len(market_caps)} coins")

    # ── Assign pass 1 dupes: pick highest-cap not yet used ───────────────────
    pass1_dupes_log = []
    coins_by_id = {c["id"]: c for c in coins}
    for cmc_id, matches in pass1_multi.items():
        sorted_matches = sorted(matches, key=lambda c: market_caps.get(c["id"], 0), reverse=True)
        best = next((c for c in sorted_matches if c["id"] not in used_gecko_ids), None)
        if best:
            result_map[cmc_id] = best["id"]
            used_gecko_ids.add(best["id"])
        else:
            result_map[cmc_id] = None
        pass1_dupes_log.append((coins_by_id[cmc_id], best, len(matches)))

    if pass1_dupes_log:
        print(f"\n--- Pass 1 dupes resolved by market cap ({len(pass1_dupes_log)}) ---")
        for coin, hit, n in pass1_dupes_log[:20]:
            if hit:
                cap = market_caps.get(hit["id"])
                cap_str = f", cap=${cap:,.0f}" if cap else ""
                print(f'  [{coin["id"]}] "{coin["name"]}" ({coin["symbol"]}) '
                      f'→ "{hit["name"]}" ({hit["id"]}){cap_str} [{n} dupes]')
            else:
                print(f'  [{coin["id"]}] "{coin["name"]}" ({coin["symbol"]}) → null (all taken)')
        if len(pass1_dupes_log) > 20:
            print(f"  ... and {len(pass1_dupes_log) - 20} more")

    # ── Assign pass 2 matches: pick highest-cap not yet used ─────────────────
    pass2_matched = 0
    pass2_log = []
    for coin in pass1_unmatched:
        cmc_id = coin["id"]
        if cmc_id not in soft_candidates:
            continue

        matches = soft_candidates[cmc_id]
        sorted_matches = sorted(matches, key=lambda c: market_caps.get(c["id"], 0), reverse=True)
        best = next((c for c in sorted_matches if c["id"] not in used_gecko_ids), None)
        if best:
            result_map[cmc_id] = best["id"]
            used_gecko_ids.add(best["id"])
            pass2_matched += 1
            pass2_log.append((coin, best, len(matches)))

    print(f"\nPass 2 matched: {pass2_matched}")

    if pass2_log:
        print("\n--- Pass 2 matches ---")
        for coin, hit, n_candidates in pass2_log[:40]:
            cap = market_caps.get(hit["id"])
            cap_str = f", cap=${cap:,.0f}" if cap else ""
            multi_str = f" [{n_candidates} candidates]" if n_candidates > 1 else ""
            print(f'  [{coin["id"]}] "{coin["name"]}" ({coin["symbol"]}) '
                  f'→ "{hit["name"]}" ({hit["id"]}){cap_str}{multi_str}')
        if len(pass2_log) > 40:
            print(f"  ... and {len(pass2_log) - 40} more")

    # ── Build result ─────────────────────────────────────────────────────────
    result_coins = []
    for coin in coins:
        entry = dict(coin)
        entry["gecko_id"] = result_map.get(coin["id"])  # None if not found
        result_coins.append(entry)

    total_matched = sum(1 for v in result_map.values() if v is not None)
    total_unmatched = len(coins) - total_matched
    save_json(OUT_FILE_GECKO, result_coins)

    print(f"\n{'=' * 50}")
    print(f"Pass 1 (exact, single): {pass1_single}")
    print(f"Pass 1 (exact, dupes):  {len(pass1_multi)}")
    print(f"Pass 2 (soft):          {pass2_matched}")
    print(f"Total matched:          {total_matched} / {len(coins)}")
    print(f"Not matched:            {total_unmatched}")

    if total_unmatched:
        still_missing = [c for c in coins if not result_map.get(c["id"])]
        print("\n--- Still unmatched ---")
        for c in still_missing[:30]:
            print(f"  [{c['id']}] {c['name']} ({c['symbol']})")
        if len(still_missing) > 30:
            print(f"  ... and {len(still_missing) - 30} more")

    print(f"\nSaved → {OUT_FILE_GECKO}")


# ── Main ──────────────────────────────────────────────────────────────────────

BUILD_COMMANDS = {
    "build": build_catalog,
    "merge": merge_catalog,
    "logos": copy_logos,
    "check": check_logos,
    "gecko": build_gecko,
}


def main():
    parser = argparse.ArgumentParser(
        prog="check_new_coins.py",
        description="Fetch coins from CoinMarketCap and update cmc.json.",
        add_help=False,
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--key", "-K", metavar="API_KEY",
        help="CoinMarketCap Pro API key (required for new/full)",
    )
    parser.add_argument(
        "--update", "-U", metavar="MODE",
        choices=["new", "full", "raw"], default="new",
        help="new:  only new coins → new_coins.json (default)\n"
             "full: all coins → full_coins.json\n"
             "raw:  all coins, full CMC data → raw_coins.json",
    )
    parser.add_argument(
        "--build", "-B", metavar="MODE",
        choices=list(BUILD_COMMANDS),
        help="merge: combine cmc.json + *_coins.json → cmc_newdata.json\n"
             "build: build cmc_newdata.json from full_coins.json directly\n"
             "logos: copy logos from frontend/images/logo/ → catalog_update/logo/\n"
             "check: verify logos in logo/ match cmc_newdata.json, clean up extras\n"
             "gecko: fetch CoinGecko IDs for all coins → cmc_geckoid.json",
    )
    parser.add_argument(
        "--pause", "-P", metavar="SECONDS", type=float, default=1.0,
        help="Pause between API requests in seconds (default: 1)",
    )
    parser.add_argument(
        "--limit", "-L", metavar="N", type=int, default=0,
        help="Limit number of coins to fetch (default: 0 = no limit)",
    )
    parser.add_argument(
        "--id", "-I", dest="id", metavar="ID", type=int, nargs="+",
        help="Fetch specific coins by CMC ID (one or more)",
    )
    parser.add_argument("--help", "-H", action="help", help="Show this help message and exit")

    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)

    args = parser.parse_args()

    # ── Build mode (no API key needed) ────────────────────────────────────────

    if args.build in BUILD_COMMANDS:
        fn = BUILD_COMMANDS[args.build]
        if args.build == "gecko":
            fn(pause=args.pause)
        else:
            fn()
        return

    # ── API modes require key ─────────────────────────────────────────────────

    if not args.key:
        print("Error: --key is required for --update new/full/raw")
        sys.exit(1)

    headers = {"X-CMC_PRO_API_KEY": args.key, "Accept": "application/json"}
    mode = args.update
    out_map = {"raw": OUT_FILE_RAW, "full": OUT_FILE_FULL, "new": OUT_FILE}

    # ── Fetch by ID mode ──────────────────────────────────────────────────────

    if args.id:
        target_ids = sorted(set(args.id))
        out_path = out_map[mode]
        aux = AUX_RAW if mode == "raw" else AUX_NORMAL
        print(f"\n=== Fetching {len(target_ids)} coin(s) by ID: {target_ids} ===")

        info_map = fetch_info(target_ids, headers, args.pause, aux=aux)

        if mode == "raw":
            built_coins = list(info_map.values())
        else:
            built_coins = []
            for cid in target_ids:
                info = info_map.get(cid)
                if not info:
                    print(f"  Warning: no data returned for ID {cid}")
                    continue
                base = {"id": cid, "name": info.get("name", ""), "symbol": info.get("symbol", "")}
                built_coins.append(build_coin_entry(cid, base, info))

        for cid in target_ids:
            info = info_map.get(cid)
            if info:
                print(f"  [{cid}] {info.get('name', '?')} ({info.get('symbol', '?')})")
            else:
                print(f"  Warning: no data returned for ID {cid}")

        save_json(out_path, built_coins)
        print(f"\nSaved {len(built_coins)} coin(s) → {out_path}")

        if ask_yes("\nDownload logos? [y/N]: "):
            print(f"\n=== Downloading logos to {LOGO_DIR_NEW}/ ===")
            ok, fail = download_logos(info_map, LOGO_DIR_NEW, args.pause)
            print(f"\nDone. Downloaded: {ok}, failed: {fail}")
        else:
            print("Skipped.")
        return

    # ── Load catalog ──────────────────────────────────────────────────────────

    if not os.path.exists(CMC_JSON):
        print(f"Error: catalog not found at {CMC_JSON}")
        sys.exit(1)

    local = load_json(CMC_JSON)
    local_ids = {c["id"] for c in local["coins"]}
    print(f"Our catalog:  {len(local_ids)} coins")

    # ── Raw mode ──────────────────────────────────────────────────────────────

    if mode == "raw":
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
            raw_map = fetch_info(target_ids, headers, args.pause, aux=AUX_RAW)
            save_json(OUT_FILE_RAW, list(raw_map.values()))
            print(f"\nSaved {len(raw_map)} coins → {OUT_FILE_RAW}")
        return

    # ── New / Full mode ───────────────────────────────────────────────────────

    out_path = out_map[mode]
    if os.path.exists(out_path):
        existing = load_json(out_path)
        print(
            f"\nFound existing {os.path.basename(out_path)} "
            f"({existing['totalFetched']} coins), skipping API fetch."
        )
        info_map = {c["id"]: c for c in existing["coins"]}
    else:
        print("\n=== Fetching coin list from CMC ===")
        cmc_coins = fetch_all_ids(headers, args.pause)
        cmc_by_id = {c["id"]: c for c in cmc_coins}
        cmc_ids = set(cmc_by_id)
        print(f"\nCMC total:    {len(cmc_ids)} coins")

        if mode == "new":
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

        print(f"\n=== Fetching data for {len(target_ids)} coins ===")
        info_map = fetch_info(target_ids, headers, args.pause)

        built_coins = []
        for cid in target_ids:
            base = cmc_by_id[cid]
            info = info_map.get(cid, {})
            built_coins.append(build_coin_entry(cid, base, info))

        save_json(out_path, built_coins)
        print(f"\nSaved {len(built_coins)} coins → {out_path}")

    # ── Logos ─────────────────────────────────────────────────────────────────

    if not ask_yes("\nDownload logos? [y/N]: "):
        print("Skipped.")
        return

    if mode == "new":
        print(f"\n=== Downloading logos to {LOGO_DIR_NEW}/ ===")
        ok, fail = download_logos(info_map, LOGO_DIR_NEW, args.pause)
    else:
        try:
            dl_mode = input("Download new only or all? [new/all]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            dl_mode = ""
        if dl_mode in ("all", "все"):
            print(f"\n=== Downloading all logos to {LOGO_DIR_FULL}/ ===")
            ok, fail = download_logos(info_map, LOGO_DIR_FULL, args.pause)
        else:
            new_info = {k: v for k, v in info_map.items() if k not in local_ids}
            print(f"\n=== Downloading {len(new_info)} new logos to {LOGO_DIR_NEW}/ ===")
            ok, fail = download_logos(new_info, LOGO_DIR_NEW, args.pause)
    print(f"\nDone. Downloaded: {ok}, failed: {fail}")


if __name__ == "__main__":
    main()
