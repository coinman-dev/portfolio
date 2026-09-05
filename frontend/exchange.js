/**
 * CoinMan Exchange Module Integration
 * Handles view switching, unified wallet connection (OneKey HD / WalletConnect),
 * multi-DEX modules (Li-Fi, CoW Swap), lazy bundle loading, and settings-cache.json synchronization.
 */
var AppExchange = (function () {
    var bundlePromise = null;
    var currentView = 'portfolio';
    var activeModule = 'lifi'; // 'lifi' | 'cowswap'
    var exchangeSettings = null;
    var lifiInstance = null;
    var cowswapInstance = null;
    var walletSubscription = null;

    function switchView(viewName) {
        var portfolioEl = document.getElementById('portfolio-view');
        var exchangeEl = document.getElementById('exchange-view');
        var earnEl = document.getElementById('earn-view');
        var menuExchangeEl = document.getElementById('menu-item-exchange');
        var menuEarnEl = document.getElementById('menu-item-earn');

        if (viewName === 'exchange') {
            currentView = 'exchange';
            if (portfolioEl) portfolioEl.style.display = 'none';
            if (earnEl) earnEl.style.display = 'none';
            if (exchangeEl) exchangeEl.style.display = 'flex';
            if (menuExchangeEl) menuExchangeEl.classList.add('active');
            if (menuEarnEl) menuEarnEl.classList.remove('active');

            updateExchangeViews();
        } else if (viewName === 'earn') {
            currentView = 'earn';
            if (portfolioEl) portfolioEl.style.display = 'none';
            if (exchangeEl) exchangeEl.style.display = 'none';
            if (earnEl) earnEl.style.display = 'flex';
            if (menuExchangeEl) menuExchangeEl.classList.remove('active');
            if (menuEarnEl) menuEarnEl.classList.add('active');

            if (window.AppEarn && typeof window.AppEarn.updateEarnViews === 'function') {
                window.AppEarn.updateEarnViews();
            }
        } else {
            currentView = 'portfolio';
            if (exchangeEl) exchangeEl.style.display = 'none';
            if (earnEl) earnEl.style.display = 'none';
            if (portfolioEl) portfolioEl.style.display = 'block';
            if (menuExchangeEl) menuExchangeEl.classList.remove('active');
            if (menuEarnEl) menuEarnEl.classList.remove('active');
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
        if (window.CoinmanExchangeLiFi && window.CoinmanExchangeCowSwap && window.CoinmanWallet) {
            setupWalletSubscription();
            return Promise.resolve();
        }
        if (bundlePromise) {
            return bundlePromise;
        }

        bundlePromise = (async function () {
            try {
                loadCss('modules/modules.bundle.css');
                if (!window.CoinmanWallet) {
                    await loadScript('modules/modules.bundle.js');
                }
                setupWalletSubscription();
            } catch (err) {
                console.warn('[Exchange] Falling back to exchange bundle:', err);
                try {
                    loadCss('exchange/exchange.bundle.css');
                    if (!window.CoinmanWallet) {
                        await loadScript('exchange/exchange.bundle.js');
                    }
                    setupWalletSubscription();
                } catch (e) {
                    console.error('[Exchange] Failed to load exchange bundle:', e);
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
        var menuStatusEl = document.getElementById('menu-wallet-status');
        var menuWalletEl = document.getElementById('menu-exchange-wallet');
        var isConnected = !!(status && status.isConnected && status.address);

        if (menuStatusEl) {
            if (isConnected) {
                menuStatusEl.innerHTML = '<span class="wallet-check-green" title="' + (status.address || '') + '">✓</span>';
            } else if (isExplicitDisconnect || (status && !status.isConnected)) {
                menuStatusEl.innerHTML = '';
            }
        }
        if (menuWalletEl) {
            menuWalletEl.classList.toggle('connected', isConnected);
        }

        // Also sync Earn menu wallet indicator
        var menuEarnStatusEl = document.getElementById('menu-earn-wallet-status');
        var menuEarnWalletEl = document.getElementById('menu-earn-wallet');
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

        // Persist connected wallet in exchangeSettings and settings-cache.json
        if (isConnected && status.address) {
            exchangeSettings = Object.assign({}, exchangeSettings || {}, {
                connectedWallet: {
                    address: status.address,
                    chainId: status.chainId,
                    connectedAt: Date.now(),
                },
            });
            saveExchangeSettings(exchangeSettings);
        } else if (isExplicitDisconnect && exchangeSettings && exchangeSettings.connectedWallet) {
            delete exchangeSettings.connectedWallet;
            saveExchangeSettings(exchangeSettings);
        }
    }

    function isWalletConnected() {
        if (window.CoinmanWallet) {
            var status = window.CoinmanWallet.getStatus();
            if (status && status.isConnected && status.address) {
                return status;
            }
        }
        if (exchangeSettings && exchangeSettings.connectedWallet && exchangeSettings.connectedWallet.address) {
            return {
                isConnected: true,
                address: exchangeSettings.connectedWallet.address,
                chainId: exchangeSettings.connectedWallet.chainId,
                shortAddress: exchangeSettings.connectedWallet.address.slice(0, 6) + '...' + exchangeSettings.connectedWallet.address.slice(-4),
            };
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

        var activeStatus = isWalletConnected();

        if (activeStatus && activeStatus.isConnected) {
            openWalletModal(activeStatus);
        } else {
            if (!window.CoinmanWallet) {
                alert('Wallet connection module is initializing, please try again in a moment.');
                return;
            }
            try {
                console.log('[Exchange] Opening WalletConnect modal...');
                var res = await window.CoinmanWallet.connect();
                if (res && res.isConnected) {
                    updateWalletUI(res);
                }
            } catch (err) {
                console.warn('[Exchange] Connect aborted or failed:', err);
            }
        }
    }

    function openWalletModal(status) {
        var modal = document.getElementById('modal-wallet-connect');
        if (!modal) return;

        var connectedView = document.getElementById('wallet-modal-connected-view');
        var disconnectedView = document.getElementById('wallet-modal-disconnected-view');
        var addressInput = document.getElementById('wallet-modal-address');
        var networkInput = document.getElementById('wallet-modal-network');
        var actionBtn = document.getElementById('wallet-modal-action-btn');

        var isConnected = !!(status && status.isConnected);

        if (isConnected) {
            if (connectedView) connectedView.style.display = 'block';
            if (disconnectedView) disconnectedView.style.display = 'none';
            if (addressInput) addressInput.value = status.address || '';
            if (networkInput) networkInput.value = status.chainId ? 'EVM (Chain ID ' + status.chainId + ')' : 'Connected';
            if (actionBtn) {
                actionBtn.textContent = 'DISCONNECT';
                actionBtn.className = 'btn btn-red';
            }
        } else {
            if (connectedView) connectedView.style.display = 'none';
            if (disconnectedView) disconnectedView.style.display = 'block';
            if (actionBtn) {
                actionBtn.textContent = 'CONNECT';
                actionBtn.className = 'btn btn-orange';
            }
        }

        if (window.UI && typeof window.UI.openModal === 'function') {
            window.UI.openModal('modal-wallet-connect');
        } else {
            modal.classList.add('open');
        }
    }

    function closeWalletModal() {
        if (window.UI && typeof window.UI.closeModal === 'function') {
            window.UI.closeModal('modal-wallet-connect');
        } else if (typeof window.closeModal === 'function') {
            window.closeModal('modal-wallet-connect');
        }
        var modal = document.getElementById('modal-wallet-connect');
        if (modal) modal.classList.remove('open');
    }

    async function handleModalWalletAction() {
        closeWalletModal();

        var activeStatus = isWalletConnected();

        if (activeStatus && activeStatus.isConnected) {
            if (window.CoinmanWallet) {
                try {
                    await window.CoinmanWallet.disconnect();
                } catch (e) {
                    console.warn('[Exchange] Disconnect error:', e);
                }
            }
            if (exchangeSettings && exchangeSettings.connectedWallet) {
                delete exchangeSettings.connectedWallet;
                saveExchangeSettings(exchangeSettings);
            }
            updateWalletUI({ isConnected: false }, true);
        } else {
            try {
                await ensureBundleLoaded();
                if (window.CoinmanWallet) {
                    var res = await window.CoinmanWallet.connect();
                    if (res && res.isConnected) {
                        updateWalletUI(res);
                    }
                }
            } catch (err) {
                console.warn('[Exchange] Connect failed:', err);
            }
        }
    }

    function selectExchangeModule(moduleName) {
        activeModule = moduleName || 'lifi';

        if (typeof window.closeAllDropdowns === 'function') {
            window.closeAllDropdowns();
        }

        var itemLiFi = document.getElementById('menu-exchange-lifi');
        var itemCowSwap = document.getElementById('menu-exchange-cowswap');

        if (itemLiFi) itemLiFi.classList.toggle('active', activeModule === 'lifi');
        if (itemCowSwap) itemCowSwap.classList.toggle('active', activeModule === 'cowswap');

        if (exchangeSettings) {
            exchangeSettings.lastSelectedModule = activeModule;
            saveExchangeSettings(exchangeSettings);
        }

        switchView('exchange');
    }

    function updateExchangeViews() {
        var lifiContainer = document.getElementById('exchange-lifi-container');
        var cowswapContainer = document.getElementById('exchange-cowswap-container');
        var titleEl = document.getElementById('exchange-header-title');

        if (activeModule === 'cowswap') {
            if (titleEl) titleEl.textContent = 'CoinMan DEX Exchange • CoW Swap';
            if (lifiContainer) lifiContainer.style.display = 'none';
            if (cowswapContainer) cowswapContainer.style.display = 'block';

            ensureBundleLoaded().then(function () {
                mountCowSwapIfNeeded();
            }).catch(function (err) {
                console.error('[Exchange] Failed to mount CoW Swap:', err);
            });
        } else {
            if (titleEl) titleEl.textContent = 'CoinMan Cross-Chain Exchange • LI.FI';
            if (cowswapContainer) cowswapContainer.style.display = 'none';
            if (lifiContainer) lifiContainer.style.display = 'block';

            ensureBundleLoaded().then(function () {
                mountLiFiIfNeeded();
            }).catch(function (err) {
                console.error('[Exchange] Failed to mount LI.FI:', err);
            });
        }
    }

    function mountLiFiIfNeeded() {
        var lifiContainer = document.getElementById('exchange-lifi-container');
        if (!lifiContainer) return;

        if (lifiInstance) {
            return;
        }

        try {
            if (window.CoinmanExchangeLiFi && typeof window.CoinmanExchangeLiFi.mount === 'function') {
                lifiInstance = window.CoinmanExchangeLiFi.mount({
                    container: lifiContainer,
                    initialSettings: exchangeSettings || {},
                    onSettingsChange: function (updated) {
                        exchangeSettings = Object.assign({}, exchangeSettings || {}, updated);
                        saveExchangeSettings(exchangeSettings);
                    },
                    onWalletConnect: function (wallet) {
                        exchangeSettings = Object.assign({}, exchangeSettings || {}, {
                            connectedWallet: wallet,
                        });
                        saveExchangeSettings(exchangeSettings);
                    },
                    onWalletDisconnect: function () {
                        if (exchangeSettings) {
                            delete exchangeSettings.connectedWallet;
                            saveExchangeSettings(exchangeSettings);
                        }
                    },
                });
            } else {
                console.warn('[Exchange] CoinmanExchangeLiFi.mount is not available');
            }
        } catch (err) {
            console.error('[Exchange] Error mounting LiFi:', err);
        }
    }

    async function mountCowSwapIfNeeded() {
        var cowswapContainer = document.getElementById('exchange-cowswap-container');
        if (!cowswapContainer) return;

        if (cowswapInstance) {
            return;
        }

        try {
            if (window.CoinmanExchangeCowSwap && typeof window.CoinmanExchangeCowSwap.mount === 'function') {
                cowswapInstance = await window.CoinmanExchangeCowSwap.mount({
                    container: cowswapContainer,
                    initialSettings: exchangeSettings || {},
                    onSettingsChange: function (updated) {
                        exchangeSettings = Object.assign({}, exchangeSettings || {}, updated);
                        saveExchangeSettings(exchangeSettings);
                    },
                });
            } else {
                console.warn('[Exchange] CoinmanExchangeCowSwap.mount is not available');
            }
        } catch (err) {
            console.error('[Exchange] Error mounting CoW Swap:', err);
        }
    }

    async function loadExchangeSettings() {
        try {
            if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
                var loaded = await window.__TAURI__.core.invoke('load_exchange_settings');
                if (loaded && typeof loaded === 'object') {
                    exchangeSettings = loaded;
                    return exchangeSettings;
                }
            }
        } catch (e) {
            console.warn('[Exchange] Could not load exchange settings from Tauri:', e);
        }
        try {
            var local = localStorage.getItem('coinman_exchange_settings');
            if (local) {
                exchangeSettings = JSON.parse(local);
                return exchangeSettings;
            }
        } catch (e) {}

        exchangeSettings = {};
        return exchangeSettings;
    }

    async function saveExchangeSettings(settings) {
        if (!settings) return;
        exchangeSettings = settings;

        try {
            if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
                await window.__TAURI__.core.invoke('save_exchange_settings', { settings: settings });
            }
        } catch (e) {
            console.warn('[Exchange] Could not save exchange settings to Tauri:', e);
        }
        try {
            localStorage.setItem('coinman_exchange_settings', JSON.stringify(settings));
        } catch (e) {}
    }

    async function initExchangeSettings() {
        await loadExchangeSettings();

        if (exchangeSettings && exchangeSettings.lastSelectedModule) {
            activeModule = exchangeSettings.lastSelectedModule;
        }

        var itemLiFi = document.getElementById('menu-exchange-lifi');
        var itemCowSwap = document.getElementById('menu-exchange-cowswap');
        if (itemLiFi) itemLiFi.classList.toggle('active', activeModule === 'lifi');
        if (itemCowSwap) itemCowSwap.classList.toggle('active', activeModule === 'cowswap');

        ensureBundleLoaded().then(function () {
            setupWalletSubscription();
        }).catch(function (e) {
            console.warn('[Exchange] Preload bundle:', e);
        });
    }

    // Auto-return to portfolio when portfolio-specific modals are opened
    window.addEventListener('DOMContentLoaded', function () {
        var portfolioActions = [
            'openCreatePortfolioModal',
            'openEditPortfolioModal',
            'openAddCoinModal',
            'handleMenuOpenDatabase',
            'handleMenuSaveDbAs',
            'openClearDatabaseModal',
        ];
        portfolioActions.forEach(function (fnName) {
            if (typeof window[fnName] === 'function') {
                var orig = window[fnName];
                window[fnName] = function () {
                    if (currentView === 'exchange' || currentView === 'earn') {
                        switchView('portfolio');
                    }
                    return orig.apply(this, arguments);
                };
            }
        });

        initExchangeSettings();
    });

    return {
        switchView: switchView,
        getCurrentView: function () { return currentView; },
        getActiveModule: function () { return activeModule; },
        saveExchangeSettings: saveExchangeSettings,
        handleWalletClick: handleWalletClick,
        openWalletModal: openWalletModal,
        handleModalWalletAction: handleModalWalletAction,
        closeWalletModal: closeWalletModal,
        selectExchangeModule: selectExchangeModule,
        updateExchangeViews: updateExchangeViews,
    };
})();

window.AppExchange = AppExchange;
window.AppNavigation = AppExchange;
