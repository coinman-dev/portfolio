/**
 * CoinMan Exchange Module Integration
 * Handles view switching, unified wallet connection (OneKey HD / WalletConnect),
 * multi-DEX modules (Li-Fi, CoW Swap), lazy bundle loading, and data/settings.json synchronization.
 */
var AppExchange = (function () {
    var kit = window.AppModuleKit;
    var settingsStore = kit.createSettingsStore('exchange', 'Exchange');

    var bundlePromise = null;
    var activeModule = 'lifi'; // 'bestrate' | 'lifi' | 'cowswap'
    var exchangeSettings = null;
    var bestRateInstance = null;
    var lifiInstance = null;
    var cowswapInstance = null;
    var walletSubscription = null;

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
                kit.loadCss('modules/modules.bundle.css');
                await kit.loadWalletStore();
                if (!window.CoinmanWallet || !window.CoinmanExchangeLiFi ||
                    !window.CoinmanExchangeCowSwap) {
                    await kit.loadScript('modules/modules.bundle.js');
                }
                setupWalletSubscription();
            } catch (err) {
                console.warn('[Exchange] Falling back to exchange bundle:', err);
                try {
                    kit.loadCss('exchange/exchange.bundle.css');
                    if (!window.CoinmanWallet || !window.CoinmanExchangeLiFi ||
                        !window.CoinmanExchangeCowSwap) {
                        await kit.loadScript('exchange/exchange.bundle.js');
                    }
                    setupWalletSubscription();
                } catch (e) {
                    console.error('[Exchange] Failed to load exchange bundle:', e);
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
            walletSubscription = kit.watchWallet(updateWalletUI);
        }
    }

    function updateWalletUI(status, isExplicitDisconnect) {
        kit.updateWalletBadges(status, isExplicitDisconnect);
        if (isWalletModalOpen()) renderWalletModal();
    }

    async function handleWalletClick(e) {
        if (e && typeof e.stopPropagation === 'function') {
            e.stopPropagation();
        }

        if (typeof window.closeAllDropdowns === 'function') {
            window.closeAllDropdowns();
        }

        await ensureBundleLoaded();

        if (!window.CoinmanWallet) {
            alert('Wallet connection module is initializing, please try again in a moment.');
            return;
        }
        // The first wallet goes straight to the QR code; after that, the list.
        if (window.CoinmanWallet.listWallets().length) {
            openWalletModal();
            return;
        }
        try {
            await window.CoinmanWallet.addWallet();
        } catch (err) {
            console.warn('[Exchange] Connect aborted or failed:', err);
        }
    }

    /* ── wallet list modal ──────────────────────────────────────────────── */

    var walletActionBusy = false;

    function isWalletModalOpen() {
        var modal = document.getElementById('modal-wallet-connect');
        return !!(modal && modal.classList.contains('open'));
    }

    function renderWalletRow(w) {
        var esc = window.Utils.escapeHtml;
        var network = w.chainName || (w.chainId ? 'Chain ' + w.chainId : '');
        var state = w.connected ? 'Connected' : 'Offline, click to reconnect';
        return '<div class="wallet-row' + (w.selected ? ' selected' : '') +
            (walletActionBusy ? ' busy' : '') + '" data-wallet-id="' + esc(w.id) + '"' +
            ' onclick="AppExchange.handleSelectWallet(this.dataset.walletId)">' +
            '<span class="wallet-row-dot' + (w.connected ? ' connected' : '') + '"></span>' +
            '<div class="wallet-row-main">' +
            '<div class="wallet-row-name">' + esc(w.name) + '</div>' +
            '<div class="wallet-row-address">' + esc(w.address || '—') + '</div>' +
            '</div>' +
            '<div class="wallet-row-meta">' +
            '<div>' + esc(network) + '</div>' +
            '<div class="wallet-row-state">' + esc(state) + '</div>' +
            '</div>' +
            '</div>';
    }

    function renderWalletModal() {
        var list = document.getElementById('wallet-modal-list');
        if (!list || !window.CoinmanWallet) return;

        var wallets = window.CoinmanWallet.listWallets();
        list.innerHTML = wallets.length
            ? wallets.map(renderWalletRow).join('')
            : '<div class="wallet-list-empty">No wallets connected yet.</div>';

        var addBtn = document.getElementById('wallet-modal-add-btn');
        if (addBtn) {
            addBtn.textContent = wallets.length ? 'CONNECT ANOTHER WALLET' : 'CONNECT WALLET';
            addBtn.disabled = walletActionBusy;
        }
        var removeBtn = document.getElementById('wallet-modal-remove-btn');
        if (removeBtn) {
            removeBtn.disabled = walletActionBusy || !wallets.some(function (w) { return w.selected; });
        }
    }

    function showWalletModalError(message) {
        var el = document.getElementById('wallet-modal-error');
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('hidden', !message);
    }

    // Closing the QR code or declining in the wallet app is the user's choice,
    // not something to report.
    function isUserRejection(err) {
        var text = String((err && (err.shortMessage || err.message)) || err);
        return !!(err && err.code === 4001) || /reject|request reset|cancel/i.test(text);
    }

    /** Runs one wallet action at a time, with the list locked while it runs. */
    async function runWalletAction(action) {
        if (walletActionBusy) return;
        walletActionBusy = true;
        showWalletModalError('');
        renderWalletModal();
        try {
            await action();
        } catch (err) {
            if (!isUserRejection(err)) {
                console.warn('[Exchange] Wallet action failed:', err);
                showWalletModalError((err && (err.shortMessage || err.message)) || String(err));
            }
        } finally {
            walletActionBusy = false;
            renderWalletModal();
        }
    }

    function openWalletModal() {
        showWalletModalError('');
        renderWalletModal();
        if (window.UI && typeof window.UI.openModal === 'function') {
            window.UI.openModal('modal-wallet-connect');
        } else {
            var modal = document.getElementById('modal-wallet-connect');
            if (modal) modal.classList.add('open');
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

    function handleAddWallet() {
        runWalletAction(function () {
            return window.CoinmanWallet.addWallet();
        });
    }

    function handleSelectWallet(id) {
        var wallet = window.CoinmanWallet.listWallets().filter(function (w) {
            return w.id === id;
        })[0];
        if (!wallet || (wallet.selected && wallet.connected)) return;
        runWalletAction(function () {
            return window.CoinmanWallet.selectWallet(id);
        });
    }

    function handleRemoveSelectedWallet() {
        var wallet = window.CoinmanWallet.listWallets().filter(function (w) {
            return w.selected;
        })[0];
        if (!wallet || walletActionBusy) return;
        var label = wallet.name + (wallet.shortAddress ? ' ' + wallet.shortAddress : '');
        window.Utils.confirm(
            'Remove ' + label + '?\n\nThe WalletConnect session is ended in the wallet app too. ' +
            'To use this wallet again you will have to scan the QR code.',
        ).then(function (ok) {
            if (!ok) return;
            runWalletAction(function () {
                return window.CoinmanWallet.removeWallet(wallet.id);
            });
        });
    }

    function selectExchangeModule(moduleName) {
        activeModule = moduleName || 'lifi';

        if (typeof window.closeAllDropdowns === 'function') {
            window.closeAllDropdowns();
        }

        markActiveModuleItem();

        if (exchangeSettings) {
            exchangeSettings.lastSelectedModule = activeModule;
            saveExchangeSettings(exchangeSettings);
        }

        kit.switchView('exchange');
    }

    function markActiveModuleItem() {
        ['bestrate', 'lifi', 'cowswap'].forEach(function (name) {
            var item = document.getElementById('menu-exchange-' + name);
            if (item) item.classList.toggle('active', activeModule === name);
        });
    }

    function updateExchangeViews() {
        var bestRateContainer = document.getElementById('exchange-bestrate-container');
        var lifiContainer = document.getElementById('exchange-lifi-container');
        var cowswapContainer = document.getElementById('exchange-cowswap-container');
        var titleEl = document.getElementById('exchange-header-title');

        if (bestRateContainer) bestRateContainer.style.display = activeModule === 'bestrate' ? 'block' : 'none';

        if (activeModule === 'bestrate') {
            if (titleEl) titleEl.textContent = 'CoinMan Best Rate • compare exchanges';
            if (lifiContainer) lifiContainer.style.display = 'none';
            if (cowswapContainer) cowswapContainer.style.display = 'none';

            ensureBundleLoaded().then(function () {
                mountBestRateIfNeeded();
            }).catch(function (err) {
                console.error('[Exchange] Failed to mount Best Rate:', err);
            });
        } else if (activeModule === 'cowswap') {
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

    function mountBestRateIfNeeded() {
        var container = document.getElementById('exchange-bestrate-container');
        if (!container || bestRateInstance) return;

        try {
            if (window.CoinmanExchangeBestRate && typeof window.CoinmanExchangeBestRate.mount === 'function') {
                bestRateInstance = window.CoinmanExchangeBestRate.mount({
                    container: container,
                    initialSettings: exchangeSettings || {},
                    onSettingsChange: function (updated) {
                        exchangeSettings = Object.assign({}, exchangeSettings || {}, updated);
                        saveExchangeSettings(exchangeSettings);
                    },
                });
            } else {
                console.warn('[Exchange] CoinmanExchangeBestRate.mount is not available');
            }
        } catch (err) {
            console.error('[Exchange] Error mounting Best Rate:', err);
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
        exchangeSettings = await settingsStore.load();
        return exchangeSettings;
    }

    function saveExchangeSettings(settings) {
        if (!settings) return;
        exchangeSettings = settings;
        settingsStore.save(settings);
    }

    async function initExchangeSettings() {
        await loadExchangeSettings();

        if (exchangeSettings && exchangeSettings.lastSelectedModule) {
            activeModule = exchangeSettings.lastSelectedModule;
        }

        markActiveModuleItem();

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
                    var view = kit.getCurrentView();
                    if (view === 'exchange' || view === 'earn') {
                        kit.switchView('portfolio');
                    }
                    return orig.apply(this, arguments);
                };
            }
        });

        initExchangeSettings();
    });

    return {
        switchView: kit.switchView,
        getCurrentView: kit.getCurrentView,
        getActiveModule: function () { return activeModule; },
        saveExchangeSettings: saveExchangeSettings,
        handleWalletClick: handleWalletClick,
        openWalletModal: openWalletModal,
        closeWalletModal: closeWalletModal,
        handleAddWallet: handleAddWallet,
        handleSelectWallet: handleSelectWallet,
        handleRemoveSelectedWallet: handleRemoveSelectedWallet,
        selectExchangeModule: selectExchangeModule,
        updateExchangeViews: updateExchangeViews,
    };
})();

window.AppExchange = AppExchange;
window.AppNavigation = AppExchange;
