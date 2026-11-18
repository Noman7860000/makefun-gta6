// SUNSET BAY — story missions. Five jobs for fixer Slim Vasquez and Rosa Marín,
// played in order. Each mission is a list of steps; the runner interprets them
// against the live game context (player, car, wanted, events). Classic script.

(function (global) {
  'use strict';

  // Step types:
  //  goto {at, r, needCar?, text} — reach a point
  //  stealCar {text, specific?} — get into a car (any, or the marked one)
  //  pickup {at, count, text} — crew members walk to your car
  //  fight {at, count, text} — defeat N enemies spawned at the point
  //  rob {at, r, seconds, text} — stand in the zone while the meter fills
  //  loseHeat {text} — get wanted down to zero
  //  deliver {at, r, timeLimit?, text} — reach a point in a car, optional timer
  // Steps may carry `say` (dialogue lines) and `want` (wanted stars to set on entry).

  function missionList(L) {
    return [
      {
        id: 'm1', title: 'First Wheels', giver: 'Slim Vasquez', reward: 300,
        brief: 'Slim needs a car, no questions asked. Jack one off the street and bring it to his garage.',
        intro: [
          { who: 'Slim', text: 'Cole, baby. I need wheels, and I need them hot.' },
          { who: 'Cole', text: 'You always need something, Slim.' },
          { who: 'Slim', text: 'Walk up to a parked car, press E, and drive it to my garage. Easy money.' },
        ],
        steps: [
          { type: 'stealCar', text: 'Steal a car (walk up to one and press E)' },
          { type: 'goto', at: L.garage, r: 8, needCar: true, text: "Drive the car to Slim's garage" },
        ],
      },
      {
        id: 'm2', title: 'The Getaway', giver: 'Slim Vasquez', reward: 600,
        brief: 'Slim\u2019s crew hit a warehouse at the docks. Pick them up and lose the cops.',
        intro: [
          { who: 'Slim', text: 'My boys are stuck at the docks with the law breathing down their necks.' },
          { who: 'Slim', text: 'Pick them up. And Cole? Drive like your life depends on it. It does.' },
        ],
        steps: [
          { type: 'pickup', at: L.docks, count: 2, text: 'Pick up the crew at the docks' },
          { type: 'goto', at: L.safehouse, r: 9, needCar: true, want: 2, text: 'Escape to the safehouse — lose the cops on the way', say: [{ who: 'Crew', text: 'Cops! Go go go!' }] },
        ],
      },
      {
        id: 'm3', title: 'Hot Delivery', giver: 'Rosa Marín', reward: 500,
        brief: 'A package at the docks. The mall. Ninety seconds. The cops are already curious.',
        intro: [
          { who: 'Rosa', text: 'One package, one driver, no mistakes. The docks, then the mall.' },
          { who: 'Rosa', text: 'Ninety seconds once you have it. The police will be watching.' },
        ],
        steps: [
          { type: 'goto', at: L.docks, r: 6, text: 'Pick up the package at the docks' },
          { type: 'deliver', at: L.mall, r: 8, timeLimit: 90, want: 1, text: 'Deliver to the mall — 90 seconds!', say: [{ who: 'Rosa', text: 'Clock is running, Cole. Move!' }] },
        ],
      },
      {
        id: 'm4', title: 'Repo Man', giver: 'Slim Vasquez', reward: 800,
        brief: 'A gold sports car at the casino belongs to Slim now. Two guards disagree. Bring it back in one piece.',
        intro: [
          { who: 'Slim', text: 'There is a gold comet sitting at the casino. It has my name on it. Spiritually.' },
          { who: 'Slim', text: 'Two guards. Handle them, take the car, bring it to my garage. Don\u2019t scratch it.' },
        ],
        steps: [
          { type: 'fight', at: L.casino, count: 2, text: 'Deal with the guards at the casino' },
          { type: 'stealCar', specific: true, at: L.casino, text: 'Steal the gold car' },
          { type: 'goto', at: L.garage, r: 8, needCar: true, text: "Deliver the gold car to Slim's garage", keepHp: 40 },
        ],
      },
      {
        id: 'm5', title: 'The Sunset Heist', giver: 'Rosa Marín', reward: 2500,
        brief: 'The big one. Crack the casino vault, grab the cash, and vanish into the sunset.',
        intro: [
          { who: 'Rosa', text: 'The casino vault. Eight seconds inside and we are rich. The hard part is leaving.' },
          { who: 'Rosa', text: 'Three stars the moment the alarm trips. Get to the safehouse, Cole. Don\u2019t look back.' },
        ],
        steps: [
          { type: 'rob', at: L.casino, r: 7, seconds: 8, text: 'Crack the vault — stay in the zone' },
          { type: 'goto', at: L.safehouse, r: 9, want: 3, text: 'Escape to the safehouse with the cash', say: [{ who: 'Rosa', text: 'Alarm is up! Every cop in Sunset Bay is coming. GO!' }] },
        ],
      },
    ];
  }

  // The runner. ctx is supplied by game.js each frame:
  // { playerPos, inCar, car, wanted, setWanted(n), events[], say(who,text),
  //   setObjective(text, marker), spawnEnemies(at,count), spawnCrew(at,count),
  //   spawnMarkedCar(at), markedCar, crewInCar, addCash(n), onFail(reason) }
  function MissionRunner(list) {
    this.list = list;
    this.current = null;   // mission object
    this.stepIdx = 0;
    this.stepState = {};   // per-step scratch
    this.timer = 0;
    this.active = false;
    this.completed = [];   // ids
  }

  MissionRunner.prototype.start = function (id, ctx) {
    const m = this.list.find((x) => x.id === id);
    if (!m) return false;
    this.current = m;
    this.stepIdx = 0;
    this.stepState = {};
    this.active = true;
    this.timer = 0;
    this._enterStep(ctx);
    if (m.intro) m.intro.forEach((l) => ctx.say(l.who, l.text));
    return true;
  };

  MissionRunner.prototype._step = function () {
    return this.current ? this.current.steps[this.stepIdx] : null;
  };

  MissionRunner.prototype._enterStep = function (ctx) {
    const s = this._step();
    this.stepState = {};
    this.timer = 0;
    if (!s) return;
    if (s.want !== undefined) ctx.setWanted(s.want);
    if (s.say) s.say.forEach((l) => ctx.say(l.who, l.text));
    if (s.type === 'fight') ctx.spawnEnemies(s.at, s.count);
    if (s.type === 'pickup') ctx.spawnCrew(s.at, s.count);
    if (s.type === 'stealCar' && s.specific) ctx.spawnMarkedCar(s.at);
    ctx.setObjective(s.text, s.at || null);
  };

  MissionRunner.prototype._next = function (ctx) {
    this.stepIdx++;
    if (this.stepIdx >= this.current.steps.length) {
      this._complete(ctx);
    } else {
      this._enterStep(ctx);
    }
  };

  MissionRunner.prototype._complete = function (ctx) {
    const m = this.current;
    this.completed.push(m.id);
    this.active = false;
    ctx.addCash(m.reward);
    ctx.setObjective('Mission complete: ' + m.title + '  +' + '$' + m.reward, null);
    ctx.jingle();
    this.current = null;
    this.stepIdx = 0;
  };

  MissionRunner.prototype.fail = function (ctx, reason) {
    this.active = false;
    this.current = null;
    this.stepIdx = 0;
    ctx.setObjective('', null);
    if (ctx.onFail) ctx.onFail(reason);
  };

  MissionRunner.prototype.update = function (dt, ctx) {
    if (!this.active || !this.current) return;
    const s = this._step();
    if (!s) return;
    this.timer += dt;
    const px = ctx.playerPos.x, pz = ctx.playerPos.z;
    const d = s.at ? Math.hypot(px - s.at.x, pz - s.at.z) : 9999;

    if (s.type === 'goto') {
      if (d < s.r && (!s.needCar || ctx.inCar)) this._next(ctx);
    } else if (s.type === 'stealCar') {
      if (ctx.inCar && (!s.specific || ctx.inMarkedCar)) this._next(ctx);
    } else if (s.type === 'pickup') {
      if (ctx.crewInCar >= s.count) this._next(ctx);
      else if (ctx.inCar && d < 14) ctx.crewBoard();
    } else if (s.type === 'fight') {
      if (ctx.enemiesDown >= s.count) this._next(ctx);
    } else if (s.type === 'rob') {
      if (d < s.r) {
        this.stepState.held = (this.stepState.held || 0) + dt;
        ctx.setProgress(this.stepState.held / s.seconds);
        if (this.stepState.held >= s.seconds) { ctx.setProgress(0); this._next(ctx); }
      } else {
        this.stepState.held = Math.max(0, (this.stepState.held || 0) - dt * 2);
        ctx.setProgress(this.stepState.held / s.seconds);
      }
    } else if (s.type === 'deliver') {
      const left = s.timeLimit - this.timer;
      ctx.setTimer(Math.max(0, left));
      if (d < s.r && ctx.inCar) { ctx.setTimer(0); this._next(ctx); }
      else if (left <= 0) { ctx.setTimer(0); this.fail(ctx, 'Delivery too slow — the buyer walked.'); }
    } else if (s.type === 'loseHeat') {
      if (ctx.wanted === 0) this._next(ctx);
    }
    // Car-wreck guard for repo job.
    if (s.keepHp && ctx.inCar && ctx.car && ctx.car.hp < s.keepHp) {
      this.fail(ctx, 'The car is too damaged — Slim will not pay for a wreck.');
    }
  };

  global.SBMissions = { missionList: missionList, MissionRunner: MissionRunner };
})(window);
