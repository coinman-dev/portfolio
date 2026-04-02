#!/usr/bin/env python3
"""
check_explorers.py — перебирает список explorer-URL из full_coins.json,
находит первый рабочий и определяет паттерн адреса кошелька.

Использование:
  python check_explorers.py -d 1-100
  python check_explorers.py -d 300-500
  python check_explorers.py -d 1-100 -o my_results.json

Поля результата:
  explorer  — итоговый URL с {{WALLET}}, например: blockchair.com/bitcoin/address/{{WALLET}}
  status    — ok | no_url | error[: описание]  (error только если все URLs упали)
  detected  — exact | rule | auto | default | none
"""

import argparse
import json
import os
import re
import sys
import time

import requests
from requests.exceptions import (
    ConnectionError as ReqConnectionError,
)
from requests.exceptions import (
    SSLError,
    Timeout,
    TooManyRedirects,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
COINS_FILE = os.path.join(SCRIPT_DIR, "full_coins.json")
DEFAULT_OUTPUT = os.path.join(SCRIPT_DIR, "explorer_status.json")
MERGE_OUTPUT = os.path.join(SCRIPT_DIR, "cmc_explorerfix.json")
# Приоритет источника для --merge: сначала cmc_newdata.json, потом cmc.json
MERGE_SOURCES = [
    os.path.join(SCRIPT_DIR, "cmc_newdata.json"),
    os.path.join(PROJECT_DIR, "frontend", "coinbase", "cmc.json"),
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}
TIMEOUT = 12

# ── домены которые надо пропускать (не block explorer-ы) ─────────────────────
SKIP_DOMAINS: set[str] = {
    "app.nansen.ai",  # аналитика
    "nansen.ai",
    "dune.com",  # аналитика
    "dune.analytics.com",
    "ethplorer.io",  # только токены, не адреса
    "coincarp.com",  # агрегатор цен
    "coingecko.com",
    "coinmarketcap.com",
    "github.com",
    "twitter.com",
    "t.me",
}

# ── принудительные правила по coin id ────────────────────────────────────────
# Применяются всегда, независимо от URL в full_coins.json.
# HTTP-проверка не выполняется — паттерн считается доверенным.
COIN_RULES: dict[int, str] = {
    21794: "explorer.aptoslabs.com/account/{{WALLET}}",  # APT  Aptos
    2010: "cexplorer.io/address/{{WALLET}}",  # ADA  Cardano
    3794: "www.mintscan.io/cosmos/address/{{WALLET}}",  # ATOM Cosmos
    2280: "filscan.io/en/address/{{WALLET}}",  # FIL  Filecoin
    22691: "voyager.online/contract/{{WALLET}}",  # STRK Starknet
}

# ── точные замены URL ──────────────────────────────────────────────────────────
# Когда base-URL содержит специфичный путь/файл — возвращаем паттерн целиком.
EXACT_RULES: dict[str, str] = {
    "www.presstab.pw/phpexplorer/ADC/index.php": "www.presstab.pw/phpexplorer/ADC/address.html?address={{WALLET}}",
}

# ── правила по домену ──────────────────────────────────────────────────────────
# (hostname, suffix) — суффикс добавляется к base-URL из coins JSON.
DOMAIN_RULES: list[tuple[str, str]] = [
    # ── multi-coin platforms ──────────────────────────────────────────────────
    ("blockchair.com", "/address/{{WALLET}}"),
    ("chainz.cryptoid.info", "/address.dws?{{WALLET}}"),  # без «=» !
    ("bitinfocharts.com", "/address/{{WALLET}}"),
    ("bchain.info", "/addr/{{WALLET}}"),
    ("omniexplorer.info", "/address/{{WALLET}}"),
    ("tokenview.io", "/address/{{WALLET}}"),
    ("tokenview.com", "/address/{{WALLET}}"),
    ("blockchain.info", "/address/{{WALLET}}"),
    ("live.blockcypher.com", "/address/{{WALLET}}"),  # base уже /btc и т.п.
    ("blockexplorer.com", "/address/{{WALLET}}"),
    ("namecha.in", "/address/{{WALLET}}"),
    ("www.namebrow.se", "/address/{{WALLET}}"),
    # ── EVM-сканеры ───────────────────────────────────────────────────────────
    ("etherscan.io", "/address/{{WALLET}}"),
    ("bscscan.com", "/address/{{WALLET}}"),
    ("polygonscan.com", "/address/{{WALLET}}"),
    ("snowtrace.io", "/address/{{WALLET}}"),
    ("ftmscan.com", "/address/{{WALLET}}"),
    ("arbiscan.io", "/address/{{WALLET}}"),
    ("optimistic.etherscan.io", "/address/{{WALLET}}"),
    ("cardanoscan.io", "/address/{{WALLET}}"),
    ("explorer.cardano.org", "/en/address?address={{WALLET}}"),
    ("avascan.info", "/blockchain/c/address/{{WALLET}}"),
    ("cronoscan.com", "/address/{{WALLET}}"),
    ("moonbeam.moonscan.io", "/address/{{WALLET}}"),
    ("moonscan.io", "/address/{{WALLET}}"),
    ("celoscan.io", "/address/{{WALLET}}"),
    ("gnosisscan.io", "/address/{{WALLET}}"),
    ("basescan.org", "/address/{{WALLET}}"),
    ("lineascan.build", "/address/{{WALLET}}"),
    ("scrollscan.com", "/address/{{WALLET}}"),
    ("era.zksync.network", "/address/{{WALLET}}"),
    ("explorer.zksync.io", "/address/{{WALLET}}"),
    ("blastscan.io", "/address/{{WALLET}}"),
    # ── Solana ────────────────────────────────────────────────────────────────
    ("solscan.io", "/account/{{WALLET}}"),
    ("explorer.solana.com", "/account/{{WALLET}}"),
    ("solanabeach.io", "/account/{{WALLET}}"),
    ("solana.fm", "/address/{{WALLET}}"),
    # ── XRP / Stellar / BTS ───────────────────────────────────────────────────
    ("livenet.xrpl.org", "/accounts/{{WALLET}}"),
    ("xrpscan.com", "/account/{{WALLET}}"),
    ("stellarchain.io", "/accounts/{{WALLET}}"),
    ("bitshares.network", "/#/account/{{WALLET}}"),
    # ── Tron ──────────────────────────────────────────────────────────────────
    ("tronscan.org", "/#/address/{{WALLET}}"),
    # ── NEM / Symbol ─────────────────────────────────────────────────────────
    ("explorer.nemtool.com", "/#/s_account?account={{WALLET}}"),
    ("symbol.fyi", "/accounts/{{WALLET}}"),
    # ── Insight-based (Angular hash-routing) ─────────────────────────────────
    ("insight.terracoin.io", "/#/address/{{WALLET}}"),
    ("explorer.dash.org", "/insight/address/{{WALLET}}"),
    # ── Прочие специфичные паттерны ───────────────────────────────────────────
    ("explorer.emercoin.com", "/wallet/{{WALLET}}"),
    ("explorer.cryptonite.info", "/?address={{WALLET}}"),
    ("explorer.whitecoin.info", "/address?address={{WALLET}}"),  # base уже /#
    ("bithomp.com", "/explorer/{{WALLET}}"),
    ("dogechain.info", "/address/{{WALLET}}"),
    ("explorer.bitcoin.com", "/address/{{WALLET}}"),
    ("blockdozer.com", "/address/{{WALLET}}"),
    ("insight.bitpay.com", "/address/{{WALLET}}"),
    # ── Подтверждённые /address/ (из ручного исследования) ───────────────────
    ("explorer.peercoin.net", "/address/{{WALLET}}"),
    ("explorer.feathercoin.com", "/address/{{WALLET}}"),
    ("luckyscan.org", "/address/{{WALLET}}"),
    ("explorer.junk-coin.com", "/address/{{WALLET}}"),
    ("explorer.bit.diamonds", "/address/{{WALLET}}"),
    ("explorer.42-coin.org", "/address/{{WALLET}}"),
    ("blockbook.reddcoin.com", "/address/{{WALLET}}"),
    ("xchain.io", "/address/{{WALLET}}"),
    ("explore.marscoin.org", "/address/{{WALLET}}"),
    ("explorer.navcoin.org", "/address/{{WALLET}}"),
    ("explorer.syscoin.org", "/address/{{WALLET}}"),
    ("verge-blockchain.info", "/address/{{WALLET}}"),
    ("bstyexplorer.globalboost.info", "/address/{{WALLET}}"),
]

DEFAULT_SUFFIX = "/address/{{WALLET}}"

# ── авто-определение по HTML ──────────────────────────────────────────────────
ADDR_RE = r"[A-Za-z0-9]{20,}"

AUTO_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'href=["\'][^"\']*?/address/' + ADDR_RE), "/address/{{WALLET}}"),
    (re.compile(r'href=["\'][^"\']*?/accounts?/' + ADDR_RE), "/accounts/{{WALLET}}"),
    (re.compile(r'href=["\'][^"\']*?/addr/' + ADDR_RE), "/addr/{{WALLET}}"),
    (re.compile(r'href=["\'][^"\']*?/wallet/' + ADDR_RE), "/wallet/{{WALLET}}"),
    (re.compile(r"address\.dws\?" + ADDR_RE), "/address.dws?{{WALLET}}"),
    (re.compile(r'href=["\'][^"\']*?/#/address/' + ADDR_RE), "/#/address/{{WALLET}}"),
    (re.compile(r'href=["\'][^"\']*?/account/' + ADDR_RE), "/account/{{WALLET}}"),
]

# Паттерн встроенного адреса/токена — обрезаем до базового домена
_STRIP_EMBEDDED = re.compile(
    r"/(address|account|accounts|addr|wallet|token)/[A-Za-z0-9]{20,}[^/]*$",
    re.IGNORECASE,
)

# ── утилиты ───────────────────────────────────────────────────────────────────


def parse_range(s: str) -> tuple[int, int]:
    parts = s.split("-")
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        print(f"Ошибка: неверный формат '{s}'. Ожидается: 1-100")
        sys.exit(1)
    a, b = int(parts[0]), int(parts[1])
    return (a, b) if a <= b else (b, a)


def _hostname(url: str) -> str:
    u = url.strip()
    if "://" in u:
        u = u.split("://", 1)[1]
    return u.split("/")[0].split("?")[0].split(":")[0].lower()


def _short(e: Exception, n: int = 70) -> str:
    return str(e)[:n]


def _should_skip(url: str) -> bool:
    """Возвращает True для URL которые точно не являются block explorer-ами."""
    host = _hostname(url)
    return host in SKIP_DOMAINS or any(host.endswith("." + d) for d in SKIP_DOMAINS)


# ── HTTP-запрос ───────────────────────────────────────────────────────────────


def _get(url: str) -> tuple[int | None, str, str]:
    """Возвращает (http_code, error_msg, html)."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
        html = r.text if r.status_code == 200 else ""
        return r.status_code, "", html
    except SSLError as e:
        return None, f"SSL: {_short(e)}", ""
    except ReqConnectionError as e:
        msg = str(e)
        if "Name or service not known" in msg or "Failed to resolve" in msg:
            return None, "DNS не резолвится", ""
        if "Connection refused" in msg:
            return None, "соединение отклонено", ""
        return None, "ошибка соединения", ""
    except Timeout:
        return None, "timeout", ""
    except TooManyRedirects:
        return None, "слишком много редиректов", ""
    except Exception as e:
        return None, _short(e), ""


def check_explorer(explorer: str) -> tuple[str, str, str]:
    """
    Возвращает (status, detail, html).
    status: 'ok' | 'notfound' | 'error'
    """
    if not explorer:
        return "error", "нет URL", ""

    base = f"https://{explorer}" if not explorer.startswith("http") else explorer
    code, err, html = _get(base)

    # HTTPS не сработал — пробуем HTTP
    if code is None and "SSL" in err:
        code2, err2, html2 = _get(base.replace("https://", "http://"))
        if code2 == 200:
            return "ok", "только http", html2
        if code2 is not None:
            return ("notfound" if code2 == 404 else "error"), f"SSL; http→{code2}", ""
        return "error", err, ""

    if code is None:
        return "error", err, ""
    if code == 200:
        return "ok", "", html
    if code in (401, 403):
        return "ok", f"HTTP {code} (антибот)", html
    if code == 404:
        # chainz и подобные — 404 без слеша, 200 со слешем
        code2, err2, html2 = _get(base.rstrip("/") + "/")
        if code2 == 200:
            return "ok", "", html2
        return "notfound", "HTTP 404", ""
    if code >= 500:
        return "error", f"сервер вернул {code}", ""
    return "error", f"HTTP {code}", ""


# ── определение паттерна адреса ───────────────────────────────────────────────


def resolve_pattern(explorer: str, html: str = "") -> tuple[str, str]:
    """
    Возвращает (pattern_url, method).
    method: 'exact' | 'rule' | 'auto' | 'default'
    """
    if not explorer:
        return explorer, "none"

    # 1. Точное совпадение
    if explorer in EXACT_RULES:
        return EXACT_RULES[explorer], "exact"

    # 2. Обрезаем встроенный адрес/токен (etherscan.io/address/0x... → etherscan.io)
    base = _STRIP_EMBEDDED.sub("", explorer)

    host = _hostname(base)

    # 3. Правило по домену
    for domain, suffix in DOMAIN_RULES:
        if host == domain or host.endswith("." + domain):
            return base + suffix, "rule"

    # 4. Авто-определение по HTML
    if html:
        for pattern, suffix in AUTO_PATTERNS:
            if pattern.search(html):
                return base + suffix, "auto"

    # 5. Умолчание
    return base + DEFAULT_SUFFIX, "default"


# ── работа с файлом результатов ───────────────────────────────────────────────


def load_results(path: str) -> dict[int, dict]:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {entry["id"]: entry for entry in data.get("results", [])}
    except (json.JSONDecodeError, KeyError):
        print(f"⚠  Файл {path} повреждён — начинаем заново.")
        return {}


def save_results(path: str, results: dict[int, dict]) -> None:
    ordered = sorted(results.values(), key=lambda x: x["id"])
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"results": ordered}, f, indent=2, ensure_ascii=False)


# ── merge ─────────────────────────────────────────────────────────────────────


def run_merge(status_path: str, out_path: str) -> None:
    """
    Объединяет explorer_status.json с исходным cmc-файлом.
    Обновляет поле explorer там где есть рабочий паттерн с {{WALLET}}.
    Пишет результат в cmc_explorerfix.json.
    """
    # Найти источник
    source_path = next((p for p in MERGE_SOURCES if os.path.exists(p)), None)
    if not source_path:
        print("Ошибка: не найден ни cmc_newdata.json ни cmc.json")
        sys.exit(1)
    print(f"Источник: {source_path}")

    with open(source_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    # Поддерживаем форматы: {"coins": [...]} и просто [...]
    if isinstance(raw, dict):
        coins = raw.get("coins", [])
        meta_keys = {k: v for k, v in raw.items() if k != "coins"}
    else:
        coins = raw
        meta_keys = {}

    # Загружаем результаты проверки
    status_map = load_results(status_path)  # dict[id -> entry]

    n_updated = 0
    n_skipped = 0
    out_coins = []

    for coin in coins:
        cid = coin.get("id")
        entry = status_map.get(cid)

        # Рабочий паттерн есть — обновляем
        if entry and entry.get("explorer") and "{{WALLET}}" in entry["explorer"]:
            out_coin = dict(coin)
            out_coin["explorer"] = entry["explorer"]
            n_updated += 1
        else:
            # Оставляем оригинальное значение из источника
            out_coin = dict(coin)
            n_skipped += 1

        out_coins.append(out_coin)

    # Собираем итоговый файл в том же формате что и источник
    if meta_keys:
        result = {**meta_keys, "coins": out_coins}
    else:
        result = out_coins

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Обновлено:  {n_updated}")
    print(f"Без изменений: {n_skipped}")
    print(f"Итого монет: {len(out_coins)}")
    print(f"Файл: {out_path}")


# ── main ──────────────────────────────────────────────────────────────────────


class _Fmt(argparse.RawDescriptionHelpFormatter):
    """Сохраняет явные переносы строк в тексте опций."""

    def _split_lines(self, text: str, width: int) -> list[str]:
        lines: list[str] = []
        for paragraph in text.splitlines():
            lines.extend(super()._split_lines(paragraph, width) if paragraph else [""])
        return lines


def main() -> None:
    parser = argparse.ArgumentParser(
        add_help=False,
        formatter_class=_Fmt,
        description="Check and resolve blockchain explorer URLs from full_coins.json.",
        usage="check_explorers.py [--range N-N] [--range-id N-N] [--recheck] [--merge]\n"
        "                    [--output FILE] [--delay SEC] [--help]",
    )
    parser.add_argument(
        "--range",
        "-R",
        default=None,
        metavar="START-END",
        dest="range",
        help="Range by position in the coin list\n"
        "  1-100   first 100 coins\n"
        "  201-400 coins at positions 201 to 400",
    )
    parser.add_argument(
        "--range-id",
        "-I",
        default=None,
        metavar="START-END",
        dest="range_id",
        help="Range by coin id\n"
        "  1-1000  coins with id from 1 to 1000\n"
        "  500-999 coins with id from 500 to 999",
    )
    parser.add_argument(
        "--recheck",
        "-C",
        action="store_true",
        help="Re-check coins with a failed status in the output file.\n"
        "Can be combined with --range or --range-id to limit scope.\n"
        "Successful results overwrite the old entry; failures are kept as-is.",
    )
    parser.add_argument(
        "--merge",
        "-M",
        action="store_true",
        help="Merge explorer_status.json into cmc_newdata.json (or cmc.json).\n"
        "Updates the explorer field where a working {{WALLET}} pattern exists.\n"
        "Output: cmc_explorerfix.json",
    )
    parser.add_argument(
        "--output",
        "-O",
        default=DEFAULT_OUTPUT,
        metavar="FILE",
        help=f"Output file for check results (default: explorer_status.json)",
    )
    parser.add_argument(
        "--delay",
        "-D",
        type=float,
        default=0.3,
        metavar="SEC",
        help="Pause between HTTP requests in seconds (default: 0.3)",
    )
    parser.add_argument(
        "--help",
        "-H",
        action="help",
        help="Show this help message and exit",
    )
    args = parser.parse_args()

    # Режим merge — запускаем отдельно, остальные аргументы не нужны
    if args.merge:
        run_merge(args.output, MERGE_OUTPUT)
        return

    if not args.recheck and not args.range and not args.range_id:
        parser.error("specify --range, --range-id, --recheck (-C) or --merge (-M)")

    if not os.path.exists(COINS_FILE):
        print(f"Файл не найден: {COINS_FILE}")
        sys.exit(1)

    with open(COINS_FILE, "r", encoding="utf-8") as f:
        raw = json.load(f)

    all_coins = raw.get("coins", raw) if isinstance(raw, dict) else raw
    # Индекс для быстрого поиска по id
    coins_by_id: dict[int, dict] = {c["id"]: c for c in all_coins}

    results = load_results(args.output)

    # ── вспомогательная функция фильтрации по аргументам ──────────────────────
    def apply_range_filter(coins_list: list) -> tuple[list, str]:
        """Применяет -d или -di к списку монет. Возвращает (отфильтрованный список, подсказка)."""
        if args.range:
            start, end = parse_range(args.range)
            # Позиции 1-based, включительно
            sliced = coins_list[start - 1 : end]
            hint = f"позиции {start}–{end}"
            return sliced, hint
        if args.range_id:
            start, end = parse_range(args.range_id)
            filtered = [c for c in coins_list if start <= c["id"] <= end]
            hint = f"id {start}–{end}"
            return filtered, hint
        return coins_list, ""

    # ── определяем список монет для обработки ─────────────────────────────────
    if args.recheck:
        # Берём монеты у которых статус не ok
        failed_ids = {
            cid
            for cid, r in results.items()
            if not r.get("status", "").startswith("ok")
        }
        # Также включаем монеты из COIN_RULES у которых паттерн устарел/неверен
        for cid, pattern in COIN_RULES.items():
            existing = results.get(cid, {})
            if existing.get("explorer") != pattern:
                failed_ids.add(cid)
        # Список в порядке как в full_coins.json
        failed_coins = [
            coins_by_id[cid] for cid in sorted(failed_ids) if cid in coins_by_id
        ]

        target, hint = apply_range_filter(failed_coins)

        if not target:
            print("Нет монет для повторной проверки" + (f" ({hint})" if hint else ""))
            sys.exit(0)

        print(
            f"Повторная проверка: {len(target)} монет с неудачным статусом"
            + (f" ({hint})" if hint else "")
        )
    else:
        target, hint = apply_range_filter(all_coins)

        if not target:
            print(f"Нет монет в диапазоне ({hint})")
            sys.exit(0)

        print(f"Монет ({hint}): {len(target)}")

    print(f"Результаты → {args.output}\n")
    total = len(target)

    for i, coin in enumerate(target, 1):
        cid = coin["id"]
        name = coin.get("name", "?")
        symbol = coin.get("symbol", "?")

        raw_explorers = coin.get("explorer") or []
        if isinstance(raw_explorers, str):
            raw_explorers = [raw_explorers]

        # Фильтруем заведомо неподходящие домены
        explorers = [u for u in raw_explorers if u and not _should_skip(u)]

        prefix = f"[{i:>{len(str(total))}}/{total}] #{cid} {symbol}"

        # Принудительное правило по coin id — наивысший приоритет
        if cid in COIN_RULES:
            pattern = COIN_RULES[cid]
            print(f"{prefix}: [coin_rule]  →  {pattern}")
            results[cid] = {
                "id": cid,
                "name": name,
                "symbol": symbol,
                "explorer": pattern,
                "status": "ok",
                "detected": "coin_rule",
            }
            save_results(args.output, results)
            continue

        if not explorers:
            print(f"{prefix}: нет explorer URL")
            results[cid] = {
                "id": cid,
                "name": name,
                "symbol": symbol,
                "explorer": "",
                "status": "no_url",
                "detected": "none",
            }
            save_results(args.output, results)
            continue

        found = False
        last_status = ""
        last_detail = ""

        for idx, url in enumerate(explorers):
            tag = f"[{idx + 1}/{len(explorers)}]"
            print(f"{prefix} {tag} {url} … ", end="", flush=True)

            status, detail, html = check_explorer(url)
            label = status.upper() + (f" ({detail})" if detail else "")

            if status == "ok":
                pattern, method = resolve_pattern(url, html)
                indicator = {
                    "coin_rule": " [coin_rule]",
                    "exact": " [exact]",
                    "rule": "",
                    "auto": " [авто]",
                    "default": " [?]",
                    "none": "",
                }[method]
                print(f"{label}  →  {pattern}{indicator}")
                results[cid] = {
                    "id": cid,
                    "name": name,
                    "symbol": symbol,
                    "explorer": pattern,
                    "status": status if not detail else f"{status}: {detail}",
                    "detected": method,
                }
                found = True
                if args.delay > 0:
                    time.sleep(args.delay)
                break
            else:
                print(f"{label} → следующий")
                last_status = status
                last_detail = detail
                if args.delay > 0:
                    time.sleep(args.delay)

        if not found:
            if args.recheck:
                # Оставляем старую запись без изменений
                print(f"{prefix}: все URL по-прежнему не работают — оставляем как есть")
            else:
                print(f"{prefix}: все URL не работают")
                results[cid] = {
                    "id": cid,
                    "name": name,
                    "symbol": symbol,
                    "explorer": "",
                    "status": "no_url",
                    "detected": "none",
                }

        save_results(args.output, results)

    # Итоговая статистика
    vals = list(results.values())
    n_ok = sum(1 for r in vals if r["status"].startswith("ok"))
    n_no_url = sum(1 for r in vals if r["status"] == "no_url")
    n_er = sum(1 for r in vals if r["status"].startswith("error"))
    n_coin_rule = sum(1 for r in vals if r.get("detected") == "coin_rule")
    n_exact = sum(1 for r in vals if r.get("detected") == "exact")
    n_rule = sum(1 for r in vals if r.get("detected") == "rule")
    n_auto = sum(1 for r in vals if r.get("detected") == "auto")
    n_default = sum(1 for r in vals if r.get("detected") == "default")

    print(f"\n{'─' * 55}")
    if args.recheck:
        print(
            f"Повторная проверка завершена. Проверено: {total}  |  итого в файле: {len(results)}"
        )
    else:
        print(f"Готово. Обработано: {total}  |  итого в файле: {len(results)}")
    print(f"Статус  — ok: {n_ok}  no_url: {n_no_url}  error: {n_er}")
    print(
        f"Паттерн — coin_rule: {n_coin_rule}  exact: {n_exact}  rule: {n_rule}  auto: {n_auto}  default(?): {n_default}"
    )
    print(f"Файл: {args.output}")


if __name__ == "__main__":
    main()
