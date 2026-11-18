// SUNSET BAY — boot: parse URL params, build the game, run the loop.
// Written fresh for this entry.
window.SB = window.SB || {};

(function () {
  'use strict';

  function params() {
    const q = new URLSearchParams(window.location.search);
    return {
      seed: parseInt(q.get('seed') || '1337', 10) || 1337,
      lowfx: q.get('lowfx') === '1',
      shot: q.get('shot') || null,
    };
  }

  function boot() {
    const p = params();
    const game = new window.SB.Game({
      seed: p.seed,
      lowfx: p.lowfx,
      shot: p.shot,
    });
    game.applyShotMode();
    let last = performance.now();
    function loop(now) {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      try {
        game.frame(dt);
      } catch (e) {
        console.error(e);
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
