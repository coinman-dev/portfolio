/**
 * CoinMan Earn Module Integration
 * Handles view switching, Yearn Finance widget mounting,
 * unified wallet connection (OneKey HD / WalletConnect via CoinmanWallet),
 * and persistence in settings-cache.json.
 */
var AppEarn = (function () {
    var bundlePromise = null;
    var currentView = 'portfolio';
    var activeModule = 'yearn'; // 'yearn' | future earn modules
    var earnSettings = null;
    var yearnInstance = null;
    var walletSubscription = null;

    function switchView(viewName) {
        var portfolioEl = document.getElementById('portfolio-view');
        var exchangeEl = document.getElementById('exchange-view');
        var earnEl = document.getElementById('earn-view');
        var menuExchangeEl = document.getElementById('menu-item-exchange');
        var menuEarnEl = document.getElementById('menu-item-earn');

        if (viewName === 'earn') {
            currentView = 'earn';
            if (portfolioEl) portfolioEl.style.display = 'none';
            if (exchangeEl) exchangeEl.style.display = 'none';
            if (earnEl) earnEl.style.display = 'flex';
            if (menuExchangeEl) menuExchangeEl.classList.remove('active');
            if (menuEarnEl) menuEarnEl.classList.add('active');

            updateEarnViews();
        } else if (viewName === 'exchange') {
            currentView = 'exchange';
            if (earnEl) earnEl.style.display = 'none';
            if (portfolioEl) portfolioEl.style.display = 'none';
            if (exchangeEl) exchangeEl.style.display = 'flex';
            if (menuEarnEl) menuEarnEl.classList.remove('active');
            if (menuExchangeEl) menuExchangeEl.classList.add('active');

            if (window.AppExchange && typeof window.AppExchange.updateExchangeViews === 'function') {
                window.AppExchange.updateExchangeViews();
            }
        } else {
            currentView = 'portfolio';
            if (earnEl) earnEl.style.display = 'none';
            if (exchangeEl) exchangeEl.style.display = 'none';
            if (portfolioEl) portfolioEl.style.display = 'block';
            if (menuEarnEl) menuEarnEl.classList.remove('active');
            if (menuExchangeEl) menuExchangeEl.classList.remove('active');
        }
    }

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

    function ensureBundleLoaded() {
        if (window.CoinmanEarnYearn && window.CoinmanWallet) {
            setupWalletSubscription();
            return Promise.resolve();
        }
        if (bundlePromise) {
            return bundlePromise;
        }

        bundlePromise = (async function () {
            try {
                loadCss('modules/modules.bundle.css');
                if (!window.CoinmanWallet || !window.CoinmanEarnYearn) {
                    await loadScript('modules/modules.bundle.js');
                }
                setupWalletSubscription();
            } catch (err) {
                console.warn('[Earn] Falling back to exchange bundle:', err);
                try {
                    loadCss('exchange/exchange.bundle.css');
                    await loadScript('exchange/exchange.bundle.js');
                    setupWalletSubscription();
                } catch (e) {
                    console.error('[Earn] Failed to load modules bundle:', e);
                    throw e;
                }
            }
        })();

        return bundlePromise;
    }

    function setupWalletSubscription() {
        if (!window.CoinmanWallet) return;

        if (!walletSubscription) {
            walletSubscription = window.CoinmanWallet.subscribe(function (status) {
                if (status && status.isConnected && status.address) {
                    updateWalletUI(status);
                } else if (status && !status.isConnected) {
                    updateWalletUI(status, true);
                }
            });
        }

        var current = window.CoinmanWallet.getStatus();
        if (current && current.isConnected && current.address) {
            updateWalletUI(current);
        }
    }

    function updateWalletUI(status, isExplicitDisconnect) {
        var menuEarnStatusEl = document.getElementById('menu-earn-wallet-status');
        var menuEarnWalletEl = document.getElementById('menu-earn-wallet');
        var isConnected = !!(status && status.isConnected && status.address);

        if (menuEarnStatusEl) {
            if (isConnected) {
                menuEarnStatusEl.innerHTML = '<span class="wallet-check-green" title="' + (status.address || '') + '">✓</span>';
            } else if (isExplicitDisconnect || (status && !status.isConnected)) {
                menuEarnStatusEl.innerHTML = '';
            }
        }
        if (menuEarnWalletEl) {
            menuEarnWalletEl.classList.toggle('connected', isConnected);
        }

        // Also sync exchange menu wallet status if available
        var menuExchangeStatusEl = document.getElementById('menu-wallet-status');
        var menuExchangeWalletEl = document.getElementById('menu-exchange-wallet');
        if (menuExchangeStatusEl) {
            if (isConnected) {
                menuExchangeStatusEl.innerHTML = '<span class="wallet-check-green" title="' + (status.address || '') + '">✓</span>';
            } else if (isExplicitDisconnect || (status && !status.isConnected)) {
                menuExchangeStatusEl.innerHTML = '';
            }
        }
        if (menuExchangeWalletEl) {
            menuExchangeWalletEl.classList.toggle('connected', isConnected);
        }
    }

    function isWalletConnected() {
        if (window.CoinmanWallet) {
            var status = window.CoinmanWallet.getStatus();
            if (status && status.isConnected && status.address) {
                return status;
            }
        }
        return null;
    }

    async function handleWalletClick(e) {
        if (e && typeof e.stopPropagation === 'function') {
            e.stopPropagation();
        }

        if (typeof window.closeAllDropdowns === 'function') {
            window.closeAllDropdowns();
        }

        await ensureBundleLoaded();

        if (window.AppExchange && typeof window.AppExchange.handleWalletClick === 'function') {
            window.AppExchange.handleWalletClick(e);
            return;
        }

        var activeStatus = isWalletConnected();
        if (activeStatus && activeStatus.isConnected) {
            if (window.AppExchange && typeof window.AppExchange.openWalletModal === 'function') {
                window.AppExchange.openWalletModal(activeStatus);
            }
        } else {
            if (!window.CoinmanWallet) {
                alert('Wallet connection module is initializing, please try again.');
                return;
            }
            try {
                var res = await window.CoinmanWallet.connect();
                if (res && res.isConnected) {
                    updateWalletUI(res);
                }
            } catch (err) {
                console.warn('[Earn] Connect aborted or failed:', err);
            }
        }
    }

    function selectEarnModule(moduleName) {
        activeModule = moduleName || 'yearn';

        if (typeof window.closeAllDropdowns === 'function') {
            window.closeAllDropdowns();
        }

        var itemYearn = document.getElementById('menu-earn-yearn');
        if (itemYearn) itemYearn.classList.toggle('active', activeModule === 'yearn');

        if (earnSettings) {
            earnSettings.lastSelectedModule = activeModule;
            saveEarnSettings(earnSettings);
        }

        switchView('earn');
    }

    function updateEarnViews() {
        var yearnContainer = document.getElementById('earn-yearn-container');
        var titleEl = document.getElementById('earn-header-title');

        if (activeModule === 'yearn') {
            if (titleEl) titleEl.textContent = 'CoinMan DeFi Earn • Yearn Finance';
            if (yearnContainer) yearnContainer.style.display = 'block';

            ensureBundleLoaded().then(function () {
                mountYearnIfNeeded();
            }).catch(function (err) {
                console.error('[Earn] Failed to mount Yearn widget:', err);
            });
        }
    }

    function mountYearnIfNeeded() {
        var yearnContainer = document.getElementById('earn-yearn-container');
        if (!yearnContainer) return;

        if (yearnInstance) {
            return;
        }

        try {
            if (window.CoinmanEarnYearn && typeof window.CoinmanEarnYearn.mount === 'function') {
                yearnInstance = window.CoinmanEarnYearn.mount({
                    container: yearnContainer,
                    initialSettings: earnSettings || {},
                    onSettingsChange: function (updated) {
                        earnSettings = Object.assign({}, earnSettings || {}, updated);
                        saveEarnSettings(earnSettings);
                    },
                });
            } else {
                console.warn('[Earn] CoinmanEarnYearn.mount is not available');
            }
        } catch (err) {
            console.error('[Earn] Error mounting Yearn widget:', err);
        }
    }

    async function loadEarnSettings() {
        try {
            if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
                var loaded = await window.__TAURI__.core.invoke('load_earn_settings');
                if (loaded && typeof loaded === 'object') {
                    earnSettings = loaded;
                    return earnSettings;
                }
            }
        } catch (e) {
            console.warn('[Earn] Could not load earn settings from Tauri:', e);
        }
        try {
            var local = localStorage.getItem('coinman_earn_settings');
            if (local) {
                earnSettings = JSON.parse(local);
                return earnSettings;
            }
        } catch (e) {}

        earnSettings = {};
        return earnSettings;
    }

    async function saveEarnSettings(settings) {
        if (!settings) return;
        earnSettings = settings;

        try {
            if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
                await window.__TAURI__.core.invoke('save_earn_settings', { settings: settings });
            }
        } catch (e) {
            console.warn('[Earn] Could not save earn settings to Tauri:', e);
        }
        try {
            localStorage.setItem('coinman_earn_settings', JSON.stringify(settings));
        } catch (e) {}
    }

    async function init() {
        await loadEarnSettings();

        // Check if there is already an active wallet session
        ensureBundleLoaded().catch(function () {});

        var itemYearn = document.getElementById('menu-earn-yearn');
        if (itemYearn) itemYearn.classList.add('active');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init: init,
        switchView: switchView,
        selectEarnModule: selectEarnModule,
        handleWalletClick: handleWalletClick,
        updateEarnViews: updateEarnViews,
        ensureBundleLoaded: ensureBundleLoaded,
    };
})();

window.AppEarn = AppEarn;
