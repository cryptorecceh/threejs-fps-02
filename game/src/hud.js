// The DOM HUD: crosshair, hit marker, health/armor/ammo/money, top bar with round
// scores and timer, killfeed, minimap, plant bar, damage vignette, scope overlay,
// round banner, buy menu and the start/pause/round-end/match-end overlays with the
// scoreboard. It never touches the simulation; main.js pushes numbers in.
const COPY = {
  start: {
    title: 'Dustline Yard',
    copy: 'A desert freight yard. Vipers attack, Jackals defend. Plant the charge or clear the enemy team — first to 8 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'Dustline Yard',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const scoreboard = $('scoreboard');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const ammoBox = $('ammo');
  const healthNum = $('health-num');
  const healthFill = $('health-fill');
  const armorNum = $('armor-num');
  const moneyValue = $('money-value');
  const roundLabel = $('round-label');
  const scoreViper = $('score-viper');
  const scoreJackal = $('score-jackal');
  const timerEl = $('timer');
  const bombTimerEl = $('bomb-timer');
  const killfeed = $('killfeed');
  const hintEl = $('hint');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const vignette = $('vignette');
  const scope = $('scope');
  const banner = $('banner');
  const bannerText = $('banner-text');
  const bannerSub = $('banner-sub');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const buyMenu = $('buymenu');
  const buyMoney = $('buy-money');
  const minimap = $('minimap');
  const mapCtx = minimap.getContext('2d');

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTop = '';

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function scoreboardHtml(rows, viperScore, jackalScore) {
    const teamRows = (team) => rows
      .filter((r) => r.team === team)
      .map((r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.name}</td><td>${r.kills}</td><td>${r.deaths}</td><td>$${r.money}</td></tr>`)
      .join('');
    return `<table><thead><tr><th>Player</th><th>K</th><th>D</th><th>$</th></tr></thead>
      <tbody><tr class="teamrow"><td colspan="4">Vipers — ${viperScore}</td></tr>${teamRows('viper')}
      <tr class="teamrow"><td colspan="4">Jackals — ${jackalScore}</td></tr>${teamRows('jackal')}</tbody></table>`;
  }

  return {
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve && name === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = name;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setHealth(health, armor) {
      if (health === lastHealth && armor === lastArmor) return;
      lastHealth = health;
      lastArmor = armor;
      healthNum.textContent = String(Math.ceil(health));
      healthFill.style.width = `${Math.max(0, health)}%`;
      healthFill.classList.toggle('low', health <= 30);
      armorNum.textContent = String(armor);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value.toLocaleString('en-US')}`;
    },
    setTop(round, viperScore, jackalScore, secondsLeft, bombSeconds) {
      const key = `${round}|${viperScore}|${jackalScore}|${Math.ceil(secondsLeft)}|${bombSeconds === null ? '' : Math.ceil(bombSeconds)}`;
      if (key === lastTop) return;
      lastTop = key;
      roundLabel.textContent = `Round ${round}`;
      scoreViper.textContent = String(viperScore);
      scoreJackal.textContent = String(jackalScore);
      timerEl.textContent = formatTime(secondsLeft);
      timerEl.classList.toggle('urgent', secondsLeft <= 10);
      if (bombSeconds === null) {
        bombTimerEl.hidden = true;
      } else {
        bombTimerEl.hidden = false;
        bombTimerEl.textContent = `BOMB ${formatTime(bombSeconds)}`;
      }
    },
    killfeed(html) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = html;
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => row.classList.add('fade'), 4200);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    setCrosshair(spreadPx) {
      crosshair.style.setProperty('--gap', `${Math.round(spreadPx)}px`);
    },
    hint(text) {
      hintEl.textContent = text ?? '';
      hintEl.hidden = !text;
    },
    setPlant(progress) {
      if (progress === null) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    damageFlash() {
      vignette.classList.remove('flash');
      void vignette.offsetWidth;
      vignette.classList.add('flash');
    },
    setScoped(on) {
      scope.hidden = !on;
      crosshair.style.visibility = on ? 'hidden' : 'visible';
    },
    banner(text, sub = '', ms = 2600) {
      bannerText.textContent = text;
      bannerSub.textContent = sub;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.hidden = true;
    },
    showBuy(open, money, owned) {
      buyMenu.hidden = !open;
      if (!open) return;
      buyMoney.textContent = `$${money.toLocaleString('en-US')}`;
      for (const item of buyMenu.querySelectorAll('[data-weapon]')) {
        const id = item.dataset.weapon;
        item.classList.toggle('owned', !!owned[id]);
      }
      for (const item of buyMenu.querySelectorAll('[data-item="armor"]')) {
        item.classList.toggle('owned', owned.armor);
      }
    },
    showOverlay(mode, data = {}) {
      const panel = overlay.querySelector('.panel');
      panel.classList.toggle('with-score', mode === 'roundEnd' || mode === 'matchEnd');
      if (mode === 'start' || mode === 'paused') {
        const text = COPY[mode];
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
        scoreboard.innerHTML = '';
      } else if (mode === 'roundEnd') {
        title.textContent = data.title;
        copy.textContent = data.copy;
        play.textContent = 'Next round';
        scoreboard.innerHTML = scoreboardHtml(data.rows, data.viperScore, data.jackalScore);
      } else if (mode === 'matchEnd') {
        title.textContent = data.title;
        copy.textContent = data.copy;
        play.textContent = 'Play again';
        scoreboard.innerHTML = scoreboardHtml(data.rows, data.viperScore, data.jackalScore);
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyMenu.addEventListener('click', (event) => {
        const item = event.target.closest('[data-weapon], [data-item]');
        if (!item) return;
        handler(item.dataset.weapon ?? item.dataset.item);
      });
    },
    drawMinimap(playerPos, playerYaw, bots, bomb, sites) {
      const W = minimap.width;
      const H = minimap.height;
      const sx = (x) => ((x + 23) / 46) * (W - 16) + 8;
      const sz = (z) => ((z + 19) / 38) * (H - 16) + 8;
      mapCtx.clearRect(0, 0, W, H);
      mapCtx.fillStyle = 'rgba(20,16,10,0.72)';
      mapCtx.fillRect(0, 0, W, H);
      mapCtx.strokeStyle = '#a89a7c';
      mapCtx.lineWidth = 2;
      mapCtx.strokeRect(sx(-23), sz(-19), sx(23) - sx(-23), sz(19) - sz(-19));
      // Sites.
      for (const site of sites) {
        mapCtx.beginPath();
        mapCtx.arc(sx(site.center.x), sz(site.center.z), 9, 0, Math.PI * 2);
        mapCtx.strokeStyle = '#f0a830';
        mapCtx.lineWidth = 1.5;
        mapCtx.stroke();
        mapCtx.fillStyle = '#f0a830';
        mapCtx.font = 'bold 11px system-ui, sans-serif';
        mapCtx.textAlign = 'center';
        mapCtx.textBaseline = 'middle';
        mapCtx.fillText(site.name, sx(site.center.x), sz(site.center.z));
      }
      // Bomb blip.
      if (bomb && bomb.planted) {
        mapCtx.fillStyle = '#ff3b30';
        mapCtx.beginPath();
        mapCtx.arc(sx(bomb.position.x), sz(bomb.position.z), 5, 0, Math.PI * 2);
        mapCtx.fill();
      }
      // Bots.
      for (const bot of bots) {
        if (!bot.alive) continue;
        mapCtx.fillStyle = bot.team === 'viper' ? '#3f7fd0' : '#e07020';
        mapCtx.beginPath();
        mapCtx.arc(sx(bot.group.position.x), sz(bot.group.position.z), 3.5, 0, Math.PI * 2);
        mapCtx.fill();
      }
      // Player arrow.
      const px = sx(playerPos.x);
      const pz = sz(playerPos.z);
      mapCtx.save();
      mapCtx.translate(px, pz);
      mapCtx.rotate(Math.atan2(Math.sin(playerYaw), -Math.cos(playerYaw)) * -1 + Math.PI);
      mapCtx.fillStyle = '#ffffff';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -7);
      mapCtx.lineTo(5, 5);
      mapCtx.lineTo(-5, 5);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    },
  };
}
