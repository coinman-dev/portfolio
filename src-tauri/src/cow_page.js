// Runs in the CoW Swap view (Linux, macOS) before swap.cow.fi's own code.
//
// Offers the CoinMan wallet to the site (EIP-1193 + EIP-6963). Every call goes
// to the app over Tauri's IPC (the cow-bridge plugin: the site's CSP blocks any
// fetch to the app), which passes it to the connected wallet; account and
// network come back the same way.
(function () {
    "use strict";
    if (location.hostname !== "swap.cow.fi" || window.__coinmanCow) return;
    window.__coinmanCow = true;

    function bridge(command, args) {
        var tauri = window.__TAURI_INTERNALS__;
        if (!tauri || typeof tauri.invoke !== "function") {
            return Promise.reject(new Error("CoinMan wallet bridge is not ready"));
        }
        return tauri.invoke("plugin:cow-bridge|" + command, args || {});
    }

    var listeners = {};
    function emit(event, value) {
        (listeners[event] || []).slice().forEach(function (fn) {
            try { fn(value); } catch (e) { /* a listener's own problem */ }
        });
    }
    function rpc(method, params) {
        return bridge("rpc", { method: method, params: params === undefined ? [] : params }).then(function (body) {
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
        bridge("state").then(function (next) {
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
})();
