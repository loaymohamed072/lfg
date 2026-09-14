/* Hold a deep link on its target while the page finishes settling.
   ============================================================
   A link into a section (/bootcamp/payitforward -> /bootcamp#give,
   /coaching -> /#coaching) is scrolled by the browser as soon as the target
   exists, which is before the sections ABOVE it have their final height. On
   the bootcamp page those sections then grow by ~1233px and carry the target
   off screen: you land in the right place and get pushed out of it a moment
   later. Chrome's scroll anchoring papers over this sometimes and not others,
   which is exactly why the same link looked right on one machine and wrong on
   another (Loay, 14 Sep).

   So: re-apply the target every time the document's height changes, until it
   stops changing or the reader takes over. Any scroll, tap, or key press means
   the reader is driving and we get out of the way for good. */
(function () {
  var id = decodeURIComponent((location.hash || "").slice(1));
  if (!id) return;

  var root = document.documentElement;
  var observer = null;
  var timer = null;
  var released = false;

  function release() {
    if (released) return;
    released = true;
    if (observer) { observer.disconnect(); observer = null; }
    if (timer) { clearTimeout(timer); timer = null; }
    window.removeEventListener("load", pin);
  }

  function pin() {
    if (released) return;
    var target = document.getElementById(id);
    if (!target) return;
    // scroll-behavior: smooth would animate toward a target that is still
    // moving and never catch it, so land instantly while things settle. The
    // page's own behaviour is put straight back for the reader's own clicks.
    var previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    target.scrollIntoView({ block: "start" });
    root.style.scrollBehavior = previous;
  }

  ["wheel", "touchstart", "keydown", "pointerdown"].forEach(function (event) {
    window.addEventListener(event, release, { passive: true, once: true });
  });

  window.addEventListener("load", pin);

  if (window.ResizeObserver && document.body) {
    // Body height changing IS the event that breaks the anchor, so watch that
    // rather than polling on a timer.
    observer = new ResizeObserver(pin);
    observer.observe(document.body);
  }

  // Late images and fetches are done well inside this; after it the reader owns
  // the scroll no matter what still moves.
  timer = setTimeout(release, 4000);

  pin();
})();
