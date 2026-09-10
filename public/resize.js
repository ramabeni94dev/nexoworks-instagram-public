(function () {
  // A page can embed both layouts and include this script more than once.
  if (window.__nexoInstagramResizeBound) return;
  window.__nexoInstagramResizeBound = true;
  window.addEventListener('message', function (event) {
    if (event.data?.type !== 'nexo-instagram:resize') return;
    const height = event.data.height;
    if (!Number.isInteger(height) || height < 120 || height > 15000) return;
    document.querySelectorAll('iframe[data-nexo-instagram]').forEach(function (frame) {
      if (event.source !== frame.contentWindow || event.origin !== new URL(frame.src, location.href).origin) return;
      frame.style.height = height + 'px';
    });
  });
  function requestSizes() {
    document.querySelectorAll('iframe[data-nexo-instagram]').forEach(function (frame) {
      const request = function () {
        frame.contentWindow?.postMessage({ type: 'nexo-instagram:measure' }, new URL(frame.src, location.href).origin);
      };
      frame.addEventListener('load', request, { once: true });
      request();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', requestSizes, { once: true });
  else requestSizes();
})();
