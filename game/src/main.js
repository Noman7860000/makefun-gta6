// SUNSET BAY — boot. Creates the game and starts it. Classic script.
// ?seed=N fixes the city. ?shot=start|drive|chase|mission stages a scene for
// screenshots and sets window.__shotReady once it has painted.
(function () {
  'use strict';
  function boot() {
    if (typeof THREE === 'undefined') {
      document.body.innerHTML = '<p style="color:#fff;font:16px Arial;padding:40px">Could not load the 3D library (game/vendor/three.min.js). Please reload.</p>';
      return;
    }
    const game = new window.SBGame();
    game.init();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
