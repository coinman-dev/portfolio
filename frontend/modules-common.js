/**
 * CoinMan Module Kit (modules-common.js)
 *
 * Shared plumbing for the lazily loaded module views (Exchange, Earn).
 * Both used to carry their own byte-identical copies of view switching,
 * bundle loading, wallet-badge rendering and settings persistence; this is
 * the single implementation they now share.
 *
 * Must be loaded before exchange.js and earn.js.
 */
var AppModuleKit = (function () {
    var currentView = 'portfolio';

    /* ── lazy asset loading ─────────────────────────────────────────────── */

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            if (document.querySelector('script[src="' + src + '"]')) {
                resolve();
                return;
            }
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () {
                reject(new Error('Failed to load script ' + src));
            };
            document.head.appendChild(s);
        });
    }

    function loadCss(href) {
        if (!document.querySelector('link[href="' + href + '"]')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            document.head.appendChild(link);
        }
    }

    /* ── view switching ─────────────────────────────────────────────────── */

    var VIEWS = {
        portfolio: { el: 'portfolio-view', display: 'block', menu: null },
        exchange: { el: 'exchange-view', display: 'flex', menu: 'menu-item-exchange' },
        earn: { el: 'earn-view', display: 'flex', menu: 'menu-item-earn' },
    };

    function switchView(viewName) {
        var target = VIEWS[viewName] ? viewName : 'portfolio';
        currentView = target;

        Object.keys(VIEWS).forEach(function (name) {
            var view = VIEWS[name];
            var el = document.getElementById(view.el);
            if (el) el.style.display = name === target ? view.display : 'none';
            if (view.menu) {
                var menuEl = document.getElementById(view.menu);
                if (menuEl) menuEl.classList.toggle('active', name === target);
            }
        });

        if (target === 'exchange' && window.AppExchange &&
            typeof window.AppExchange.updateExchangeViews === 'function') {
            window.AppExchange.updateExchangeViews();
        } else if (target === 'earn' && window.AppEarn &&
            typeof window.AppEarn.updateEarnViews === 'function') {
            window.AppEarn.updateEarnViews();
        }
    }

    function getCurrentView() {
        return currentView;
    }

    /* ── wallet ─────────────────────────────────────────────────────────── */

    var WALLET_BADGES = [
        { status: 'menu-wallet-status', item: 'menu-exchange-wallet' },
        { status: 'menu-earn-wallet-status', item: 'menu-earn-wallet' },
    ];

    /** Paints the connection tick on every module's menu entry. */
    function updateWalletBadges(status, isExplicitDisconnect) {
        var isConnected = !!(status && status.isConnected && status.address);

        WALLET_BADGES.forEach(function (badge) {
            var statusEl = document.getElementById(badge.status);
            if (statusEl) {
                if (isConnected) {
                    statusEl.innerHTML =
                        '<span class="wallet-check-green" title="' +
                        (status.address || '') + '">✓</span>';
                } else if (isExplicitDisconnect || (status && !status.isConnected)) {
                    statusEl.innerHTML = '';
                }
            }
            var itemEl = document.getElementById(badge.item);
            if (itemEl) itemEl.classList.toggle('connected', isConnected);
        });
    }

    /**
     * Subscribes `onStatus(status, isExplicitDisconnect)` to wallet changes and
     * replays the current status. Returns the unsubscribe handle, or null when
     * the wallet bundle is not loaded yet.
     */
    function watchWallet(onStatus) {
        if (!window.CoinmanWallet) return null;

        var unsubscribe = window.CoinmanWallet.subscribe(function (status) {
            if (status && status.isConnected && status.address) {
                onStatus(status, false);
            } else if (status && !status.isConnected) {
                onStatus(status, true);
            }
        });

        var current = window.CoinmanWallet.getStatus();
        if (current && current.isConnected && current.address) {
            onStatus(current, false);
        }
        return unsubscribe;
    }

    function getWalletStatus() {
        if (!window.CoinmanWallet) return null;
        var status = window.CoinmanWallet.getStatus();
        return status && status.isConnected && status.address ? status : null;
    }

    /* ── settings persistence ───────────────────────────────────────────── */

    /**
     * Settings store backed by Tauri (`load_<name>_settings` /
     * `save_<name>_settings`) with a localStorage mirror as fallback.
     */
    function createSettingsStore(name, logTag) {
        var storageKey = 'coinman_' + name + '_settings';

        function hasTauri() {
            return !!(window.__TAURI__ && window.__TAURI__.core &&
                typeof window.__TAURI__.core.invoke === 'function');
        }

        return {
            load: async function () {
                try {
                    if (hasTauri()) {
                        var loaded = await window.__TAURI__.core.invoke('load_' + name + '_settings');
                        if (loaded && typeof loaded === 'object') return loaded;
                    }
                } catch (e) {
                    console.warn('[' + logTag + '] Could not load settings from Tauri:', e);
                }
                try {
                    var local = localStorage.getItem(storageKey);
                    if (local) return JSON.parse(local);
                } catch (e) {}
                return {};
            },
            save: async function (settings) {
                if (!settings) return;
                try {
                    if (hasTauri()) {
                        await window.__TAURI__.core.invoke('save_' + name + '_settings', {
                            settings: settings,
                        });
                    }
                } catch (e) {
                    console.warn('[' + logTag + '] Could not save settings to Tauri:', e);
                }
                try {
                    localStorage.setItem(storageKey, JSON.stringify(settings));
                } catch (e) {}
            },
        };
    }

    return {
        loadScript: loadScript,
        loadCss: loadCss,
        switchView: switchView,
        getCurrentView: getCurrentView,
        updateWalletBadges: updateWalletBadges,
        watchWallet: watchWallet,
        getWalletStatus: getWalletStatus,
        createSettingsStore: createSettingsStore,
    };
})();

window.AppModuleKit = AppModuleKit;
