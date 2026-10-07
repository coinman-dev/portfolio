// Runs in the Jumper Exchange view before jumper.xyz's own code.
//
// 0. Puts back the site's saved settings, and saves them as they change.
// 1. Answers the site's CMS calls (banners, feature cards, badges) with an
//    empty list, so nothing ever reaches strapi.jumper.xyz.
// 2. Offers the CoinMan wallet to the site (EIP-1193 + EIP-6963). Every call
//    goes over the coinman-wallet protocol to the app, which checks it and
//    only then passes it to the connected wallet.
// 3. Hides everything but the swap: navigation, promos, footer.
(function () {
    "use strict";
    if (location.hostname !== "jumper.xyz" || window.__coinmanJumper) return;
    window.__coinmanJumper = true;

    var BRIDGE = navigator.userAgent.indexOf("Windows") !== -1
        ? "https://coinman-wallet.localhost"
        : "coinman-wallet://localhost";
    var realFetch = window.fetch.bind(window);

    // ── 0. Settings kept between sessions ───────────────────────────────────
    // The view is private, so the site's local storage is gone after a
    // restart. The settings keys come back from data/jumper-storage.json
    // (the app puts them in __coinmanJumperSaved) before the site reads them.
    // Must match is_kept in jumper_storage.rs.
    function isKept(key) {
        return key.indexOf("jumper-") === 0 ||
            /-widget-settings$/.test(key) ||
            key === "wagmi.store" ||
            key === "wagmi.recentConnectorId";
    }
    try {
        var saved = window.__coinmanJumperSaved || {};
        Object.keys(saved).forEach(function (key) {
            if (isKept(key) && typeof saved[key] === "string" && localStorage.getItem(key) === null) {
                localStorage.setItem(key, saved[key]);
            }
        });
    } catch (e) { /* no storage: the site starts with its defaults */ }

    var lastSaved = null;
    function saveSettings(keepalive) {
        try {
            var items = {};
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && isKept(key)) items[key] = localStorage.getItem(key);
            }
            var body = JSON.stringify(items);
            if (body === lastSaved) return;
            lastSaved = body;
            realFetch(BRIDGE + "/storage", {
                method: "POST",
                headers: { "content-type": "text/plain" },
                body: body,
                keepalive: !!keepalive
            }).catch(function () { lastSaved = null; });
        } catch (e) { /* try again next round */ }
    }
    setInterval(function () { saveSettings(false); }, 5000);
    window.addEventListener("pagehide", function () { saveSettings(true); });
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") saveSettings(true);
    });

    // ── 1. CMS calls answered locally ───────────────────────────────────────
    var CMS_HOST = /(^|\.)strapi\.jumper\.(xyz|exchange)$/i;
    var EMPTY = JSON.stringify({
        data: [],
        meta: { pagination: { page: 1, pageSize: 0, pageCount: 0, total: 0 } }
    });
    function isCms(url) {
        try {
            return CMS_HOST.test(new URL(String(url), location.href).hostname);
        } catch (e) {
            return false;
        }
    }
    window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : input && (input.url || input.href);
        if (url && isCms(url)) {
            return Promise.resolve(new Response(EMPTY, {
                status: 200,
                headers: { "content-type": "application/json" }
            }));
        }
        return realFetch(input, init);
    };
    var xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        if (isCms(url)) args[1] = "data:application/json," + encodeURIComponent(EMPTY);
        return xhrOpen.apply(this, args);
    };
    // CMS images: drop the source before the browser fetches it.
    function scrubImages(root) {
        var nodes = root.querySelectorAll ? root.querySelectorAll("img[src], source[srcset]") : [];
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var src = el.getAttribute("src") || el.getAttribute("srcset") || "";
            if (isCms(src.split(" ")[0])) {
                el.removeAttribute("src");
                el.removeAttribute("srcset");
            }
        }
    }

    // ── 2. The CoinMan wallet ───────────────────────────────────────────────
    var listeners = {};
    function emit(event, value) {
        (listeners[event] || []).slice().forEach(function (fn) {
            try { fn(value); } catch (e) { /* a listener's own problem */ }
        });
    }
    function rpc(method, params) {
        return realFetch(BRIDGE + "/rpc", {
            method: "POST",
            // text/plain keeps this a simple request: no CORS preflight.
            headers: { "content-type": "text/plain" },
            body: JSON.stringify({ method: method, params: params === undefined ? [] : params })
        }).then(function (res) {
            return res.json();
        }).then(function (body) {
            if (body && body.error) {
                var err = new Error(body.error.message || "Request failed");
                err.code = body.error.code || 4001;
                throw err;
            }
            return body ? body.result : null;
        });
    }
    var provider = {
        isCoinMan: true,
        request: function (args) {
            if (!args || typeof args.method !== "string") {
                return Promise.reject(new Error("request needs a method"));
            }
            return rpc(args.method, args.params);
        },
        on: function (event, fn) {
            (listeners[event] = listeners[event] || []).push(fn);
            return provider;
        },
        removeListener: function (event, fn) {
            listeners[event] = (listeners[event] || []).filter(function (f) { return f !== fn; });
            return provider;
        },
        enable: function () { return rpc("eth_requestAccounts"); }
    };
    provider.addListener = provider.on;
    provider.off = provider.removeListener;

    // Account and network come from the app; changes are passed on as events.
    var state = { accounts: [], chainId: null };
    function poll() {
        realFetch(BRIDGE + "/state").then(function (res) {
            return res.json();
        }).then(function (next) {
            var accounts = Array.isArray(next.accounts) ? next.accounts : [];
            var chainChanged = next.chainId !== state.chainId;
            var accountsChanged = accounts.join() !== state.accounts.join();
            state = { accounts: accounts, chainId: next.chainId };
            if (chainChanged && next.chainId) emit("chainChanged", "0x" + Number(next.chainId).toString(16));
            if (accountsChanged) emit("accountsChanged", accounts);
        }).catch(function () { /* the app is busy; next round */ }).then(function () {
            setTimeout(poll, 1500);
        });
    }
    poll();

    var ICON = "data:image/svg+xml;base64," + btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<circle cx="32" cy="32" r="30" fill="#ff8c00"/>' +
        '<text x="32" y="42" font-size="30" font-family="Arial" font-weight="bold" fill="#121318" text-anchor="middle">C</text></svg>'
    );
    var info = Object.freeze({
        uuid: (crypto.randomUUID && crypto.randomUUID()) || "coinman-" + Date.now(),
        name: "CoinMan wallet",
        icon: ICON,
        rdns: "dev.coinman.wallet"
    });
    function announce() {
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
            detail: Object.freeze({ info: info, provider: provider })
        }));
    }
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    try {
        Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    } catch (e) { /* another script got there first */ }

    // ── 3. Only the swap ────────────────────────────────────────────────────
    var CSS =
        "footer, #background-root { display: none !important; }" +
        "body { background: #121318 !important; }";
    // Top-level sections the swap does not need, matched by their label.
    var HIDDEN_LINKS = /^(earn|portfolio|missions|rewards|learn|blog|scan|explorer|leaderboard|profile|support|discord|x|twitter|docs)$/i;

    function tidy(root) {
        scrubImages(root);
        var links = document.querySelectorAll("header a, header button, nav a, nav button");
        for (var i = 0; i < links.length; i++) {
            var el = links[i];
            var label = (el.getAttribute("aria-label") || el.textContent || "").trim();
            if (HIDDEN_LINKS.test(label)) el.style.display = "none";
        }
    }
    // React re-renders often; one pass per frame is plenty.
    var scheduled = false;
    function scheduleTidy() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
            scheduled = false;
            tidy(document);
        });
    }
    function start() {
        var style = document.createElement("style");
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
        tidy(document);
        new MutationObserver(scheduleTidy).observe(document.documentElement, { childList: true, subtree: true });
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
