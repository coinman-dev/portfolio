/**
 * CoinMan Earn Module Integration
 * Handles view switching, Yearn Finance widget mounting,
 * unified wallet connection (OneKey HD / WalletConnect via CoinmanWallet),
 * and persistence in data/settings.json.
 */
var AppEarn = (function () {
    var kit = window.AppModuleKit;
    var settingsStore = kit.createSettingsStore('earn', 'Earn');

    var bundlePromise = null;
    var activeModule = 'yearn'; // 'yearn' | future earn modules
    var earnSettings = null;
    var yearnInstance = null;
    var walletSubscription = null;

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
                kit.loadCss('modules/modules.bundle.css');
                if (!window.CoinmanWallet || !window.CoinmanEarnYearn) {
                    await kit.loadScript('modules/modules.bundle.js');
                }
                setupWalletSubscription();
            } catch (err) {
                console.warn('[Earn] Falling back to exchange bundle:', err);
                try {
                    kit.loadCss('exchange/exchange.bundle.css');
                    await kit.loadScript('exchange/exchange.bundle.js');
                    setupWalletSubscription();
                } catch (e) {
                    console.error('[Earn] Failed to load modules bundle:', e);
                    // Drop the cached promise so a later attempt can retry;
                    // otherwise one transient failure breaks the module for
                    // the rest of the session.
                    bundlePromise = null;
                    throw e;
                }
            }
        })();

        return bundlePromise;
    }

    function setupWalletSubscription() {
        if (!walletSubscription) {
            walletSubscription = kit.watchWallet(kit.updateWalletBadges);
        }
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

        var activeStatus = kit.getWalletStatus();
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
                    kit.updateWalletBadges(res);
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

        kit.switchView('earn');
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
        earnSettings = await settingsStore.load();
        return earnSettings;
    }

    function saveEarnSettings(settings) {
        if (!settings) return;
        earnSettings = settings;
        settingsStore.save(settings);
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
        switchView: kit.switchView,
        selectEarnModule: selectEarnModule,
        handleWalletClick: handleWalletClick,
        updateEarnViews: updateEarnViews,
        ensureBundleLoaded: ensureBundleLoaded,
    };
})();

window.AppEarn = AppEarn;
