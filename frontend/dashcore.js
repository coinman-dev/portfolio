/**
 * Exchange → Connect wallet → Dash Core.
 *
 * The user chooses the Dash Core folder; the Rust side (dash_core.rs) checks
 * the files, dash.conf, the running node and its open wallets. Once the
 * checks pass the folder is remembered, and Best Rate's DASH deposits can be
 * sent from Dash Core (DepositPanel). Status changes are announced with the
 * `coinman-dashcore` window event: detail = { connected, dir }.
 */
var AppDashCore = (function () {
    var state = { dir: '', connected: false, report: null };
    var busy = false;

    function invoke(cmd, args) {
        var tauri = window.__TAURI__;
        if (!tauri || !tauri.core) return Promise.reject(new Error('Dash Core needs the desktop app'));
        return tauri.core.invoke(cmd, args || {});
    }

    function esc(s) {
        return window.Utils && window.Utils.escapeHtml
            ? window.Utils.escapeHtml(String(s == null ? '' : s))
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }

    function announce() {
        var status = document.getElementById('menu-dashcore-status');
        if (status) {
            // ◉: the folder is chosen but the node is not running or still syncs.
            status.innerHTML = state.connected
                ? '<span class="wallet-check-green" title="' + esc(state.dir) + '">✓</span>'
                : state.dir
                    ? '<span class="wallet-check-view" title="' + esc(state.dir) + ' — Dash Core is not running or not synchronised yet">◉</span>'
                    : '';
        }
        var item = document.getElementById('menu-exchange-dashcore');
        if (item) item.classList.toggle('connected', state.connected);
        var forget = document.getElementById('dashcore-forget-btn');
        if (forget) forget.style.display = state.dir ? '' : 'none';
        window.dispatchEvent(new CustomEvent('coinman-dashcore', {
            detail: { connected: state.connected, dir: state.dir },
        }));
    }

    function renderReport(report, error) {
        var box = document.getElementById('dashcore-result');
        if (!box) return;
        if (error) {
            box.innerHTML = '<p class="dashcore-summary is-bad">' + esc(error) + '</p>';
            return;
        }
        if (!report) {
            box.innerHTML = '';
            return;
        }
        var rows = (report.checks || []).map(function (c) {
            var mark = c.ok ? '✓' : (c.required ? '✗' : '–');
            var cls = c.ok ? 'is-ok' : (c.required ? 'is-bad' : 'is-info');
            return '<li><span class="' + cls + '">' + mark + '</span><span>' + esc(c.label) +
                '</span><span class="dashcore-hint">' + esc(c.hint) + '</span></li>';
        }).join('');
        var wallets = (report.wallets || []).map(function (w) {
            var parts = [];
            if (w.balance != null) parts.push(esc(w.balance) + ' DASH');
            parts.push(w.encrypted ? 'encrypted — the password is asked when sending' : 'not encrypted');
            if (w.privateKeysEnabled === false) parts.push('watch-only, cannot sign');
            return '<li><strong>' + esc(w.name || '(default wallet)') + '</strong> — ' + parts.join(', ') + '</li>';
        }).join('');
        var summary = report.ready
            ? '<p class="dashcore-summary is-ok">Dash Core is connected. Best Rate offers “Send from Dash Core” for DASH deposits.</p>'
            : '<p class="dashcore-summary is-bad">Not ready yet — fix the items marked ✗ and press Check again.</p>';
        box.innerHTML = '<ul class="dashcore-checks">' + rows + '</ul>' +
            (wallets ? '<div>Open wallets:</div><ul class="dashcore-wallets">' + wallets + '</ul>' : '') +
            summary;
    }

    async function check() {
        if (busy) return;
        var input = document.getElementById('dashcore-dir');
        var dir = input ? input.value.trim() : '';
        if (!dir) {
            renderReport(null, 'Choose the Dash Core folder first.');
            return;
        }
        busy = true;
        renderReport(null, null);
        var box = document.getElementById('dashcore-result');
        if (box) box.innerHTML = '<p class="wallet-modal-intro">Checking…</p>';
        try {
            var report = await invoke('dash_core_inspect', { dir: dir });
            state.report = report;
            renderReport(report, null);
            // A folder with Dash Core in it is remembered even while the node
            // still syncs; sending checks the node again each time.
            var found = (report.checks || []).some(function (c) { return c.label === 'Data folder' && c.ok; });
            if (found) {
                await invoke('dash_core_save', { dir: dir });
                state.dir = dir;
                state.connected = !!report.ready;
                if (window.DebugLog) window.DebugLog.write('info', 'DASHCORE', 'folder ' + dir + (report.ready ? ' — ready' : ' — not ready'));
            }
            announce();
        } catch (err) {
            renderReport(null, String(err && err.message || err));
        } finally {
            busy = false;
        }
    }

    async function pickFolder() {
        try {
            var dir = await invoke('dash_core_pick_folder');
            if (!dir) return;
            var input = document.getElementById('dashcore-dir');
            if (input) input.value = dir;
            await check();
        } catch (err) {
            renderReport(null, String(err && err.message || err));
        }
    }

    async function forget() {
        try {
            await invoke('dash_core_save', { dir: null });
        } catch (e) { /* settings write failed: still forget for this session */ }
        state = { dir: '', connected: false, report: null };
        var input = document.getElementById('dashcore-dir');
        if (input) input.value = '';
        renderReport(null, null);
        announce();
    }

    function open(e) {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof window.closeAllDropdowns === 'function') window.closeAllDropdowns();
        var input = document.getElementById('dashcore-dir');
        if (input) input.value = state.dir;
        renderReport(state.report, null);
        announce();
        if (window.UI && typeof window.UI.openModal === 'function') {
            window.UI.openModal('modal-dash-core');
        } else {
            var modal = document.getElementById('modal-dash-core');
            if (modal) modal.classList.add('open');
        }
        if (state.dir) void check();
    }

    function close() {
        if (window.UI && typeof window.UI.closeModal === 'function') {
            window.UI.closeModal('modal-dash-core');
        }
        var modal = document.getElementById('modal-dash-core');
        if (modal) modal.classList.remove('open');
    }

    /** Re-checks the saved folder without the window (Best Rate asks before sending). */
    async function refresh() {
        if (!state.dir) return state;
        try {
            var report = await invoke('dash_core_inspect', { dir: state.dir });
            state.report = report;
            state.connected = !!report.ready;
        } catch (e) {
            state.connected = false;
        }
        announce();
        return state;
    }

    async function init() {
        try {
            var saved = await invoke('dash_core_saved');
            if (saved && saved.dir) {
                state.dir = saved.dir;
                // ◉ until the node answers; the deposit panel checks it again before every send.
                announce();
                void refresh();
            } else {
                announce();
            }
        } catch (e) { /* browser preview: no Dash Core */ }
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
        pickFolder: pickFolder,
        forget: forget,
        refresh: refresh,
        getStatus: function () { return { connected: state.connected, dir: state.dir, report: state.report }; },
    };
})();

window.AppDashCore = AppDashCore;
