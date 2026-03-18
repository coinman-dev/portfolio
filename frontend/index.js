/* jshint esversion: 6, browser: true, devel: true */
/* eslint-disable no-console */
/* eslint-env browser, es6 */

window.DEBUG_MODE = false;

var CONFIG = {
    IMAGE_DIR: "images/logo/",
    MAX_COIN_NAME_LEN: 64,
    MAX_SYMBOL_LEN: 16,
    MAX_DESCRIPTION_LEN: 128,
    AMOUNT_DECIMALS: 8,
    PRICE_DECIMALS: 8,
    DECIMAL_SEPARATOR: ".",
    API_MARKETS_URL: "https://api.coingecko.com/api/v3/coins/markets",
    MARKET_CACHE_STORAGE_KEY: "coinman_market_cache_v1",
    MARKET_SESSION_COOKIE_NAME: "coinman_market_session_v1",
    TIME_STEP_MINUTES: 5,
    MAX_SUGGESTIONS: 5,
    CURRENCY_SYMBOLS_FIAT: {
        USD: "$",
        EUR: "€",
        GBP: "£",
    },
    CURRENCY_SYMBOLS_CRYPTO: {
        BTC: "₿",
        ETH: "Ξ",
        BNB: "BNB",
        XRP: "XRP",
        SOL: "SOL",
        TRX: "TRX",
        DOGE: "DOGE",
        ADA: "ADA",
        BCH: "BCH",
        LINK: "LINK",
    },
    CURRENCY_DECIMALS_FIAT: 2,
    CURRENCY_DECIMALS_CRYPTO: 8,
    SORT_DEFAULT_DIR: {
        coinDate: "asc",
        price: "asc",
        currentPrice: "asc",
        holdings: "asc",
        profit: "asc",
        change: "asc",
    },

    /* ============================================================
       NEW: MODAL SIZES (можно менять здесь)
       - ширина/высота задаются как CSS значения: '600px', '90vw', 'auto' и т.п.
       - maxHeight полезен для небольших экранов (чтобы модалка не вылезала за пределы)
       ============================================================ */
    MODAL_SIZES: {
        DEFAULT: { width: "600px", height: "auto", maxHeight: "90vh" },
        SELL: { width: "750px", height: "auto", maxHeight: "90vh" },
    },
};

var state = {
    marketData: [],
    marketDataBySymbol: {},
    activePortfolioId: 1,
    currentView: "current",
    isCollapsed: false,
    currentEditingId: null,
    activeEditTab: "buy",
    sortKey: "coinDate",
    sortDir: "asc",
    bulkSellSymbol: null,
    bulkSellCatalogId: "",
    bulkSellTxs: [],
    bulkSellSelectedSum: 0,
    bulkSellTotalSum: 0,
    addCatalogId: "",
    editCatalogId: "",
    bulkSellSortDir: "asc",
};

var AppBridge = {
    isTauri: function () {
        return !!(
            window.__TAURI__ &&
            window.__TAURI__.core &&
            typeof window.__TAURI__.core.invoke === "function"
        );
    },

    invoke: function (command, args) {
        return window.__TAURI__.core.invoke(command, args || {});
    },

    bootstrap: function () {
        if (!AppBridge.isTauri()) {
            return window.Promise.resolve(window.SERVER_CONFIG || null);
        }

        return AppBridge.invoke("bootstrap_app").then(function (config) {
            window.SERVER_CONFIG = config || {};
            window.DEBUG_MODE = !!(config && config.debugMode);
            return window.SERVER_CONFIG;
        });
    },
};

// ─── DEBUG LOGGER ────────────────────────────────────────────────────────────
var DebugLog = {
    _send: function (line) {
        if (
            window.__TAURI__ &&
            window.__TAURI__.core &&
            typeof window.__TAURI__.core.invoke === "function"
        ) {
            window.__TAURI__.core
                .invoke("debug_log", { message: line })
                .catch(function () {});
        }
    },

    log: function (category, message, data) {
        if (!window.DEBUG_MODE) return;
        var ts = new Date().toISOString();
        var line = "[" + ts + "] [" + category + "] " + message;
        if (data !== undefined) {
            try {
                var s = JSON.stringify(data);
                if (s && s !== "{}") line += " | " + s;
            } catch (e) {
                line += " | [non-serializable]";
            }
        }
        console.log(line);
        DebugLog._send(line);
    },

    error: function (message, err) {
        var stack = err && err.stack ? "\n" + err.stack : "";
        DebugLog.log("ERROR", message + stack);
    },
};

// Перехват всех AppBridge.invoke — логирует каждый вызов и каждую ошибку
(function () {
    var _orig = AppBridge.invoke;
    AppBridge.invoke = function (command, args) {
        if (command !== "debug_log") {
            DebugLog.log("INVOKE →", command, args);
        }
        return _orig(command, args)
            .then(function (result) {
                if (command !== "debug_log") {
                    DebugLog.log("INVOKE ✓", command);
                }
                return result;
            })
            .catch(function (err) {
                DebugLog.log(
                    "INVOKE ✗",
                    command + " FAILED: " + String(err),
                );
                throw err;
            });
    };
})();

// Глобальный перехват кликов по меню и кнопкам
document.addEventListener(
    "click",
    function (e) {
        if (!window.DEBUG_MODE) return;
        var el = e.target;
        var tag = el.tagName || "";
        var cls = (el.className || "").replace(/\s+/g, " ").trim();
        var text = (el.textContent || "").trim().slice(0, 60);
        var id = el.id ? "#" + el.id : "";
        if (
            cls.indexOf("dropdown-item") !== -1 ||
            cls.indexOf("menu-item") !== -1 ||
            tag === "BUTTON" ||
            cls.indexOf("btn") !== -1
        ) {
            DebugLog.log(
                "CLICK",
                '"' + text + '" ' + tag + id + " ." + cls,
            );
        }
    },
    true,
);

// Глобальный перехват JS-ошибок
window.onerror = function (message, source, lineno, colno, error) {
    if (!window.DEBUG_MODE) return false;
    var stack = error && error.stack ? error.stack : "";
    DebugLog.log(
        "JS_ERROR",
        message +
            " at " +
            source +
            ":" +
            lineno +
            ":" +
            colno +
            "\n" +
            stack,
    );
    return false;
};

window.addEventListener("unhandledrejection", function (event) {
    if (!window.DEBUG_MODE) return;
    var reason = event.reason;
    var msg = reason
        ? reason.message
            ? reason.message
            : String(reason)
        : "unknown rejection";
    var stack = reason && reason.stack ? "\n" + reason.stack : "";
    DebugLog.log("PROMISE_ERROR", msg + stack);
});
// ─────────────────────────────────────────────────────────────────────────────

// ─── APP SETTINGS ─────────────────────────────────────────────────────────────
var AppSettings = {
    _LS_KEY: "coinman_settings",

    _load: function () {
        try {
            return JSON.parse(localStorage.getItem(this._LS_KEY) || "{}");
        } catch (e) {
            return {};
        }
    },

    _save: function (settings) {
        try {
            localStorage.setItem(this._LS_KEY, JSON.stringify(settings));
        } catch (e) {}
    },

    get: function (key, defaultValue) {
        var settings = this._load();
        return key in settings ? settings[key] : defaultValue;
    },

    set: function (key, value) {
        var settings = this._load();
        settings[key] = value;
        this._save(settings);
    },

    applyCurPrice: function () {
        var enabled = this.get("showCurPrice", false);
        if (enabled) {
            document.body.classList.add("show-cur-price");
        } else {
            document.body.classList.remove("show-cur-price");
        }
        var td = document.getElementById("empty-row-colspan-td");
        if (td) {
            td.colSpan = enabled ? 7 : 6;
        }
        var menuItem = document.getElementById("menu-toggle-cur-price");
        if (menuItem) {
            if (enabled) {
                menuItem.classList.add("checked");
            } else {
                menuItem.classList.remove("checked");
            }
        }

        // Adjust column widths to keep Profit/Loss and Change columns in place
        var thCoin = document.getElementById("th-coin");
        var thCur = document.getElementById("th-cur-price");
        if (thCoin && thCur) {
            var savedObj = this.get("columnWidths", {});
            var saved = savedObj.widths || savedObj;
            var wCoinBase = parseInt(saved["th-coin"]) || 444;
            var wCurBase = parseInt(saved["th-cur-price"]) || 121;

            if (enabled) {
                thCoin.style.width = wCoinBase + "px";
                thCur.style.width = wCurBase + "px";
            } else {
                // When hidden, th-coin expands to cover both its base width and cur-price width
                thCoin.style.width = (wCoinBase + wCurBase) + "px";
                thCur.style.width = "0px";
            }
        }
    },

    handleToggleCurPrice: function () {
        var current = this.get("showCurPrice", false);
        var newVal = !current;
        this.set("showCurPrice", newVal);
        if (AppBridge.isTauri()) {
            AppBridge.invoke("save_show_cur_price", { show: newVal }).catch(function () {});
        }
        this.applyCurPrice();
    },

    init: function () {
        this.applyCurPrice();
    },
};
// ─────────────────────────────────────────────────────────────────────────────

// Основные данные портфелей теперь приходят с сервера (default.json).
var portfolios = [];

var Templates = {
    portfolioTab: null,
    coinRow: null,
    summaryRow: null,
    emptyRow: null,
    bulkSellRow: null,

    init: function () {
        var ids = {
            portfolioTab: "template-portfolio-tab",
            coinRow: "template-coin-row",
            summaryRow: "template-summary-row",
            emptyRow: "template-empty-row",
            bulkSellRow: "template-bulk-sell-row",
        };
        Object.keys(ids).forEach(function (key) {
            var el = document.getElementById(ids[key]);
            if (el) {
                el.removeAttribute("id");
                if (el.parentNode) el.parentNode.removeChild(el);
                Templates[key] = el;
            }
        });
    },
};

var Utils = {
    parseNumber: function (value, fallback) {
        if (fallback === undefined) fallback = 0;
        var s = String(value || "").trim();
        s = s.replace(/,/g, ".");
        var n = parseFloat(s);
        return Number.isFinite(n) ? n : fallback;
    },

    roundTo: function (value, decimals) {
        var n = Number(value);
        if (!Number.isFinite(n)) return 0;
        var pow = Math.pow(10, Number(decimals));
        return Math.round((n + Number.EPSILON) * pow) / pow;
    },

    normalizeAmount: function (value) {
        return Utils.roundTo(value, CONFIG.AMOUNT_DECIMALS);
    },
    normalizePrice: function (value) {
        return Utils.roundTo(value, CONFIG.PRICE_DECIMALS);
    },

    formatAmount: function (value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return "0";
        var fixed = Utils.normalizeAmount(n).toFixed(CONFIG.AMOUNT_DECIMALS);
        var parts = fixed.split(".");
        var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        var fracPart = (parts[1] || "").replace(/0+$/, "");
        if (fracPart.length < 2) fracPart = fracPart.padEnd(2, "0");
        var out = fracPart ? intPart + "." + fracPart : intPart;
        if (CONFIG.DECIMAL_SEPARATOR === ",") out = out.replace(".", ",");
        return out;
    },

    formatMoney: function (amount, currency) {
        var value = Number.isFinite(amount) ? amount : 0;
        var meta = Utils.getCurrencyMeta(currency);
        var symbol = meta.symbol;
        var minD = meta.type === "crypto" ? 2 : meta.decimals;
        var maxD = meta.decimals;
        var s = value.toLocaleString("en-US", {
            minimumFractionDigits: minD,
            maximumFractionDigits: maxD,
        });
        if (CONFIG.DECIMAL_SEPARATOR === ",") s = s.replace(".", ",");
        return symbol + " " + s;
    },

    getCurrencyMeta: function (currency) {
        var curr = String(currency || "USD").toUpperCase();
        var isFiat = Object.prototype.hasOwnProperty.call(
            CONFIG.CURRENCY_SYMBOLS_FIAT,
            curr,
        );
        var isCrypto = Object.prototype.hasOwnProperty.call(
            CONFIG.CURRENCY_SYMBOLS_CRYPTO,
            curr,
        );
        return {
            code: curr,
            symbol: isFiat
                ? CONFIG.CURRENCY_SYMBOLS_FIAT[curr]
                : isCrypto
                  ? CONFIG.CURRENCY_SYMBOLS_CRYPTO[curr]
                  : curr,
            decimals: isCrypto
                ? CONFIG.CURRENCY_DECIMALS_CRYPTO
                : CONFIG.CURRENCY_DECIMALS_FIAT,
            type: isCrypto ? "crypto" : "fiat",
        };
    },

    getSupportedCurrencies: function () {
        return Object.keys(CONFIG.CURRENCY_SYMBOLS_FIAT).concat(
            Object.keys(CONFIG.CURRENCY_SYMBOLS_CRYPTO),
        );
    },

    uniqueList: function (arr) {
        var seen = {};
        return (arr || []).filter(function (item) {
            if (seen[item]) return false;
            seen[item] = true;
            return true;
        });
    },

    formatPercent: function (value) {
        var v = Number.isFinite(value) ? value : 0;
        var s = v.toFixed(2) + "%";
        if (CONFIG.DECIMAL_SEPARATOR === ",") s = s.replace(".", ",");
        return s;
    },

    getColorClass: function (value) {
        return value > 0 ? "text-green" : value < 0 ? "text-red" : "";
    },

    pad2: function (n) {
        return String(n).padStart(2, "0");
    },

    splitDateTime: function (iso) {
        if (!iso) return { date: "", time: "" };
        var idx = iso.indexOf("T");
        if (idx !== -1) {
            return {
                date: iso.substring(0, idx),
                time: iso.substring(idx + 1, idx + 6),
            };
        }
        return { date: iso, time: "" };
    },

    mergeDateTime: function (date, time) {
        return date ? (time ? date + "T" + time : date) : "";
    },

    sanitizeCoinName: function (v) {
        return String(v || "")
            .replace(/[^\x20-\x7E]/g, "")
            .slice(0, CONFIG.MAX_COIN_NAME_LEN);
    },

    sanitizeSymbol: function (v) {
        return String(v || "")
            .toUpperCase()
            .replace(/[^A-Z0-9_.-]/g, "")
            .slice(0, CONFIG.MAX_SYMBOL_LEN);
    },

    sanitizeCatalogId: function (v) {
        var s = String(v === undefined || v === null ? "" : v).trim();
        return /^\d+$/.test(s) ? s : "";
    },

    escapeHtml: function (value) {
        return String(value === undefined || value === null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    },

    escapeAttr: function (value) {
        return Utils.escapeHtml(value);
    },

    generateId: function () {
        return Date.now();
    },

    getDefaultSortDir: function (key) {
        return CONFIG.SORT_DEFAULT_DIR[key] || "asc";
    },

    fillTokens: function (element, data) {
        if (!element || !data) return;
        var html = element.innerHTML;
        var keys = Object.keys(data);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var val = data[key];
            html = html
                .split(key)
                .join(val !== undefined && val !== null ? val : "");
        }
        element.innerHTML = html;
    },
};

var ServerSync = {
    apiUrl: "index.php?api=1",
    user: "default",
    saveInProgress: false,
    saveQueued: false,
    saveErrorShown: false,

    init: function () {
        if (!window.SERVER_CONFIG) return;
        if (!AppBridge.isTauri() && window.SERVER_CONFIG.apiUrl) {
            ServerSync.apiUrl = String(window.SERVER_CONFIG.apiUrl);
        }
        if (window.SERVER_CONFIG.user) {
            ServerSync.user = String(window.SERVER_CONFIG.user);
        }
    },

    buildUrl: function (action) {
        var separator = ServerSync.apiUrl.indexOf("?") === -1 ? "?" : "&";
        return (
            ServerSync.apiUrl +
            separator +
            "action=" +
            encodeURIComponent(action) +
            "&user=" +
            encodeURIComponent(ServerSync.user)
        );
    },

    loadPortfolios: function (password) {
        if (AppBridge.isTauri()) {
            var args = { user: ServerSync.user };
            if (password) args.password = password;
            return AppBridge.invoke("load_portfolios", args).then(function (payload) {
                if (!payload || payload.ok !== true || !payload.data) {
                    throw new Error("Invalid DB payload");
                }

                var list = Array.isArray(payload.data.portfolios)
                    ? payload.data.portfolios
                    : [];
                portfolios = list;
            });
        }

        return window
            .fetch(ServerSync.buildUrl("load"), { cache: "no-store" })
            .then(function (response) {
                if (!response.ok) throw new Error("DB load failed");
                return response.json();
            })
            .then(function (payload) {
                if (!payload || payload.ok !== true || !payload.data) {
                    throw new Error("Invalid DB payload");
                }

                var list = Array.isArray(payload.data.portfolios)
                    ? payload.data.portfolios
                    : [];
                portfolios = list;
            });
    },

    savePortfolios: function () {
        if (ServerSync.saveInProgress) {
            ServerSync.saveQueued = true;
            return;
        }

        ServerSync.saveInProgress = true;
        var body = JSON.stringify({
            portfolios: portfolios,
        });

        if (AppBridge.isTauri()) {
            AppBridge.invoke("save_portfolios", {
                user: ServerSync.user,
                data: {
                    portfolios: portfolios,
                },
            })
                .then(function (payload) {
                    if (!payload || payload.ok !== true) {
                        throw new Error("DB save returned error");
                    }
                    ServerSync.saveErrorShown = false;
                })
                .catch(function (e) {
                    console.error("Save failed:", e);
                    if (!ServerSync.saveErrorShown) {
                        window.alert(
                            "Cannot save data to the local portfolio file.",
                        );
                        ServerSync.saveErrorShown = true;
                    }
                })
                .finally(function () {
                    ServerSync.saveInProgress = false;
                    if (ServerSync.saveQueued) {
                        ServerSync.saveQueued = false;
                        ServerSync.savePortfolios();
                    }
                });
            return;
        }

        window
            .fetch(ServerSync.buildUrl("save"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: body,
                keepalive: true,
            })
            .then(function (response) {
                if (!response.ok) throw new Error("DB save failed");
                return response.json();
            })
            .then(function (payload) {
                if (!payload || payload.ok !== true) {
                    throw new Error("DB save returned error");
                }
                ServerSync.saveErrorShown = false;
            })
            .catch(function (e) {
                console.error("Save failed:", e);
                if (!ServerSync.saveErrorShown) {
                    window.alert(
                        "Cannot save data to the local portfolio file.",
                    );
                    ServerSync.saveErrorShown = true;
                }
            })
            .finally(function () {
                ServerSync.saveInProgress = false;
                if (ServerSync.saveQueued) {
                    ServerSync.saveQueued = false;
                    ServerSync.savePortfolios();
                }
            });
    },

    clearDatabase: function () {
        if (AppBridge.isTauri()) {
            return AppBridge.invoke("clear_portfolios", {
                user: ServerSync.user,
            }).then(function (payload) {
                if (!payload || payload.ok !== true) {
                    throw new Error("DB clear returned error");
                }
            });
        }

        return window
            .fetch(ServerSync.buildUrl("clear"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
                keepalive: true,
            })
            .then(function (response) {
                if (!response.ok) throw new Error("DB clear failed");
                return response.json();
            })
            .then(function (payload) {
                if (!payload || payload.ok !== true) {
                    throw new Error("DB clear returned error");
                }
            });
    },
};

var CoinCatalog = {
    list: [],
    byId: {},
    bySymbol: {},
    imageDir: "",

    buildImageUrl: function (catalogId) {
        var id = Utils.sanitizeCatalogId(catalogId);
        return id
            ? CoinCatalog.imageDir
                ? CoinCatalog.imageDir + "/" + id + ".webp"
                : id + ".webp"
            : "";
    },

    resolveImageObj: function (raw) {
        var catalogId = Utils.sanitizeCatalogId(
            raw && (raw.id !== undefined ? raw.id : raw.catalogId),
        );

        return {
            id: catalogId,
            src: CoinCatalog.buildImageUrl(catalogId),
        };
    },

    initFromServer: function () {
        var conf = window.SERVER_CONFIG && window.SERVER_CONFIG.coinbase;
        if (!conf) return;

        CoinCatalog.imageDir = String(
            conf.imageDir || CONFIG.IMAGE_DIR || "",
        ).replace(/\/+$/, "");

        var mapById = {};
        var mapBySymbol = {};
        var items = [];

        if (Array.isArray(conf.coins)) {
            conf.coins.forEach(function (raw) {
                var sym = Utils.sanitizeSymbol(
                    raw && raw.symbol ? raw.symbol : "",
                );
                if (!sym) return;
                var imgObj = CoinCatalog.resolveImageObj(raw || {});
                var item = {
                    id: imgObj.id,
                    name: String((raw && raw.name) || sym),
                    symbol: sym,
                    nameLower: String((raw && raw.name) || sym).toLowerCase(),
                    symbolLower: sym.toLowerCase(),
                    image: imgObj.src,
                };
                items.push(item);
                if (item.id && !mapById[item.id]) mapById[item.id] = item;
                if (!mapBySymbol[sym]) mapBySymbol[sym] = [];
                mapBySymbol[sym].push(item);
            });
        }

        CoinCatalog.byId = mapById;
        CoinCatalog.bySymbol = mapBySymbol;
        CoinCatalog.list = items;
    },

    getById: function (catalogId) {
        var id = Utils.sanitizeCatalogId(catalogId);
        return id && CoinCatalog.byId[id] ? CoinCatalog.byId[id] : null;
    },

    findBest: function (catalogId, symbol, coinName) {
        var id = Utils.sanitizeCatalogId(catalogId);
        var byId = CoinCatalog.getById(id);
        var sym = Utils.sanitizeSymbol(symbol || "");
        if (byId && (!sym || byId.symbol === sym)) return byId;

        var list =
            sym && CoinCatalog.bySymbol[sym] ? CoinCatalog.bySymbol[sym] : [];
        if (!list.length) return null;

        var nameKey = String(coinName || "")
            .trim()
            .toLowerCase();
        if (nameKey) {
            var exact = list.find(function (item) {
                return (
                    String(item && item.name ? item.name : "")
                        .trim()
                        .toLowerCase() === nameKey
                );
            });
            if (exact) return exact;

            var compactNameKey = nameKey.replace(/[^a-z0-9]+/g, "");
            if (compactNameKey) {
                var fuzzy = list.filter(function (item) {
                    var itemName = String(item && item.name ? item.name : "")
                        .trim()
                        .toLowerCase();
                    var compactItemName = itemName.replace(/[^a-z0-9]+/g, "");
                    return (
                        itemName.indexOf(nameKey) === 0 ||
                        compactItemName.indexOf(compactNameKey) === 0
                    );
                });
                if (fuzzy.length === 1) return fuzzy[0];
            }
        }

        return list.length === 1 ? list[0] : null;
    },
};

var SessionScope = {
    id: "",

    readCookie: function (name) {
        var prefix = String(name || "") + "=";
        var parts = document.cookie ? document.cookie.split(";") : [];
        for (var i = 0; i < parts.length; i += 1) {
            var entry = String(parts[i] || "").trim();
            if (entry.indexOf(prefix) === 0) {
                return decodeURIComponent(entry.substring(prefix.length));
            }
        }
        return "";
    },

    generateId: function () {
        return (
            "s" +
            Date.now().toString(36) +
            Math.random().toString(36).slice(2, 10)
        );
    },

    ensure: function () {
        var cookieName = CONFIG.MARKET_SESSION_COOKIE_NAME;
        var current = SessionScope.readCookie(cookieName);
        if (!current) {
            current = SessionScope.generateId();
            document.cookie =
                cookieName +
                "=" +
                encodeURIComponent(current) +
                "; path=/; SameSite=Lax";
        }
        SessionScope.id = current;
        return current;
    },
};

var MarketCache = {
    buildSignature: function (symbols, vsCurrencies) {
        var symbolsKey = (Array.isArray(symbols) ? symbols : [])
            .map(function (s) {
                return Utils.sanitizeSymbol(s || "");
            })
            .filter(function (s) {
                return !!s;
            })
            .sort()
            .join(",");

        var currKey = (Array.isArray(vsCurrencies) ? vsCurrencies : [])
            .map(function (c) {
                return String(c || "").toUpperCase();
            })
            .filter(function (c) {
                return !!c;
            })
            .sort()
            .join(",");

        return currKey + "|" + symbolsKey;
    },

    readPayload: function () {
        try {
            var raw = window.localStorage.getItem(
                CONFIG.MARKET_CACHE_STORAGE_KEY,
            );
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
            return null;
        }
    },

    clear: function () {
        try {
            window.localStorage.removeItem(CONFIG.MARKET_CACHE_STORAGE_KEY);
        } catch {
            // ignore storage errors
        }
    },

    init: function () {
        var sid = SessionScope.ensure();
        var payload = MarketCache.readPayload();
        if (!payload) return;

        if (String(payload.sessionId || "") !== sid) {
            MarketCache.clear();
        }
    },

    get: function (symbols, vsCurrencies) {
        if (!SessionScope.id) SessionScope.ensure();

        var payload = MarketCache.readPayload();
        if (!payload) return null;
        if (String(payload.sessionId || "") !== SessionScope.id) return null;

        var sign = MarketCache.buildSignature(symbols, vsCurrencies);
        if (String(payload.signature || "") !== sign) return null;
        if (!Array.isArray(payload.marketData)) return null;

        return {
            marketData: payload.marketData,
            savedAt: Number(payload.savedAt || 0),
        };
    },

    set: function (symbols, vsCurrencies, marketData) {
        if (!SessionScope.id) SessionScope.ensure();
        var payload = {
            sessionId: SessionScope.id,
            signature: MarketCache.buildSignature(symbols, vsCurrencies),
            savedAt: Date.now(),
            marketData: Array.isArray(marketData) ? marketData : [],
        };

        try {
            window.localStorage.setItem(
                CONFIG.MARKET_CACHE_STORAGE_KEY,
                JSON.stringify(payload),
            );
        } catch {
            // ignore storage errors
        }
    },
};

var Storage = {
    save: function (options) {
        var opts = options && typeof options === "object" ? options : {};
        ServerSync.savePortfolios();
        if (opts.refreshMarket === false) return;
        Market.scheduleRefresh(200);
    },

    load: function () {
        portfolios.forEach(function (p) {
            if (!p || !Array.isArray(p.transactions)) return;
            p.transactions.forEach(function (t) {
                if (!t || typeof t !== "object") return;
                t.catalogId = Market.resolveCatalogId(
                    t.catalogId,
                    t.symbol,
                    t.coin,
                );
            });
        });

        var hasActive = portfolios.some(function (p) {
            return p.id === state.activePortfolioId;
        });
        if (!hasActive && portfolios.length) {
            state.activePortfolioId = portfolios[0].id;
        }
    },
};

var Market = {
    refreshTimer: null,
    refreshInProgress: false,
    fileCacheSavedAt: 0,
    detailsCache: {},

    clearDetailsCache: function () {
        Market.detailsCache = {};
    },

    setStatus: function (text, color) {
        var el = document.getElementById("market-status");
        if (!el) return;
        el.textContent = text;
        el.style.color = color ? color : "";
    },

    setDbStatus: function (name) {
        var el = document.getElementById("db-status");
        if (!el) return;
        el.textContent = "Database file: " + name + ".json";
    },

    setEncStatus: function (encrypted) {
        var iconEl = document.getElementById("enc-lock-icon");
        var labelEl = document.getElementById("enc-label");
        if (iconEl) iconEl.innerHTML = encrypted ? "&#128274;" : "&#128275;";
        if (labelEl) {
            labelEl.textContent = encrypted ? "Encrypted" : "Not encrypted";
            labelEl.style.color = encrypted ? "#e67e22" : "";
        }
        // Encrypt — active only when NOT encrypted
        var encItem = document.getElementById("menu-encrypt-database");
        if (encItem) encItem.classList.toggle("dropdown-item-disabled", !!encrypted);
        // Decrypt and Change password — active only when encrypted
        var decItem = document.getElementById("menu-decrypt-database");
        if (decItem) decItem.classList.toggle("dropdown-item-disabled", !encrypted);
        var chpwItem = document.getElementById("menu-change-password");
        if (chpwItem) chpwItem.classList.toggle("dropdown-item-disabled", !encrypted);
    },

    getActiveCurrency: function () {
        var p = Portfolio.getActive ? Portfolio.getActive() : null;
        return p && p.currency ? String(p.currency).toUpperCase() : "USD";
    },

    getNeededVsCurrencies: function () {
        var configured = Utils.getSupportedCurrencies().map(function (c) {
            return String(c || "").toUpperCase();
        });

        var fromPortfolios = portfolios
            .filter(function (p) {
                return p && p.currency;
            })
            .map(function (p) {
                return String(p.currency || "").toUpperCase();
            });

        var uniq = Utils.uniqueList(fromPortfolios);
        var filtered = uniq.filter(function (c) {
            return configured.indexOf(c) !== -1;
        });

        return filtered.length ? filtered : ["USD"];
    },

    getTrackedCoins: function () {
        var out = [];
        var seen = {};
        portfolios.forEach(function (p) {
            (p.transactions || []).forEach(function (t) {
                var sym = Utils.sanitizeSymbol(t && t.symbol ? t.symbol : "");
                if (!sym) return;
                var catalogId = Utils.sanitizeCatalogId(
                    t && t.catalogId ? t.catalogId : "",
                );
                var key = catalogId ? "id:" + catalogId : "sym:" + sym;
                if (seen[key]) return;
                seen[key] = true;
                out.push({
                    symbol: sym,
                    catalogId: catalogId,
                    coin: String(t && t.coin ? t.coin : ""),
                });
            });
        });
        return out;
    },

    getTrackedSymbols: function (trackedCoins) {
        return Utils.uniqueList(
            (Array.isArray(trackedCoins)
                ? trackedCoins
                : Market.getTrackedCoins()
            )
                .map(function (x) {
                    return x.symbol;
                })
                .filter(function (x) {
                    return !!x;
                }),
        );
    },

    getCatalogCoin: function (catalogId, symbol, coinName) {
        return CoinCatalog.findBest(catalogId, symbol, coinName);
    },

    resolveCatalogId: function (catalogId, symbol, coinName) {
        var item = CoinCatalog.findBest(catalogId, symbol, coinName);
        return item && item.id ? String(item.id) : "";
    },

    setStateMarketData: function (marketData) {
        var nextList = [];
        var nextMap = {};

        (Array.isArray(marketData) ? marketData : []).forEach(function (coin) {
            var sym = Utils.sanitizeSymbol(
                coin && coin.symbol ? coin.symbol : "",
            );
            if (!sym) return;

            var item = Object.assign({}, coin, { symbol: sym });
            nextList.push(item);
            nextMap[sym] = item;
        });

        Market.clearDetailsCache();
        state.marketData = nextList;
        state.marketDataBySymbol = nextMap;
    },

    getMarketCoin: function (symbol) {
        var sym = Utils.sanitizeSymbol(symbol || "");
        return sym && state.marketDataBySymbol[sym]
            ? state.marketDataBySymbol[sym]
            : null;
    },

    hasCoinCurrencyData: function (coin, currency) {
        if (!coin) return false;
        var curr = String(currency || "USD").toUpperCase();
        if (
            coin.prices &&
            Object.prototype.hasOwnProperty.call(coin.prices, curr) &&
            Number.isFinite(Number(coin.prices[curr]))
        ) {
            return true;
        }
        if (curr === "USD" && Number.isFinite(Number(coin.price))) {
            return true;
        }
        return false;
    },

    getCoinFromSessionCache: function (symbol) {
        var sym = Utils.sanitizeSymbol(symbol || "");
        if (!sym) return null;
        if (!SessionScope.id) SessionScope.ensure();

        var payload = MarketCache.readPayload();
        if (!payload) return null;
        if (String(payload.sessionId || "") !== SessionScope.id) return null;
        if (!Array.isArray(payload.marketData)) return null;

        return (
            payload.marketData.find(function (item) {
                return (
                    Utils.sanitizeSymbol(
                        item && item.symbol ? item.symbol : "",
                    ) === sym
                );
            }) || null
        );
    },

    upsertCoinInState: function (coin) {
        if (!coin || !coin.symbol) return;
        var sym = Utils.sanitizeSymbol(coin.symbol);
        if (!sym) return;

        var next = Object.assign({}, coin, { symbol: sym });
        Market.clearDetailsCache();
        state.marketDataBySymbol[sym] = next;
        var idx = state.marketData.findIndex(function (item) {
            return item && item.symbol === sym;
        });

        if (idx === -1) {
            state.marketData.push(next);
        } else {
            state.marketData[idx] = next;
        }
    },

    buildCoinFromRow: function (symbol, currency, row, baseCoin, catalogCoin) {
        var sym = Utils.sanitizeSymbol(symbol || "");
        var curr = String(currency || "USD").toUpperCase();
        var currentBase = baseCoin || {};
        var baseCatalogId = Utils.sanitizeCatalogId(
            currentBase.catalogId || "",
        );
        var catalog =
            catalogCoin ||
            Market.getCatalogCoin(baseCatalogId, sym, currentBase.name || "");

        var out = {
            name:
                currentBase.name ||
                (catalog && catalog.name ? catalog.name : sym),
            symbol: sym,
            catalogId:
                baseCatalogId ||
                (catalog && catalog.id ? String(catalog.id) : ""),
            price: Number.isFinite(Number(currentBase.price))
                ? Number(currentBase.price)
                : 0,
            prices:
                currentBase.prices && typeof currentBase.prices === "object"
                    ? Object.assign({}, currentBase.prices)
                    : {},
            change24h: Number.isFinite(Number(currentBase.change24h))
                ? Number(currentBase.change24h)
                : 0,
            changes24h:
                currentBase.changes24h &&
                typeof currentBase.changes24h === "object"
                    ? Object.assign({}, currentBase.changes24h)
                    : {},
            image:
                catalog && catalog.image
                    ? catalog.image
                    : baseCatalogId && currentBase.image
                      ? currentBase.image
                      : null,
        };

        if (row && row.name) out.name = String(row.name);

        if (row && Number.isFinite(Number(row.current_price))) {
            out.prices[curr] = Number(row.current_price);
        } else if (!Object.prototype.hasOwnProperty.call(out.prices, curr)) {
            out.prices[curr] = 0;
        }

        var ch24 = Number(row && row.price_change_percentage_24h_in_currency);
        if (!Number.isFinite(ch24)) {
            ch24 = Number(row && row.price_change_percentage_24h);
        }
        if (Number.isFinite(ch24)) {
            out.changes24h[curr] = ch24;
        } else if (
            !Object.prototype.hasOwnProperty.call(out.changes24h, curr)
        ) {
            out.changes24h[curr] = 0;
        }

        out.price = Market.getEntryPrice(out, "USD");
        out.change24h = Market.getEntryChange24h(out, "USD");
        return out;
    },

    persistStateToCache: function () {
        var trackedCoins = Market.getTrackedCoins();
        var symbols = Market.getTrackedSymbols(trackedCoins);
        var vsCurrencies = Market.getNeededVsCurrencies();
        if (!symbols.length) {
            MarketCache.clear();
            return;
        }
        MarketCache.set(symbols, vsCurrencies, state.marketData);
    },

    getEntryPrice: function (coin, currency) {
        if (!coin) return 0;
        var curr = String(currency || "USD").toUpperCase();

        if (coin.prices && Number.isFinite(Number(coin.prices[curr]))) {
            return Number(coin.prices[curr]);
        }
        if (Number.isFinite(Number(coin.price))) {
            return Number(coin.price);
        }
        return 0;
    },

    getEntryChange24h: function (coin, currency) {
        if (!coin) return 0;
        var curr = String(currency || "USD").toUpperCase();

        if (coin.changes24h && Number.isFinite(Number(coin.changes24h[curr]))) {
            return Number(coin.changes24h[curr]);
        }
        if (Number.isFinite(Number(coin.change24h))) {
            return Number(coin.change24h);
        }
        return 0;
    },

    getDetailsKey: function (coinRef, currency) {
        var ref = coinRef && typeof coinRef === "object" ? coinRef : {};
        var symbol =
            coinRef && typeof coinRef === "object"
                ? Utils.sanitizeSymbol(ref.symbol || "")
                : Utils.sanitizeSymbol(coinRef || "");
        var catalogId = Utils.sanitizeCatalogId(ref.catalogId || "");
        var coinName = String(ref.coin || ref.name || "")
            .trim()
            .toLowerCase();
        return (
            String(currency || "USD").toUpperCase() +
            "|" +
            catalogId +
            "|" +
            symbol +
            "|" +
            coinName
        );
    },

    getDetails: function (coinRef, currency) {
        var curr = String(currency || Market.getActiveCurrency()).toUpperCase();
        var cacheKey = Market.getDetailsKey(coinRef, curr);
        if (
            cacheKey &&
            Object.prototype.hasOwnProperty.call(Market.detailsCache, cacheKey)
        ) {
            return Market.detailsCache[cacheKey];
        }
        var symbol =
            coinRef && typeof coinRef === "object" ? coinRef.symbol : coinRef;
        var catalogId =
            coinRef && typeof coinRef === "object" ? coinRef.catalogId : "";
        var coinName =
            coinRef && typeof coinRef === "object"
                ? coinRef.coin || coinRef.name || ""
                : "";
        var coin = Market.getMarketCoin(symbol);
        var catalog = Market.getCatalogCoin(catalogId, symbol, coinName);
        var details = {
            price: coin ? Market.getEntryPrice(coin, curr) : 0,
            change24hPct: coin ? Market.getEntryChange24h(coin, curr) : 0,
            image:
                catalog && catalog.image
                    ? catalog.image
                    : coin && coin.image
                      ? coin.image
                      : null,
        };
        if (cacheKey) Market.detailsCache[cacheKey] = details;
        return details;
    },

    splitToChunks: function (items, size) {
        var out = [];
        for (var i = 0; i < items.length; i += size) {
            out.push(items.slice(i, i + size));
        }
        return out;
    },

    fetchMarketsChunk: function (symbols, currency) {
        if (!symbols.length) return window.Promise.resolve([]);
        var symbolsParam = symbols
            .map(function (s) {
                return String(s || "").toLowerCase();
            })
            .join(",");
        var url =
            CONFIG.API_MARKETS_URL +
            "?vs_currency=" +
            encodeURIComponent(String(currency || "USD").toLowerCase()) +
            "&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h&symbols=" +
            encodeURIComponent(symbolsParam);

        return window.fetch(url).then(function (response) {
            if (!response.ok) throw new Error("API Error: " + response.status);
            return response.json();
        });
    },

    fetchSingleIfMissing: function (symbol, currency, catalogId, coinName) {
        var sym = Utils.sanitizeSymbol(symbol || "");
        var curr = String(currency || "USD").toUpperCase();
        if (!sym) return window.Promise.resolve(false);
        var catalog = Market.getCatalogCoin(catalogId, sym, coinName || "");

        var inState = Market.getMarketCoin(sym);
        if (Market.hasCoinCurrencyData(inState, curr)) {
            return window.Promise.resolve(false);
        }

        var inCache = Market.getCoinFromSessionCache(sym);
        if (Market.hasCoinCurrencyData(inCache, curr)) {
            Market.upsertCoinInState(inCache);
            Market.persistStateToCache();
            renderApp();
            Market.setStatus(
                "Market data: " + sym + " loaded from cache.",
                "#aaa",
            );
            return window.Promise.resolve(false);
        }

        Market.setStatus("Market data: loading " + sym + "...", "#888");
        return Market.fetchMarketsChunk([sym], curr)
            .then(function (rows) {
                var matched = (rows || []).find(function (row) {
                    return (
                        Utils.sanitizeSymbol(
                            row && row.symbol ? row.symbol : "",
                        ) === sym
                    );
                });

                var base = inState || inCache || null;
                var coin = Market.buildCoinFromRow(
                    sym,
                    curr,
                    matched || null,
                    base,
                    catalog,
                );
                Market.upsertCoinInState(coin);
                Market.persistStateToCache();
                renderApp();
                Market.setStatus(
                    "Market data: loaded " +
                        sym +
                        " (" +
                        new Date().toLocaleString() +
                        ")",
                    "#aaa",
                );
                return true;
            })
            .catch(function (e) {
                console.error("Single market fetch failed:", sym, e);
                Market.setStatus(
                    "Market data: API error for " + sym + ".",
                    "#D32F2F",
                );
                return false;
            });
    },

    fetchData: function () {
        var trackedCoins = Market.getTrackedCoins();
        var symbols = Market.getTrackedSymbols(trackedCoins);
        var vsCurrencies = Market.getNeededVsCurrencies();
        var trackedBySymbol = {};

        trackedCoins.forEach(function (item) {
            if (!item || !item.symbol) return;
            if (!trackedBySymbol[item.symbol])
                trackedBySymbol[item.symbol] = item;
        });

        if (!symbols.length) {
            Market.setStateMarketData([]);
            MarketCache.clear();
            Market.setStatus("Market data: no symbols in portfolios.", "#888");
            renderApp();
            return window.Promise.resolve();
        }

        var cached = MarketCache.get(symbols, vsCurrencies);
        if (cached) {
            Market.setStateMarketData(cached.marketData);
            Market.setStatus(
                "Market data: loaded " + cached.marketData.length +
                    " symbols from session cache (" +
                    new Date(cached.savedAt || Date.now()).toLocaleString() +
                    ")",
                "#aaa",
            );
            renderApp();
            return window.Promise.resolve();
        }

        if (Market.refreshInProgress) return window.Promise.resolve();
        Market.refreshInProgress = true;
        Market.setStatus("Market data: loading...", "#888");

        var chunks = Market.splitToChunks(symbols, 200);
        var allRequests = [];
        vsCurrencies.forEach(function (currency) {
            chunks.forEach(function (chunk) {
                allRequests.push(
                    Market.fetchMarketsChunk(chunk, currency)
                        .then(function (rows) {
                            return {
                                currency: currency,
                                rows: Array.isArray(rows) ? rows : [],
                            };
                        })
                        .catch(function (e) {
                            console.error("Market chunk failed:", currency, e);
                            return { currency: currency, rows: [] };
                        }),
                );
            });
        });

        return window.Promise.all(allRequests)
            .then(function (responses) {
                var totalApiRows = 0;
                responses.forEach(function (res) {
                    totalApiRows += (res.rows || []).length;
                });

                if (totalApiRows === 0 && state.marketData.length > 0) {
                    var ts = Market.fileCacheSavedAt
                        ? new Date(Market.fileCacheSavedAt).toLocaleString()
                        : "date unknown";
                    Market.setStatus(
                        "Market data: loaded " + state.marketData.length +
                        " symbols from file (" + ts + ")",
                        "#aaa",
                    );
                    renderApp();
                    return;
                }

                if (totalApiRows === 0) {
                    Market.setStatus("Market data: API unavailable, no cached data.", "#D32F2F");
                    return;
                }

                var map = {};
                symbols.forEach(function (sym) {
                    var tracked = trackedBySymbol[sym] || {
                        symbol: sym,
                        catalogId: "",
                        coin: "",
                    };
                    var catalog = Market.getCatalogCoin(
                        tracked.catalogId,
                        tracked.symbol,
                        tracked.coin,
                    );
                    map[sym] = {
                        name: catalog && catalog.name ? catalog.name : sym,
                        symbol: sym,
                        catalogId:
                            catalog && catalog.id ? String(catalog.id) : "",
                        price: 0,
                        prices: {},
                        change24h: 0,
                        changes24h: {},
                        image: catalog && catalog.image ? catalog.image : null,
                    };
                });

                responses.forEach(function (res) {
                    var curr = String(res.currency || "USD").toUpperCase();
                    (res.rows || []).forEach(function (row) {
                        var sym = Utils.sanitizeSymbol(
                            row && row.symbol ? row.symbol : "",
                        );
                        if (!sym || !map[sym]) return;
                        if (row && row.name) map[sym].name = String(row.name);
                        if (Number.isFinite(Number(row && row.current_price))) {
                            map[sym].prices[curr] = Number(row.current_price);
                        } else if (map[sym].prices[curr] === undefined) {
                            map[sym].prices[curr] = 0;
                        }

                        var ch24 = Number(
                            row && row.price_change_percentage_24h_in_currency,
                        );
                        if (!Number.isFinite(ch24)) {
                            ch24 = Number(
                                row && row.price_change_percentage_24h,
                            );
                        }
                        if (Number.isFinite(ch24)) {
                            map[sym].changes24h[curr] = ch24;
                        } else if (map[sym].changes24h[curr] === undefined) {
                            map[sym].changes24h[curr] = 0;
                        }
                    });
                });

                Market.setStateMarketData(
                    symbols.map(function (sym) {
                        var item = map[sym];
                        item.price = Market.getEntryPrice(item, "USD");
                        item.change24h = Market.getEntryChange24h(item, "USD");
                        return item;
                    }),
                );
                MarketCache.set(symbols, vsCurrencies, state.marketData);
                Market.fileCacheSavedAt = Date.now();
                if (AppBridge.isTauri()) {
                    AppBridge.invoke("save_market_cache", {
                        user: ServerSync.user,
                        cache: state.marketData,
                        savedAt: Market.fileCacheSavedAt,
                    }).catch(function () {});
                }

                Market.setStatus(
                    "Market data: loaded " +
                        state.marketData.length +
                        " symbols from API (" +
                        new Date().toLocaleString() +
                        ")",
                    "#aaa",
                );
                renderApp();
            })
            .catch(function (e) {
                console.error(e);
                if (state.marketData.length > 0) {
                    var ts = Market.fileCacheSavedAt
                        ? new Date(Market.fileCacheSavedAt).toLocaleString()
                        : "date unknown";
                    Market.setStatus(
                        "Market data: loaded " + state.marketData.length +
                        " symbols from file (" + ts + ")",
                        "#aaa",
                    );
                    renderApp();
                } else {
                    Market.setStatus("Market data: API error.", "#D32F2F");
                }
            })
            .finally(function () {
                Market.refreshInProgress = false;
            });
    },

    scheduleRefresh: function (delayMs) {
        var wait = Number.isFinite(Number(delayMs)) ? Number(delayMs) : 0;
        if (Market.refreshTimer) {
            window.clearTimeout(Market.refreshTimer);
            Market.refreshTimer = null;
        }
        Market.refreshTimer = window.setTimeout(function () {
            Market.fetchData();
        }, wait);
    },

    getAutoCompleteList: function () {
        return CoinCatalog.list;
    },
};

var Portfolio = {
    getActive: function () {
        return portfolios.find(function (p) {
            return p.id === state.activePortfolioId;
        });
    },

    create: function (name, currency, description) {
        var p = {
            id: Utils.generateId(),
            name: name,
            currency: currency,
            description: (description || "").slice(
                0,
                CONFIG.MAX_DESCRIPTION_LEN,
            ),
            createdAt: new Date().toISOString(),
            transactions: [],
        };
        portfolios.push(p);
        state.activePortfolioId = p.id;
        if (AppBridge.isTauri()) {
            AppBridge.invoke("save_active_portfolio", { user: ServerSync.user, id: p.id }).catch(function () {});
        }
        Storage.save({ refreshMarket: false });
        return p;
    },

    update: function (id, data) {
        var p = portfolios.find(function (x) {
            return x.id === id;
        });
        if (!p) return null;
        var prevCurrency = String(p.currency || "").toUpperCase();
        if (data.name !== undefined) p.name = data.name;
        if (data.currency !== undefined) p.currency = data.currency;
        if (data.description !== undefined)
            p.description = data.description.slice(
                0,
                CONFIG.MAX_DESCRIPTION_LEN,
            );
        Storage.save({
            refreshMarket:
                prevCurrency !== String(p.currency || "").toUpperCase(),
        });
        return p;
    },

    delete: function (id) {
        if (portfolios.length <= 1) return false;
        portfolios = portfolios.filter(function (p) {
            return p.id !== id;
        });
        state.activePortfolioId = portfolios[0].id;
        if (AppBridge.isTauri()) {
            AppBridge.invoke("save_active_portfolio", { user: ServerSync.user, id: portfolios[0].id }).catch(function () {});
        }
        Storage.save();
        return true;
    },

    switch: function (id) {
        state.activePortfolioId = id;
        if (AppBridge.isTauri()) {
            AppBridge.invoke("save_active_portfolio", { user: ServerSync.user, id: id }).catch(function () {});
        }
        renderApp();
    },
};

var Tx = {
    find: function (portfolio, txId) {
        return portfolio && portfolio.transactions
            ? portfolio.transactions.find(function (t) {
                  return t.id === txId;
              })
            : null;
    },

    getCatalogId: function (tx) {
        return Utils.sanitizeCatalogId(tx && tx.catalogId ? tx.catalogId : "");
    },

    getGroupKey: function (tx) {
        var catalogId = Tx.getCatalogId(tx);
        if (catalogId) return "id:" + catalogId;

        var sym = Utils.sanitizeSymbol(tx && tx.symbol ? tx.symbol : "");
        var coin = String(tx && tx.coin ? tx.coin : "")
            .trim()
            .toUpperCase();
        if (sym) return coin ? "sym:" + sym + "|name:" + coin : "sym:" + sym;

        return coin ? "name:" + coin : "";
    },

    matchBySymbolAndCatalog: function (tx, symbol, catalogId) {
        var sym = Utils.sanitizeSymbol(symbol || "");
        var txSym = Utils.sanitizeSymbol(tx && tx.symbol ? tx.symbol : "");
        if (!sym || txSym !== sym) return false;

        var requestedId = Utils.sanitizeCatalogId(catalogId);
        if (!requestedId) return true;
        return Tx.getCatalogId(tx) === requestedId;
    },

    normalize: function (tx) {
        if (tx.amount !== undefined)
            tx.amount = Utils.normalizeAmount(tx.amount);
        if (tx.buyPrice !== undefined)
            tx.buyPrice = Utils.normalizePrice(tx.buyPrice);
        if (tx.sellPrice !== undefined)
            tx.sellPrice = Utils.normalizePrice(tx.sellPrice);
        if (tx.catalogId !== undefined)
            tx.catalogId = Utils.sanitizeCatalogId(tx.catalogId);
        if (Object.is(tx.amount, -0)) tx.amount = 0;
        return tx;
    },

    add: function (portfolioId, data) {
        var p = portfolios.find(function (x) {
            return x.id === portfolioId;
        });
        if (!p) return null;
        var tx = Object.assign(
            { id: Utils.generateId(), type: "buy", status: "current" },
            data,
        );
        Tx.normalize(tx);
        p.transactions.push(tx);
        Storage.save();
        return tx;
    },

    update: function (portfolioId, txId, data) {
        var p = portfolios.find(function (x) {
            return x.id === portfolioId;
        });
        var tx =
            p && p.transactions
                ? p.transactions.find(function (t) {
                      return t.id === txId;
                  })
                : null;
        if (!tx) return null;
        Object.assign(tx, data);
        Tx.normalize(tx);
        Storage.save();
        return tx;
    },

    delete: function (portfolioId, txId) {
        var p = portfolios.find(function (x) {
            return x.id === portfolioId;
        });
        if (!p) return false;
        p.transactions = p.transactions.filter(function (t) {
            return t.id !== txId;
        });
        Storage.save();
        return true;
    },

    sell: function (portfolioId, txId, sellData) {
        var p = portfolios.find(function (x) {
            return x.id === portfolioId;
        });
        var tx =
            p && p.transactions
                ? p.transactions.find(function (t) {
                      return t.id === txId;
                  })
                : null;
        if (!tx) return null;

        var sellAmount = Utils.normalizeAmount(sellData.sellAmount);
        var sellPrice = Utils.normalizePrice(sellData.sellPrice);
        var currentAmount = Utils.normalizeAmount(tx.amount);

        if (sellAmount > currentAmount) return null;

        var soldTx = {
            id: Utils.generateId(),
            type: "sell",
            coin: tx.coin,
            symbol: tx.symbol,
            catalogId: tx.catalogId || "",
            amount: sellAmount,
            buyPrice: tx.buyPrice,
            sellPrice: sellPrice,
            date: sellData.sellDate,
            note: sellData.sellNote,
            status: "sold",
        };
        Tx.normalize(soldTx);
        p.transactions.push(soldTx);

        if (sellAmount === currentAmount) {
            p.transactions = p.transactions.filter(function (t) {
                return t.id !== txId;
            });
        } else {
            tx.amount = Utils.normalizeAmount(currentAmount - sellAmount);
            if (Math.abs(tx.amount) < Math.pow(10, -CONFIG.AMOUNT_DECIMALS))
                tx.amount = 0;
            Tx.normalize(tx);
        }

        Storage.save();
        return true;
    },

    sellBulk: function (
        portfolioId,
        symbol,
        catalogId,
        sellAmount,
        sellPrice,
        sellDate,
        sellNote,
    ) {
        var p = portfolios.find(function (x) {
            return x.id === portfolioId;
        });
        if (!p) return { ok: false, reason: "Portfolio not found" };

        var amountNeed = Utils.normalizeAmount(sellAmount);
        if (!Number.isFinite(amountNeed) || amountNeed <= 0)
            return { ok: false, reason: "Invalid amount" };

        var price = Utils.normalizePrice(sellPrice);
        if (!Number.isFinite(price) || price < 0)
            return { ok: false, reason: "Invalid price" };

        var all = p.transactions.filter(function (t) {
            return (
                t.status === "current" &&
                Tx.matchBySymbolAndCatalog(t, symbol, catalogId)
            );
        });

        all.sort(function (a, b) {
            var ta = Date.parse(a.date || "") || 0;
            var tb = Date.parse(b.date || "") || 0;
            return ta - tb;
        });

        var totalAvail = all.reduce(function (s, t) {
            return s + Utils.normalizeAmount(t.amount);
        }, 0);
        totalAvail = Utils.normalizeAmount(totalAvail);

        if (amountNeed > totalAvail)
            return { ok: false, reason: "Not enough holdings" };

        var parts = [];
        var left = amountNeed;

        for (var i = 0; i < all.length; i++) {
            if (left <= 0) break;

            var tx = all[i];
            var txAmt = Utils.normalizeAmount(tx.amount);
            if (txAmt <= 0) continue;

            var take = txAmt >= left ? left : txAmt;
            take = Utils.normalizeAmount(take);

            var soldTx = {
                id: Utils.generateId(),
                type: "sell",
                coin: tx.coin,
                symbol: tx.symbol,
                catalogId: tx.catalogId || "",
                amount: take,
                buyPrice: tx.buyPrice,
                sellPrice: price,
                date: sellDate,
                note: sellNote,
                status: "sold",
            };
            Tx.normalize(soldTx);
            p.transactions.push(soldTx);

            if (take === txAmt) {
                p.transactions = p.transactions.filter(function (t) {
                    return t.id !== tx.id;
                });
            } else {
                tx.amount = Utils.normalizeAmount(txAmt - take);
                Tx.normalize(tx);
            }

            parts.push({ id: tx.id, taken: take, total: txAmt });
            left = Utils.normalizeAmount(left - take);
        }

        Storage.save();
        return {
            ok: true,
            parts: parts,
            soldAmount: amountNeed,
            totalAvail: totalAvail,
        };
    },

    getFiltered: function (portfolio, status) {
        return portfolio.transactions.filter(function (t) {
            return t.status === status;
        });
    },

    calcMetrics: function (portfolio) {
        var current = Tx.getFiltered(portfolio, "current");
        var sold = Tx.getFiltered(portfolio, "sold");
        var curr = portfolio && portfolio.currency ? portfolio.currency : "USD";

        var acqCost = current.reduce(function (s, t) {
            return s + t.amount * t.buyPrice;
        }, 0);
        var realizedCost = sold.reduce(function (s, t) {
            return s + t.amount * t.buyPrice;
        }, 0);
        var realized = sold.reduce(function (s, t) {
            return s + (t.sellPrice - t.buyPrice) * t.amount;
        }, 0);
        var realizedPct =
            realizedCost > 0 ? (realized / realizedCost) * 100 : 0;
        var marketStats = current.reduce(
            function (s, t) {
                var det = Market.getDetails(t, curr);
                var livePrice = det.price > 0 ? det.price : t.buyPrice;
                var change24hPct = Number.isFinite(Number(det.change24hPct))
                    ? Number(det.change24hPct)
                    : 0;
                var factor = 1 + change24hPct / 100;
                var price24hAgo = factor > 0 ? livePrice / factor : livePrice;
                s.holdings += t.amount * livePrice;
                s.holdings24hAgo += t.amount * price24hAgo;
                return s;
            },
            { holdings: 0, holdings24hAgo: 0 },
        );
        var holdings = marketStats.holdings;
        var holdings24hAgo = marketStats.holdings24hAgo;

        var unrealized = holdings - acqCost;
        var unrealizedPct = acqCost > 0 ? (unrealized / acqCost) * 100 : 0;
        var day24h = holdings - holdings24hAgo;
        var day24hPct =
            holdings24hAgo > 0 ? (day24h / holdings24hAgo) * 100 : 0;

        return {
            acqCost: acqCost,
            realized: realized,
            realizedPct: realizedPct,
            holdings: holdings,
            unrealized: unrealized,
            unrealizedPct: unrealizedPct,
            day24h: day24h,
            day24hPct: day24hPct,
        };
    },

    groupBySymbol: function (transactions, view) {
        var groups = {};
        var curr = Market.getActiveCurrency();
        transactions.forEach(function (t) {
            var det = Market.getDetails(t, curr);
            var livePrice = det.price > 0 ? det.price : t.buyPrice;
            var key = Tx.getGroupKey(t);
            if (!key) return;

            if (!groups[key]) {
                groups[key] = {
                    symbol: t.symbol,
                    coin: t.coin,
                    catalogId: Tx.getCatalogId(t),
                    totalAmount: 0,
                    totalCost: 0,
                    totalValue: 0,
                    marketValue: 0,
                    image: det.image,
                    txCount: 0,
                };
            }

            var g = groups[key];
            g.txCount += 1;
            g.totalAmount += t.amount;
            g.totalCost += t.amount * t.buyPrice;
            g.totalValue +=
                t.amount * (view === "current" ? livePrice : t.sellPrice);
            g.marketValue += t.amount * livePrice;
        });

        return Object.values(groups).map(function (g) {
            g.totalAmount = Utils.normalizeAmount(g.totalAmount);
            g.totalCost = Utils.normalizePrice(g.totalCost);
            g.totalValue = Utils.normalizePrice(g.totalValue);
            g.marketValue = Utils.normalizePrice(g.marketValue);
            return g;
        });
    },
};

var Sorting = {
    compareText: function (a, b) {
        var aa = String(a || "").toLowerCase();
        var bb = String(b || "").toLowerCase();
        return aa < bb ? -1 : aa > bb ? 1 : 0;
    },

    compareNumber: function (a, b) {
        var va = Number.isFinite(Number(a)) ? Number(a) : 0;
        var vb = Number.isFinite(Number(b)) ? Number(b) : 0;
        return va < vb ? -1 : va > vb ? 1 : 0;
    },

    dirMul: function (dir) {
        return dir === "desc" ? -1 : 1;
    },

    sortTxs: function (txs, key, dir) {
        var mul = Sorting.dirMul(dir);
        var curr = Market.getActiveCurrency();
        var isCurrent = state.currentView === "current";
        var arr = txs.map(function (t, index) {
            var ms = Date.parse(t && t.date ? t.date : "");
            var det = Market.getDetails(t, curr);
            var livePrice = det.price > 0 ? det.price : t.buyPrice;
            var cost = t.amount * t.buyPrice;
            var total = t.amount * (isCurrent ? livePrice : t.sellPrice);
            var profit = total - cost;
            return {
                item: t,
                index: index,
                coin: String(t && t.coin ? t.coin : ""),
                ts: Number.isFinite(ms) ? ms : 0,
                price: isCurrent ? t.buyPrice : t.sellPrice,
                currentPrice: livePrice,
                holdings: t.amount,
                profit: profit,
                change: cost > 0 ? (profit / cost) * 100 : 0,
            };
        });

        arr.sort(function (a, b) {
            var cmp = 0;

            if (key === "coinDate") {
                cmp = Sorting.compareText(a.coin, b.coin);
                if (cmp === 0) cmp = Sorting.compareNumber(a.ts, b.ts);
            } else if (key === "price") {
                cmp = Sorting.compareNumber(a.price, b.price);
            } else if (key === "currentPrice") {
                cmp = Sorting.compareNumber(a.currentPrice, b.currentPrice);
            } else if (key === "holdings") {
                cmp = Sorting.compareNumber(a.holdings, b.holdings);
            } else if (key === "profit") {
                cmp = Sorting.compareNumber(a.profit, b.profit);
            } else if (key === "change") {
                cmp = Sorting.compareNumber(a.change, b.change);
            }

            if (cmp !== 0) return cmp * mul;
            return Sorting.compareNumber(a.index, b.index);
        });

        return arr.map(function (entry) {
            return entry.item;
        });
    },

    sortGroups: function (groups, key, dir) {
        var mul = Sorting.dirMul(dir);
        var curr = Market.getActiveCurrency();
        var isCurrent = state.currentView === "current";
        var arr = groups.map(function (g, index) {
            var det = Market.getDetails(g, curr);
            var livePrice =
                det.price > 0
                    ? det.price
                    : g.totalAmount > 0
                      ? g.totalCost / g.totalAmount
                      : 0;
            var price =
                g.totalAmount > 0
                    ? isCurrent
                        ? g.totalCost / g.totalAmount
                        : g.totalValue / g.totalAmount
                    : 0;
            var profit = g.totalValue - g.totalCost;
            return {
                item: g,
                index: index,
                coin: String(g && g.coin ? g.coin : ""),
                price: price,
                currentPrice: livePrice,
                holdings: g.totalAmount,
                profit: profit,
                change: g.totalCost > 0 ? (profit / g.totalCost) * 100 : 0,
            };
        });

        arr.sort(function (a, b) {
            var cmp = 0;

            if (key === "coinDate") {
                cmp = Sorting.compareText(a.coin, b.coin);
            } else if (key === "price") {
                cmp = Sorting.compareNumber(a.price, b.price);
            } else if (key === "currentPrice") {
                cmp = Sorting.compareNumber(a.currentPrice, b.currentPrice);
            } else if (key === "holdings") {
                cmp = Sorting.compareNumber(a.holdings, b.holdings);
            } else if (key === "profit") {
                cmp = Sorting.compareNumber(a.profit, b.profit);
            } else if (key === "change") {
                cmp = Sorting.compareNumber(a.change, b.change);
            }

            if (cmp !== 0) return cmp * mul;
            return Sorting.compareNumber(a.index, b.index);
        });

        return arr.map(function (entry) {
            return entry.item;
        });
    },
};

var UI = {
    openModal: function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.add("open");
    },

    closeModal: function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.remove("open");
    },

    applyModalSize: function (modalId, sizeKey) {
        var modal = document.getElementById(modalId);
        if (!modal) return;

        var content = modal.querySelector(".modal-content");
        if (!content) return;

        var key = sizeKey || "DEFAULT";
        var size =
            CONFIG.MODAL_SIZES && CONFIG.MODAL_SIZES[key]
                ? CONFIG.MODAL_SIZES[key]
                : null;
        if (!size) return;

        if (size.width !== undefined) content.style.width = size.width;
        if (size.height !== undefined) content.style.height = size.height;
        if (size.maxHeight !== undefined)
            content.style.maxHeight = size.maxHeight;

        var body = modal.querySelector(".modal-body");
        if (body && size.maxHeight) {
            body.style.overflowY = "auto";
        }
    },

    fillCurrencySelects: function () {
        var ids = ["create-p-currency", "edit-p-currency"];
        var fiatCurrencies = Object.keys(CONFIG.CURRENCY_SYMBOLS_FIAT);
        var cryptoCurrencies = Object.keys(CONFIG.CURRENCY_SYMBOLS_CRYPTO);
        var allCurrencies = fiatCurrencies.concat(cryptoCurrencies);

        ids.forEach(function (id) {
            var select = document.getElementById(id);
            if (!select) return;

            var prev = String(select.value || "USD").toUpperCase();
            select.innerHTML = "";

            var fiatGroup = document.createElement("optgroup");
            fiatGroup.label = "Fiat Currencies";
            fiatCurrencies.forEach(function (code) {
                var opt = document.createElement("option");
                opt.value = code;
                opt.textContent = code;
                fiatGroup.appendChild(opt);
            });
            select.appendChild(fiatGroup);

            var cryptoGroup = document.createElement("optgroup");
            cryptoGroup.label = "Cryptocurrencies";
            cryptoCurrencies.forEach(function (code) {
                var opt = document.createElement("option");
                opt.value = code;
                opt.textContent = code;
                cryptoGroup.appendChild(opt);
            });
            select.appendChild(cryptoGroup);

            if (allCurrencies.indexOf(prev) !== -1) {
                select.value = prev;
            } else if (allCurrencies.indexOf("USD") !== -1) {
                select.value = "USD";
            }
        });
    },

    updateCounter: function (inputId, counterId, max) {
        if (max === undefined) max = CONFIG.MAX_DESCRIPTION_LEN;
        var input = document.getElementById(inputId);
        var counter = document.getElementById(counterId);
        if (input && counter)
            counter.textContent = input.value.length + "/" + max;
    },

    attachRestriction: function (inputId, sanitizer) {
        var input = document.getElementById(inputId);
        if (!input) return;
        var handler = function () {
            var after = sanitizer(input.value);
            if (input.value !== after) {
                var pos = Math.min(input.selectionStart || 0, after.length);
                input.value = after;
                try {
                    input.setSelectionRange(pos, pos);
                } catch (e) {
                    console.warn(e);
                }
            }
        };
        input.addEventListener("input", handler);
        input.addEventListener("blur", handler);
    },

    initRestrictions: function () {
        UI.attachRestriction("add-coin-name", Utils.sanitizeCoinName);
        UI.attachRestriction("edit-coin-name", Utils.sanitizeCoinName);
        UI.attachRestriction("add-coin-symbol", Utils.sanitizeSymbol);
        UI.attachRestriction("edit-coin-symbol", Utils.sanitizeSymbol);

        ["add-coin-name", "add-coin-symbol"].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener("input", function () {
                state.addCatalogId = "";
            });
        });
        ["edit-coin-name", "edit-coin-symbol"].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener("input", function () {
                state.editCatalogId = "";
            });
        });
    },

    updateSortArrows: function () {
        var btns = document.querySelectorAll(".th-sort-btn");
        btns.forEach(function (btn) {
            var key = btn.getAttribute("data-sort-key");
            var arrows = btn.querySelectorAll(".sort-arrow");
            arrows.forEach(function (a) {
                var dir = a.getAttribute("data-sort-dir");
                var isActive = key === state.sortKey && dir === state.sortDir;
                a.classList.toggle("active", isActive);
            });
        });
    },

    initColumnResizing: function () {
        var resizers = document.querySelectorAll("#portfolio-transactions-table .resizer");
        resizers.forEach(function (resizer) {
            resizer.addEventListener("mousedown", function (e) {
                e.preventDefault();
                var th = resizer.parentElement;
                
                // Find the previous visible th
                var prevTh = th.previousElementSibling;
                while (prevTh && window.getComputedStyle(prevTh).display === "none") {
                    prevTh = prevTh.previousElementSibling;
                }
                
                if (!prevTh) return;

                var startX = e.pageX;
                var startWidth = prevTh.getBoundingClientRect().width;
                
                // Calculate how much we can expand to the right before the last column hits its minimum width (80px)
                var thChange = document.getElementById("th-change");
                var availableSlack = thChange ? (thChange.offsetWidth - 80) : 10000;

                function onMouseMove(eMove) {
                    var delta = eMove.pageX - startX;
                    
                    // Limit movement to the right to prevent table overflow and scrollbars
                    if (delta > availableSlack) {
                        delta = availableSlack;
                    }

                    var newWidth = startWidth + delta;
                    if (newWidth > 30) {
                        prevTh.style.width = newWidth + "px";
                    }
                }

                function onMouseUp() {
                    document.removeEventListener("mousemove", onMouseMove);
                    document.removeEventListener("mouseup", onMouseUp);

                    // We need to store widths correctly, accounting for whether Cur. Price is hidden
                    var showCur = AppSettings.get("showCurPrice", false);
                    var thCoin = document.getElementById("th-coin");
                    var thCur = document.getElementById("th-cur-price");

                    var widths = {};
                    var allThs = document.querySelectorAll("#portfolio-transactions-table th");
                    allThs.forEach(function (t) {
                        if (t.id && t.id !== "th-change" && t.offsetWidth > 0) {
                            widths[t.id] = t.offsetWidth;
                        }
                    });

                    // Keep existing saved widths for currently hidden columns
                    var savedObj = AppSettings.get("columnWidths", {});
                    var saved = savedObj.widths || savedObj;
                    Object.keys(widths).forEach(function (k) {
                        saved[k] = widths[k];
                    });

                    // If curPrice is hidden, th-coin's current offsetWidth is its base width plus cur-price width.
                    // To get the correct base width of th-coin, we subtract current base of cur-price.
                    if (!showCur && thCoin && thCur) {
                        var wCurBase = parseInt(saved["th-cur-price"]) || 121;
                        saved["th-coin"] = Math.max(30, (thCoin.offsetWidth || 444) - wCurBase);
                    }

                    AppSettings.set("columnWidths", saved);

                    if (AppBridge.isTauri()) {
                        AppBridge.invoke("save_column_widths", { widths: saved }).catch(function () {});
                    }
                }

                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
            });
        });
    },

    initSortingUI: function () {
        var btns = document.querySelectorAll(".th-sort-btn");
        btns.forEach(function (btn) {
            if (btn.closest && btn.closest("#modal-sell-coins")) return;

            btn.addEventListener("click", function (e) {
                e.preventDefault();
                var key = btn.getAttribute("data-sort-key");
                if (!key) return;

                var defaultDir = Utils.getDefaultSortDir(key);

                if (state.sortKey !== key) {
                    state.sortKey = key;
                    state.sortDir = defaultDir;
                } else {
                    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
                }

                UI.updateSortArrows();
                renderApp();
            });
        });

        UI.updateSortArrows();
    },

    updateBulkSellSortArrows: function () {
        var el = document.getElementById("bulk-th-coindate");
        if (!el) return;
        var arrows = el.querySelectorAll(".sort-arrow");
        Array.from(arrows).forEach(function (a) {
            var dir = a.getAttribute("data-sort-dir");
            var isActive = state.bulkSellSortDir === dir;
            a.classList.toggle("active", isActive);
        });
    },

    initBulkSellSorting: function () {
        var el = document.getElementById("bulk-th-coindate");
        if (!el) return;
        if (el.getAttribute("data-init") === "1") return;
        el.setAttribute("data-init", "1");

        el.addEventListener("click", function (e) {
            e.preventDefault();
            state.bulkSellSortDir =
                state.bulkSellSortDir === "asc" ? "desc" : "asc";

            UI.updateBulkSellSortArrows();
            renderBulkSellTable();
            var amountInput = document.getElementById("bulk-sell-amount");
            var need = Utils.parseNumber(
                amountInput ? amountInput.value : "",
                0,
            );
            var clamped = updateBulkSellChecksByAmount(need);
            if (amountInput && clamped !== need)
                amountInput.value = clamped > 0 ? String(clamped) : "";
        });
    },
};

var TimePicker = {
    options: null,

    buildOptions: function () {
        if (TimePicker.options) return TimePicker.options;

        var items = [];
        for (var h = 0; h < 24; h++) {
            for (var m = 0; m < 60; m += CONFIG.TIME_STEP_MINUTES) {
                items.push(Utils.pad2(h) + ":" + Utils.pad2(m));
            }
        }
        TimePicker.options = items;
        return TimePicker.options;
    },

    init: function (inputId, listId) {
        var input = document.getElementById(inputId);
        var list = document.getElementById(listId);
        if (!input || !list) return;

        var options = TimePicker.buildOptions();
        var render = function (filter) {
            var q = (filter || "").trim();
            list.innerHTML = "";
            var filtered = q
                ? options.filter(function (t) {
                      return t.indexOf(q) === 0;
                  })
                : options;
            filtered.slice(0, 96).forEach(function (t) {
                var li = document.createElement("li");
                li.textContent = t;
                li.onclick = function () {
                    input.value = t;
                    list.classList.remove("active");
                };
                list.appendChild(li);
            });
            list.classList.add("active");
        };

        input.addEventListener("focus", function () {
            render(input.value);
        });
        input.addEventListener("input", function () {
            render(input.value);
        });
        input.addEventListener("keydown", function (e) {
            if (e.key === "Escape") list.classList.remove("active");
        });
    },

    initAll: function () {
        TimePicker.init("add-coin-time", "time-suggestions-add");
        TimePicker.init("edit-coin-time", "time-suggestions-edit");
        TimePicker.init("sell-coin-time", "time-suggestions-sell");
        TimePicker.init("bulk-sell-time", "time-suggestions-bulk-sell");
    },
};

var Autocomplete = {
    handleSearch: function (inputId, listId) {
        var input = document.getElementById(inputId);
        var list = document.getElementById(listId);
        var query = (input && input.value ? input.value : "").toLowerCase();
        var source = Market.getAutoCompleteList();
        if (!list) return;
        list.innerHTML = "";

        if (query.length < 1 || !source.length) {
            list.classList.remove("active");
            return;
        }

        var matches = [];
        var i;
        for (i = 0; i < source.length; i += 1) {
            var item = source[i];
            if (
                item.nameLower.indexOf(query) === 0 ||
                item.symbolLower.indexOf(query) === 0
            ) {
                matches.push(item);
                if (matches.length >= CONFIG.MAX_SUGGESTIONS) break;
            }
        }

        if (matches.length) {
            list.classList.add("active");
            var fragment = document.createDocumentFragment();
            matches.forEach(function (coin) {
                var li = document.createElement("li");
                li.className = "suggestion-item";
                var imgHtml = coin.image
                    ? '<img src="' +
                      Utils.escapeAttr(coin.image) +
                      '" class="s-img">'
                    : '<span class="s-img">' +
                      Utils.escapeHtml(
                          coin.symbol && coin.symbol[0] ? coin.symbol[0] : "?",
                      ) +
                      "</span>";
                li.innerHTML =
                    imgHtml +
                    '<span class="s-name">' +
                    Utils.escapeHtml(coin.name) +
                    '</span><span class="s-symbol">' +
                    Utils.escapeHtml(coin.symbol) +
                    "</span>";
                li.onclick = function () {
                    Autocomplete.select(coin, inputId, listId);
                };
                fragment.appendChild(li);
            });
            list.appendChild(fragment);
        } else {
            list.classList.remove("active");
        }
    },

    handleSearchBySymbol: function (inputId, listId) {
        var input = document.getElementById(inputId);
        var list = document.getElementById(listId);
        var query = (input && input.value ? input.value : "").toLowerCase();
        var source = Market.getAutoCompleteList();
        if (!list) return;
        list.innerHTML = "";

        if (query.length < 1 || !source.length) {
            list.classList.remove("active");
            return;
        }

        var matches = [];
        var i;
        for (i = 0; i < source.length; i += 1) {
            var item = source[i];
            if (item.symbolLower.indexOf(query) === 0) {
                matches.push(item);
                if (matches.length >= CONFIG.MAX_SUGGESTIONS) break;
            }
        }

        if (matches.length) {
            list.classList.add("active");
            var fragment = document.createDocumentFragment();
            matches.forEach(function (coin) {
                var li = document.createElement("li");
                li.className = "suggestion-item";
                var imgHtml = coin.image
                    ? '<img src="' + Utils.escapeAttr(coin.image) + '" class="s-img">'
                    : '<span class="s-img">' + Utils.escapeHtml(coin.symbol && coin.symbol[0] ? coin.symbol[0] : "?") + "</span>";
                li.innerHTML =
                    imgHtml +
                    '<span class="s-name">' + Utils.escapeHtml(coin.name) + '</span><span class="s-symbol">' + Utils.escapeHtml(coin.symbol) + "</span>";
                li.onclick = function () {
                    Autocomplete.select(coin, inputId, listId);
                };
                fragment.appendChild(li);
            });
            list.appendChild(fragment);
        } else {
            list.classList.remove("active");
        }
    },

    select: function (coin, inputId, listId) {
        var isEdit = inputId === "edit-coin-name";
        var prefix = isEdit ? "edit" : "add";
        var selectedCatalogId = Utils.sanitizeCatalogId(
            coin && coin.id ? coin.id : "",
        );
        var p = Portfolio.getActive();
        var curr = p && p.currency ? p.currency : "USD";
        document.getElementById(prefix + "-coin-name").value =
            Utils.sanitizeCoinName(coin.name);
        document.getElementById(prefix + "-coin-symbol").value =
            Utils.sanitizeSymbol(coin.symbol);
        if (isEdit) {
            state.editCatalogId = selectedCatalogId;
        } else {
            state.addCatalogId = selectedCatalogId;
        }
        var priceInput = document.getElementById(prefix + "-coin-price");
        var marketCoin = Market.getMarketCoin(coin.symbol);
        if (priceInput && !priceInput.value)
            priceInput.value = Utils.normalizePrice(
                Market.getEntryPrice(marketCoin || coin, curr),
            );
        var lst = document.getElementById(listId);
        if (lst) lst.classList.remove("active");
    },
};

function updateBulkSellSellAllText() {
    var el = document.getElementById("bulk-sell-sell-all");
    if (!el) return;
    var total = state.bulkSellTotalSum || 0;
    var txt = "(sell all: " + Utils.formatAmount(total) + ")";
    el.textContent = txt;
    el.style.display = total > 0 ? "inline-block" : "none";

    el.onclick = function () {
        var input = document.getElementById("bulk-sell-amount");
        if (!input) return;
        var normalized = String(Utils.normalizeAmount(total));
        input.value = normalized;
        updateBulkSellChecksByAmount(Utils.parseNumber(normalized, 0));
        try {
            input.focus();
        } catch (e) {
            console.warn(e);
        }
    };
}

function openBulkSellModal(symbol, catalogId) {
    var p = Portfolio.getActive();
    if (!p) return;

    var normalizedCatalogId = Utils.sanitizeCatalogId(catalogId);
    var txs = p.transactions
        .filter(function (t) {
            return (
                t.status === "current" &&
                Tx.matchBySymbolAndCatalog(t, symbol, normalizedCatalogId)
            );
        })
        .slice(0);

    txs.sort(function (a, b) {
        var ta = Date.parse(a.date || "") || 0;
        var tb = Date.parse(b.date || "") || 0;
        return ta - tb;
    });

    state.bulkSellSymbol = String(symbol || "").toUpperCase();
    state.bulkSellCatalogId = normalizedCatalogId;
    state.bulkSellTxs = txs;
    state.bulkSellTotalSum = Utils.normalizeAmount(
        txs.reduce(function (s, t) {
            return s + Utils.normalizeAmount(t.amount);
        }, 0),
    );
    state.bulkSellSelectedSum = 0;

    var now = new Date();
    document.getElementById("bulk-sell-date").valueAsDate = now;
    document.getElementById("bulk-sell-time").value = now
        .toTimeString()
        .substring(0, 5);
    document.getElementById("bulk-sell-note").value = "";
    document.getElementById("bulk-sell-price").value = "";
    var amountInput = document.getElementById("bulk-sell-amount");
    if (amountInput) {
        amountInput.value = "";
        amountInput.min = "0";
        amountInput.max = String(state.bulkSellTotalSum);
    }

    renderBulkSellTable();
    updateBulkSellChecksByAmount(0);
    updateBulkSellSellAllText();

    UI.applyModalSize("modal-sell-coins", "SELL");

    UI.initBulkSellSorting();
    UI.updateBulkSellSortArrows();

    UI.openModal("modal-sell-coins");
}

function renderBulkSellTable() {
    var p = Portfolio.getActive();
    var curr = p ? p.currency : "USD";

    var tbody = document.getElementById("bulk-sell-tbody");
    var tpl = Templates.bulkSellRow;
    if (!tbody || !tpl) return;

    tbody.innerHTML = "";

    var list = state.bulkSellTxs.slice(0);
    list.sort(function (a, b) {
        var ta = Date.parse(a.date || "") || 0;
        var tb = Date.parse(b.date || "") || 0;
        return ta - tb;
    });
    if (state.bulkSellSortDir === "desc") {
        list.reverse();
    }

    var fragment = document.createDocumentFragment();
    list.forEach(function (t) {
        var det = Market.getDetails(t, curr);
        var live = det.price > 0 ? det.price : t.buyPrice;

        var row = tpl.cloneNode(true);
        row.style.display = "";
        row.id = "";

        var firstChar = t.coin && t.coin.length > 0 ? t.coin[0] : "?";
        var iconHtml = det.image
            ? '<img src="' +
              Utils.escapeAttr(det.image) +
              '" alt="' +
              Utils.escapeAttr(t.symbol) +
              '" style="width:100%;height:100%;object-fit:cover;">'
            : Utils.escapeHtml(firstChar);

        var dtStr =
            t.date && t.date.indexOf("T") !== -1
                ? new Date(t.date).toLocaleString()
                : t.date || "";

        var tokens = {
            "[[ICON]]": iconHtml,
            "[[COINNAME]]": Utils.escapeHtml(t.coin + " (" + t.symbol + ")"),
            "[[DATE]]": Utils.escapeHtml(dtStr),
            "[[BUY_PRICE]]": Utils.formatMoney(t.buyPrice, curr),
            "[[TOTAL_BUY_PRICE]]":
                "Total: " + Utils.formatMoney(t.amount * t.buyPrice, curr),
            "[[AMOUNT]]": Utils.escapeHtml(
                Utils.formatAmount(t.amount) + " " + t.symbol,
            ),
            "[[LAST_PRICE]]":
                "Last Price: " + Utils.formatMoney(t.amount * live, curr),
        };

        Utils.fillTokens(row, tokens);

        var ch = row.querySelector(".bs-check");
        if (ch) {
            ch.checked = false;
            ch.disabled = false;
            ch.addEventListener("change", function () {
                updateBulkSellByCheckbox(row, ch.checked);
            });
        }

        row.setAttribute("data-txid", String(t.id));
        row.setAttribute(
            "data-amount",
            String(Utils.normalizeAmount(t.amount)),
        );

        fragment.appendChild(row);
    });
    tbody.appendChild(fragment);
}

function getBulkSellRows() {
    var tbody = document.getElementById("bulk-sell-tbody");
    if (!tbody) return [];
    return Array.from(tbody.querySelectorAll("tr")).filter(function (tr) {
        return tr.id !== "template-bulk-sell-row";
    });
}

function updateBulkSellCounter() {
    var counter = document.getElementById("bulk-sell-counter");
    if (!counter) return;
    counter.textContent =
        Utils.formatAmount(state.bulkSellSelectedSum) +
        "/" +
        Utils.formatAmount(state.bulkSellTotalSum);
}

function clampBulkSellAmount(inputAmount) {
    var need = Utils.normalizeAmount(inputAmount);
    if (!Number.isFinite(need) || need < 0) need = 0;

    var total = Utils.normalizeAmount(state.bulkSellTotalSum || 0);
    if (need > total) need = total;
    return need;
}

function updateBulkSellByCheckbox(row, isChecked) {
    var rows = getBulkSellRows();
    var idx = rows.indexOf(row);
    if (idx < 0) return;

    var sum = 0;
    rows.forEach(function (tr, i) {
        var ch = tr.querySelector(".bs-check");
        if (!ch) return;

        var shouldCheck = isChecked ? i <= idx : i < idx;
        ch.checked = shouldCheck;

        if (shouldCheck) {
            var amt = Utils.normalizeAmount(
                Utils.parseNumber(tr.getAttribute("data-amount"), 0),
            );
            sum = Utils.normalizeAmount(sum + amt);
        }
    });

    state.bulkSellSelectedSum = Utils.normalizeAmount(sum);
    updateBulkSellCounter();

    var input = document.getElementById("bulk-sell-amount");
    if (input) input.value = sum > 0 ? String(state.bulkSellSelectedSum) : "";
}

function updateBulkSellChecksByAmount(inputAmount) {
    var need = clampBulkSellAmount(inputAmount);
    var rows = getBulkSellRows();

    var sum = 0;
    rows.forEach(function (tr) {
        var amt = Utils.normalizeAmount(
            Utils.parseNumber(tr.getAttribute("data-amount"), 0),
        );
        var checked = false;

        if (need > 0 && sum < need) {
            checked = true;
            sum = Utils.normalizeAmount(sum + amt);
        }

        var ch = tr.querySelector(".bs-check");
        if (ch) ch.checked = checked;
    });

    state.bulkSellSelectedSum = Utils.normalizeAmount(sum);
    updateBulkSellCounter();
    return need;
}

function handleBulkSell() {
    var p = Portfolio.getActive();
    if (!p) return;

    var amount = Utils.parseNumber(
        document.getElementById("bulk-sell-amount").value,
        NaN,
    );
    var price = Utils.parseNumber(
        document.getElementById("bulk-sell-price").value,
        NaN,
    );

    if (!Number.isFinite(amount) || amount <= 0)
        return window.alert("Please enter Sell Amount");
    if (!Number.isFinite(price) || price < 0)
        return window.alert("Please enter Sell Price");

    var dateVal = document.getElementById("bulk-sell-date").value;
    if (!dateVal) return window.alert("Please enter Sell Date");

    var sellDate = Utils.mergeDateTime(
        dateVal,
        document.getElementById("bulk-sell-time").value,
    );
    var note = document.getElementById("bulk-sell-note").value;

    var res = Tx.sellBulk(
        state.activePortfolioId,
        state.bulkSellSymbol,
        state.bulkSellCatalogId,
        amount,
        price,
        sellDate,
        note,
    );
    if (!res.ok) {
        if (res.reason === "Not enough holdings")
            return window.alert("You cannot sell more than you hold.");
        return window.alert("Sell failed: " + res.reason);
    }

    UI.closeModal("modal-sell-coins");
    renderApp();
}

function handleCreatePortfolio() {
    var name = document.getElementById("create-p-name").value;
    if (!name) return window.alert("Please enter a name");
    Portfolio.create(
        name,
        document.getElementById("create-p-currency").value,
        document.getElementById("create-p-desc").value,
    );
    document.getElementById("create-p-name").value = "";
    document.getElementById("create-p-desc").value = "";
    UI.updateCounter("create-p-desc", "create-p-desc-counter");
    renderApp();
    UI.closeModal("modal-create-portfolio");
}

function openCreatePortfolioModal(useDefaults) {
    var withDefaults = useDefaults === true;
    var nameInput = document.getElementById("create-p-name");
    var descInput = document.getElementById("create-p-desc");
    var currencyInput = document.getElementById("create-p-currency");

    if (nameInput) {
        nameInput.value = withDefaults ? "BTC/USD" : "";
    }
    if (descInput) {
        descInput.value = withDefaults ? "My first portfolio" : "";
    }
    if (currencyInput) {
        currencyInput.value = "USD";
    }
    UI.updateCounter("create-p-desc", "create-p-desc-counter");
    UI.applyModalSize("modal-create-portfolio", "DEFAULT");
    UI.openModal("modal-create-portfolio");
}

function openEditPortfolioModal() {
    var p = Portfolio.getActive();
    if (!p) return;
    document.getElementById("edit-p-name").value = p.name;
    document.getElementById("edit-p-desc").value = p.description || "";
    document.getElementById("edit-p-currency").value = p.currency;
    UI.updateCounter("edit-p-desc", "edit-p-desc-counter");

    UI.applyModalSize("modal-edit-portfolio", "DEFAULT");
    UI.openModal("modal-edit-portfolio");
}

function handleUpdatePortfolio() {
    Portfolio.update(state.activePortfolioId, {
        name: document.getElementById("edit-p-name").value,
        description: document.getElementById("edit-p-desc").value,
        currency: document.getElementById("edit-p-currency").value,
    });
    renderApp();
    UI.closeModal("modal-edit-portfolio");
}

function handleDeletePortfolio() {
    if (portfolios.length <= 1)
        return window.alert("Cannot delete the last portfolio.");
    if (!window.confirm("Delete this portfolio?")) return;
    Portfolio.delete(state.activePortfolioId);
    renderApp();
    UI.closeModal("modal-edit-portfolio");
}

function openAddCoinModal() {
    var p = Portfolio.getActive();
    var now = new Date();
    state.addCatalogId = "";
    document.getElementById("add-coin-currency").value = p ? p.currency : "USD";
    document.getElementById("add-coin-date").valueAsDate = now;
    document.getElementById("add-coin-time").value = now
        .toTimeString()
        .substring(0, 5);
    [
        "add-coin-name",
        "add-coin-symbol",
        "add-coin-price",
        "add-coin-amount",
        "add-coin-note",
        "add-coin-wallet",
    ].forEach(function (id) {
        document.getElementById(id).value = "";
    });

    UI.applyModalSize("modal-add-coin", "DEFAULT");
    UI.openModal("modal-add-coin");
}

function handleAddCoin() {
    var name = Utils.sanitizeCoinName(
        document.getElementById("add-coin-name").value,
    );
    var symbol = Utils.sanitizeSymbol(
        document.getElementById("add-coin-symbol").value,
    );
    var price = Utils.normalizePrice(
        Utils.parseNumber(document.getElementById("add-coin-price").value, NaN),
    );
    var amount = Utils.normalizeAmount(
        Utils.parseNumber(
            document.getElementById("add-coin-amount").value,
            NaN,
        ),
    );
    var dateVal = document.getElementById("add-coin-date").value;

    var missing = [];
    if (!name) missing.push("Coin Name");
    if (!symbol) missing.push("Symbol");
    if (!Number.isFinite(price)) missing.push("Buy Price");
    if (!Number.isFinite(amount)) missing.push("Amount");
    if (!dateVal) missing.push("Date");
    if (missing.length)
        return window.alert("Please fill in: " + missing.join(", "));

    var catalogId = Market.resolveCatalogId(state.addCatalogId, symbol, name);
    Tx.add(state.activePortfolioId, {
        coin: name,
        symbol: symbol,
        catalogId: catalogId,
        amount: amount,
        buyPrice: price,
        date: Utils.mergeDateTime(
            dateVal,
            document.getElementById("add-coin-time").value,
        ),
        note: document.getElementById("add-coin-note").value,
        wallet: document.getElementById("add-coin-wallet").value,
    });

    if (Market.refreshTimer) {
        window.clearTimeout(Market.refreshTimer);
        Market.refreshTimer = null;
    }

    var activePortfolio = Portfolio.getActive();
    var activeCurrency =
        activePortfolio && activePortfolio.currency
            ? activePortfolio.currency
            : "USD";
    Market.fetchSingleIfMissing(symbol, activeCurrency, catalogId, name);

    renderApp();
    UI.closeModal("modal-add-coin");
}

function switchEditTab(tab) {
    state.activeEditTab = tab;
    var isBuy = tab === "buy";
    document.getElementById("tab-btn-buy").classList.toggle("active", isBuy);
    document.getElementById("tab-btn-sell").classList.toggle("active", !isBuy);
    document
        .getElementById("edit-section-buy")
        .classList.toggle("hidden", !isBuy);
    document
        .getElementById("edit-section-sell")
        .classList.toggle("hidden", isBuy);
    document.getElementById("btn-edit-action").textContent = isBuy
        ? "UPDATE"
        : "SELL";
}

function openEditCoinModal(id) {
    var p = Portfolio.getActive();
    var tx = Tx.find(p, id);
    if (!tx) return;

    state.currentEditingId = id;
    state.editCatalogId = Utils.sanitizeCatalogId(tx.catalogId || "");
    var dt = Utils.splitDateTime(tx.date);

    document.getElementById("edit-coin-currency").value = p.currency;
    document.getElementById("edit-coin-name").value = Utils.sanitizeCoinName(
        tx.coin,
    );
    document.getElementById("edit-coin-symbol").value = Utils.sanitizeSymbol(
        tx.symbol,
    );
    document.getElementById("edit-coin-price").value = Utils.normalizePrice(
        tx.buyPrice,
    );
    document.getElementById("edit-coin-amount").value = Utils.normalizeAmount(
        tx.amount,
    );
    document.getElementById("edit-coin-date").value = dt.date;
    document.getElementById("edit-coin-time").value = dt.time;
    document.getElementById("edit-coin-note").value = tx.note || "";
    document.getElementById("edit-coin-wallet").value = tx.wallet || "";

    if (tx.status === "sold") {
        document.getElementById("sell-coin-price").value = Utils.normalizePrice(
            tx.sellPrice,
        );
        document.getElementById("sell-coin-amount").value =
            Utils.normalizeAmount(tx.amount);
        document.getElementById("sell-coin-date").value = dt.date;
        document.getElementById("sell-coin-time").value = dt.time;
        document.getElementById("sell-coin-note").value = tx.note || "";
        switchEditTab("sell");
    } else {
        var now = new Date();
        document.getElementById("sell-coin-price").value = "";
        document.getElementById("sell-coin-amount").value =
            Utils.normalizeAmount(tx.amount);
        document.getElementById("sell-coin-date").valueAsDate = now;
        document.getElementById("sell-coin-time").value = now
            .toTimeString()
            .substring(0, 5);
        document.getElementById("sell-coin-note").value = "";
        switchEditTab("buy");
    }

    UI.applyModalSize("modal-edit-coin", "DEFAULT");
    UI.openModal("modal-edit-coin");
}

function handleEditModalAction() {
    if (state.activeEditTab === "buy") {
        handleUpdateTransaction();
    } else {
        handleSellTransaction();
    }
}

function handleUpdateTransaction() {
    var symbol = Utils.sanitizeSymbol(
        document.getElementById("edit-coin-symbol").value,
    );
    var coin = Utils.sanitizeCoinName(
        document.getElementById("edit-coin-name").value,
    );
    if (!symbol) return window.alert("Symbol cannot be empty");
    if (!coin) return window.alert("Coin Name cannot be empty");
    var catalogId = Market.resolveCatalogId(state.editCatalogId, symbol, coin);

    Tx.update(state.activePortfolioId, state.currentEditingId, {
        symbol: symbol,
        coin: coin,
        catalogId: catalogId,
        buyPrice: Utils.normalizePrice(
            Utils.parseNumber(document.getElementById("edit-coin-price").value),
        ),
        amount: Utils.normalizeAmount(
            Utils.parseNumber(
                document.getElementById("edit-coin-amount").value,
            ),
        ),
        date: Utils.mergeDateTime(
            document.getElementById("edit-coin-date").value,
            document.getElementById("edit-coin-time").value,
        ),
        note: document.getElementById("edit-coin-note").value,
        wallet: document.getElementById("edit-coin-wallet").value,
    });

    renderApp();
    UI.closeModal("modal-edit-coin");
}

function handleSellTransaction() {
    var tx = Tx.find(Portfolio.getActive(), state.currentEditingId);
    if (!tx) return;

    var sellPriceRaw = Utils.parseNumber(
        document.getElementById("sell-coin-price").value,
        NaN,
    );
    var sellAmountRaw = Utils.parseNumber(
        document.getElementById("sell-coin-amount").value,
        NaN,
    );

    if (!Number.isFinite(sellPriceRaw) || !Number.isFinite(sellAmountRaw)) {
        return window.alert("Please enter valid Sell Price and Amount");
    }

    var sellPrice = Utils.normalizePrice(sellPriceRaw);
    var sellAmount = Utils.normalizeAmount(sellAmountRaw);

    if (tx.status === "sold") {
        Tx.update(state.activePortfolioId, state.currentEditingId, {
            sellPrice: sellPrice,
            amount: sellAmount,
            date: Utils.mergeDateTime(
                document.getElementById("sell-coin-date").value,
                document.getElementById("sell-coin-time").value,
            ),
            note: document.getElementById("sell-coin-note").value,
        });
    } else {
        var result = Tx.sell(state.activePortfolioId, state.currentEditingId, {
            sellPrice: sellPrice,
            sellAmount: sellAmount,
            sellDate: Utils.mergeDateTime(
                document.getElementById("sell-coin-date").value,
                document.getElementById("sell-coin-time").value,
            ),
            sellNote: document.getElementById("sell-coin-note").value,
        });
        if (!result) return window.alert("You cannot sell more than you hold.");
    }

    renderApp();
    UI.closeModal("modal-edit-coin");
}

function handleDeleteTransaction() {
    if (!window.confirm("Delete this transaction?")) return;
    Tx.delete(state.activePortfolioId, state.currentEditingId);
    renderApp();
    UI.closeModal("modal-edit-coin");
}

function openClearDatabaseModal() {
    window.closeAllDropdowns();
    UI.applyModalSize("modal-clear-database", "DEFAULT");
    UI.openModal("modal-clear-database");
}

function handleClearDatabase() {
    ServerSync.clearDatabase()
        .then(function () {
            window.location.reload();
        })
        .catch(function (e) {
            console.error("Clear DB failed:", e);
            window.alert("Cannot clear the local portfolio file.");
        });
}

function switchView(view) {
    state.currentView = view;
    document.getElementById("tab-current").className =
        "view-tab " + (view === "current" ? "active" : "");
    document.getElementById("tab-sold").className =
        "view-tab " + (view === "sold" ? "active" : "");
    renderApp();
}

function toggleCollapse() {
    state.isCollapsed = !state.isCollapsed;
    var collapseLabel = state.isCollapsed ? "EXPAND" : "COLLAPSE";
    document.getElementById("btn-collapse").textContent = collapseLabel;
    var footerBtn = document.getElementById("btn-collapse-footer");
    if (footerBtn) footerBtn.textContent = collapseLabel;
    if (AppBridge.isTauri()) {
        AppBridge.invoke("save_is_collapsed", { collapsed: state.isCollapsed }).catch(function () {});
    }
    renderApp();
}

function switchPortfolio(id) {
    Portfolio.switch(id);
}

// Reorder the global `portfolios` array to match the saved ID order.
// Portfolios not present in `order` are appended at the end (e.g. newly created ones).
function applyPortfolioOrder(order) {
    if (!Array.isArray(order) || !order.length) return;
    var indexMap = {};
    order.forEach(function (id, i) { indexMap[String(id)] = i; });
    portfolios.sort(function (a, b) {
        var ia = indexMap[String(a.id)];
        var ib = indexMap[String(b.id)];
        if (ia === undefined && ib === undefined) return 0;
        if (ia === undefined) return 1;
        if (ib === undefined) return -1;
        return ia - ib;
    });
}

var PortfolioTabsDnD = {
    holdDelayMs: 180,
    moveThresholdPx: 8,
    holdTimer: null,
    holdReady: false,
    dragging: false,
    startX: 0,
    startY: 0,
    pressedPortfolioId: null,
    pressedEl: null,
    rowEl: null,

    reset: function () {
        if (PortfolioTabsDnD.holdTimer) {
            window.clearTimeout(PortfolioTabsDnD.holdTimer);
            PortfolioTabsDnD.holdTimer = null;
        }
        if (PortfolioTabsDnD.pressedEl) {
            PortfolioTabsDnD.pressedEl.classList.remove("p-tab-dragging");
        }
        document.body.classList.remove("tabs-drag-active");
        document.removeEventListener("mousemove", PortfolioTabsDnD.onMouseMove);
        document.removeEventListener("mouseup", PortfolioTabsDnD.onMouseUp);

        PortfolioTabsDnD.holdReady = false;
        PortfolioTabsDnD.dragging = false;
        PortfolioTabsDnD.startX = 0;
        PortfolioTabsDnD.startY = 0;
        PortfolioTabsDnD.pressedPortfolioId = null;
        PortfolioTabsDnD.pressedEl = null;
        PortfolioTabsDnD.rowEl = null;
    },

    onTabMouseDown: function (e, portfolioId, rowEl) {
        if (!e || e.button !== 0) return;

        PortfolioTabsDnD.reset();

        PortfolioTabsDnD.startX = e.clientX;
        PortfolioTabsDnD.startY = e.clientY;
        PortfolioTabsDnD.pressedPortfolioId = portfolioId;
        PortfolioTabsDnD.pressedEl = e.currentTarget;
        PortfolioTabsDnD.rowEl = rowEl;
        PortfolioTabsDnD.holdTimer = window.setTimeout(function () {
            PortfolioTabsDnD.holdReady = true;
        }, PortfolioTabsDnD.holdDelayMs);

        document.addEventListener("mousemove", PortfolioTabsDnD.onMouseMove);
        document.addEventListener("mouseup", PortfolioTabsDnD.onMouseUp);
    },

    onMouseMove: function (e) {
        if (!PortfolioTabsDnD.pressedEl) return;

        var dx = e.clientX - PortfolioTabsDnD.startX;
        var dy = e.clientY - PortfolioTabsDnD.startY;
        var movedEnough =
            Math.abs(dx) >= PortfolioTabsDnD.moveThresholdPx ||
            Math.abs(dy) >= PortfolioTabsDnD.moveThresholdPx;

        if (!PortfolioTabsDnD.dragging) {
            if (!PortfolioTabsDnD.holdReady || !movedEnough) return;
            PortfolioTabsDnD.dragging = true;
            PortfolioTabsDnD.pressedEl.classList.add("p-tab-dragging");
            document.body.classList.add("tabs-drag-active");
        }
    },

    onMouseUp: function (e) {
        if (!PortfolioTabsDnD.pressedEl) {
            PortfolioTabsDnD.reset();
            return;
        }

        var draggedId = PortfolioTabsDnD.pressedPortfolioId;
        var row = PortfolioTabsDnD.rowEl;

        if (!PortfolioTabsDnD.dragging) {
            switchPortfolio(draggedId);
            PortfolioTabsDnD.reset();
            return;
        }

        var tabs = Array.from(
            row.querySelectorAll(".p-tab[data-portfolio-id]"),
        );
        var dropX = e.clientX;
        var toIndex = 0;

        tabs.forEach(function (tab, i) {
            var rect = tab.getBoundingClientRect();
            var centerX = rect.left + rect.width / 2;
            if (dropX > centerX) toIndex = i + 1;
        });

        var fromIndex = portfolios.findIndex(function (p) {
            return p.id === draggedId;
        });

        if (fromIndex !== -1) {
            if (fromIndex < toIndex) toIndex -= 1;
            if (toIndex < 0) toIndex = 0;
            if (toIndex > portfolios.length - 1)
                toIndex = portfolios.length - 1;
        }

        if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
            var moved = portfolios.splice(fromIndex, 1)[0];
            portfolios.splice(toIndex, 0, moved);
            if (AppBridge.isTauri()) {
                AppBridge.invoke("save_portfolio_order", {
                    user: ServerSync.user,
                    order: portfolios.map(function (p) { return p.id; }),
                }).catch(function () {});
            }
            renderApp();
        }

        PortfolioTabsDnD.reset();
    },
};

function renderApp() {
    Market.clearDetailsCache();
    var p = Portfolio.getActive();
    if (!p && portfolios.length) {
        state.activePortfolioId = portfolios[0].id;
        p = Portfolio.getActive();
    }
    var renderPortfolio = p || {
        __isFallback: true,
        currency: Market.getActiveCurrency(),
        createdAt: "",
        description: "",
        transactions: [],
    };
    renderTabs();
    renderMeta(renderPortfolio);
    renderMetrics(renderPortfolio);
    renderTable(renderPortfolio);
    UI.updateSortArrows();

    var collapseLabel = state.isCollapsed ? "EXPAND" : "COLLAPSE";
    var btnC = document.getElementById("btn-collapse");
    if (btnC) btnC.textContent = collapseLabel;
    var btnCF = document.getElementById("btn-collapse-footer");
    if (btnCF) btnCF.textContent = collapseLabel;
}

function renderTabs() {
    var row = document.getElementById("portfolioTabsRow");
    var tpl = Templates.portfolioTab;
    if (!row || !tpl) return;

    row.innerHTML = "";

    var fragment = document.createDocumentFragment();
    portfolios.forEach(function (p) {
        var clone = tpl.cloneNode(true);
        clone.style.display = "";
        clone.id = "";
        var dateStr = p.createdAt
            ? new Date(p.createdAt).toLocaleString()
            : "Unknown";

        Utils.fillTokens(clone, {
            "[[PORTFOLIO_NAME]]": Utils.escapeHtml(p.name),
        });

        clone.title = "Created: " + dateStr;
        clone.setAttribute("data-portfolio-id", String(p.id));
        clone.className =
            "p-tab" + (p.id === state.activePortfolioId ? " active" : "");
        clone.onmousedown = function (e) {
            PortfolioTabsDnD.onTabMouseDown(e, p.id, row);
        };
        fragment.appendChild(clone);
    });
    row.appendChild(fragment);
}

function renderMeta(p) {
    var created = document.getElementById("portfolio-created-text");
    var desc = document.getElementById("portfolio-description-text");
    var isFallback = !p || p.__isFallback === true;
    var dateStr =
        p && p.createdAt ? new Date(p.createdAt).toLocaleString() : "";
    var descStr = p && p.description ? String(p.description).trim() : "";

    if (!dateStr && !isFallback) dateStr = "Unknown";
    if (!descStr && !isFallback) descStr = "Not specified.";

    if (created) {
        created.textContent = dateStr
            ? "Portfolio created: " + dateStr
            : "Portfolio created:";
    }
    if (desc) {
        desc.textContent = descStr ? "Description: " + descStr : "Description:";
    }
}

function renderMetrics(p) {
    var m = Tx.calcMetrics(p);
    var c = p.currency;

    var elAcq = document.getElementById("m-acq-cost");
    if (elAcq) elAcq.textContent = Utils.formatMoney(m.acqCost, c);

    var elHoldings = document.getElementById("m-holdings");
    if (elHoldings) elHoldings.textContent = Utils.formatMoney(m.holdings, c);

    var realEl = document.getElementById("m-realized-pl");
    if (realEl) {
        realEl.textContent = Utils.formatMoney(m.realized, c);
        realEl.className = "metric-value " + Utils.getColorClass(m.realized);
    }

    var realPctEl = document.getElementById("m-realized-pct");
    if (realPctEl) {
        realPctEl.textContent = Utils.formatPercent(m.realizedPct);
        realPctEl.className = Utils.getColorClass(m.realizedPct);
    }

    var unrealEl = document.getElementById("m-unrealized-pl");
    if (unrealEl) {
        unrealEl.textContent = Utils.formatMoney(m.unrealized, c);
        unrealEl.className =
            "metric-value " + Utils.getColorClass(m.unrealized);
    }

    var pctEl = document.getElementById("m-unrealized-pct");
    if (pctEl) {
        pctEl.textContent = Utils.formatPercent(m.unrealizedPct);
        pctEl.className = "metric-sub " + Utils.getColorClass(m.unrealizedPct);
    }

    var dayEl = document.getElementById("m-24h");
    if (dayEl) {
        dayEl.textContent = Utils.formatMoney(m.day24h, c);
        dayEl.className = "metric-value " + Utils.getColorClass(m.day24h);
    }

    var dayPctEl = document.getElementById("m-24h-pct");
    if (dayPctEl) {
        dayPctEl.textContent = Utils.formatPercent(m.day24hPct);
        dayPctEl.className = "metric-sub " + Utils.getColorClass(m.day24hPct);
    }
}

function buildSummaryRowData(txs, curr, view) {
    var uniqueCoins = {};
    var totalCoinNames = 0;
    var totalAmount = 0;
    var totalBuyCost = 0;
    var totalDisplayPriceSum = 0;
    var totalCurrentValue = 0;
    var totalDisplayValue = 0;
    var totalMarketValue = 0;

    txs.forEach(function (t) {
        var catalogKey = Utils.sanitizeCatalogId(t.catalogId || "");
        var symbolKey = Utils.sanitizeSymbol(t.symbol || "");
        var coinKey = String(t.coin || "")
            .trim()
            .toUpperCase();
        var uniqueKey = catalogKey ? "id:" + catalogKey : symbolKey || coinKey;
        if (uniqueKey && !uniqueCoins[uniqueKey]) {
            uniqueCoins[uniqueKey] = true;
            totalCoinNames += 1;
        }

        var amount = Number.isFinite(Number(t.amount)) ? Number(t.amount) : 0;
        var buyPrice = Number.isFinite(Number(t.buyPrice))
            ? Number(t.buyPrice)
            : 0;
        var sellPrice =
            Number.isFinite(Number(t.sellPrice)) && Number(t.sellPrice) > 0
                ? Number(t.sellPrice)
                : 0;
        var det = Market.getDetails(t, curr);
        var livePrice = det.price > 0 ? det.price : buyPrice;
        var dispPrice = view === "current" ? buyPrice : sellPrice;
        var dispValue = amount * (view === "current" ? livePrice : sellPrice);
        var marketValue = amount * livePrice;

        totalAmount += amount;
        totalBuyCost += amount * buyPrice;
        totalDisplayPriceSum += amount * dispPrice;
        totalCurrentValue += amount * livePrice;
        totalDisplayValue += dispValue;
        totalMarketValue += marketValue;
    });

    var avgBuyPrice = totalAmount > 0 ? totalBuyCost / totalAmount : 0;
    var avgDisplayPrice =
        totalAmount > 0 ? totalDisplayPriceSum / totalAmount : 0;
    var avgCurrentPrice = totalAmount > 0 ? totalCurrentValue / totalAmount : 0;
    var profit = totalDisplayValue - totalBuyCost;
    var pct = totalBuyCost > 0 ? (profit / totalBuyCost) * 100 : 0;

    return {
        totalCoinNames: totalCoinNames,
        totalTransactions: txs.length,
        amount: totalAmount,
        totalValue: totalDisplayValue,
        marketValue: totalMarketValue,
        price: view === "current" ? avgBuyPrice : avgDisplayPrice,
        totalBuyCost: totalBuyCost,
        currentPrice: avgCurrentPrice,
        profit: profit,
        pct: pct,
        curr: curr,
        view: view,
    };
}

function buildTotalPriceSubText(view, spentValue, receivedValue, curr) {
    if (view === "sold")
        return "Total Received: " + Utils.formatMoney(receivedValue, curr);
    return "Total Spent: " + Utils.formatMoney(spentValue, curr);
}

function renderTable(p) {
    var curr = p.currency;
    var tbody = document.getElementById("transactions-table-body");
    var tpl = Templates.coinRow;
    var summaryTpl = Templates.summaryRow;
    var empty = Templates.emptyRow;
    if (!tbody || !tpl || !empty) return;

    tbody.innerHTML = "";

    var txsRaw = Tx.getFiltered(p, state.currentView);

    var headerPriceLabel = document.getElementById("col-header-price-label");
    var priceText = state.isCollapsed
        ? "Avg Price"
        : state.currentView === "sold"
          ? "Sell Price"
          : "Buy Price";
    if (headerPriceLabel) headerPriceLabel.textContent = priceText;

    var fragment = document.createDocumentFragment();
    if (!txsRaw.length) {
        var er = empty.cloneNode(true);
        er.id = "";
        er.style.display = "";
        fragment.appendChild(er);
        tbody.appendChild(fragment);
        return;
    }

    if (state.isCollapsed) {
        var groupsRaw = Tx.groupBySymbol(txsRaw, state.currentView);
        var groups = Sorting.sortGroups(
            groupsRaw,
            state.sortKey,
            state.sortDir,
        );

        groups.forEach(function (g) {
            var det = Market.getDetails(g, curr);
            var live =
                det.price > 0
                    ? det.price
                    : g.totalAmount > 0
                      ? g.totalCost / g.totalAmount
                      : 0;
            var profit = g.totalValue - g.totalCost;
            var pct = g.totalCost > 0 ? (profit / g.totalCost) * 100 : 0;

            fragment.appendChild(
                createRow(tpl, {
                    icon: det.image,
                    coin: g.coin,
                    symbol: g.symbol,
                    catalogId: g.catalogId || "",
                    dateText: "Transactions: " + g.txCount,
                    price:
                        g.totalAmount > 0
                            ? state.currentView === "current"
                                ? g.totalCost / g.totalAmount
                                : g.totalValue / g.totalAmount
                            : 0,
                    priceSub: buildTotalPriceSubText(
                        state.currentView,
                        g.totalCost,
                        g.totalValue,
                        curr,
                    ),
                    currentPrice: live,
                    amount: g.totalAmount,
                    totalValue: g.marketValue,
                    totalSpent: g.totalCost,
                    profit: profit,
                    pct: pct,
                    curr: curr,
                    view: state.currentView,
                    isCollapsed: true,
                }),
            );
        });
    } else {
        var txs = Sorting.sortTxs(txsRaw, state.sortKey, state.sortDir);

        txs.forEach(function (t) {
            var det = Market.getDetails(t, curr);
            var live = det.price > 0 ? det.price : t.buyPrice;
            var isCurrent = state.currentView === "current";
            var dispPrice = isCurrent ? t.buyPrice : t.sellPrice;
            var dispTotal = t.amount * (isCurrent ? live : t.sellPrice);
            var marketTotal = t.amount * live;
            var cost = t.amount * t.buyPrice;
            var profit = dispTotal - cost;
            var pct = cost > 0 ? (profit / cost) * 100 : 0;
            var dateStr = "";
            if (t.date && t.date.indexOf("T") !== -1) {
                var _d = new Date(t.date);
                dateStr = _d.toLocaleString([], {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                });
            } else {
                dateStr = t.date || "";
            }
            var _note = t.note ? String(t.note).trim() : "";
            var _dateWithNote = dateStr + (_note ? " • " + _note : "");

            fragment.appendChild(
                createRow(tpl, {
                    icon: det.image,
                    coin: t.coin,
                    symbol: t.symbol,
                    dateText: _dateWithNote,
                    price: dispPrice,
                    priceSub: buildTotalPriceSubText(
                        state.currentView,
                        cost,
                        dispTotal,
                        curr,
                    ),
                    currentPrice: live,
                    amount: t.amount,
                    totalValue: marketTotal,
                    totalSpent: cost,
                    profit: profit,
                    pct: pct,
                    curr: curr,
                    view: state.currentView,
                    isCollapsed: false,
                    txId: t.id,
                }),
            );
        });
    }

    if (summaryTpl) {
        fragment.appendChild(
            createSummaryRow(
                summaryTpl,
                buildSummaryRowData(txsRaw, curr, state.currentView),
            ),
        );
    }
    tbody.appendChild(fragment);
}

function createSummaryRow(summaryTpl, d) {
    var row = summaryTpl.cloneNode(true);
    row.style.display = "";
    row.id = "";

    var tokens = {
        "[[TOTAL_COINS]]": String(d.totalCoinNames),
        "[[TOTAL_TRN]]": String(d.totalTransactions),
        "[[TOTAL_AMOUNT]]": (function (val) {
            var s = (Number.isFinite(val) ? Number(val) : 0).toLocaleString(
                "en-US",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                },
            );
            if (CONFIG.DECIMAL_SEPARATOR === ",") s = s.replace(".", ",");
            return s;
        })(d.amount),
        "[[A_MARKET_PRICE]]":
            d.view === "sold"
                ? "Total Spent: " + Utils.formatMoney(d.totalBuyCost, d.curr)
                : "Market Price: " + Utils.formatMoney(d.marketValue, d.curr),
        "[[AVG_PRICE]]": Utils.formatMoney(d.price, d.curr),
        "[[A_TOTAL_PRICE]]": buildTotalPriceSubText(
            d.view,
            d.totalBuyCost,
            d.totalValue,
            d.curr,
        ),
        "[[A_CUR_PRICE]]": Utils.formatMoney(d.currentPrice, d.curr),
        "[[A_PROFIT]]": Utils.formatMoney(d.profit, d.curr),
        "[[A_CHANGE_%]]": Utils.formatPercent(d.pct),
    };

    Utils.fillTokens(row, tokens);

    var elProfit = row.querySelector(".s-profit");
    if (elProfit)
        elProfit.className =
            "text-bold s-profit " + Utils.getColorClass(d.profit);

    var elChange = row.querySelector(".s-change");
    if (elChange)
        elChange.className = "text-bold s-change " + Utils.getColorClass(d.pct);

    return row;
}

function createRow(tpl, d) {
    var row = tpl.cloneNode(true);
    row.style.display = "";
    row.id = "";

    var firstChar = d.coin && d.coin.length > 0 ? d.coin[0] : "?";
    var iconHtml = d.icon
        ? '<img src="' +
          Utils.escapeAttr(d.icon) +
          '" alt="' +
          Utils.escapeAttr(d.symbol) +
          '" style="width:100%;height:100%;object-fit:cover;">'
        : Utils.escapeHtml(firstChar);

    var tokens = {
        "[[ICON]]": iconHtml,
        "[[COINNAME]]": Utils.escapeHtml(d.coin),
        "[[DATE]]": Utils.escapeHtml(d.dateText),
        "[[NOTE]]": Utils.escapeHtml(d.note || ""),
        "[[AMOUNT]]": Utils.escapeHtml(Utils.formatAmount(d.amount)),
        "[[SYMBOL]]": Utils.escapeHtml(d.symbol || ""),
        "[[MARKET_PRICE]]":
            d.view === "sold"
                ? "Total Spent: " + Utils.formatMoney(d.totalSpent, d.curr)
                : "Market Price: " + Utils.formatMoney(d.totalValue, d.curr),
        "[[PRICE]]": Utils.formatMoney(d.price, d.curr),
        "[[TOTAL_PRICE]]": d.priceSub,
        "[[CUR_PRICE]]": Utils.formatMoney(d.currentPrice, d.curr),
        "[[PROFIT]]": Utils.formatMoney(d.profit, d.curr),
        "[[CHANGE_%]]": Utils.formatPercent(d.pct),
    };

    Utils.fillTokens(row, tokens);

    var btn = row.querySelector(".t-btn-edit");
    if (btn) {
        if (d.isCollapsed) {
            if (state.currentView === "current") {
                btn.textContent = "SELL";
                btn.className = "btn-table-edit t-btn-edit";
                btn.onclick = function () {
                    openBulkSellModal(d.symbol, d.catalogId || "");
                };
            } else {
                btn.textContent = "EXPAND";
                btn.className = "btn-table-edit t-btn-edit";
                btn.onclick = toggleCollapse;
            }
        } else {
            btn.textContent = "EDIT";
            btn.className = "btn-table-edit t-btn-edit";
            btn.onclick = function () {
                openEditCoinModal(d.txId);
            };
        }
    }

    var profitEl = row.querySelector(".t-profit");
    if (profitEl)
        profitEl.className =
            "text-bold t-profit " + Utils.getColorClass(d.profit);

    var changeEl = row.querySelector(".t-change");
    if (changeEl)
        changeEl.className = "text-bold t-change " + Utils.getColorClass(d.pct);

    return row;
}

document.addEventListener("click", function (e) {
    if (!e.target.closest(".form-group")) {
        document
            .querySelectorAll(".suggestions-list, .time-suggestions")
            .forEach(function (el) {
                el.classList.remove("active");
            });
    }
});

document.addEventListener("input", function (e) {
    if (e && e.target && e.target.id === "bulk-sell-amount") {
        var raw = String(e.target.value || "").trim();
        if (raw === "") {
            updateBulkSellChecksByAmount(0);
            return;
        }

        var val = Utils.parseNumber(raw, 0);
        var clamped = updateBulkSellChecksByAmount(val);
        if (clamped !== val)
            e.target.value = clamped > 0 ? String(clamped) : "";
    }
});

window.openModal = UI.openModal;
window.closeModal = UI.closeModal;
window.handleCreatePortfolio = handleCreatePortfolio;
window.openEditPortfolioModal = openEditPortfolioModal;
window.handleUpdatePortfolio = handleUpdatePortfolio;
window.handleDeletePortfolio = handleDeletePortfolio;
window.openAddCoinModal = openAddCoinModal;
window.handleAddCoin = handleAddCoin;
window.openEditCoinModal = openEditCoinModal;
window.handleEditModalAction = handleEditModalAction;
window.handleDeleteTransaction = handleDeleteTransaction;
window.openClearDatabaseModal = openClearDatabaseModal;
window.handleClearDatabase = handleClearDatabase;
window.switchEditTab = switchEditTab;
window.switchView = switchView;
window.toggleCollapse = toggleCollapse;
window.switchPortfolio = switchPortfolio;
window.handleSearch = Autocomplete.handleSearch;
window.handleSearchBySymbol = Autocomplete.handleSearchBySymbol;
window.openBulkSellModal = openBulkSellModal;
window.handleBulkSell = handleBulkSell;
window.openCreatePortfolioModal = openCreatePortfolioModal;

// --- TOP MENU BAR ---
window.toggleDropdown = function (id, event) {
    if (event) event.stopPropagation();
    var el = document.getElementById(id);
    var isShown = el.classList.contains("show");
    window.closeAllDropdowns();
    if (!isShown) {
        el.classList.add("show");
    }
};

window.closeAllDropdowns = function () {
    var dropdowns = document.getElementsByClassName("dropdown-menu");
    for (var i = 0; i < dropdowns.length; i++) {
        var openDropdown = dropdowns[i];
        if (openDropdown.classList.contains("show")) {
            openDropdown.classList.remove("show");
        }
    }
    // Clear keyboard focus highlight
    var focused = document.querySelectorAll(".dropdown-item-focused");
    for (var j = 0; j < focused.length; j++) {
        focused[j].classList.remove("dropdown-item-focused");
    }
};

// Keyboard navigation for top menu dropdowns
document.addEventListener("keydown", function (e) {
    var openMenu = document.querySelector(".dropdown-menu.show");
    if (!openMenu) return;

    var items = Array.prototype.slice.call(
        openMenu.querySelectorAll(".dropdown-item:not(.dropdown-item-disabled)")
    );
    if (!items.length) return;

    var focusedIdx = -1;
    for (var i = 0; i < items.length; i++) {
        if (items[i].classList.contains("dropdown-item-focused")) {
            focusedIdx = i;
            break;
        }
    }

    if (e.key === "ArrowDown") {
        e.preventDefault();
        var next = focusedIdx < items.length - 1 ? focusedIdx + 1 : 0;
        if (focusedIdx >= 0) items[focusedIdx].classList.remove("dropdown-item-focused");
        items[next].classList.add("dropdown-item-focused");
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        var prev = focusedIdx > 0 ? focusedIdx - 1 : items.length - 1;
        if (focusedIdx >= 0) items[focusedIdx].classList.remove("dropdown-item-focused");
        items[prev].classList.add("dropdown-item-focused");
    } else if (e.key === "Enter") {
        if (focusedIdx >= 0) {
            e.preventDefault();
            items[focusedIdx].click();
        }
    } else if (e.key === "Escape") {
        window.closeAllDropdowns();
    }
});

window.onclick = function (event) {
    if (!event.target.closest(".menu-item")) {
        window.closeAllDropdowns();
    }
};

// Prevent clicks inside a dropdown from bubbling up to .menu-item,
// which would cause toggleDropdown() to re-open the just-closed menu.
(function () {
    var menus = document.getElementsByClassName("dropdown-menu");
    for (var i = 0; i < menus.length; i++) {
        menus[i].addEventListener("click", function (e) { e.stopPropagation(); });
    }
}());

window.openAboutModal = function () {
    window.closeAllDropdowns();
    UI.openModal("modal-about");
};

window.handleMenuExit = function () {
    window.closeAllDropdowns();
    if (AppBridge.isTauri()) {
        AppBridge.invoke("exit_app");
    } else {
        window.close();
    }
};

var DbSelector = {
    items: [],
    selectedIndex: 0,
    dbDir: "",

    open: function (files, dbDir) {
        DbSelector.items = files;
        DbSelector.selectedIndex = 0;
        DbSelector.dbDir = dbDir || "";
        DbSelector._renderDir();
        DbSelector._render();
        UI.openModal("modal-open-database");
    },

    _renderDir: function () {
        var el = document.getElementById("db-selector-dir");
        if (el) el.textContent = DbSelector.dbDir;
    },

    _render: function () {
        var list = document.getElementById("db-selector-list");
        if (!list) return;
        list.innerHTML = "";
        if (DbSelector.items.length === 0) {
            var empty = document.createElement("div");
            empty.style.cssText =
                "padding:20px;color:#555;text-align:center;font-size:13px;";
            empty.textContent = "No database files found in this folder.";
            list.appendChild(empty);
            return;
        }
        DbSelector.items.forEach(function (item, i) {
            var div = document.createElement("div");
            div.className =
                "db-list-item" +
                (i === DbSelector.selectedIndex ? " selected" : "");
            div.setAttribute("data-index", String(i));

            var d = new Date(item.modifiedMs);
            var dateStr =
                d.toLocaleDateString("ru-RU") +
                " " +
                d.toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                });

            var lockHtml = item.encrypted
                ? '<span class="db-item-lock" title="Encrypted">&#128274;</span>'
                : "";
            div.innerHTML =
                '<span class="db-item-name">' +
                item.name +
                lockHtml +
                '</span><span class="db-item-coins">' +
                (item.encrypted ? "Encrypted database" : "Total coins in database: " + item.coinCount) +
                '</span><span class="db-item-date">' +
                dateStr +
                "</span>";

            div.onclick = function () {
                DbSelector.selectedIndex = parseInt(
                    this.getAttribute("data-index"),
                    10,
                );
                DbSelector._render();
            };
            div.ondblclick = function () {
                DbSelector.selectedIndex = parseInt(
                    this.getAttribute("data-index"),
                    10,
                );
                DbSelector.load();
            };
            list.appendChild(div);
        });
        DbSelector._scrollSelected();
    },

    _scrollSelected: function () {
        var list = document.getElementById("db-selector-list");
        if (!list) return;
        var items = list.querySelectorAll(".db-list-item");
        if (items[DbSelector.selectedIndex]) {
            items[DbSelector.selectedIndex].scrollIntoView({
                block: "nearest",
            });
        }
    },

    onKey: function (e) {
        var modal = document.getElementById("modal-open-database");
        if (!modal || !modal.classList.contains("open")) return;
        if (e.key === "ArrowUp") {
            if (DbSelector.selectedIndex > 0) {
                DbSelector.selectedIndex--;
                DbSelector._render();
            }
            e.preventDefault();
        } else if (e.key === "ArrowDown") {
            if (DbSelector.selectedIndex < DbSelector.items.length - 1) {
                DbSelector.selectedIndex++;
                DbSelector._render();
            }
            e.preventDefault();
        } else if (e.key === "Enter") {
            DbSelector.load();
        } else if (e.key === "Escape") {
            UI.closeModal("modal-open-database");
        }
    },

    load: function () {
        var item = DbSelector.items[DbSelector.selectedIndex];
        if (!item) return;
        UI.closeModal("modal-open-database");
        if (item.encrypted) {
            // We know the file is encrypted — update user context immediately,
            // then ask for the password before attempting to load.
            window.SERVER_CONFIG.user = item.name;
            ServerSync.user = item.name;
            Market.setDbStatus(item.name);
            DbEncryption.promptUnlock(function (pw) {
                DbSelector._loadByName(item.name, pw);
            });
        } else {
            DbSelector._loadByName(item.name);
        }
    },

    _loadByName: function (name, password) {
        window.SERVER_CONFIG.user = name;
        ServerSync.user = name;
        Market.setDbStatus(name);
        Market.setStatus(
            "Market data: loading database " + name + "...",
            "#888",
        );
        ServerSync.loadPortfolios(password || null)
            .then(function () {
                if (AppBridge.isTauri()) {
                    AppBridge.invoke("check_db_encrypted", { user: name })
                        .then(function (enc) { Market.setEncStatus(!!enc); })
                        .catch(function () {});
                }
                renderApp();
                MarketCache.clear();
                // Restore market cache from settings.json, then schedule refresh
                if (AppBridge.isTauri()) {
                    AppBridge.invoke("load_app_settings", { user: ServerSync.user })
                        .then(function (appSettings) {
                            if (appSettings && appSettings.activePortfolioId !== undefined) {
                                state.activePortfolioId = appSettings.activePortfolioId;
                            }
                            if (appSettings && Array.isArray(appSettings.portfolioOrder)) {
                                applyPortfolioOrder(appSettings.portfolioOrder);
                            }
                            if (appSettings && appSettings.showCurPrice !== undefined) {
                                AppSettings.set("showCurPrice", !!appSettings.showCurPrice);
                                AppSettings.applyCurPrice();
                            }
                            if (appSettings && appSettings.isCollapsed !== undefined) {
                                state.isCollapsed = !!appSettings.isCollapsed;
                            }
                            if (appSettings && appSettings.columnWidths) {
                                var widthsData = appSettings.columnWidths;
                                var widths = widthsData.widths || widthsData;
                                AppSettings.set("columnWidths", widths);
                                AppSettings.applyCurPrice(); // Still call here to apply widths correctly
                                Object.keys(widths).forEach(function (id) {
                                    var th = document.getElementById(id);
                                    if (th && id !== "th-change" && id !== "th-coin" && id !== "th-cur-price") {
                                        th.style.width = widths[id] + "px";
                                    }
                                });
                            }
                            if (appSettings && Array.isArray(appSettings.marketCache) && appSettings.marketCache.length) {
                                Market.setStateMarketData(appSettings.marketCache);
                                Market.fileCacheSavedAt = appSettings.marketCacheSavedAt || 0;
                                var ts = Market.fileCacheSavedAt
                                    ? new Date(Market.fileCacheSavedAt).toLocaleString()
                                    : "date unknown";
                                Market.setStatus(
                                    "Market data: loaded " + appSettings.marketCache.length +
                                    " symbols from file (" + ts + ")",
                                    "#aaa",
                                );
                                renderApp();
                            }
                        })
                        .catch(function () {})
                        .finally(function () { Market.scheduleRefresh(100); });
                } else {
                    Market.scheduleRefresh(100);
                }
            })
            .catch(function (e) {
                var msg = String(e);
                if (msg.indexOf("DB_ENCRYPTED") !== -1) {
                    // Fallback: file turned out to be encrypted without us knowing
                    DbEncryption.promptUnlock(function (pw) {
                        DbSelector._loadByName(name, pw);
                    });
                    return;
                }
                if (msg.indexOf("UNKNOWN_FORMAT") !== -1) {
                    showDbUnreadableError(name);
                    return;
                }
                console.error("Failed to load db", e);
                Market.setStatus(
                    "Market data: Error loading database",
                    "#D32F2F",
                );
            });
    },
};

document.addEventListener("keydown", DbSelector.onKey);

function showDbUnreadableError(name) {
    var el = document.getElementById("db-unreadable-name");
    if (el) el.textContent = name ? name + ".json" : "";
    UI.openModal("modal-db-unreadable");
}

window.handleMenuOpenDatabase = function () {
    window.closeAllDropdowns();
    if (!AppBridge.isTauri()) {
        alert("This feature requires the desktop application environment.");
        return;
    }
    AppBridge.invoke("open_file_dialog")
        .then(function (filePath) {
            if (!filePath) return;
            var name = filePath.replace(/\\/g, "/").split("/").pop().replace(/\.json$/i, "");
            if (!name) return;
            DebugLog.log("OPEN_DB_FILE", "path=" + filePath + " name=" + name);
            DbSelector._loadByName(name);
        })
        .catch(function (err) {
            console.error("open_file_dialog error:", err);
            alert("Error opening file:\n" + String(err));
        });
};

window.handleMenuSaveDbAs = function () {
    window.closeAllDropdowns();
    if (!AppBridge.isTauri()) {
        alert("This feature requires the desktop application environment.");
        return;
    }
    var nameEl = document.getElementById("save-db-as-name");
    var errEl = document.getElementById("save-db-as-error");
    if (nameEl) nameEl.value = "";
    if (errEl) errEl.classList.add("hidden");
    UI.openModal("modal-save-db-as");
    if (nameEl) setTimeout(function () { nameEl.focus(); }, 80);
};

window.handleSaveDbAsKeydown = function (e) {
    if (e.key === "Enter") handleDoSaveDbAs();
};

window.handleDoSaveDbAs = function () {
    var nameEl = document.getElementById("save-db-as-name");
    var errEl = document.getElementById("save-db-as-error");
    var name = nameEl ? nameEl.value.trim() : "";

    function showErr(msg) {
        if (errEl) { errEl.textContent = msg; errEl.classList.remove("hidden"); }
    }

    if (!name) { showErr("Please enter a name."); return; }

    AppBridge.invoke("copy_database", { sourceUser: ServerSync.user, targetUser: name })
        .then(function () {
            UI.closeModal("modal-save-db-as");
            DbSelector._loadByName(name);
        })
        .catch(function (e) {
            var msg = String(e);
            if (msg.indexOf("DATABASE_EXISTS") !== -1) {
                showErr("A database with that name already exists.");
            } else if (msg.indexOf("INVALID_NAME") !== -1) {
                showErr("Invalid name. Avoid special characters like / \\ and leading dots.");
            } else {
                showErr("Error: " + msg);
            }
            if (nameEl) { nameEl.select(); nameEl.focus(); }
        });
};

window.handleOpenSelectedDatabase = function () {
    DbSelector.load();
};

// ─── DB ENCRYPTION ────────────────────────────────────────────────────────────
var DbEncryption = {
    _unlockCallback: null,

    // Open the unlock modal. onSuccess(password) is called when user unlocks.
    promptUnlock: function (onSuccess) {
        DbEncryption._unlockCallback = onSuccess;
        var pwEl = document.getElementById("unlock-db-password");
        var errEl = document.getElementById("unlock-db-error");
        if (pwEl) pwEl.value = "";
        if (errEl) errEl.classList.add("hidden");
        UI.openModal("modal-unlock-database");
        if (pwEl) setTimeout(function () { pwEl.focus(); }, 80);
    },

    doUnlock: function () {
        var pwEl = document.getElementById("unlock-db-password");
        var errEl = document.getElementById("unlock-db-error");
        var pw = pwEl ? pwEl.value : "";
        if (!pw) {
            if (errEl) { errEl.textContent = "Please enter a password."; errEl.classList.remove("hidden"); }
            return;
        }
        // Try loading with provided password
        var user = ServerSync.user;
        AppBridge.invoke("load_portfolios", { user: user, password: pw })
            .then(function (payload) {
                if (!payload || payload.ok !== true || !payload.data) {
                    throw new Error("Invalid DB payload");
                }
                portfolios = Array.isArray(payload.data.portfolios) ? payload.data.portfolios : [];
                UI.closeModal("modal-unlock-database");
                Market.setEncStatus(true);
                var cb = DbEncryption._unlockCallback;
                DbEncryption._unlockCallback = null;
                if (cb) cb(pw);
            })
            .catch(function (e) {
                var msg = String(e);
                var text = msg.indexOf("WRONG_PASSWORD") !== -1
                    ? "Wrong password. Please try again."
                    : "Error: " + msg;
                if (errEl) { errEl.textContent = text; errEl.classList.remove("hidden"); }
                if (pwEl) { pwEl.select(); pwEl.focus(); }
            });
    },
};

window.handleUnlockKeydown = function (e) {
    if (e.key === "Enter") handleDoUnlockDatabase();
};

window.handleEncryptKeydown = function (e) {
    if (e.key === "Enter") handleDoEncryptDatabase();
};

window.handleDecryptKeydown = function (e) {
    if (e.key === "Enter") handleDoDecryptDatabase();
};

window.handleChangePwKeydown = function (e) {
    if (e.key === "Enter") handleDoChangePassword();
};

window.handleDoUnlockDatabase = function () {
    DbEncryption.doUnlock();
};

window.handleMenuEncryptDatabase = function () {
    window.closeAllDropdowns();
    var menuItem = document.getElementById("menu-encrypt-database");
    if (menuItem && menuItem.classList.contains("dropdown-item-disabled")) return;
    var pwEl = document.getElementById("encrypt-db-password");
    var cfEl = document.getElementById("encrypt-db-confirm");
    var errEl = document.getElementById("encrypt-db-error");
    if (pwEl) pwEl.value = "";
    if (cfEl) cfEl.value = "";
    if (errEl) errEl.classList.add("hidden");
    UI.openModal("modal-encrypt-database");
    if (pwEl) setTimeout(function () { pwEl.focus(); }, 80);
};

window.handleMenuDecryptDatabase = function () {
    window.closeAllDropdowns();
    var decItem = document.getElementById("menu-decrypt-database");
    if (decItem && decItem.classList.contains("dropdown-item-disabled")) return;
    var pwEl  = document.getElementById("decrypt-db-password");
    var errEl = document.getElementById("decrypt-db-error");
    if (pwEl)  pwEl.value = "";
    if (errEl) errEl.classList.add("hidden");
    UI.openModal("modal-decrypt-database");
    if (pwEl) setTimeout(function () { pwEl.focus(); }, 80);
};

window.handleDoDecryptDatabase = function () {
    var pwEl  = document.getElementById("decrypt-db-password");
    var errEl = document.getElementById("decrypt-db-error");
    var pw = pwEl ? pwEl.value : "";

    function showErr(msg) {
        if (errEl) { errEl.textContent = msg; errEl.classList.remove("hidden"); }
    }
    if (!pw) { showErr("Please enter your current password."); return; }

    AppBridge.invoke("decrypt_database", { user: ServerSync.user, password: pw })
        .then(function () {
            UI.closeModal("modal-decrypt-database");
            Market.setEncStatus(false);
        })
        .catch(function (e) {
            var msg = String(e);
            showErr(msg.indexOf("WRONG_PASSWORD") !== -1 ? "Wrong password. Please try again." : "Error: " + msg);
            if (pwEl) { pwEl.select(); pwEl.focus(); }
        });
};

window.handleMenuChangePassword = function () {
    window.closeAllDropdowns();
    var chpwItem = document.getElementById("menu-change-password");
    if (chpwItem && chpwItem.classList.contains("dropdown-item-disabled")) return;
    var curEl = document.getElementById("change-pw-current");
    var newEl = document.getElementById("change-pw-new");
    var cfEl  = document.getElementById("change-pw-confirm");
    var errEl = document.getElementById("change-pw-error");
    if (curEl) curEl.value = "";
    if (newEl) newEl.value = "";
    if (cfEl)  cfEl.value  = "";
    if (errEl) errEl.classList.add("hidden");
    UI.openModal("modal-change-password");
    if (curEl) setTimeout(function () { curEl.focus(); }, 80);
};

window.handleDoChangePassword = function () {
    var curEl = document.getElementById("change-pw-current");
    var newEl = document.getElementById("change-pw-new");
    var cfEl  = document.getElementById("change-pw-confirm");
    var errEl = document.getElementById("change-pw-error");
    var cur = curEl ? curEl.value : "";
    var nw  = newEl ? newEl.value : "";
    var cf  = cfEl  ? cfEl.value  : "";

    function showErr(msg) {
        if (errEl) { errEl.textContent = msg; errEl.classList.remove("hidden"); }
    }
    if (!cur) { showErr("Please enter your current password."); return; }
    if (!nw)  { showErr("Please enter a new password."); return; }
    if (nw.length < 4) { showErr("New password must be at least 4 characters."); return; }
    if (nw !== cf) { showErr("New passwords do not match."); return; }

    AppBridge.invoke("change_database_password", {
        user: ServerSync.user,
        currentPassword: cur,
        newPassword: nw,
    })
        .then(function () {
            UI.closeModal("modal-change-password");
        })
        .catch(function (e) {
            var msg = String(e);
            showErr(msg.indexOf("WRONG_PASSWORD") !== -1 ? "Wrong current password." : "Error: " + msg);
            if (curEl) { curEl.select(); curEl.focus(); }
        });
};

window.handleDoEncryptDatabase = function () {
    var pwEl = document.getElementById("encrypt-db-password");
    var cfEl = document.getElementById("encrypt-db-confirm");
    var errEl = document.getElementById("encrypt-db-error");
    var pw = pwEl ? pwEl.value : "";
    var cf = cfEl ? cfEl.value : "";

    if (!pw) {
        if (errEl) { errEl.textContent = "Please enter a password."; errEl.classList.remove("hidden"); }
        return;
    }
    if (pw.length < 4) {
        if (errEl) { errEl.textContent = "Password must be at least 4 characters."; errEl.classList.remove("hidden"); }
        return;
    }
    if (pw !== cf) {
        if (errEl) { errEl.textContent = "Passwords do not match."; errEl.classList.remove("hidden"); }
        return;
    }

    AppBridge.invoke("encrypt_database", { user: ServerSync.user, password: pw })
        .then(function () {
            UI.closeModal("modal-encrypt-database");
            Market.setEncStatus(true);
        })
        .catch(function (e) {
            var msg = String(e);
            if (errEl) { errEl.textContent = "Encryption failed: " + msg; errEl.classList.remove("hidden"); }
        });
};
// ─────────────────────────────────────────────────────────────────────────────

window.onload = function () {
    AppSettings.init();
    AppBridge.bootstrap()
        .catch(function (e) {
            console.error("Bootstrap failed:", e);
            window.SERVER_CONFIG = window.SERVER_CONFIG || {};
        })
        .finally(function () {
            ServerSync.init();
            Market.setDbStatus(ServerSync.user);
            CoinCatalog.initFromServer();
            MarketCache.init();
            UI.fillCurrencySelects();

            // One-time UI setup — run only once, re-render calls just call renderApp()
            var uiSetupDone = false;
            function initUiSetup() {
                if (uiSetupDone) return;
                uiSetupDone = true;

                Templates.init();
                Storage.load();
                TimePicker.initAll();
                UI.initRestrictions();
                UI.initSortingUI();
                UI.initColumnResizing();

                UI.applyModalSize("modal-create-portfolio", "DEFAULT");
                UI.applyModalSize("modal-edit-portfolio", "DEFAULT");
                UI.applyModalSize("modal-add-coin", "DEFAULT");
                UI.applyModalSize("modal-edit-coin", "DEFAULT");
                UI.applyModalSize("modal-sell-coins", "SELL");

                ["create-p-desc", "edit-p-desc"].forEach(function (id) {
                    var input = document.getElementById(id);
                    if (input) {
                        input.addEventListener("input", function () {
                            UI.updateCounter(id, id + "-counter");
                        });
                        UI.updateCounter(id, id + "-counter");
                    }
                });
            }

            // opts.locked = true → render empty state but don't open "Create portfolio" modal
            function initUiAndRender(opts) {
                initUiSetup();
                renderApp();
                if (!(opts && opts.locked) && !portfolios.length) {
                    openCreatePortfolioModal(true);
                }
            }

            function afterLoad() {
                if (AppBridge.isTauri()) {
                    AppBridge.invoke("check_db_encrypted", { user: ServerSync.user })
                        .then(function (enc) { Market.setEncStatus(!!enc); })
                        .catch(function () {});
                }

                if (AppBridge.isTauri()) {
                    AppBridge.invoke("load_app_settings", { user: ServerSync.user })
                        .then(function (appSettings) {
                            if (appSettings && appSettings.activePortfolioId !== undefined) {
                                state.activePortfolioId = appSettings.activePortfolioId;
                            }
                            if (appSettings && Array.isArray(appSettings.portfolioOrder)) {
                                applyPortfolioOrder(appSettings.portfolioOrder);
                            }
                            if (appSettings && appSettings.showCurPrice !== undefined) {
                                AppSettings.set("showCurPrice", !!appSettings.showCurPrice);
                                AppSettings.applyCurPrice();
                            }
                            if (appSettings && appSettings.isCollapsed !== undefined) {
                                state.isCollapsed = !!appSettings.isCollapsed;
                            }
                            if (appSettings && appSettings.columnWidths) {
                                var widthsData = appSettings.columnWidths;
                                var widths = widthsData.widths || widthsData;
                                AppSettings.set("columnWidths", widths);
                                AppSettings.applyCurPrice(); // Still call here to apply widths correctly
                                Object.keys(widths).forEach(function (id) {
                                    var th = document.getElementById(id);
                                    if (th && id !== "th-change" && id !== "th-coin" && id !== "th-cur-price") {
                                        th.style.width = widths[id] + "px";
                                    }
                                });
                            }
                            if (appSettings && Array.isArray(appSettings.marketCache) && appSettings.marketCache.length) {
                                Market.setStateMarketData(appSettings.marketCache);
                                Market.fileCacheSavedAt = appSettings.marketCacheSavedAt || 0;
                                var ts = Market.fileCacheSavedAt
                                    ? new Date(Market.fileCacheSavedAt).toLocaleString()
                                    : "date unknown";
                                Market.setStatus(
                                    "Market data: loaded " + appSettings.marketCache.length +
                                    " symbols from file (" + ts + ")",
                                    "#aaa",
                                );
                                renderApp();
                            }
                        })
                        .catch(function () {})
                        .finally(function () {
                            initUiAndRender();
                            Market.scheduleRefresh(100);
                        });
                } else {
                    initUiAndRender();
                    Market.scheduleRefresh(100);
                }
            }

            function doInitLoad(password) {
                ServerSync.loadPortfolios(password || null)
                    .then(function () {
                        afterLoad();
                    })
                    .catch(function (e) {
                        var msg = String(e);
                        if (msg.indexOf("DB_ENCRYPTED") !== -1) {
                            Market.setEncStatus(true);
                            // Render empty app (0/$0 everywhere) so placeholders are gone
                            initUiAndRender({ locked: true });
                            DbEncryption.promptUnlock(function (pw) {
                                doInitLoad(pw);
                            });
                            return;
                        }
                        if (msg.indexOf("UNKNOWN_FORMAT") !== -1) {
                            initUiAndRender({ locked: true });
                            showDbUnreadableError(ServerSync.user);
                            return;
                        }
                        console.error("Load failed:", e);
                        portfolios = [];
                        Market.setStatus(
                            "Market data: cannot load local portfolio data",
                            "#D32F2F",
                        );
                        afterLoad();
                    });
            }

            // Check how many DB files exist before loading anything.
            // If 2+ files → show selector immediately so the user picks first.
            // If 1 file (or non-Tauri) → load the default file directly.
            if (AppBridge.isTauri()) {
                AppBridge.invoke("list_databases")
                    .then(function (result) {
                        var files = result.files || [];
                        if (files.length >= 2) {
                            initUiAndRender({ locked: true });
                            DbSelector.open(files, result.dbDir || "");
                        } else if (files.length === 1) {
                            var singleName = files[0].name;
                            window.SERVER_CONFIG.user = singleName;
                            ServerSync.user = singleName;
                            Market.setDbStatus(singleName);
                            doInitLoad(null);
                        } else {
                            doInitLoad(null);
                        }
                    })
                    .catch(function () {
                        doInitLoad(null);
                    });
            } else {
                doInitLoad(null);
            }
        });
};
