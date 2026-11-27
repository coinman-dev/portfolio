/**
 * Privacy → Tor network.
 *
 * CoinMan does not include Tor; it uses Tor Browser (SOCKS 127.0.0.1:9150
 * while it is open), the Tor service (127.0.0.1:9050) or a SOCKS5 address the
 * user enters. The Rust side (privacy.rs) fixes the proxy at start-up for the
 * webviews and its own HTTP clients, so a change applies after a restart.
 * The status bar shows whether traffic really leaves through Tor, as told by
 * check.torproject.org.
 */
var AppPrivacy = (function () {
    var TOR_BROWSER_URL = 'https://www.torproject.org/download/';
    var TOR_SERVICE_URL = 'https://www.torproject.org/download/tor/';

    var status = null;
    /** Result of the last check through the active proxy: null, 'checking', or { isTor, ip, error }. */
    var live = null;
    var busy = false;

    function invoke(cmd, args) {
        var tauri = window.__TAURI__;
        if (!tauri || !tauri.core) return Promise.reject(new Error('Tor needs the desktop app'));
        return tauri.core.invoke(cmd, args || {});
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function el(id) {
        return document.getElementById(id);
    }

    function log(level, message) {
        if (window.DebugLog) window.DebugLog.write(level, 'PRIVACY', message);
    }

    // ─── Indicators: menu mark and status bar ───────────────────────────────

    function renderIndicators() {
        var active = status && status.active;
        var mark = el('menu-tor-status');
        var top = el('menu-privacy-mark');
        var bar = el('tor-status');
        if (!active) {
            if (mark) mark.innerHTML = '';
            if (top) top.innerHTML = '';
            if (bar) bar.style.display = 'none';
            return;
        }
        var done = live && live !== 'checking';
        var boot = active.source === 'built-in' && status.builtin ? status.builtin.bootstrap : 100;
        var ok = done && live.isTor;
        // A SOCKS5 proxy that works but is not Tor (manual address): used as chosen.
        var proxyOnly = done && !live.isTor && !live.error && !active.missing;
        var bad = active.missing || (done && live.error);
        if (mark) {
            mark.innerHTML = ok
                ? '<span class="wallet-check-green" title="Traffic goes through Tor">✓</span>'
                : '<span class="wallet-check-view" title="Tor is on but not confirmed">◉</span>';
        }
        // Top menu bar: a green tick while traffic is confirmed to go through Tor.
        if (top) {
            top.innerHTML = ok
                ? '<span class="wallet-check-green" title="Tor is active">✓</span>'
                : bad
                    ? '<span class="privacy-mark-bad" title="Tor is on but not connected">✗</span>'
                    : '';
        }
        if (bar) {
            bar.style.display = '';
            bar.classList.toggle('is-ok', !!ok);
            bar.classList.toggle('is-bad', !!bad);
            bar.textContent = ok
                ? '✓ Tor active'
                : proxyOnly
                    ? 'Proxy (not Tor)'
                    : bad
                    ? '✗ Tor: no connection'
                    : boot < 100
                        ? 'Tor: connecting ' + boot + '%…'
                        : 'Tor: connecting…';
            bar.title = ok
                ? 'All traffic goes through Tor (' + active.address + '), exit address ' + (live.ip || '?')
                : proxyOnly
                    ? 'All traffic goes through the SOCKS5 proxy ' + active.address + ', which is not Tor (exit address ' + (live.ip || '?') + ')'
                    : bad
                    ? 'Tor is on, but ' + active.address + ' does not lead to Tor. Nothing is sent directly. Click for details.'
                    : 'Checking the connection through ' + active.address + '…';
        }
    }

    // ─── Window ─────────────────────────────────────────────────────────────

    function line(ok, label, hint) {
        var cls = ok === true ? 'is-ok' : ok === false ? 'is-bad' : 'is-info';
        var sign = ok === true ? '✓' : ok === false ? '✗' : '–';
        return '<li><span class="' + cls + '">' + sign + '</span><span>' + label +
            '</span><span class="dashcore-hint">' + hint + '</span></li>';
    }

    function renderStatus() {
        var box = el('privacy-status');
        if (!box || !status) return;
        var d = status.detected || {};
        var b = status.builtin || {};
        var builtinHint = !b.supported
            ? 'not available for this system'
            : !b.installed
                ? 'not installed'
                : 'version ' + b.version + (b.running
                    ? ' — running, ' + (b.bootstrap >= 100 ? 'connected' : 'connecting ' + b.bootstrap + '%') + ' (127.0.0.1:' + b.port + ')'
                    : ' — starts when Tor is on');
        var rows =
            line(b.installed ? true : null, 'CoinMan\'s Tor', esc(builtinHint)) +
            line(d.torBrowser ? true : null, 'Tor Browser', d.torBrowser ? 'running — 127.0.0.1:9150' : 'not running (127.0.0.1:9150)') +
            line(d.torService ? true : null, 'Tor service', d.torService ? 'running — 127.0.0.1:9050' : 'not found (127.0.0.1:9050)');

        var now;
        var active = status.active;
        if (!active) {
            now = '<p class="dashcore-summary">Now: direct connection, Tor is off.</p>';
        } else if (live === 'checking' || live === null) {
            now = '<p class="dashcore-summary">Now: through ' + esc(active.address) + ' — checking…</p>';
        } else if (live.isTor) {
            now = '<p class="dashcore-summary is-ok">Now: all traffic goes through Tor (' + esc(active.address) +
                '). check.torproject.org sees the exit address ' + esc(live.ip) + ', not yours.</p>';
        } else if (live.error) {
            now = '<p class="dashcore-summary is-bad">Tor is on, but ' + esc(active.address) + ' does not answer: ' +
                esc(live.error) + '. Nothing is sent directly — start Tor Browser or the Tor service and press Check, ' +
                'or switch Tor off.</p>';
        } else {
            now = '<p class="dashcore-summary is-bad">Traffic goes through ' + esc(active.address) +
                ', but it is not Tor: check.torproject.org sees ' + esc(live.ip) + '.</p>';
        }
        if (active && active.missing) {
            now += '<p class="dashcore-summary is-bad">At start-up neither Tor Browser nor the Tor service was running. ' +
                'Start one of them, then restart CoinMan.</p>';
        }
        box.innerHTML = '<ul class="dashcore-checks">' + rows + '</ul>' + now;
        renderBuiltin();
    }

    // ─── CoinMan's own Tor (tor_builtin.rs) ─────────────────────────────────

    var installing = false;

    function renderBuiltin() {
        var b = (status && status.builtin) || {};
        var box = el('privacy-builtin');
        if (!box) return;
        box.style.display = b.supported ? '' : 'none';
        var install = el('privacy-builtin-install');
        var update = el('privacy-builtin-update');
        var remove = el('privacy-builtin-remove');
        if (install) {
            install.style.display = b.installed ? 'none' : '';
            install.disabled = installing;
        }
        if (update) {
            update.style.display = b.installed ? '' : 'none';
            update.disabled = installing;
        }
        if (remove) {
            remove.style.display = b.installed ? '' : 'none';
            remove.disabled = installing;
        }
    }

    function builtinMessage(text, ok) {
        var box = el('privacy-builtin-msg');
        if (!box) return;
        box.className = 'privacy-builtin-msg' + (ok === true ? ' is-ok' : ok === false ? ' is-bad' : '');
        box.textContent = text || '';
    }

    var STAGES = {
        version: 'Looking for the latest Tor release…',
        verify: 'Checking the Tor Project signature…',
        unpack: 'Unpacking…',
    };

    async function installBuiltin(isUpdate) {
        if (installing) return;
        installing = true;
        renderBuiltin();
        var unlisten = null;
        try {
            var ev = window.__TAURI__ && window.__TAURI__.event;
            if (ev && ev.listen) {
                unlisten = await ev.listen('tor-install-progress', function (e) {
                    var p = e.payload || {};
                    if (p.stage === 'download') builtinMessage('Downloading Tor… ' + (p.percent || 0) + '%', null);
                    else if (STAGES[p.stage]) builtinMessage(STAGES[p.stage], null);
                });
            }
            if (isUpdate) {
                builtinMessage(STAGES.version, null);
                var latest = await invoke('tor_builtin_latest');
                var have = status && status.builtin && status.builtin.version;
                if (have && latest === have) {
                    builtinMessage('Tor ' + have + ' is the latest version.', true);
                    return;
                }
            }
            var b = await invoke('tor_builtin_install');
            builtinMessage('Tor ' + b.version + ' is installed. The Tor Project signature is valid.', true);
            log('info', 'installed Tor ' + b.version);
            await refreshStatus();
            // First install: offer to switch it on right away.
            var enabled = el('privacy-tor-enabled');
            if (!isUpdate && enabled && !enabled.checked) {
                enabled.checked = true;
                var auto = el('privacy-mode-auto');
                if (auto) auto.checked = true;
            }
            syncForm();
        } catch (err) {
            builtinMessage(String(err && err.message || err), false);
        } finally {
            if (unlisten) unlisten();
            installing = false;
            renderBuiltin();
        }
    }

    async function removeBuiltin() {
        if (installing) return;
        try {
            await invoke('tor_builtin_remove');
            builtinMessage('CoinMan\'s Tor is removed.', true);
            await refreshStatus();
        } catch (err) {
            builtinMessage(String(err && err.message || err), false);
        }
    }

    /** CoinMan's own Tor needs a few seconds to connect before anything can go through it. */
    async function waitForBootstrap() {
        for (var i = 0; i < 90; i++) {
            var b = status && status.builtin;
            if (!status.active || status.active.source !== 'built-in' || !b || !b.running || b.bootstrap >= 100) return;
            await new Promise(function (r) { setTimeout(r, 1500); });
            try { await refreshStatus(); } catch (e) { return; }
        }
    }

    function renderForm() {
        var saved = (status && status.saved) || {};
        var enabled = el('privacy-tor-enabled');
        if (enabled) enabled.checked = !!saved.torEnabled;
        var manual = !!saved.manual;
        var auto = el('privacy-mode-auto');
        var man = el('privacy-mode-manual');
        if (auto) auto.checked = !manual;
        if (man) man.checked = manual;
        var addr = el('privacy-address');
        if (addr) addr.value = saved.address || '';
        var adv = el('privacy-advanced');
        if (adv && manual) adv.open = true;
        syncForm();
    }

    function syncForm() {
        var supported = !status || status.platformSupported;
        var enabled = el('privacy-tor-enabled');
        if (enabled) enabled.disabled = !supported;
        var man = el('privacy-mode-manual');
        var addr = el('privacy-address');
        if (addr) addr.disabled = !(man && man.checked);
        var note = el('privacy-unsupported');
        if (note) note.style.display = supported ? 'none' : '';
        // The button says what it will do: a change to what this run uses means a restart.
        var btn = el('privacy-save-btn');
        if (btn && status) {
            var v = formValues();
            var now = status.startup || {};
            var restart = changesStartup(v, now);
            btn.textContent = !restart
                ? 'SAVE'
                : v.torEnabled && !now.torEnabled
                    ? 'TURN ON TOR & RESTART'
                    : !v.torEnabled && now.torEnabled
                        ? 'TURN OFF TOR & RESTART'
                        : 'SAVE & RESTART';
        }
    }

    function changesStartup(v, now) {
        if (!!v.torEnabled !== !!now.torEnabled) return true;
        if (!v.torEnabled) return false;
        if (!!v.manual !== !!now.manual) return true;
        return !!v.manual && (v.address || '').toLowerCase() !== (now.address || '').toLowerCase();
    }

    function message(text, ok) {
        var box = el('privacy-message');
        if (!box) return;
        box.className = 'dashcore-summary' + (ok === true ? ' is-ok' : ok === false ? ' is-bad' : '');
        box.textContent = text || '';
    }

    function formValues() {
        var manual = !!(el('privacy-mode-manual') && el('privacy-mode-manual').checked);
        var address = el('privacy-address') ? el('privacy-address').value.trim() : '';
        return {
            torEnabled: !!(el('privacy-tor-enabled') && el('privacy-tor-enabled').checked),
            manual: manual,
            address: address || null,
        };
    }

    async function refreshStatus() {
        status = await invoke('privacy_status');
        renderStatus();
        renderIndicators();
        return status;
    }

    async function checkActive() {
        if (!status || !status.active) return;
        live = 'checking';
        renderIndicators();
        renderStatus();
        try {
            var r = await invoke('privacy_check', { address: null });
            live = { isTor: !!r.isTor, ip: r.ip };
            log(r.isTor ? 'info' : 'warn', 'check through ' + r.address + ': ' + (r.isTor ? 'Tor' : 'not Tor'));
        } catch (err) {
            live = { isTor: false, ip: '', error: String(err && err.message || err) };
            log('warn', 'check failed: ' + live.error);
        }
        renderIndicators();
        renderStatus();
    }

    /** Check button: the address being set up, else the one in use, else the Tor that is running. */
    async function check() {
        if (busy) return;
        busy = true;
        message('Checking…', null);
        try {
            await refreshStatus();
            var v = formValues();
            var d = status.detected || {};
            var address = v.manual && v.address
                ? v.address
                : status.active
                    ? null
                    : d.torBrowser ? '127.0.0.1:9150' : d.torService ? '127.0.0.1:9050' : '';
            if (address === '') {
                message('Tor was not found. Start Tor Browser or the Tor service, then press Check again.', false);
                return;
            }
            if (address === null) {
                await checkActive();
                message(live && live.isTor ? 'Tor works.' : 'The connection through Tor does not work right now.', !!(live && live.isTor));
                return;
            }
            var r = await invoke('privacy_check', { address: address });
            message(r.isTor
                ? 'Tor works through ' + r.address + ' (exit address ' + r.ip + ').'
                : r.address + ' answers, but it is not Tor (check.torproject.org sees ' + r.ip + '). It can still be used as a proxy.', !!r.isTor);
        } catch (err) {
            message(String(err && err.message || err), false);
        } finally {
            busy = false;
        }
    }

    async function save() {
        if (busy) return;
        busy = true;
        try {
            var v = formValues();
            status = await invoke('privacy_save', v);
            renderStatus();
            syncForm();
            if (status.restartNeeded) {
                restart();
                return;
            }
            close();
        } catch (err) {
            message(String(err && err.message || err), false);
        } finally {
            busy = false;
        }
    }

    function restart() {
        message('Restarting CoinMan to apply the setting…', null);
        invoke('privacy_restart').catch(function (err) {
            message(String(err && err.message || err), false);
        });
    }

    function openLink(which) {
        var url = which === 'service' ? TOR_SERVICE_URL : TOR_BROWSER_URL;
        invoke('open_url', { url: url }).catch(function () { window.open(url, '_blank'); });
    }

    function open(e) {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof window.closeAllDropdowns === 'function') window.closeAllDropdowns();
        message('', null);
        var modal = el('modal-privacy');
        if (modal) modal.classList.add('open');
        refreshStatus()
            .then(function () {
                renderForm();
            })
            .catch(function (err) {
                message(String(err && err.message || err), false);
            });
    }

    function close() {
        var modal = el('modal-privacy');
        if (modal) modal.classList.remove('open');
    }

    async function init() {
        try {
            await refreshStatus();
        } catch (e) {
            return; // browser preview
        }
        if (!status.active) return;
        live = 'checking';
        renderIndicators();
        await waitForBootstrap();
        await checkActive();
        // Tor is on but does not work: say so once rather than leave every request failing silently.
        if (status.active.missing || (live && live.error)) open();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        void init();
    }

    return {
        open: open,
        close: close,
        check: check,
        save: save,
        restart: restart,
        installBuiltin: installBuiltin,
        removeBuiltin: removeBuiltin,
        openLink: openLink,
        syncForm: syncForm,
    };
})();

window.AppPrivacy = AppPrivacy;
