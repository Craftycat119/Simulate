// ui.js — интерфейс, экраны, игровой цикл. Использует GameState из engine.js.
'use strict';

const SAVE_KEY = 'life_sim_save_v1';
const AUTOSAVE_MS = 8000;

let gs = null;
let currentTab = 'home';
let currentSpecialSub = 'invest';
let currentInvestSub = 'crypto';
let tickTimer = null;
let autosaveTimer = null;
let tempAvatar = Object.assign({}, DEFAULT_AVATAR);

// ============================================================== УТИЛИТЫ UI
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

function showScreen(id) {
  $all('.screen').forEach(s => s.classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
}

function toast(text, kind, ms) {
  kind = kind || 'info';
  ms = ms || 4200;
  const t = el(`<div class="toast ${kind}">${escapeHtml(text)}</div>`);
  $('#toast-container').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity 0.3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtPct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }

function openModal(title, bodyHtml, opts) {
  opts = opts || {};
  const root = $('#modal-root');
  root.innerHTML = '';
  const backdrop = el(`<div class="modal-backdrop"><div class="modal-sheet">
    <h3 class="modal-title">${escapeHtml(title)}</h3>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-close-row"><button class="btn" id="modal-close-btn">Закрыть</button></div>
  </div></div>`);
  root.appendChild(backdrop);
  $('#modal-close-btn', backdrop).onclick = closeModal;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  return backdrop;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function confirmDialog(message, onYes) {
  const b = openModal('Подтверждение', `<p style="color:var(--text-muted);font-size:13.5px;line-height:1.5;">${escapeHtml(message)}</p>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn btn-block" id="cf-no">Отмена</button>
      <button class="btn btn-danger btn-block" id="cf-yes">Да</button>
    </div>`);
  $('#cf-no', b).onclick = closeModal;
  $('#cf-yes', b).onclick = () => { closeModal(); onYes(); };
}

// ============================================================== СТАРТ / ЗАГРУЗКА
window.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  const saved = loadFromStorage();
  if (saved) {
    showLaunchScreen(saved);
  } else {
    showScreen('screen-create');
    setupCreateScreen();
  }
});

function showLaunchScreen(saved) {
  showScreen('screen-launch');
  const box = $('#launch-continue-box');
  const days = Math.floor(saved.game_minutes / (60 * 24));
  box.innerHTML = `<div class="continue-card">
      <div class="info">
        <div class="name">${escapeHtml(saved.name)} • ${fmtMoney(saved.money)}</div>
        <div class="meta">День ${days}, возраст ${saved.age} • сохранено ${escapeHtml(saved.saved_at || '')}</div>
      </div>
    </div>
    <button id="btn-continue" class="btn btn-accent btn-block" style="margin-bottom:10px;">Продолжить</button>`;
  $('#btn-continue').onclick = () => {
    gs = GameState.fromDict(saved);
    enterGame();
  };
  $('#btn-new-game').onclick = () => {
    confirmDialog('Начать новую игру? Текущее сохранение будет удалено безвозвратно.', () => {
      localStorage.removeItem(SAVE_KEY);
      showScreen('screen-create');
      setupCreateScreen();
    });
  };
}

function setupCreateScreen() {
  $('#create-step-name').classList.remove('hidden');
  $('#create-step-avatar').classList.add('hidden');
  $('#name-input').value = '';
  tempAvatar = Object.assign({}, DEFAULT_AVATAR);

  $('#btn-name-next').onclick = () => {
    $('#create-step-name').classList.add('hidden');
    $('#create-step-avatar').classList.remove('hidden');
    buildAvatarEditor();
    redrawAvatarPreview();
  };
  $('#name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-name-next').click(); });

  $('#btn-start-game').onclick = () => {
    const name = $('#name-input').value.trim() || 'Игрок';
    gs = new GameState(name, tempAvatar);
    enterGame();
  };
}

function buildAvatarEditor() {
  const box = $('#avatar-controls');
  box.innerHTML = '';
  box.appendChild(buildSwatchRow('Тон кожи', SKIN_TONES, 'skin'));
  box.appendChild(buildSwatchRow('Волосы', HAIR_COLORS, 'hair_color'));
  box.appendChild(buildSwatchRow('Глаза', EYE_COLORS, 'eyes'));
  box.appendChild(buildStyleRow('Причёска', HAIR_STYLES, 'hair_style'));
}

function buildSwatchRow(label, colors, field) {
  const wrap = el(`<div><div class="swatch-row-label">${label}</div><div class="swatch-row"></div></div>`);
  const row = $('.swatch-row', wrap);
  for (const color of colors) {
    const sw = el(`<div class="swatch${tempAvatar[field] === color ? ' selected' : ''}" style="background:${color}"></div>`);
    sw.onclick = () => { tempAvatar[field] = color; buildAvatarEditor(); redrawAvatarPreview(); };
    row.appendChild(sw);
  }
  return wrap;
}
function buildStyleRow(label, options, field) {
  const wrap = el(`<div><div class="swatch-row-label">${label}</div><div class="swatch-row"></div></div>`);
  const row = $('.swatch-row', wrap);
  for (const [key, rus] of options) {
    const b = el(`<button type="button" class="style-btn${tempAvatar[field] === key ? ' selected' : ''}">${rus}</button>`);
    b.onclick = () => { tempAvatar[field] = key; buildAvatarEditor(); redrawAvatarPreview(); };
    row.appendChild(b);
  }
  return wrap;
}

function redrawAvatarPreview() {
  const canvas = $('#avatar-preview');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawAvatar(ctx, 90, 95, 1.3, tempAvatar, 100, 100, 0);
}

// ============================================================== ВХОД В ИГРУ
function enterGame() {
  showScreen('screen-game');
  gs.paused = true;
  $('#btn-pause').textContent = '▶';
  $('#speed-select').value = String(gs.speed);
  switchTab('home');
  startTickLoop();
  saveToStorage();
}

function startTickLoop() {
  if (tickTimer) clearInterval(tickTimer);
  if (autosaveTimer) clearInterval(autosaveTimer);
  tickTimer = setInterval(gameTick, TICK_MS);
  autosaveTimer = setInterval(saveToStorage, AUTOSAVE_MS);
}

function gameTick() {
  if (!gs || gs.game_over) { renderTopbar(); return; }
  if (!gs.paused) {
    gs.advanceTime(BASE_GAME_MINUTES_PER_TICK * gs.speed);
  }
  drainPending();
  renderTopbar();
  renderCurrentTab();
  if (gs.game_over) { showGameOver(); }
}

function drainPending() {
  while (gs.pending_warnings.length) {
    const stat = gs.pending_warnings.shift();
    toast(`${stat} опустилось ниже 30%!`, 'warning');
  }
  while (gs.pending_events.length) {
    const ev = gs.pending_events.shift();
    const parts = [];
    if (ev.money_delta) parts.push(fmtMoney(ev.money_delta));
    if (ev.health_delta) parts.push(`здоровье ${ev.health_delta > 0 ? '+' : ''}${ev.health_delta.toFixed(0)}`);
    if (ev.mood_delta) parts.push(`настроение ${ev.mood_delta > 0 ? '+' : ''}${ev.mood_delta.toFixed(0)}`);
    if (ev.food_delta) parts.push(`сытость ${ev.food_delta > 0 ? '+' : ''}${ev.food_delta.toFixed(0)}`);
    const details = parts.length ? ` (${parts.join(', ')})` : '';
    const kind = ev.money_delta > 0 ? 'success' : (ev.money_delta < 0 ? 'danger' : 'info');
    toast(`Событие: ${ev.text}${details}`, kind, 6000);
  }
  while (gs.pending_achievements.length) {
    const id = gs.pending_achievements.shift();
    const ach = D.ACHIEVEMENTS.find(a => a.id === id);
    if (ach) toast(`Достижение: ${ach.icon} ${ach.name}`, 'success');
  }
  gs.pending_sounds = [];
}

function showGameOver() {
  clearInterval(tickTimer); clearInterval(autosaveTimer);
  saveToStorage();
  $('#content').innerHTML = `<div class="gameover-wrap">
    <h2>Игра окончена</h2>
    <p style="color:var(--text-muted);">Показатель «${escapeHtml(gs.game_over_reason)}» достиг нуля.</p>
    <p style="margin:14px 0;">Итоговый капитал: <b style="color:var(--gold)">${fmtMoney(gs.getNetWorth())}</b></p>
    <p style="color:var(--text-muted);font-size:13px;">Возраст: ${gs.age} лет • Прожито дней: ${Math.floor(gs.game_minutes/1440)}</p>
    <button class="btn btn-accent btn-block" style="margin-top:20px;max-width:280px;" id="go-restart">Новая игра</button>
  </div>`;
  $('#go-restart').onclick = () => {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  };
}

// ============================================================== СОХРАНЕНИЕ
function saveToStorage() {
  if (!gs) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(gs.toDict())); } catch (e) { /* quota etc. */ }
}
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ============================================================== ТОПБАР / ВКЛАДКИ
function renderTopbar() {
  if (!gs) return;
  $('#topbar-name').textContent = `${gs.name} • ${gs.age} лет`;
  $('#topbar-date').textContent = gs.getGameDatetimeStr();
  $('#topbar-money').textContent = fmtMoney(gs.money);
  $('#topbar-money').style.color = gs.money < 0 ? 'var(--red)' : 'var(--gold)';
  $('#btn-pause').textContent = gs.paused ? '▶' : '⏸';
}

$('#btn-pause') && ($('#btn-pause').onclick = () => {
  if (!gs || gs.game_over) return;
  gs.togglePause();
  renderTopbar();
});
$('#speed-select') && ($('#speed-select').addEventListener('change', e => {
  if (!gs) return;
  gs.setSpeed(parseInt(e.target.value, 10));
}));
$('#btn-menu') && ($('#btn-menu').onclick = openGameMenu);

function openGameMenu() {
  const b = openModal('Меню', `
    <button class="btn btn-block" id="menu-save" style="margin-bottom:8px;">💾 Сохранить сейчас</button>
    <button class="btn btn-block" id="menu-avatar" style="margin-bottom:8px;">🎨 Изменить внешность</button>
    <button class="btn btn-danger btn-block" id="menu-restart">🗑 Новая игра</button>
  `);
  $('#menu-save', b).onclick = () => { saveToStorage(); closeModal(); toast('Игра сохранена.', 'success'); };
  $('#menu-avatar', b).onclick = () => { closeModal(); openAvatarEditModal(); };
  $('#menu-restart', b).onclick = () => {
    confirmDialog('Начать новую игру? Текущий прогресс будет удалён безвозвратно.', () => {
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    });
  };
}

function openAvatarEditModal() {
  tempAvatar = Object.assign({}, gs.avatar);
  const b = openModal('Внешность персонажа', `
    <canvas id="avatar-preview-modal" width="160" height="190" style="display:block;margin:0 auto 12px;background:var(--bg-alt);border:1px solid var(--border);border-radius:12px;"></canvas>
    <div id="avatar-controls-modal"></div>
    <button class="btn btn-accent btn-block" id="avatar-save-btn" style="margin-top:12px;">Сохранить</button>
  `);
  const canvas = $('#avatar-preview-modal', b);
  const redraw = () => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAvatar(ctx, 80, 85, 1.15, tempAvatar, gs.mood, gs.health, gs.getNetWorth());
  };
  const rebuild = () => {
    const box = $('#avatar-controls-modal', b);
    box.innerHTML = '';
    const mkSwatch = (label, colors, field) => {
      const wrap = el(`<div><div class="swatch-row-label">${label}</div><div class="swatch-row"></div></div>`);
      const row = $('.swatch-row', wrap);
      for (const color of colors) {
        const sw = el(`<div class="swatch${tempAvatar[field] === color ? ' selected' : ''}" style="background:${color}"></div>`);
        sw.onclick = () => { tempAvatar[field] = color; rebuild(); redraw(); };
        row.appendChild(sw);
      }
      box.appendChild(wrap);
    };
    mkSwatch('Тон кожи', SKIN_TONES, 'skin');
    mkSwatch('Волосы', HAIR_COLORS, 'hair_color');
    mkSwatch('Глаза', EYE_COLORS, 'eyes');
    const styleWrap = el(`<div><div class="swatch-row-label">Причёска</div><div class="swatch-row"></div></div>`);
    const styleRow = $('.swatch-row', styleWrap);
    for (const [key, rus] of HAIR_STYLES) {
      const sb = el(`<button type="button" class="style-btn${tempAvatar.hair_style === key ? ' selected' : ''}">${rus}</button>`);
      sb.onclick = () => { tempAvatar.hair_style = key; rebuild(); redraw(); };
      styleRow.appendChild(sb);
    }
    box.appendChild(styleWrap);
  };
  rebuild(); redraw();
  $('#avatar-save-btn', b).onclick = () => {
    gs.avatar = sanitizeAvatar(tempAvatar);
    saveToStorage();
    closeModal();
    renderCurrentTab();
  };
}

$all('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  currentTab = tab;
  $all('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderTopbar();
  renderCurrentTab();
  $('#content').scrollTop = 0;
}

function renderCurrentTab() {
  if (!gs || gs.game_over) return;
  const map = {
    home: renderHomeTab, status: renderStatusTab, employment: renderEmploymentTab,
    family: renderFamilyTab, special: renderSpecialTab, property: renderPropertyTab, log: renderLogTab,
  };
  (map[currentTab] || renderHomeTab)();
}

// ============================================================== СТАТ-БАРЫ (переиспользуемый компонент)
function statBarHtml(label, value, icon) {
  const color = value >= 60 ? 'var(--green)' : (value >= 30 ? 'var(--amber)' : 'var(--red)');
  return `<div class="statbar-wrap">
    <div class="statbar-label"><span>${icon} ${label}</span><span>${value.toFixed(0)}%</span></div>
    <div class="statbar-track"><div class="statbar-fill" style="width:${clamp(value,0,100)}%;background:${color};"></div></div>
  </div>`;
}

let currentStatusSub = 'mood';

function renderStatusTab() {
  const content = $('#content');
  const subs = [['mood', 'Развлечения', 'mood', D.ENTERTAINMENT_ACTIONS], ['health', 'Здоровье', 'health', D.HEALTH_ACTIONS],
                ['food', 'Еда', 'food', D.FOOD_ACTIONS]];
  const cur = subs.find(s => s[0] === currentStatusSub) || subs[0];
  content.innerHTML = `
    <div class="subtab-row">${subs.map(s => `<button class="subtab-btn${s[0]===currentStatusSub?' active':''}" data-sub="${s[0]}">${s[1]}</button>`).join('')}</div>
    <div class="balance-line" style="font-size:15px;">${cur[1]} сейчас: ${gs[cur[2]].toFixed(0)}%</div>
    <div class="hint">Действия меняют соответствующий показатель. Бесплатные варианты можно повторять без ограничений (кроме паузы).</div>
    <div id="status-actions-list"></div>
  `;
  $all('.subtab-btn', content).forEach(b => b.onclick = () => { currentStatusSub = b.dataset.sub; renderStatusTab(); });
  const list = $('#status-actions-list');
  for (const action of cur[3]) {
    const affordable = action.cost <= 0 || gs.money >= action.cost;
    const card = el(`<div class="card">
      <div class="card-row"><div>
          <div class="card-title">${escapeHtml(action.name)}</div>
          <div class="card-sub">${escapeHtml(action.description || '')}</div>
        </div>
        <button class="btn btn-small ${action.cost > 0 ? '' : 'btn-green'}" ${affordable ? '' : 'disabled'}>${action.cost > 0 ? fmtMoney(-action.cost) : 'Бесплатно'}</button>
      </div>
    </div>`);
    $('button', card).onclick = () => {
      const [ok, msg] = gs.performAction(action);
      if (!ok) toast(msg, 'warning'); else { renderTopbar(); renderStatusTab(); }
    };
    list.appendChild(card);
  }
}
let currentEmploymentSub = 'jobs';

function renderEmploymentTab() {
  const content = $('#content');
  content.innerHTML = `
    <div class="subtab-row">
      <button class="subtab-btn${currentEmploymentSub==='jobs'?' active':''}" data-sub="jobs">Работа</button>
      <button class="subtab-btn${currentEmploymentSub==='edu'?' active':''}" data-sub="edu">Образование</button>
    </div>
    <div id="employment-body"></div>
  `;
  $all('.subtab-btn', content).forEach(b => b.onclick = () => { currentEmploymentSub = b.dataset.sub; renderEmploymentTab(); });
  if (currentEmploymentSub === 'jobs') renderJobsList(); else renderEducationList();
}

function renderJobsList() {
  const body = $('#employment-body');
  body.innerHTML = `<div class="card" style="margin-bottom:14px;">
      <div class="card-row"><span>Текущая должность</span><b>${gs.current_job ? escapeHtml(gs.current_job) : '— нет —'}</b></div>
      ${gs.current_job ? `<button class="btn btn-danger btn-block" id="quit-job-btn" style="margin-top:10px;">Уволиться</button>` : ''}
    </div>`;
  if (gs.current_job) {
    $('#quit-job-btn').onclick = () => { gs.quitJob(); renderTopbar(); renderJobsList(); };
  }
  const groups = {};
  for (const [name, job] of Object.entries(D.JOBS)) {
    const key = job.education || '__none__';
    (groups[key] = groups[key] || []).push(name);
  }
  const groupOrder = ['__none__'].concat(Object.keys(D.EDUCATION));
  const seen = new Set();
  for (const key of groupOrder) {
    if (!groups[key] || seen.has(key)) continue;
    seen.add(key);
    const names = groups[key].sort((a, b) => D.JOBS[a].income - D.JOBS[b].income);
    const title = key === '__none__' ? 'Без образования' : key;
    body.appendChild(el(`<div class="section-title">${escapeHtml(title)}</div>`));
    for (const name of names) body.appendChild(buildJobCard(name));
  }
}

function buildJobCard(name) {
  const job = D.JOBS[name];
  const [ok, reasons] = gs.canApplyJob(name);
  const isCurrent = gs.current_job === name;
  const card = el(`<div class="card">
    <div class="card-row"><div>
        <div class="card-title">${escapeHtml(name)}${job.tips ? ' 💵' : ''}</div>
        <div class="card-sub">${fmtMoney(job.income)}/нед • здоровье -${job.health_cost} настроение -${job.mood_cost} еда -${job.food_cost}</div>
      </div>
      <button class="btn btn-small ${isCurrent ? '' : 'btn-accent'}" ${isCurrent || !ok ? 'disabled' : ''}>${isCurrent ? 'Работаете' : 'Устроиться'}</button>
    </div>
    ${(!ok && !isCurrent) ? `<div class="card-reasons">${reasons.map(escapeHtml).join('; ')}</div>` : ''}
  </div>`);
  if (!isCurrent && ok) {
    $('button', card).onclick = () => {
      const [okA, msg] = gs.applyJob(name);
      if (!okA) toast(msg, 'warning'); else { toast(`Новая работа: ${name}`, 'success'); renderTopbar(); renderJobsList(); }
    };
  }
  return card;
}

function renderEducationList() {
  const body = $('#employment-body');
  body.innerHTML = '<div class="hint">Можно учиться сразу на нескольких курсах одновременно — но расходы по каждому взимаются отдельно.</div>';
  for (const [name, edu] of Object.entries(D.EDUCATION)) {
    const completed = gs.completed_educations.has(name);
    const inProgress = gs.education_in_progress[name] !== undefined;
    const fee = gs.getInflatedPrice(edu.yearly_fee);
    let actionHtml, extraHtml = '';
    if (completed) {
      actionHtml = `<button class="btn btn-small" disabled>✓ Получено</button>`;
    } else if (inProgress) {
      const weeks = gs.education_in_progress[name];
      const pct = Math.min(100, weeks / edu.weeks_required * 100);
      extraHtml = `<div class="statbar-track" style="margin-top:8px;"><div class="statbar-fill" style="width:${pct}%;background:var(--gold);"></div></div>
        <div class="card-sub" style="margin-top:4px;">Неделя ${weeks} из ${edu.weeks_required}</div>`;
      actionHtml = `<button class="btn btn-small btn-danger" data-drop="${escapeHtml(name)}">Бросить</button>`;
    } else {
      const affordable = gs.money >= fee;
      actionHtml = `<button class="btn btn-small btn-accent" ${affordable ? '' : 'disabled'} data-enroll="${escapeHtml(name)}">Поступить (${fmtMoney(fee)}/год)</button>`;
    }
    const card = el(`<div class="card">
      <div class="card-row"><div>
          <div class="card-title">${escapeHtml(name)}</div>
          <div class="card-sub">${edu.duration_years} лет • ${escapeHtml(edu.description || '')}</div>
        </div>
      </div>
      ${extraHtml}
      <div class="card-actions">${actionHtml}</div>
    </div>`);
    const dropBtn = card.querySelector('[data-drop]');
    if (dropBtn) dropBtn.onclick = () => confirmDialog('Весь прогресс обучения будет потерян. Продолжить?', () => {
      gs.dropEducation(name); renderEducationList();
    });
    const enrollBtn = card.querySelector('[data-enroll]');
    if (enrollBtn) enrollBtn.onclick = () => {
      const [ok, msg] = gs.enrollEducation(name);
      if (!ok) toast(msg, 'warning'); else { renderTopbar(); renderEducationList(); }
    };
    body.appendChild(card);
  }
}

function renderHomeTab() {
  const content = $('#content');
  content.innerHTML = `
    <div class="avatar-home-wrap"><canvas id="home-avatar" width="140" height="165"></canvas></div>
    ${statBarHtml('Здоровье', gs.health, '❤')}
    ${statBarHtml('Настроение', gs.mood, '☺')}
    ${statBarHtml('Сытость', gs.food, '🍗')}
    <div class="card" style="margin-top:14px;">
      <div class="card-row"><span class="card-title">Работа</span>
        <span style="color:var(--text-muted);font-size:12.5px;">${gs.current_job ? escapeHtml(gs.current_job) : 'нет работы'}</span></div>
    </div>
    <div class="coin-wrap">
      <button id="coin-btn">${gs.current_job ? '+' + fmtMoney(D.JOBS[gs.current_job].income / 30) : 'Нет работы'}</button>
      <div id="coin-hint">Тапайте по монетке, чтобы подрабатывать сверх зарплаты</div>
    </div>
    <div class="section-title">Сводка</div>
    <div class="card">
      <div class="card-row"><span>Чистый капитал</span><b id="home-net-worth" style="color:var(--gold)">${fmtMoney(gs.getNetWorth())}</b></div>
      <div class="card-row" style="margin-top:6px;"><span>Заработано на работе</span><span>${fmtMoney(gs.total_earned_from_job)}</span></div>
      <div class="card-row" style="margin-top:6px;"><span>Заработано на монетке</span><span id="home-coin-total">${fmtMoney(gs.total_earned_from_coin)}</span></div>
      <div class="card-row" style="margin-top:6px;"><span>Достижения</span><span>${gs.unlocked_achievements.size} / ${D.ACHIEVEMENTS.length}</span></div>
    </div>
  `;
  const ctx = $('#home-avatar').getContext('2d');
  drawAvatar(ctx, 70, 78, 1.05, gs.avatar, gs.mood, gs.health, gs.getNetWorth());
  $('#coin-btn').onclick = () => {
    const [ok, amount] = gs.clickCoin();
    if (ok) {
      renderTopbar();
      $('#coin-btn').textContent = '+' + fmtMoney(D.JOBS[gs.current_job].income / 30);
      $('#home-net-worth').textContent = fmtMoney(gs.getNetWorth());
      $('#home-coin-total').textContent = fmtMoney(gs.total_earned_from_coin);
    } else if (amount) {
      toast(amount, 'warning');
    }
  };
}

// ============================================================== ВКЛАДКА: СЕМЬЯ
function renderFamilyTab() {
  const content = $('#content');
  content.innerHTML = `<div class="hint">Члены семьи и наёмный персонал дают ежедневный прирост характеристик и требуют еженедельной платы за содержание. Некоторые защищают от негативных случайных событий.</div>
    <div id="family-list"></div>`;
  const list = $('#family-list');
  for (const [name, f] of Object.entries(D.FAMILY)) {
    const owned = gs.family_members.has(name);
    const [ok, reasons] = owned ? [true, []] : gs.canAcquireFamily(name);
    const deltas = [];
    if (f.health_delta) deltas.push(`здоровье ${f.health_delta > 0 ? '+' : ''}${f.health_delta}/день`);
    if (f.mood_delta) deltas.push(`настроение ${f.mood_delta > 0 ? '+' : ''}${f.mood_delta}/день`);
    if (f.food_delta) deltas.push(`сытость ${f.food_delta > 0 ? '+' : ''}${f.food_delta}/день`);
    const card = el(`<div class="card">
      <div class="card-row"><div>
          <div class="card-title">${escapeHtml(name)}</div>
          <div class="card-sub">${escapeHtml(f.description || '')}</div>
          <div class="card-sub">${deltas.join(' • ') || '—'}${f.weekly_cost ? ` • ${fmtMoney(-gs.getInflatedPrice(f.weekly_cost))}/нед` : ''}${f.one_time_cost ? ` • разово ${fmtMoney(gs.getInflatedPrice(f.one_time_cost))}` : ''}</div>
        </div>
        <button class="btn btn-small ${owned ? 'btn-danger' : 'btn-accent'}" ${(!owned && !ok) ? 'disabled' : ''}>${owned ? 'Расстаться' : 'Добавить'}</button>
      </div>
      ${(!owned && !ok) ? `<div class="card-reasons">${reasons.map(escapeHtml).join('; ')}</div>` : ''}
    </div>`);
    $('button', card).onclick = () => {
      if (owned) {
        confirmDialog(`Расстаться с «${name}»?`, () => { gs.dismissFamily(name); renderFamilyTab(); });
      } else {
        const [okA, msg] = gs.acquireFamily(name);
        if (!okA) toast(msg, 'warning'); else { renderTopbar(); renderFamilyTab(); }
      }
    };
    list.appendChild(card);
  }
}

// ============================================================== ВКЛАДКА: СОБСТВЕННОСТЬ
let currentPropertySub = 'cars';

function renderPropertyTab() {
  const content = $('#content');
  const cats = Object.keys(D.PROPERTY_CATEGORIES);
  content.innerHTML = `
    <div class="balance-line">💰 Баланс: ${fmtMoney(gs.money)}</div>
    <div class="subtab-row">${cats.map(c => `<button class="subtab-btn${c===currentPropertySub?' active':''}" data-sub="${c}">${D.PROPERTY_CATEGORIES[c][0]}</button>`).join('')}</div>
    <div id="property-list"></div>
  `;
  $all('.subtab-btn', content).forEach(b => b.onclick = () => { currentPropertySub = b.dataset.sub; renderPropertyTab(); });
  const list = $('#property-list');
  const items = D.PROPERTY_CATEGORIES[currentPropertySub][1];
  const ownedSet = gs._ownedPropertySet(currentPropertySub);
  const sorted = Object.entries(items).sort((a, b) => a[1] - b[1]);
  for (const [name, basePrice] of sorted) {
    const owned = ownedSet.has(name);
    const price = gs.getInflatedPrice(basePrice);
    const card = el(`<div class="card">
      <div class="card-row"><div>
          <div class="card-title">${escapeHtml(name)}</div>
          <div class="card-sub">${fmtMoney(price)}</div>
        </div>
        <button class="btn btn-small ${owned ? '' : 'btn-accent'}" ${owned || gs.money < price ? 'disabled' : ''}>${owned ? '✓ Куплено' : 'Купить'}</button>
      </div>
    </div>`);
    if (!owned) {
      $('button', card).onclick = () => {
        const [ok, msg] = gs.buyProperty(currentPropertySub, name);
        if (!ok) toast(msg, 'warning'); else { renderTopbar(); renderPropertyTab(); }
      };
    }
    list.appendChild(card);
  }
}

// ============================================================== ВКЛАДКА: ЖУРНАЛ
function renderLogTab() {
  const content = $('#content');
  const achDone = D.ACHIEVEMENTS.filter(a => gs.unlocked_achievements.has(a.id));
  const achTodo = D.ACHIEVEMENTS.filter(a => !gs.unlocked_achievements.has(a.id));
  content.innerHTML = `
    <div class="section-title">Достижения (${achDone.length}/${D.ACHIEVEMENTS.length})</div>
    <div class="card">${achDone.map(a => `<div class="card-row" style="margin-bottom:4px;"><span>${a.icon} ${escapeHtml(a.name)}</span></div>`).join('') || '<span class="card-sub">Пока нет разблокированных</span>'}</div>
    <div class="section-title">Журнал событий</div>
    <div class="card">${gs.event_log.slice().reverse().map(l => `<div class="log-line">${escapeHtml(l)}</div>`).join('') || '<div class="empty-state">Пока пусто</div>'}</div>
  `;
}

// ============================================================== ВКЛАДКА: СПЕЦВОЗМОЖНОСТИ
function renderSpecialTab() {
  const content = $('#content');
  content.innerHTML = `
    <div class="balance-line">💰 Баланс: ${fmtMoney(gs.money)}</div>
    <div class="summary-row">
      <div class="summary-cell"><div class="t">🏠 Недвижимость</div><div class="v" id="sum-re"></div></div>
      <div class="summary-cell"><div class="t">📈 Акции</div><div class="v" id="sum-stocks"></div></div>
      <div class="summary-cell"><div class="t">🪙 Крипта</div><div class="v" id="sum-crypto"></div></div>
    </div>
    <div class="subtab-row">
      <button class="subtab-btn${currentSpecialSub==='invest'?' active':''}" data-sub="invest">Инвестиции</button>
      <button class="subtab-btn${currentSpecialSub==='casino'?' active':''}" data-sub="casino">Казино</button>
      <button class="subtab-btn${currentSpecialSub==='re'?' active':''}" data-sub="re">Недвижимость</button>
    </div>
    <div id="special-body"></div>
  `;
  $('#sum-re').textContent = `${fmtMoney(gs.realEstateMonthlyIncomeTotal())}/мес • ${Object.keys(gs.real_estate_owned).length} объектов`;
  $('#sum-stocks').textContent = `${fmtMoney(gs.monthlyDividendsTotal())}/мес • портфель ${fmtMoney(gs.stockPortfolioValue())}`;
  $('#sum-crypto').textContent = `портфель ${fmtMoney(gs.cryptoPortfolioValue())}`;
  $all('.subtab-row .subtab-btn', content).forEach(b => b.onclick = () => { currentSpecialSub = b.dataset.sub; renderSpecialTab(); });

  if (currentSpecialSub === 'invest') renderInvestBody();
  else if (currentSpecialSub === 'casino') renderCasinoBody();
  else renderRealEstateBody();
}

function renderInvestBody() {
  const body = $('#special-body');
  body.innerHTML = `<div class="subtab-row">
      <button class="subtab-btn${currentInvestSub==='crypto'?' active':''}" data-isub="crypto">Крипта</button>
      <button class="subtab-btn${currentInvestSub==='stocks'?' active':''}" data-isub="stocks">Акции</button>
    </div><div id="invest-list"></div>`;
  $all('[data-isub]', body).forEach(b => b.onclick = () => { currentInvestSub = b.dataset.isub; renderInvestBody(); });
  const list = $('#invest-list');
  if (currentInvestSub === 'crypto') {
    for (const [name, token] of Object.entries(gs.crypto)) list.appendChild(buildAssetCard('crypto', name, token));
  } else {
    for (const [name, stock] of Object.entries(gs.stocks)) list.appendChild(buildAssetCard('stock', name, stock));
  }
}

function buildAssetCard(kind, name, asset) {
  const change = gs.priceChangePct(asset);
  const color = change >= 0 ? 'var(--green)' : 'var(--red)';
  const holdings = kind === 'stock' ? (gs.stock_holdings[name] || 0) : (gs.crypto_holdings[name] || 0);
  const priceStr = asset.current_price < 10 ? asset.current_price.toFixed(4) : asset.current_price.toLocaleString('en-US', {maximumFractionDigits: 2});
  const value = holdings * asset.current_price;
  const card = el(`<div class="card">
    <div class="card-row"><div>
        <div class="card-title">${escapeHtml(name)} ${kind==='crypto' ? '('+asset.ticker+')' : ''}</div>
        <div class="card-sub" style="color:${color}">$${priceStr} (${fmtPct(change)} за день)</div>
        <div class="card-sub">${holdings ? `У вас: ${kind==='crypto' ? holdings.toFixed(6) : holdings} (≈${fmtMoney(value)})` : 'У вас: 0'}</div>
        ${kind==='stock' ? `<div class="card-sub">Дивиденды: ${asset.dividend_yield_annual_pct}%/год</div>` : ''}
      </div></div>
    <div class="qty-row">
      <input type="number" min="0" step="${kind==='crypto'?'0.0001':'1'}" placeholder="Кол-во" class="qty-input" id="qty-${kind}-${cssSafe(name)}">
      <button class="btn btn-small btn-accent" data-buy>Купить</button>
      <button class="btn btn-small btn-danger" data-sell>Продать</button>
    </div>
  </div>`);
  const input = $('input', card);
  card.querySelector('[data-buy]').onclick = () => {
    const qty = input.value;
    const [ok, msg] = kind === 'stock' ? gs.buyStock(name, qty) : gs.buyCrypto(name, qty);
    if (!ok) toast(msg, 'warning'); else { renderTopbar(); renderInvestBody(); }
  };
  card.querySelector('[data-sell]').onclick = () => {
    const qty = input.value;
    const [ok, msg] = kind === 'stock' ? gs.sellStock(name, qty) : gs.sellCrypto(name, qty);
    if (!ok) toast(msg, 'warning'); else { renderTopbar(); renderInvestBody(); }
  };
  return card;
}
function cssSafe(s) { return s.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_'); }

// ---------------------------------------------------------- НЕДВИЖИМОСТЬ (инвестиционная)
function renderRealEstateBody() {
  const body = $('#special-body');
  body.innerHTML = `<div class="hint">Инвестиционная недвижимость приносит доход раз в игровой месяц. Для каждого купленного объекта доступны три ОДНОРАЗОВЫХ улучшения — каждое покупается один раз и навсегда повышает доходность.</div>
    <div id="re-list"></div>`;
  const list = $('#re-list');
  const sorted = Object.entries(D.REAL_ESTATE).sort((a, b) => a[1].price - b[1].price);
  for (const [lid, listing] of sorted) {
    const owned = gs.real_estate_owned[lid];
    const price = gs.getInflatedPrice(listing.price);
    let bodyHtml;
    if (owned) {
      const income = gs.realEstateListingMonthlyIncome(lid);
      const upgradesHtml = Object.entries(D.PROPERTY_UPGRADES).map(([ukey, up]) => {
        const has = owned.upgrades.includes(ukey);
        const cost = gs.getInflatedPrice(listing.price * up.cost_pct);
        return `<button class="btn btn-small ${has ? '' : ''}" data-upgrade="${ukey}" ${has || gs.money < cost ? 'disabled' : ''}>${has ? '✓ ' : ''}${up.label}${has ? '' : ' ('+fmtMoney(cost)+')'}</button>`;
      }).join('');
      bodyHtml = `<div class="card">
        <div class="card-row"><div>
            <div class="card-title">${escapeHtml(listing.name)}</div>
            <div class="card-sub" style="color:var(--green)">Доход: ${fmtMoney(income)}/мес</div>
          </div>
          <button class="btn btn-small btn-danger" data-sell>Продать</button>
        </div>
        <div class="card-actions">${upgradesHtml}</div>
      </div>`;
    } else {
      bodyHtml = `<div class="card">
        <div class="card-row"><div>
            <div class="card-title">${escapeHtml(listing.name)}</div>
            <div class="card-sub">${fmtMoney(price)} • доходность ${listing.monthly_yield_pct.toFixed(2)}%/мес.</div>
          </div>
          <button class="btn btn-small btn-accent" data-buy ${gs.money < price ? 'disabled' : ''}>Купить</button>
        </div>
      </div>`;
    }
    const card = el(bodyHtml);
    const buyBtn = card.querySelector('[data-buy]');
    if (buyBtn) buyBtn.onclick = () => { const [ok, msg] = gs.buyRealEstate(lid); if (!ok) toast(msg, 'warning'); else { renderTopbar(); renderRealEstateBody(); } };
    const sellBtn = card.querySelector('[data-sell]');
    if (sellBtn) sellBtn.onclick = () => confirmDialog('Продать этот объект?', () => { gs.sellRealEstate(lid); renderTopbar(); renderRealEstateBody(); });
    card.querySelectorAll('[data-upgrade]').forEach(btn => {
      btn.onclick = () => {
        const [ok, msg] = gs.applyPropertyUpgrade(lid, btn.dataset.upgrade);
        if (!ok) toast(msg, 'warning'); else { renderTopbar(); renderRealEstateBody(); }
      };
    });
    list.appendChild(card);
  }
}

// ---------------------------------------------------------- КАЗИНО
let currentCasinoSub = 'slots';

function renderCasinoBody() {
  const body = $('#special-body');
  body.innerHTML = `<div class="subtab-row">
      <button class="subtab-btn${currentCasinoSub==='slots'?' active':''}" data-csub="slots">Слоты</button>
      <button class="subtab-btn${currentCasinoSub==='roulette'?' active':''}" data-csub="roulette">Рулетка</button>
      <button class="subtab-btn${currentCasinoSub==='bj'?' active':''}" data-csub="bj">Блэкджек</button>
    </div><div id="casino-inner"></div>`;
  $all('[data-csub]', body).forEach(b => b.onclick = () => { currentCasinoSub = b.dataset.csub; renderCasinoBody(); });
  if (currentCasinoSub === 'slots') renderSlots();
  else if (currentCasinoSub === 'roulette') renderRoulette();
  else renderBlackjack();
}

function renderSlots() {
  const inner = $('#casino-inner');
  inner.innerHTML = `
    <div class="slots-display" id="slots-display">🍒 🍋 🍇</div>
    <div class="card-sub" style="text-align:center;margin-bottom:10px;" id="slots-result"></div>
    <div class="qty-row"><input type="number" min="1" value="50" class="qty-input" id="slots-bet"><button class="btn btn-accent" id="slots-spin-btn">Крутить</button></div>
    <div class="hint" style="margin-top:12px;">${D.SLOT_SYMBOLS.map(s => `${s[0]}×3 = x${s[2]}, ${s[0]}×2 = x${s[3]}`).join(' • ')}</div>
  `;
  $('#slots-spin-btn').onclick = () => {
    const amount = parseFloat($('#slots-bet').value);
    const res = gs.slotsSpin(amount);
    if (!res) { toast('Некорректная ставка или недостаточно денег.', 'warning'); return; }
    renderTopbar();
    animateSlots(res.reels, res.total_return, 0);
  };
}
function animateSlots(finalReels, totalReturn, step) {
  const disp = $('#slots-display');
  const btn = $('#slots-spin-btn');
  if (!disp || !btn) return;
  btn.disabled = true;
  const symbols = D.SLOT_SYMBOLS.map(s => s[0]);
  const stopSteps = [7, 12, 18];
  const reel = [0, 1, 2].map(i => step < stopSteps[i] ? symbols[Math.floor(Math.random() * symbols.length)] : finalReels[i]);
  disp.textContent = reel.join(' ');
  if (step < stopSteps[2]) {
    setTimeout(() => animateSlots(finalReels, totalReturn, step + 1), 70);
  } else {
    btn.disabled = false;
    const resEl = $('#slots-result');
    if (resEl) {
      if (totalReturn > 0) { resEl.textContent = `Выигрыш: ${fmtMoney(totalReturn)}!`; resEl.style.color = 'var(--green)'; }
      else { resEl.textContent = 'Не повезло — попробуйте ещё раз.'; resEl.style.color = 'var(--red)'; }
    }
  }
}

function renderRoulette() {
  const inner = $('#casino-inner');
  inner.innerHTML = `
    <div class="card-sub" style="text-align:center;margin-bottom:8px;" id="roulette-result"></div>
    <div class="qty-row"><input type="number" min="1" value="50" class="qty-input" id="roulette-bet"></div>
    <div class="roulette-grid">
      <button class="btn" data-bet="color:red">Красное (x2)</button>
      <button class="btn" data-bet="color:black">Чёрное (x2)</button>
      <button class="btn" data-bet="parity:even">Чётное (x2)</button>
      <button class="btn" data-bet="parity:odd">Нечётное (x2)</button>
      <button class="btn" data-bet="range:low">1-18 (x2)</button>
      <button class="btn" data-bet="range:high">19-36 (x2)</button>
    </div>
    <div class="qty-row">
      <input type="number" min="0" max="36" placeholder="Число 0-36" class="qty-input" id="roulette-number">
      <button class="btn btn-accent" data-bet="number">На число (x36)</button>
    </div>
  `;
  $all('[data-bet]', inner).forEach(btn => btn.onclick = () => {
    const amount = parseFloat($('#roulette-bet').value);
    const [betType, betValue] = btn.dataset.bet.split(':');
    const value = betType === 'number' ? $('#roulette-number').value : betValue;
    if (betType === 'number' && (value === '' || value === null)) { toast('Введите число от 0 до 36.', 'warning'); return; }
    const res = gs.rouletteSpin(betType, betType === 'number' ? parseInt(value, 10) : value, amount);
    if (!res) { toast('Некорректная ставка или недостаточно денег.', 'warning'); return; }
    renderTopbar();
    const resEl = $('#roulette-result');
    resEl.textContent = `Выпало: ${res.result} (${res.color}) — ${res.win ? 'выигрыш ' + fmtMoney(res.total_return) : 'проигрыш'}`;
    resEl.style.color = res.win ? 'var(--green)' : 'var(--red)';
  });
}

function renderBlackjack() {
  const inner = $('#casino-inner');
  if (!gs.bj_active && !gs.bj_player.length) {
    inner.innerHTML = `<div class="qty-row"><input type="number" min="1" value="50" class="qty-input" id="bj-bet"><button class="btn btn-accent" id="bj-deal-btn">Сдать карты</button></div>`;
    $('#bj-deal-btn').onclick = () => {
      const amount = parseFloat($('#bj-bet').value);
      const st = gs.blackjackDeal(amount);
      if (!st) { toast('Некорректная ставка или недостаточно денег.', 'warning'); return; }
      renderTopbar();
      renderBlackjackState(st);
    };
    return;
  }
  renderBlackjackState(gs._bjState());
}
function cardHtml(card) {
  const red = card[1] === '♥' || card[1] === '♦';
  return `<div class="bj-card${red ? ' red' : ''}">${card[0]}${card[1]}</div>`;
}
function renderBlackjackState(st) {
  const inner = $('#casino-inner');
  inner.innerHTML = `
    <div class="card-sub">Дилер (${st.dealer_value}${st.active ? '+?' : ''})</div>
    <div class="bj-hand">${st.dealer.map(cardHtml).join('')}</div>
    <div class="card-sub" style="margin-top:8px;">Ваши карты (${st.player_value})</div>
    <div class="bj-hand">${st.player.map(cardHtml).join('')}</div>
    <div id="bj-outcome" style="margin:10px 0;font-weight:700;"></div>
    <div class="card-actions" id="bj-actions"></div>
  `;
  const actions = $('#bj-actions');
  if (st.active) {
    const hit = el(`<button class="btn btn-accent">Ещё карту</button>`);
    const stand = el(`<button class="btn">Хватит</button>`);
    hit.onclick = () => { const s2 = gs.blackjackHit(); renderTopbar(); renderBlackjackState(s2); };
    stand.onclick = () => { const s2 = gs.blackjackStand(); renderTopbar(); renderBlackjackState(s2); };
    actions.appendChild(hit); actions.appendChild(stand);
  } else {
    const labels = { win: 'Победа!', lose: 'Проигрыш', push: 'Ничья', blackjack: 'Блэкджек!' };
    const outEl = $('#bj-outcome');
    if (st.outcome) {
      outEl.textContent = `${labels[st.outcome] || ''} ${st.total_return !== null ? fmtMoney(st.total_return - st.bet) : ''}`;
      outEl.style.color = st.total_return > st.bet ? 'var(--green)' : (st.total_return < st.bet ? 'var(--red)' : 'var(--text-muted)');
    }
    const again = el(`<button class="btn btn-accent btn-block">Новая раздача</button>`);
    again.onclick = () => { gs.bj_player = []; gs.bj_dealer = []; renderCasinoBody(); };
    actions.appendChild(again);
  }
}
