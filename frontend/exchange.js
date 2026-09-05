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
        var menuExchangeEl = document.getElementById('menu-item-exchange');

        if (viewName === 'exchange') {
            currentView = 'exchange';
            if (portfolioEl) portfolioEl.style.display = 'none';
            if (exchangeEl) exchangeEl.style.display = 'block';
            if (menuExchangeEl) menuExchangeEl.classList.add('active');

            updateExchangeViews();
        } else {
            currentView = 'portfolio';
            if (exchangeEl) exchangeEl.style.display = 'none';
            if (portfolioEl) portfolioEl.style.display = 'block';
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
        if (window.CoinmanExchangeLiFi && window.CoinmanExchangeCowSwap && window.CoinmanWallet) {
            setupWalletSubscription();
            return Promise.resolve();
        }
        if (bundlePromise) {
            return bundlePromise;
        }

        bundlePromise = (async function () {
            try {
                loadCss('exchange/exchange-lifi.bundle.css');
                if (!window.CoinmanWallet) {
                    await loadScript('exchange/exchange-lifi.bundle.js');
                }
                setupWalletSubscription();
            } catch (err) {
                console.error('[Exchange] Failed to load exchange bundle:', err);
                throw err;
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

    async function handleWalletClick(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (typeof window.closeAllDropdowns === 'function') {
            window.closeAllDropdowns();
        }

        try {
            await ensureBundleLoaded();
        } catch (e) {
            console.error('Failed to load wallet module:', e);
        }

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
        if (typeof window.closeAllDropdowns === 'function') {
            window.closeAllDropdowns();
        }
        activeModule = moduleName || 'lifi';
        if (exchangeSettings) {
            exchangeSettings.lastSelectedModule = activeModule;
            saveExchangeSettings(exchangeSettings);
        }
        switchView('exchange');
    }

    async function updateExchangeViews() {
        var lifiContainer = document.getElementById('exchange-lifi-container');
        var cowswapContainer = document.getElementById('exchange-cowswap-container');
        var titleEl = document.getElementById('exchange-header-title');

        if (activeModule === 'cowswap') {
            if (titleEl) titleEl.textContent = 'CoinMan DEX & Swap (CoW Swap)';
            if (lifiContainer) lifiContainer.style.display = 'none';
            if (cowswapContainer) cowswapContainer.style.display = 'block';

            if (!cowswapInstance && cowswapContainer) {
                await initCowSwap(cowswapContainer);
            }
        } else {
            if (titleEl) titleEl.textContent = 'CoinMan Cross-Chain Exchange (Li-Fi)';
            if (cowswapContainer) cowswapContainer.style.display = 'none';
            if (lifiContainer) lifiContainer.style.display = 'block';

            if (!lifiInstance && lifiContainer) {
                await initLiFi(lifiContainer);
            }
        }
    }

    async function initLiFi(container) {
        container.innerHTML = '<div style="text-align:center; padding:60px 20px; color:#9ca3af; font-size:14px;"><div style="margin-bottom:12px; font-weight:bold; color:#f59e0b;">Loading Cross-Chain Exchange...</div>Initializing LI.FI engine and wallet connectors...</div>';

        try {
            await ensureBundleLoaded();

            container.innerHTML = '';

            if (window.CoinmanExchangeLiFi && typeof window.CoinmanExchangeLiFi.mount === 'function') {
                lifiInstance = window.CoinmanExchangeLiFi.mount({
                    container: container,
                    projectId: '927c5d6fc3d30f43842ac0b9e0714891',
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
                container.innerHTML = '<div style="text-align:center; padding:40px; color:#ef4444;">Failed to initialize LiFi module: widget bundle export not found.</div>';
            }
        } catch (err) {
            console.error('[Exchange] Error loading LiFi module:', err);
            container.innerHTML = '<div style="text-align:center; padding:40px; color:#ef4444;">Error loading LiFi module: ' + (err.message || err) + '</div>';
        }
    }

    async function initCowSwap(container) {
        container.innerHTML = '<div style="text-align:center; padding:60px 20px; color:#9ca3af; font-size:14px;"><div style="margin-bottom:12px; font-weight:bold; color:#f59e0b;">Loading CoW Swap Widget...</div>Initializing CoW Protocol engine and wallet provider...</div>';

        try {
            await ensureBundleLoaded();

            container.innerHTML = '';

            if (window.CoinmanExchangeCowSwap && typeof window.CoinmanExchangeCowSwap.mount === 'function') {
                cowswapInstance = await window.CoinmanExchangeCowSwap.mount({
                    container: container,
                    initialSettings: exchangeSettings || {},
                    onSettingsChange: function (updated) {
                        exchangeSettings = Object.assign({}, exchangeSettings || {}, updated);
                        saveExchangeSettings(exchangeSettings);
                    },
                });
            } else {
                container.innerHTML = '<div style="text-align:center; padding:40px; color:#ef4444;">Failed to initialize CoW Swap: widget bundle export not found.</div>';
            }
        } catch (err) {
            console.error('[Exchange] Error loading CoW Swap module:', err);
            container.innerHTML = '<div style="text-align:center; padding:40px; color:#ef4444;">Error loading CoW Swap module: ' + (err.message || err) + '</div>';
        }
    }

    function saveExchangeSettings(settings) {
        if (window.AppBridge && window.AppBridge.isTauri()) {
            window.AppBridge.invoke('save_exchange_settings', {
                settings: settings,
            }).catch(function (e) {
                console.warn('[Exchange] Failed to save exchange settings:', e);
            });
        }
    }

    async function initExchangeSettings() {
        if (window.AppBridge && window.AppBridge.isTauri()) {
            try {
                exchangeSettings = await window.AppBridge.invoke('load_exchange_settings');
                if (exchangeSettings && exchangeSettings.lastSelectedModule) {
                    activeModule = exchangeSettings.lastSelectedModule;
                }
                if (exchangeSettings && exchangeSettings.connectedWallet && exchangeSettings.connectedWallet.address) {
                    updateWalletUI({
                        isConnected: true,
                        address: exchangeSettings.connectedWallet.address,
                        chainId: exchangeSettings.connectedWallet.chainId,
                    });
                }
            } catch (e) {
                console.warn('[Exchange] Failed to load exchange settings:', e);
            }
        }

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
                    if (currentView === 'exchange') {
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
        handleModalWalletAction: handleModalWalletAction,
        closeWalletModal: closeWalletModal,
        selectExchangeModule: selectExchangeModule,
    };
})();

window.AppExchange = AppExchange;
window.AppNavigation = AppExchange;
