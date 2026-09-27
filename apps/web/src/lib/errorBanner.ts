/**
 * An inline script for <head> that shows uncaught errors on screen in a
 * dismissible banner, so they can be read on a phone with no dev tools.
 *
 * It's plain ES5 with no dependencies on purpose: it has to run even when an
 * app bundle fails to parse or load on an older browser, which is exactly
 * when React never starts. It handles:
 *   - window "error" (what window.onerror sees), in the capture phase so
 *     failed <script>/<link> loads are reported too
 *   - "unhandledrejection"
 * Messages go in with textContent, never as HTML.
 */
export const ERROR_BANNER_SCRIPT = `(function () {
  var MAX = 5, count = 0, box = null;
  function container() {
    if (box && box.parentNode) return box;
    box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;font:12px/1.4 -apple-system,system-ui,sans-serif";
    document.body.appendChild(box);
    return box;
  }
  function show(message) {
    if (count >= MAX) return;
    count++;
    function add() {
      var item = document.createElement("div");
      item.style.cssText = "position:relative;margin-bottom:6px;padding:8px 36px 8px 10px;border:1px solid #fca5a5;border-radius:8px;background:#7f1d1d;color:#fff;white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow:auto;box-shadow:0 4px 16px rgba(0,0,0,.5)";
      item.textContent = message;
      var close = document.createElement("button");
      close.type = "button";
      close.textContent = "\\u00d7";
      close.setAttribute("aria-label", "Dismiss error");
      close.style.cssText = "position:absolute;top:2px;right:4px;padding:4px 8px;border:0;background:none;color:#fff;font-size:22px;line-height:1;cursor:pointer";
      close.onclick = function () {
        if (item.parentNode) item.parentNode.removeChild(item);
      };
      item.appendChild(close);
      container().appendChild(item);
    }
    if (document.body) add();
    else document.addEventListener("DOMContentLoaded", add);
  }
  function describe(err) {
    if (err === null || err === undefined) return "Unknown error";
    if (typeof err !== "object") return String(err);
    var text = (err.name ? err.name + ": " : "") + (err.message || String(err));
    if (err.stack) text += "\\n" + String(err.stack).split("\\n").slice(0, 6).join("\\n");
    return text;
  }
  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      show("Failed to load " + String(target.tagName || "resource").toLowerCase() + ": " + (target.src || target.href));
      return;
    }
    var where = event.filename ? "\\n" + event.filename + ":" + event.lineno + ":" + event.colno : "";
    show((event.error ? describe(event.error) : event.message || "Script error") + where);
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    show("Unhandled promise rejection: " + describe(event.reason));
  });
})();`;
