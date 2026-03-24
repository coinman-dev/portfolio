/**
 * CoinMan Template Engine (coinman-tpl.js)
 *
 * Handlebars-inspired mini-engine for CoinMan Portfolio Tracker.
 *
 * Syntax
 * ──────
 *   {{VAR}}                                      – escaped variable
 *   {{{VAR}}}                                    – raw (unescaped) variable
 *   <!--{{#NAME}}-->    …  <!--{{/NAME}}-->       – loop  (array → N renders,
 *                                                   object → 1 render)
 *   <!--{{#if VAR}}-->  …  <!--{{/if}}-->         – conditional
 *   <!--{{else}}-->                               – else branch inside if
 *
 * HTML attribute
 * ──────────────
 *   data-tpl-root="NAME"  – named root: entire innerHTML is stored as
 *                            template "NAME" and cleared from the DOM.
 *   data-tpl-root          – unnamed root: scanned for <!--{{#NAME}}-->
 *                            blocks which are extracted as named templates.
 */

var CoinmanTpl = {

    /* ── storage ──────────────────────────────────────────────────────────── */
    _templates: {},

    /* ── public API ───────────────────────────────────────────────────────── */

    /**
     * Scan every [data-tpl-root] container and extract named template blocks:
     *
     *   data-tpl-root="NAME"  → entire innerHTML stored as "NAME"
     *
     *   data-tpl-root (no value) → scans for <!--{{#NAME}}--> blocks
     *     → each block stored as "NAME": content
     */
    init: function () {
        var self = this;
        var roots = document.querySelectorAll("[data-tpl-root]");

        /* regex for  <!--{{#NAME}}--> ... <!--{{/NAME}}--> */
        var reBlock = /<!--\{\{#([A-Za-z0-9_]+)\}\}-->([\s\S]*?)<!--\{\{\/\1\}\}-->/g;

        for (var i = 0; i < roots.length; i++) {
            var el = roots[i];
            var name = el.getAttribute("data-tpl-root");

            if (name) {
                /* named root: entire innerHTML is the template */
                self._templates[name] = el.innerHTML;
                el.innerHTML = "";
            } else {
                /* unnamed root: extract <!--{{#NAME}}--> blocks */
                var html = el.innerHTML;
                html = html.replace(reBlock, function (_m, bname, content) {
                    self._templates[bname] = content;
                    return "";
                });
                reBlock.lastIndex = 0;
                el.innerHTML = html;
            }
        }
    },

    /**
     * Render a previously-extracted named template with the given data.
     * Returns an HTML string.
     *
     *   • data is an Array  → template is rendered once per item; results
     *                          are concatenated.
     *   • data is an Object → template is rendered once with data as context.
     *
     * @param {string}         name – template name (registered by init)
     * @param {Object|Array}   data – context object or array of context objects
     * @returns {string} rendered HTML
     */
    render: function (name, data) {
        var tpl = this._templates[name];
        if (!tpl) {
            console.warn("CoinmanTpl: template '" + name + "' not found");
            return "";
        }
        if (Array.isArray(data)) {
            var out = "";
            for (var i = 0; i < data.length; i++) {
                out += this._process(tpl, data[i]);
            }
            return out;
        }
        return this._process(tpl, data || {});
    },

    /* ── internal processing pipeline ─────────────────────────────────────── */

    /**
     * Full processing pipeline for a template string.
     * Order: with → if → loops → raw vars → escaped vars.
     */
    _process: function (tpl, data) {
        tpl = this._processWith(tpl, data);
        tpl = this._processIf(tpl, data);
        tpl = this._processLoops(tpl, data);
        tpl = this._processRawVars(tpl, data);
        tpl = this._processEscVars(tpl, data);
        return tpl;
    },

    /**
     * <!--{{#with NAME}}--> … <!--{{/with}}-->
     *
     * Changes context to data[NAME] and renders the block once.
     * If data[NAME] is falsy the block is skipped.
     */
    _processWith: function (tpl, data) {
        var self = this;
        return tpl.replace(
            /<!--\{\{#with\s+([A-Za-z0-9_]+)\}\}-->([\s\S]*?)<!--\{\{\/with\}\}-->/g,
            function (_m, name, body) {
                var ctx = data[name];
                if (!ctx) return "";
                return self._process(body, ctx);
            },
        );
    },

    /**
     * <!--{{#if VAR}}--> … <!--{{else}}--> … <!--{{/if}}-->
     *
     * Truthy check: arrays are truthy when length > 0; everything else
     * follows standard JS truthiness.
     */
    _processIf: function (tpl, data) {
        var self = this;
        return tpl.replace(
            /<!--\{\{#if\s+([A-Za-z0-9_]+)\}\}-->([\s\S]*?)<!--\{\{\/if\}\}-->/g,
            function (_m, varName, body) {
                var parts = body.split("<!--{{else}}-->");
                var val = data[varName];
                var truthy = Array.isArray(val) ? val.length > 0 : !!val;
                if (truthy) {
                    return self._process(parts[0], data);
                }
                return parts.length > 1 ? self._process(parts[1], data) : "";
            },
        );
    },

    /**
     * <!--{{#NAME}}--> … <!--{{/NAME}}-->
     *
     * data[NAME] is an array  → block rendered once per item.
     * data[NAME] is an object → block rendered once with that object as ctx.
     * data[NAME] is falsy     → block skipped.
     */
    _processLoops: function (tpl, data) {
        var self = this;
        return tpl.replace(
            /<!--\{\{#([A-Za-z0-9_]+)\}\}-->([\s\S]*?)<!--\{\{\/\1\}\}-->/g,
            function (_m, name, body) {
                var items = data[name];
                if (!items) return "";
                if (!Array.isArray(items)) items = [items];
                var out = "";
                for (var i = 0; i < items.length; i++) {
                    out += self._process(body, items[i]);
                }
                return out;
            },
        );
    },

    /** {{{VAR}}} → raw value (no escaping) */
    _processRawVars: function (tpl, data) {
        return tpl.replace(
            /\{\{\{([A-Za-z0-9_]+)\}\}\}/g,
            function (_m, name) {
                var val = data[name];
                return val != null ? String(val) : "";
            },
        );
    },

    /** {{VAR}} → HTML-escaped value (lookbehind guards against {{{VAR}}}) */
    _processEscVars: function (tpl, data) {
        var self = this;
        return tpl.replace(
            /(?<!\{)\{\{([A-Za-z0-9_]+)\}\}(?!\})/g,
            function (_m, name) {
                var val = data[name];
                if (val == null) return "";
                return self._escapeHtml(String(val));
            },
        );
    },

    /* ── utility ──────────────────────────────────────────────────────────── */

    _escapeHtml: function (s) {
        return s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    },
};
