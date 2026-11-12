/**
 * CoinMan window tabs (tabs.js)
 *
 * A tab strip under the menu bar. Portfolio is always there; every Exchange
 * or Earn module opened from the menu (or from a Best Rate link) gets its own
 * tab, so several modules stay open at once and keep their state — their
 * widgets stay mounted while hidden. Closing a tab only removes it from the
 * strip; reopening it shows the module as it was left.
 *
 * Tabs can be dragged to reorder them. The open tabs and their order are
 * remembered between launches; a restored tab mounts its
 * module only when it is first clicked.
 *
 * Must be loaded after modules-common.js, exchange.js and earn.js.
 */
var AppTabs = (function () {
    var STORAGE_KEY = 'coinman_open_tabs';

    var TABS = {
        portfolio: { title: 'Portfolio', icon: '❤' },
        'exchange:bestrate': { title: 'Best Rate', icon: '◇' },
        'exchange:lifi': { title: 'Li-Fi', icon: '◇' },
        'exchange:cowswap': { title: 'CoW Swap', icon: '◇' },
        'exchange:jumper': { title: 'Jumper', icon: '◇' },
        'exchange:approvals': { title: 'Approvals', icon: '✓' },
        'earn:yearn': { title: 'Yearn Finance', icon: '◈' },
    };

    var openTabs = [];
    var activeTab = 'portfolio';

    function load() {
        try {
            var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            if (Array.isArray(saved)) {
                saved.forEach(function (key) {
                    if (TABS[key] && openTabs.indexOf(key) < 0) openTabs.push(key);
                });
            }
        } catch (e) {}
        // Portfolio can be moved but never closed.
        if (openTabs.indexOf('portfolio') < 0) openTabs.unshift('portfolio');
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(openTabs));
        } catch (e) {}
    }

    /** The tab that matches what is on screen now. */
    function currentKey() {
        var kit = window.AppModuleKit;
        var view = kit ? kit.getCurrentView() : 'portfolio';
        if (view === 'exchange' && window.AppExchange) {
            return 'exchange:' + window.AppExchange.getActiveModule();
        }
        if (view === 'earn') return 'earn:yearn';
        return 'portfolio';
    }

    function render() {
        var bar = document.getElementById('window-tabs');
        if (!bar) return;
        var esc = window.Utils && window.Utils.escapeHtml ? window.Utils.escapeHtml : String;
        bar.innerHTML = openTabs.map(function (key) {
            var tab = TABS[key];
            var close = key === 'portfolio' ? '' :
                '<span class="window-tab-close" title="Close tab" data-close="' + esc(key) + '">×</span>';
            return '<div class="window-tab' + (key === activeTab ? ' active' : '') + '"' +
                ' data-tab="' + esc(key) + '" title="' + esc(tab.title) + '">' +
                '<span class="window-tab-icon">' + tab.icon + '</span>' +
                '<span class="window-tab-title">' + esc(tab.title) + '</span>' +
                close + '</div>';
        }).join('');
    }

    /** Called after every view switch: adds the shown module's tab and marks it. */
    function sync() {
        var key = currentKey();
        if (!TABS[key]) key = 'portfolio';
        if (openTabs.indexOf(key) < 0) {
            openTabs.push(key);
            save();
        }
        activeTab = key;
        render();
    }

    function activate(key) {
        if (!TABS[key]) return;
        if (key === 'portfolio') {
            window.AppModuleKit.switchView('portfolio');
        } else if (key.indexOf('exchange:') === 0) {
            window.AppExchange.selectExchangeModule(key.slice('exchange:'.length));
        } else if (key.indexOf('earn:') === 0) {
            window.AppEarn.selectEarnModule(key.slice('earn:'.length));
        }
    }

    function close(key) {
        var index = openTabs.indexOf(key);
        if (key === 'portfolio' || index < 0) return;
        openTabs.splice(index, 1);
        save();
        // jumper.xyz and swap.cow.fi (Linux/macOS) are native views; take them
        // off screen with their tab.
        if (key === 'exchange:jumper' && window.CoinmanJumper) window.CoinmanJumper.hide();
        if (key === 'exchange:cowswap' && window.CoinmanCowView) window.CoinmanCowView.hide();
        if (key === activeTab) {
            activate(openTabs[Math.min(index, openTabs.length - 1)] || 'portfolio');
        } else {
            render();
        }
    }

    /* ── drag to reorder ────────────────────────────────────────────────
       Mouse events, not HTML5 drag-and-drop: the webview's native file drop
       handling can swallow HTML5 drags. A tab starts moving after 5px; it
       swaps with a neighbour once the pointer passes that neighbour's middle. */

    var suppressClick = false;

    function initDrag(bar) {
        var drag = null;

        bar.addEventListener('mousedown', function (e) {
            if (e.button !== 0 || e.target.closest('[data-close]')) return;
            var tabEl = e.target.closest('[data-tab]');
            if (!tabEl) return;
            // Otherwise the press starts a text selection across the page.
            e.preventDefault();
            drag = { key: tabEl.getAttribute('data-tab'), startX: e.clientX, moving: false };
        });

        document.addEventListener('mousemove', function (e) {
            if (!drag) return;
            if (!drag.moving) {
                if (Math.abs(e.clientX - drag.startX) < 5) return;
                drag.moving = true;
                bar.classList.add('dragging');
                document.body.classList.add('window-tabs-dragging');
            }
            e.preventDefault();
            var from = openTabs.indexOf(drag.key);
            var els = bar.querySelectorAll('[data-tab]');
            var to = from;
            for (var i = 0; i < els.length; i++) {
                var r = els[i].getBoundingClientRect();
                var mid = r.left + r.width / 2;
                if (i < from && e.clientX < mid) { to = i; break; }
                if (i > from && e.clientX > mid) to = i;
            }
            if (to !== from) {
                openTabs.splice(from, 1);
                openTabs.splice(to, 0, drag.key);
                render();
            }
            var moved = bar.querySelector('[data-tab="' + drag.key + '"]');
            if (moved) moved.classList.add('drag-source');
        });

        document.addEventListener('mouseup', function () {
            if (!drag) return;
            if (drag.moving) {
                suppressClick = true;
                setTimeout(function () { suppressClick = false; }, 0);
                bar.classList.remove('dragging');
                document.body.classList.remove('window-tabs-dragging');
                save();
                render();
            }
            drag = null;
        });
    }

    function init() {
        load();
        var bar = document.getElementById('window-tabs');
        if (bar) {
            bar.addEventListener('click', function (e) {
                if (suppressClick) {
                    suppressClick = false;
                    return;
                }
                var closeEl = e.target.closest('[data-close]');
                if (closeEl) {
                    e.stopPropagation();
                    close(closeEl.getAttribute('data-close'));
                    return;
                }
                var tabEl = e.target.closest('[data-tab]');
                if (tabEl) activate(tabEl.getAttribute('data-tab'));
            });
            initDrag(bar);
            // Middle click closes a tab, as in a browser.
            bar.addEventListener('auxclick', function (e) {
                if (e.button !== 1) return;
                var tabEl = e.target.closest('[data-tab]');
                if (tabEl) close(tabEl.getAttribute('data-tab'));
            });
            bar.addEventListener('mousedown', function (e) {
                if (e.button === 1) e.preventDefault();
            });
        }
        sync();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        sync: sync,
        activate: activate,
        close: close,
    };
})();

window.AppTabs = AppTabs;
