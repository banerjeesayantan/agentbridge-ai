/**
 * The sample "customer website" shown in the Playground preview.
 *
 * It is rendered in an iframe with `sandbox="allow-scripts"` and NO
 * `allow-same-origin`, so the page (and the third-party widget script it
 * loads) runs in an opaque origin: it cannot read the dashboard's cookies,
 * Clerk session or storage, and the dashboard cannot touch its window. The
 * dashboard and preview talk only through the postMessage protocol below
 * (every message carries `__ab: 1`).
 *
 *   parent -> preview: { __ab, id, cmd: "init"|"show"|"hide"|"destroy", args? }
 *   preview -> parent: { __ab, type: "ready", status, hasGetState }
 *                      { __ab, type: "result", id, ok, result?, error?, state }
 *                      { __ab, type: "state", state }   (widget changed itself)
 *                      { __ab, type: "log", level, message }
 */
export function buildPreviewDocument(scriptUrl: string): string {
  // JSON-encode, then neutralise "<" so the URL can never close the script tag.
  const url = JSON.stringify(scriptUrl).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;font-family:system-ui,sans-serif;color:#475569;background:#fff}
  header{padding:16px 24px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a}
  main{padding:24px;max-width:640px}
  .bar{height:12px;border-radius:6px;background:#e2e8f0;margin:12px 0}
  .bar.s{width:60%}.bar.m{width:80%}
  p{font-size:13px;color:#94a3b8}
</style></head>
<body><header>Sample website</header>
<main><div class="bar"></div><div class="bar m"></div><div class="bar s"></div><div class="bar"></div><div class="bar m"></div>
<p>This page stands in for your site. The widget loads into it exactly as it would in production.</p></main>
<script>
(function () {
  var P = window.parent;
  function post(m) { m.__ab = 1; P.postMessage(m, "*"); }

  ["warn", "error"].forEach(function (level) {
    var original = console[level].bind(console);
    console[level] = function () {
      original.apply(null, arguments);
      post({ type: "log", level: level, message: [].map.call(arguments, function (a) { return (a && a.message) || String(a); }).join(" ") });
    };
  });

  function api() { var a = window.AgentBridgeWidget; return a && typeof a.init === "function" ? a : null; }
  function state() { var a = api(); return a && typeof a.getState === "function" ? a.getState() : null; }

  var last = "";
  function pushState() {
    var s = state(), j = JSON.stringify(s);
    if (j !== last) { last = j; post({ type: "state", state: s }); }
  }

  window.addEventListener("message", function (e) {
    if (e.source !== P) return;
    var d = e.data;
    if (!d || d.__ab !== 1 || typeof d.id !== "number") return;
    var out = { type: "result", id: d.id, ok: false };
    var a = api();
    if (!a) { out.error = "bundle-not-ready"; post(out); return; }
    try {
      if (d.cmd === "init") out.result = a.init(d.args);
      else if (d.cmd === "show") a.show();
      else if (d.cmd === "hide") a.hide();
      else if (d.cmd === "destroy") a.destroy();
      else { out.error = "unknown-command"; post(out); return; }
      out.ok = true;
    } catch (err) { out.error = String((err && err.message) || err); }
    out.state = state();
    last = JSON.stringify(out.state);
    post(out);
  });

  var s = document.createElement("script");
  s.async = true;
  s.src = ${url};
  s.onload = function () {
    var a = api();
    post({ type: "ready", status: a ? "ready" : "missing-api", hasGetState: !!(a && typeof a.getState === "function") });
    if (a) { pushState(); setInterval(pushState, 400); }
  };
  s.onerror = function () { post({ type: "ready", status: "error" }); };
  document.body.appendChild(s);
})();
</script></body></html>`;
}
