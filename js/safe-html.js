/* ============================================================
   Paramedic Papers — the one way markup gets into the page
   (modern-web-guidance security/trusted-types, phase 6).

   The pages send a Content-Security-Policy with
   require-trusted-types-for 'script', so in supporting browsers a plain
   string assigned to innerHTML throws. Every view builds its markup from
   app-written templates with data passed through esc(), then hands it to
   window.ppSetHTML(el, html), which goes through the single 'pp' policy
   below. The same policy vouches for the one script URL the page loads
   by hand: the service worker (window.ppScriptURL('/sw.js')).

   The policy is a last line of defence, not a sanitiser for outside HTML:
   esc() should already have made data harmless. If a template ever lets
   something through, the policy defuses it before the browser sees it:
   - script-capable tags (script, iframe, object, embed, base, meta, link,
     style, frame, frameset, template, svg <foreignObject>) become text;
   - on* event handler attributes are removed;
   - href/src/action/formaction/xlink:href/poster values that start with
     javascript:, vbscript: or data: (other than data:image/) are removed.
   Each defused piece is logged, so it shows up while testing.

   Browsers without Trusted Types still get the same checks.
   ============================================================ */

(function () {
  'use strict';

  var BAD_TAG = /<(\/?)\s*(script|iframe|object|embed|base|meta|link|style|frame|frameset|template|foreignobject|noscript)\b/gi;
  var TAG = /<[a-z][a-z0-9-]*(?:\s[^<>]*)?>/gi;
  var ATTR = /(\s)([^\s"'<>\/=]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  var URL_ATTR = /^(href|src|action|formaction|xlink:href|poster|srcset|ping)$/i;
  var BAD_URL = /^(?:javascript|vbscript|data(?!:image\/(?:png|jpe?g|gif|webp|avif);))\s*:/i;

  function warn(what) {
    try { console.warn('[pp] removed ' + what); } catch (e) {}
  }

  /* Undo the entity escapes a scheme could hide behind (&#106;avascript:,
     java&#x09;script:) and drop the whitespace/control characters URL
     parsing ignores, so the scheme check sees what the browser would. */
  function plainUrl(v) {
    var s = v.replace(/^\s*["']?|["']?\s*$/g, '')
      .replace(/&#x([0-9a-f]+);?/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);?/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/&colon;/gi, ':').replace(/&tab;|&newline;/gi, '');
    return s.replace(/[\u0000- \u007f-\u009f]/g, '');
  }

  function cleanTag(tag) {
    return tag.replace(ATTR, function (all, sp, name, val) {
      if (/^on/i.test(name)) { warn(name + ' handler'); return ''; }
      if (/^srcdoc$/i.test(name)) { warn('srcdoc'); return ''; }
      if (val && URL_ATTR.test(name) && BAD_URL.test(plainUrl(val.replace(/^\s*=\s*/, '')))) {
        warn(name + ' URL'); return '';
      }
      return all;
    });
  }

  function guard(html) {
    var s = String(html == null ? '' : html);
    s = s.replace(BAD_TAG, function (all) { warn(all + ' tag'); return '&lt;' + all.slice(1); });
    return s.replace(TAG, cleanTag);
  }

  /* Only our own service worker may be started from script. */
  function scriptURL(url) {
    if (url === '/sw.js') return url;
    throw new TypeError('[pp] script URL not allowed: ' + url);
  }

  var rules = { createHTML: guard, createScriptURL: scriptURL };
  var policy = rules;
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    try { policy = window.trustedTypes.createPolicy('pp', rules); }
    catch (e) { /* name already taken (should never happen): keep the plain checks */ }
  }

  window.ppSetHTML = function (el, html) {
    el.innerHTML = policy.createHTML(html);
  };
  window.ppScriptURL = function (url) { return policy.createScriptURL(url); };
  window.ppGuardHTML = guard;  /* exposed for tests */
})();
