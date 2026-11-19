// SUNSET BAY — main.js
// Boot: read the URL parameters (?seed=, ?lowfx=, ?shot=), create the game,
// and publish the debug API the verification harnesses use.
(function () {
  'use strict';

  function param(name, fallback) {
    try {
      var v = new URLSearchParams(window.location.search).get(name);
      return v === null || v === '' ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  var seed = parseInt(param('seed', '1337'), 10);
  if (isNaN(seed)) seed = 1337;
  var lowfx = param('lowfx', '0') === '1';
  var shot = param('shot', null);

  var canvas = document.getElementById('game');
  var game = new window.SB.game.Game(canvas, { seed: seed, lowfx: lowfx, shot: shot });

  // Debug / verification API.
  window.SUNSET = {
    state: function () { return game.getState(); },
    game: game,
    teleport: function (x, z) { game.teleport(x, z); },
    startMission: function (id) { return game.startMission(id); },
    setWanted: function (n) { game.setWanted(n); },
    giveCash: function (n) { game.giveCash(n); },
  };

  window.__shotReady = false;
  if (shot) game.setupShot(shot);
})();
