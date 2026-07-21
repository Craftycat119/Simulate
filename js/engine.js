// engine.js — вся игровая логика, порт state.py. Не содержит DOM-кода.
'use strict';

const D = GAMEDATA;

// ============================================================== КОНСТАНТЫ
const STARTING_MONEY = 500.0;
const STARTING_HEALTH = 100.0;
const STARTING_MOOD = 100.0;
const STARTING_FOOD = 100.0;
const STARTING_AGE = 18;

const PASSIVE_DECAY_PER_HOUR = { health: 0.10, mood: 0.20, food: 0.40 };
const STARVATION_EXTRA_HEALTH_DECAY_PER_HOUR = 1.0;
const DEPRESSION_EXTRA_HEALTH_DECAY_PER_HOUR = 0.5;

const WARNING_THRESHOLD = 30.0;
const CRITICAL_STAT_THRESHOLD = 10.0;
const STAT_LABELS = { health: 'Здоровье', mood: 'Настроение', food: 'Сытость' };

const RANDOM_EVENT_INTERVAL_MINUTES = [36 * 60, 96 * 60];
const EXPERIENCE_WEEKS_PER_TIER = 6;
const TIP_CHANCE = 0.45;
const TIP_RANGE = [0.3, 1.1];

const BASE_GAME_MINUTES_PER_TICK = 60;
const TICK_MS = 1000;
const SPEEDS = [1, 2, 4, 8, 16, 32];

const REAL_ESTATE_SELL_FACTOR = 0.85;
const INCOME_TAX_RATE = 0.13;
const INFLATION_PER_YEAR = 0.04;
const DEBT_GRACE_WEEKS = 3;
const NET_WORTH_HISTORY_CAP = 1000;

const WORK_BONUS_CHANCE = 0.10;
const WORK_FINE_CHANCE = 0.08;
const WORK_FIRE_CHANCE = 0.04;
const WORK_BONUS_RANGE = [0.15, 0.6];
const WORK_FINE_RANGE = [0.05, 0.35];

const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const SUITS = ["♠","♥","♦","♣"];

function fmtMoney(value) {
  const sign = value < 0 ? '-' : '';
  return sign + '$' + Math.abs(Math.round(value)).toLocaleString('en-US');
}

function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function gauss(mean, sd) {
  // Box-Muller
  const u1 = Math.random() || 1e-9, u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function cardValue(card) {
  const r = card[0];
  if (r === 'J' || r === 'Q' || r === 'K') return 10;
  if (r === 'A') return 11;
  return parseInt(r, 10);
}
function handValue(hand) {
  let total = hand.reduce((s, c) => s + cardValue(c), 0);
  let aces = hand.filter(c => c[0] === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return total;
}
function newDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push([r, s]);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

class GameState {
  constructor(name, avatar) {
    this.name = (name || 'Игрок').trim() || 'Игрок';
    this.age = STARTING_AGE;
    this.money = STARTING_MONEY;
    this.health = STARTING_HEALTH;
    this.mood = STARTING_MOOD;
    this.food = STARTING_FOOD;
    this.avatar = sanitizeAvatar(avatar);

    this.game_minutes = 0.0;
    this.paused = true;
    this.speed = 1;

    this.current_job = null;
    this.completed_educations = new Set();
    this.education_in_progress = {};
    this.family_members = new Set();
    this.group_experience_weeks = {};

    this.owned_cars = new Set();
    this.owned_yachts = new Set();
    this.owned_planes = new Set();
    this.owned_apartments = new Set();

    this.stocks = {};
    for (const [nm, s] of Object.entries(D.STOCKS)) {
      this.stocks[nm] = Object.assign({}, s, { current_price: s.initial_price, history: [s.initial_price] });
    }
    this.crypto = {};
    for (const [nm, c] of Object.entries(D.CRYPTO)) {
      this.crypto[nm] = Object.assign({}, c, { current_price: c.initial_price, history: [c.initial_price] });
    }
    this.stock_holdings = {};
    this.crypto_holdings = {};
    this.real_estate_owned = {};

    this.week_number = 0;

    this.event_log = [];
    this.pending_warnings = [];
    this.pending_events = [];
    this.warned_low = { health: false, mood: false, food: false };
    this.pending_sounds = [];

    this.game_over = false;
    this.game_over_reason = null;

    this.next_event_minute = randInt(...RANDOM_EVENT_INTERVAL_MINUTES);

    this.last_coin_click_time = 0;
    this.last_action_time = {};

    this.bj_active = false;
    this.bj_player = [];
    this.bj_dealer = [];
    this.bj_deck = [];
    this.bj_bet = 0;

    this._start_age = this.age;
    this.inflation_factor = 1.0;
    this.weeks_in_debt = 0;
    this.had_critical_stat = false;
    this.career_history = [];
    this.times_fired = 0;
    this.biggest_casino_win = 0.0;
    this.biggest_casino_loss = 0.0;
    this.total_earned_from_job = 0.0;
    this.total_earned_from_coin = 0.0;
    this.total_tax_paid = 0.0;
    this.net_worth_history = [this.getNetWorth()];
    this.unlocked_achievements = new Set();
    this.pending_achievements = [];

    this.log(`Добро пожаловать, ${this.name}! Ваш путь к выживанию и богатству начинается.`);
  }

  // ---------------------------------------------------------- ЛОГ / УТИЛИТЫ
  log(msg) {
    this.event_log.push(msg);
    if (this.event_log.length > 300) this.event_log.shift();
  }

  _ownedPropertySet(cat) {
    return { cars: this.owned_cars, yachts: this.owned_yachts,
             planes: this.owned_planes, apartments: this.owned_apartments }[cat];
  }

  _hasPropertyAtLeast(cat, minPrice) {
    const items = D.PROPERTY_CATEGORIES[cat][1];
    const owned = this._ownedPropertySet(cat);
    for (const n of owned) if (items[n] >= minPrice) return true;
    return false;
  }

  getNetWorth() {
    let total = this.money;
    for (const cat of ['cars', 'yachts', 'planes', 'apartments']) {
      const items = D.PROPERTY_CATEGORIES[cat][1];
      for (const n of this._ownedPropertySet(cat)) total += items[n];
    }
    for (const [nm, qty] of Object.entries(this.stock_holdings)) total += this.stocks[nm].current_price * qty;
    for (const [nm, qty] of Object.entries(this.crypto_holdings)) total += this.crypto[nm].current_price * qty;
    for (const lid of Object.keys(this.real_estate_owned)) total += D.REAL_ESTATE[lid].price;
    return total;
  }

  getInflatedPrice(base) { return base * this.inflation_factor; }

  getGameDatetimeStr() {
    const totalMinutes = Math.floor(this.game_minutes);
    const totalHours = Math.floor(totalMinutes / 60);
    const hourOfDay = totalHours % 24;
    const minuteOfHour = totalMinutes % 60;
    const totalDays = Math.floor(totalHours / 24);
    const dayOfYear = totalDays % 360;
    const month = Math.floor(dayOfYear / 30) + 1;
    const day = (dayOfYear % 30) + 1;
    const pad = n => String(n).padStart(2, '0');
    return `День ${pad(day)}, месяц ${pad(month)}   ${pad(hourOfDay)}:${pad(minuteOfHour)}`;
  }

  priceChangePct(asset) {
    const h = asset.history;
    if (h.length < 2 || h[h.length - 2] === 0) return 0.0;
    return (h[h.length - 1] - h[h.length - 2]) / h[h.length - 2] * 100.0;
  }

  // ---------------------------------------------------------- ВРЕМЯ
  setSpeed(speed) { if (SPEEDS.includes(speed)) this.speed = speed; }
  togglePause() { this.paused = !this.paused; }

  advanceTime(minutesDelta) {
    if (this.game_over || minutesDelta <= 0) return;
    const prev = this.game_minutes;
    this.game_minutes += minutesDelta;
    const curr = this.game_minutes;

    const prevHour = Math.floor(prev / 60), currHour = Math.floor(curr / 60);
    const hoursPassed = currHour - prevHour;
    if (hoursPassed > 0) this.applyPassiveDecay(hoursPassed);

    const prevDay = Math.floor(prev / (60 * 24)), currDay = Math.floor(curr / (60 * 24));
    for (let i = 0; i < currDay - prevDay; i++) this.onNewDay();

    const prevWeek = Math.floor(prev / (60 * 24 * 7)), currWeek = Math.floor(curr / (60 * 24 * 7));
    for (let i = 0; i < currWeek - prevWeek; i++) { this.week_number += 1; this.onNewWeek(); }

    const prevMonth = Math.floor(prev / (60 * 24 * 30)), currMonth = Math.floor(curr / (60 * 24 * 30));
    for (let i = 0; i < currMonth - prevMonth; i++) this.onNewMonth();

    const prevYear = Math.floor(prev / (60 * 24 * 360)), currYear = Math.floor(curr / (60 * 24 * 360));
    for (let i = 0; i < currYear - prevYear; i++) {
      this.age += 1;
      this.inflation_factor *= (1 + INFLATION_PER_YEAR);
      this.log(`С днём рождения! Вам исполнилось ${this.age}.`);
    }

    let guard = 0;
    while (this.game_minutes >= this.next_event_minute && guard < 20) {
      this._triggerScheduledEvent();
      guard += 1;
    }
    this.clampStats();
  }

  applyPassiveDecay(hours) {
    this.health -= PASSIVE_DECAY_PER_HOUR.health * hours;
    this.mood -= PASSIVE_DECAY_PER_HOUR.mood * hours;
    this.food -= PASSIVE_DECAY_PER_HOUR.food * hours;
    if (this.food <= 0) this.health -= STARVATION_EXTRA_HEALTH_DECAY_PER_HOUR * hours;
    if (this.mood <= 0) this.health -= DEPRESSION_EXTRA_HEALTH_DECAY_PER_HOUR * hours;
  }

  onNewDay() {
    this.updateMarketPrices();
    this.processFamilyDay();
    this.clampStats();
  }

  onNewWeek() {
    this.processJobWeek();
    this.processFamilyWeek();
    this.processEducationWeek();

    this.net_worth_history.push(this.getNetWorth());
    if (this.net_worth_history.length > NET_WORTH_HISTORY_CAP) this.net_worth_history.shift();

    if (this.money < 0) {
      this.weeks_in_debt += 1;
      if (this.weeks_in_debt >= DEBT_GRACE_WEEKS) { this._triggerDebtCollection(); this.weeks_in_debt = 0; }
    } else {
      this.weeks_in_debt = 0;
    }
  }

  onNewMonth() {
    const div = this.monthlyDividends();
    const rent = this.monthlyRealEstateIncome();
    if (div > 0 || rent > 0) {
      this.log(`Пассивный доход за месяц: дивиденды ${fmtMoney(div)}, аренда ${fmtMoney(rent)}`);
      this.pending_sounds.push('cash');
    }
  }

  _triggerDebtCollection() {
    const pools = [['cars', this.owned_cars], ['yachts', this.owned_yachts],
                    ['planes', this.owned_planes], ['apartments', this.owned_apartments]];
    const available = pools.filter(([_c, s]) => s.size > 0);
    if (available.length) {
      const [cat, ownedSet] = choice(available);
      const arr = Array.from(ownedSet).sort();
      const itemName = choice(arr);
      ownedSet.delete(itemName);
      const label = D.PROPERTY_CATEGORIES[cat][0];
      this.log(`Коллекторы забрали имущество за долги: ${itemName} (${label})`);
    } else {
      this.mood = Math.max(0, this.mood - 15);
      this.health = Math.max(0, this.health - 10);
      this.log('Коллекторы требуют долг — забирать нечего, но нервы потрёпаны (−15 настроения, −10 здоровья).');
    }
    this.pending_sounds.push('negative');
  }

  _triggerScheduledEvent() {
    let ev;
    if (this.family_members.has('Жена и дети') && this.family_members.has('Любовница')
        && Math.random() < D.SCANDAL_EVENT_CHANCE) {
      ev = Object.assign({}, D.SCANDAL_EVENT);
    } else {
      ev = Object.assign({}, choice(D.LIFE_EVENTS));
    }

    let blocked = false;
    if (ev.money_delta < 0 && this.family_members.has('Личный юрист')) {
      if (Math.random() < 0.6) blocked = true;
    }
    if (ev.health_delta < 0 && this.family_members.has('Телохранитель')) {
      if (Math.random() < 0.5) blocked = true;
    }
    if (blocked) {
      this.log(`Событие предотвращено благодаря нанятой защите: «${ev.text}» не произошло.`);
      this.pending_sounds.push('notify');
    } else {
      if (this.family_members.has('Наёмный водитель')) {
        for (const k of ['money_delta', 'health_delta', 'mood_delta']) {
          if (ev[k] < 0) ev[k] = ev[k] * 0.7;
        }
      }
      if (ev.money_delta < 0) {
        const cap = Math.max(30.0, this.money * 0.12);
        ev.money_delta = -Math.min(-ev.money_delta, cap);
      }
      this.money += ev.money_delta;
      this.health += ev.health_delta;
      this.mood += ev.mood_delta;
      this.food += ev.food_delta;
      this.log(`Событие: ${ev.text}`);
      this.pending_sounds.push(ev.money_delta > 0 ? 'cash' : (ev.money_delta < 0 ? 'negative' : 'notify'));
      this.pending_events.push({
        text: ev.text, money_delta: ev.money_delta, health_delta: ev.health_delta,
        mood_delta: ev.mood_delta, food_delta: ev.food_delta,
      });
    }
    this.next_event_minute = this.game_minutes + randInt(...RANDOM_EVENT_INTERVAL_MINUTES);
  }

  // ---------------------------------------------------------- СОСТОЯНИЕ / GAME OVER
  clampStats(restoring) {
    restoring = restoring || new Set();
    for (const stat of ['health', 'mood', 'food']) {
      let val = clamp(this[stat], 0, 100);
      this[stat] = val;
      if (val > 0 && val < CRITICAL_STAT_THRESHOLD) this.had_critical_stat = true;
      if (val < WARNING_THRESHOLD && !this.warned_low[stat] && !restoring.has(stat)) {
        this.warned_low[stat] = true;
        this.pending_warnings.push(STAT_LABELS[stat]);
      } else if (val >= WARNING_THRESHOLD && this.warned_low[stat]) {
        this.warned_low[stat] = false;
      }
    }
    this.checkGameOver();
    this.checkAchievements();
  }

  checkGameOver() {
    if (this.game_over) return;
    if (this.health <= 0) { this.game_over = true; this.game_over_reason = 'Здоровье'; }
    else if (this.mood <= 0) { this.game_over = true; this.game_over_reason = 'Настроение'; }
    else if (this.food <= 0) { this.game_over = true; this.game_over_reason = 'Сытость'; }
    if (this.game_over) this.log(`ИГРА ОКОНЧЕНА: показатель «${this.game_over_reason}» достиг нуля.`);
  }

  checkAchievements() {
    for (const ach of D.ACHIEVEMENTS) {
      if (this.unlocked_achievements.has(ach.id)) continue;
      let unlocked = false;
      try { unlocked = !!ACHIEVEMENT_CHECKS[ach.id](this); } catch (e) { unlocked = false; }
      if (unlocked) {
        this.unlocked_achievements.add(ach.id);
        this.pending_achievements.push(ach.id);
        this.log(`Достижение разблокировано: ${ach.icon} ${ach.name}`);
        this.pending_sounds.push('cash');
      }
    }
  }

  // ---------------------------------------------------------- МОНЕТКА
  clickCoin() {
    if (this.paused) return [false, 'Игра на паузе — нажмите «▶ Играть», чтобы подрабатывать.'];
    if (!this.current_job) return [false, 'Сначала найдите работу — кликать неоткуда.'];
    const job = D.JOBS[this.current_job];
    const amount = job.income / 30.0;
    this.money += amount;
    this.total_earned_from_coin += amount;
    return [true, amount];
  }

  // ---------------------------------------------------------- РАБОТА
  _jobExperienceRequirement(jobName) {
    const job = D.JOBS[jobName];
    const group = job.education;
    const groupKey = group === null ? 'null' : group;
    const uniqueIncomes = [...new Set(Object.values(D.JOBS).filter(j => j.education === group).map(j => j.income))].sort((a, b) => a - b);
    const rank = uniqueIncomes.indexOf(job.income);
    const required = Math.max(0, rank - 2) * EXPERIENCE_WEEKS_PER_TIER;
    const have = this.group_experience_weeks[groupKey] || 0;
    return [group, required, have];
  }

  canApplyJob(jobName) {
    const job = D.JOBS[jobName];
    if (!job) return [false, ['профессия не найдена']];
    const reasons = [];
    if (job.education && !this.completed_educations.has(job.education)) {
      reasons.push(`нужно образование «${job.education}»`);
    }
    for (const fam of job.family_reqs) {
      if (!this.family_members.has(fam)) reasons.push(`нужен статус «${fam}»`);
    }
    for (const [cat, minPrice] of job.property_reqs) {
      const label = D.PROPERTY_CATEGORIES[cat][0];
      if (!this._hasPropertyAtLeast(cat, minPrice)) reasons.push(`нужно имущество «${label}» от ${fmtMoney(minPrice)}`);
    }
    const [, required, have] = this._jobExperienceRequirement(jobName);
    if (have < required) reasons.push(`нужен опыт в этой сфере: ${have.toFixed(0)} из ${required} нед.`);
    return [reasons.length === 0, reasons];
  }

  applyJob(jobName) {
    const [ok, reasons] = this.canApplyJob(jobName);
    if (!ok) return [false, reasons.join('; ')];
    this.current_job = jobName;
    this.career_history.push([jobName, this.age]);
    this.log(`Новая работа: ${jobName}`);
    return [true, 'OK'];
  }

  quitJob() {
    if (!this.current_job) return [false, 'Вы нигде не работаете.'];
    const old = this.current_job;
    this.current_job = null;
    this.log(`Вы уволились с должности «${old}».`);
    return [true, 'OK'];
  }

  processJobWeek() {
    if (!this.current_job) return;
    let job = D.JOBS[this.current_job];
    const groupKey = job.education === null ? 'null' : job.education;
    this.group_experience_weeks[groupKey] = (this.group_experience_weeks[groupKey] || 0) + 1;

    const roll = Math.random();
    if (roll < WORK_BONUS_CHANCE) {
      const bonus = job.income * rand(...WORK_BONUS_RANGE);
      this.money += bonus; this.total_earned_from_job += bonus;
      this.log(`Премия на работе: +${fmtMoney(bonus)}`);
      this.pending_sounds.push('cash');
    } else if (roll < WORK_BONUS_CHANCE + WORK_FINE_CHANCE) {
      const fine = job.income * rand(...WORK_FINE_RANGE);
      this.money -= fine;
      this.log(`Штраф на работе: -${fmtMoney(fine)}`);
      this.pending_sounds.push('negative');
    } else if (roll < WORK_BONUS_CHANCE + WORK_FINE_CHANCE + WORK_FIRE_CHANCE) {
      const firedFrom = this.current_job;
      this.current_job = null;
      this.times_fired += 1;
      this.log(`Вас уволили с должности «${firedFrom}»!`);
      this.pending_sounds.push('negative');
    }

    if (job.tips && Math.random() < TIP_CHANCE) {
      const tip = job.income * rand(...TIP_RANGE);
      this.money += tip; this.total_earned_from_job += tip;
      this.log(`Чаевые: +${fmtMoney(tip)}`);
      this.pending_sounds.push('cash');
    }

    if (this.current_job) {
      job = D.JOBS[this.current_job];
      const gross = job.income;
      const tax = gross * INCOME_TAX_RATE;
      const net = gross - tax;
      this.money += net; this.total_earned_from_job += net; this.total_tax_paid += tax;
      this.health -= job.health_cost; this.mood -= job.mood_cost; this.food -= job.food_cost;
      this.log(`Зарплата (${this.current_job}): +${fmtMoney(net)} (до налога ${fmtMoney(gross)}, ` +
               `налог ${(INCOME_TAX_RATE * 100).toFixed(0)}% = ${fmtMoney(tax)})`);
      this.pending_sounds.push('cash');
    }
  }

  // ---------------------------------------------------------- УЧЁБА
  canStartEducation(eduName) {
    if (!D.EDUCATION[eduName]) return [false, 'Такого образования не существует.'];
    if (this.education_in_progress[eduName] !== undefined) return [false, 'Вы уже учитесь на этом курсе.'];
    if (this.completed_educations.has(eduName)) return [false, 'Это образование уже получено.'];
    return [true, 'OK'];
  }

  enrollEducation(eduName) {
    const [ok, msg] = this.canStartEducation(eduName);
    if (!ok) return [false, msg];
    const edu = D.EDUCATION[eduName];
    const fee = this.getInflatedPrice(edu.yearly_fee);
    if (this.money < fee) return [false, `Недостаточно денег на оплату (${fmtMoney(fee)}/год).`];
    this.money -= fee;
    this.education_in_progress[eduName] = 0;
    this.log(`Вы поступили на обучение: ${eduName} (оплата ${fmtMoney(fee)})`);
    return [true, 'OK'];
  }

  dropEducation(eduName) {
    if (eduName === undefined) {
      const keys = Object.keys(this.education_in_progress);
      if (keys.length !== 1) return [false, 'Укажите, какой именно курс бросить.'];
      eduName = keys[0];
    }
    if (this.education_in_progress[eduName] === undefined) return [false, 'Вы сейчас не учитесь на этом курсе.'];
    delete this.education_in_progress[eduName];
    this.log(`Вы бросили обучение: ${eduName}`);
    return [true, 'OK'];
  }

  processEducationWeek() {
    const names = Object.keys(this.education_in_progress);
    if (!names.length) return;
    const finished = [];
    for (const eduName of names) {
      const edu = D.EDUCATION[eduName];
      this.health -= edu.health_cost; this.mood -= edu.mood_cost; this.food -= edu.food_cost;
      const weeks = this.education_in_progress[eduName] + 1;
      this.education_in_progress[eduName] = weeks;
      if (weeks % 52 === 0) {
        const fee = this.getInflatedPrice(edu.yearly_fee);
        this.money -= fee;
        this.log(`Оплата за обучение «${eduName}»: -${fmtMoney(fee)}`);
      }
      if (weeks >= edu.weeks_required) finished.push(eduName);
    }
    for (const eduName of finished) {
      this.completed_educations.add(eduName);
      this.log(`Образование получено: ${eduName}!`);
      delete this.education_in_progress[eduName];
    }
  }

  // ---------------------------------------------------------- СЕМЬЯ
  canAcquireFamily(famName) {
    const f = D.FAMILY[famName];
    if (!f) return [false, ['не найдено']];
    if (this.family_members.has(famName)) return [false, ['уже есть']];
    const reasons = [];
    if (f.req_family && !this.family_members.has(f.req_family)) reasons.push(`сначала нужно «${f.req_family}»`);
    if (f.req_weekly_income !== null) {
      const currentIncome = this.current_job ? D.JOBS[this.current_job].income : 0;
      if (currentIncome < f.req_weekly_income) reasons.push(`нужен доход от работы ${fmtMoney(f.req_weekly_income)}/нед.`);
    }
    if (f.req_money !== null && this.money < f.req_money) reasons.push(`нужны сбережения ${fmtMoney(f.req_money)}`);
    if (f.req_property) {
      const [cat, minPrice] = f.req_property;
      const label = D.PROPERTY_CATEGORIES[cat][0];
      if (!this._hasPropertyAtLeast(cat, minPrice)) reasons.push(`нужно имущество «${label}» от ${fmtMoney(minPrice)}`);
    }
    if (f.one_time_cost > 0 && this.money < this.getInflatedPrice(f.one_time_cost)) {
      reasons.push(`нужно ${fmtMoney(this.getInflatedPrice(f.one_time_cost))} разово`);
    }
    return [reasons.length === 0, reasons];
  }

  acquireFamily(famName) {
    const [ok, reasons] = this.canAcquireFamily(famName);
    if (!ok) return [false, reasons.join('; ')];
    const f = D.FAMILY[famName];
    const cost = this.getInflatedPrice(f.one_time_cost);
    this.money -= cost;
    this.family_members.add(famName);
    this.log(`Новый член семьи / статус: ${famName}` + (cost ? ` (разово ${fmtMoney(cost)})` : ''));
    return [true, 'OK'];
  }

  dismissFamily(famName) {
    if (!this.family_members.has(famName)) return [false, 'Такого члена семьи у вас нет.'];
    this.family_members.delete(famName);
    this.log(`Вы расстались: ${famName}`);
    return [true, 'OK'];
  }

  processFamilyWeek() {
    for (const famName of this.family_members) {
      const f = D.FAMILY[famName];
      this.money -= this.getInflatedPrice(f.weekly_cost);
    }
  }

  processFamilyDay() {
    for (const famName of this.family_members) {
      const f = D.FAMILY[famName];
      this.health += f.health_delta; this.mood += f.mood_delta; this.food += f.food_delta;
    }
  }

  // ---------------------------------------------------------- ИМУЩЕСТВО (СТАТУС)
  buyProperty(category, itemName) {
    const items = D.PROPERTY_CATEGORIES[category][1];
    if (items[itemName] === undefined) return [false, 'Такого предмета не существует.'];
    const owned = this._ownedPropertySet(category);
    if (owned.has(itemName)) return [false, 'Уже куплено.'];
    const price = this.getInflatedPrice(items[itemName]);
    if (price > 0 && this.money < price) return [false, 'Недостаточно денег.'];
    this.money -= price;
    owned.add(itemName);
    this.log(`Куплено имущество: ${itemName} (${fmtMoney(price)})`);
    return [true, 'OK'];
  }

  // ---------------------------------------------------------- ДЕЙСТВИЯ
  performAction(action) {
    if (this.paused) return [false, 'Игра на паузе — нажмите «▶ Играть», чтобы выполнить действие.'];
    if (this.money < action.cost && action.cost > 0) return [false, 'Недостаточно денег.'];
    this.money -= action.cost;
    const restoring = new Set();
    if (action.health_delta > 0) restoring.add('health');
    if (action.mood_delta > 0) restoring.add('mood');
    if (action.food_delta > 0) restoring.add('food');
    this.health += action.health_delta; this.mood += action.mood_delta; this.food += action.food_delta;
    this.clampStats(restoring);
    const costTxt = action.cost ? fmtMoney(-action.cost) : 'бесплатно';
    this.log(`${action.name} (${costTxt})`);
    return [true, 'OK'];
  }

  // ---------------------------------------------------------- ИНВЕСТИЦИИ: АКЦИИ / КРИПТА
  updateMarketPrices() {
    for (const stock of Object.values(this.stocks)) {
      const change = gauss(0, stock.volatility_pct / 100.0);
      const newPrice = Math.max(0.5, stock.current_price * (1 + change));
      stock.current_price = Math.round(newPrice * 100) / 100;
      stock.history.push(stock.current_price);
      if (stock.history.length > 60) stock.history.shift();
    }
    for (const token of Object.values(this.crypto)) {
      const change = gauss(0, token.volatility_pct / 100.0);
      const newPrice = Math.max(0.0001, token.current_price * (1 + change));
      token.current_price = Math.round(newPrice * 1e6) / 1e6;
      token.history.push(token.current_price);
      if (token.history.length > 60) token.history.shift();
    }
  }

  buyStock(name, qty) {
    qty = parseInt(qty, 10);
    if (!D.STOCKS[name]) return [false, 'Такой акции не существует.'];
    if (!qty || qty <= 0) return [false, 'Некорректное количество.'];
    const stock = this.stocks[name];
    const owned = this.stock_holdings[name] || 0;
    if (owned + qty > stock.available_shares) return [false, 'Недостаточно акций в наличии на рынке.'];
    const cost = stock.current_price * qty;
    if (this.money < cost) return [false, 'Недостаточно денег.'];
    this.money -= cost;
    this.stock_holdings[name] = owned + qty;
    this.log(`Куплено ${qty} акций «${name}» за ${fmtMoney(cost)}`);
    return [true, 'OK'];
  }

  sellStock(name, qty) {
    qty = parseInt(qty, 10);
    const owned = this.stock_holdings[name] || 0;
    if (!qty || qty <= 0 || qty > owned) return [false, 'Недостаточно акций для продажи.'];
    const stock = this.stocks[name];
    const revenue = stock.current_price * qty;
    this.money += revenue;
    this.stock_holdings[name] = owned - qty;
    if (this.stock_holdings[name] <= 0) delete this.stock_holdings[name];
    this.log(`Продано ${qty} акций «${name}» за ${fmtMoney(revenue)}`);
    return [true, 'OK'];
  }

  buyCrypto(name, qty) {
    qty = parseFloat(qty);
    if (!D.CRYPTO[name]) return [false, 'Такой монеты не существует.'];
    if (!qty || qty <= 0) return [false, 'Некорректное количество.'];
    const token = this.crypto[name];
    const cost = token.current_price * qty;
    if (this.money < cost) return [false, 'Недостаточно денег.'];
    this.money -= cost;
    this.crypto_holdings[name] = (this.crypto_holdings[name] || 0) + qty;
    this.log(`Куплено ${qty.toFixed(6)} ${token.ticker} за ${fmtMoney(cost)}`);
    return [true, 'OK'];
  }

  sellCrypto(name, qty) {
    qty = parseFloat(qty);
    const token = this.crypto[name];
    const owned = this.crypto_holdings[name] || 0;
    if (!qty || qty <= 0 || qty > owned + 1e-9) return [false, 'Недостаточно монет для продажи.'];
    const revenue = token.current_price * qty;
    this.money += revenue;
    this.crypto_holdings[name] = Math.max(0, owned - qty);
    if (this.crypto_holdings[name] <= 1e-9) delete this.crypto_holdings[name];
    this.log(`Продано ${qty.toFixed(6)} ${token.ticker} за ${fmtMoney(revenue)}`);
    return [true, 'OK'];
  }

  monthlyDividendsTotal() {
    let total = 0;
    for (const [name, qty] of Object.entries(this.stock_holdings)) {
      const s = this.stocks[name];
      total += s.current_price * (s.dividend_yield_annual_pct / 100.0 / 12.0) * qty;
    }
    return total;
  }
  stockPortfolioValue() {
    return Object.entries(this.stock_holdings).reduce((sum, [nm, qty]) => sum + this.stocks[nm].current_price * qty, 0);
  }
  cryptoPortfolioValue() {
    return Object.entries(this.crypto_holdings).reduce((sum, [nm, qty]) => sum + this.crypto[nm].current_price * qty, 0);
  }
  realEstateMonthlyIncomeTotal() {
    return Object.keys(this.real_estate_owned).reduce((sum, lid) => sum + this.realEstateListingMonthlyIncome(lid), 0);
  }
  monthlyDividends() {
    const total = this.monthlyDividendsTotal();
    this.money += total;
    return total;
  }

  // ---------------------------------------------------------- НЕДВИЖИМОСТЬ
  buyRealEstate(listingId) {
    const listing = D.REAL_ESTATE[listingId];
    if (!listing) return [false, 'Такого объекта не существует.'];
    if (this.real_estate_owned[listingId]) return [false, 'Уже куплено.'];
    const price = this.getInflatedPrice(listing.price);
    if (this.money < price) return [false, 'Недостаточно денег.'];
    this.money -= price;
    this.real_estate_owned[listingId] = { upgrades: [] };
    this.log(`Куплена недвижимость: ${listing.name} (${fmtMoney(price)})`);
    return [true, 'OK'];
  }

  sellRealEstate(listingId) {
    if (!this.real_estate_owned[listingId]) return [false, 'Вам не принадлежит этот объект.'];
    const listing = D.REAL_ESTATE[listingId];
    const salePrice = listing.price * REAL_ESTATE_SELL_FACTOR;
    this.money += salePrice;
    delete this.real_estate_owned[listingId];
    this.log(`Продана недвижимость: ${listing.name} за ${fmtMoney(salePrice)}`);
    return [true, `Продано за ${fmtMoney(salePrice)}`];
  }

  applyPropertyUpgrade(listingId, upgradeKey) {
    const info = this.real_estate_owned[listingId];
    if (!info) return [false, 'Вам не принадлежит этот объект.'];
    const upgrade = D.PROPERTY_UPGRADES[upgradeKey];
    if (!upgrade) return [false, 'Такого улучшения не существует.'];
    if (info.upgrades.includes(upgradeKey)) return [false, 'Это улучшение уже куплено для этого объекта.'];
    const listing = D.REAL_ESTATE[listingId];
    const cost = this.getInflatedPrice(listing.price * upgrade.cost_pct);
    if (this.money < cost) return [false, 'Недостаточно денег на это улучшение.'];
    this.money -= cost;
    info.upgrades.push(upgradeKey);
    this.log(`«${upgrade.label}» для «${listing.name}» (+${upgrade.yield_bonus_pct.toFixed(0)}% доходности) за ${fmtMoney(cost)}`);
    return [true, 'OK'];
  }

  realEstateListingMonthlyIncome(listingId) {
    const info = this.real_estate_owned[listingId];
    if (!info) return 0;
    const listing = D.REAL_ESTATE[listingId];
    const bonusPct = info.upgrades.reduce((s, u) => s + D.PROPERTY_UPGRADES[u].yield_bonus_pct, 0);
    const effectiveYieldPct = listing.monthly_yield_pct * (1.0 + bonusPct / 100.0);
    return listing.price * effectiveYieldPct / 100.0;
  }

  monthlyRealEstateIncome() {
    const total = this.realEstateMonthlyIncomeTotal();
    this.money += total;
    return total;
  }

  // ---------------------------------------------------------- КАЗИНО: РУЛЕТКА
  rouletteSpin(betType, betValue, amount) {
    amount = parseFloat(amount);
    if (!amount || amount <= 0 || amount > this.money) return null;
    this.money -= amount;
    const result = randInt(0, 36);
    const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
    const isRed = RED.has(result);
    const color = result === 0 ? 'зелёное' : (isRed ? 'красное' : 'чёрное');

    let win = false, payoutOdds = 0;
    if (betType === 'number' && String(betValue) === String(result)) { win = true; payoutOdds = 35; }
    else if (betType === 'color' && result !== 0 && ((betValue === 'red') === isRed)) { win = true; payoutOdds = 1; }
    else if (betType === 'parity' && result !== 0 && ((betValue === 'even') === (result % 2 === 0))) { win = true; payoutOdds = 1; }
    else if (betType === 'range' && result !== 0) {
      if (betValue === 'low' && result >= 1 && result <= 18) { win = true; payoutOdds = 1; }
      else if (betValue === 'high' && result >= 19 && result <= 36) { win = true; payoutOdds = 1; }
    }
    const totalReturn = win ? amount * (payoutOdds + 1) : 0;
    this.money += totalReturn;
    if (win) this.biggest_casino_win = Math.max(this.biggest_casino_win, totalReturn - amount);
    else this.biggest_casino_loss = Math.max(this.biggest_casino_loss, amount);
    this.log(`Рулетка: выпало ${result} (${color}) — ` +
             (win ? 'выигрыш ' + fmtMoney(totalReturn) : 'проигрыш ' + fmtMoney(amount)));
    return { result, color, win, total_return: totalReturn };
  }

  // ---------------------------------------------------------- КАЗИНО: СЛОТЫ
  slotsSpin(amount) {
    amount = parseFloat(amount);
    if (!amount || amount <= 0 || amount > this.money) return null;
    this.money -= amount;
    const symbols = D.SLOT_SYMBOLS.map(s => s[0]);
    const weights = D.SLOT_SYMBOLS.map(s => s[1]);
    const totalW = weights.reduce((a, b) => a + b, 0);
    const pick = () => {
      let r = Math.random() * totalW;
      for (let i = 0; i < symbols.length; i++) { r -= weights[i]; if (r <= 0) return symbols[i]; }
      return symbols[symbols.length - 1];
    };
    const reels = [pick(), pick(), pick()];
    let payoutMult = 0;
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      const row = D.SLOT_SYMBOLS.find(s => s[0] === reels[0]);
      payoutMult = row[2];
    } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
      const matched = (reels[0] === reels[1] || reels[2] === reels[1]) ? reels[1] : reels[0];
      const row = D.SLOT_SYMBOLS.find(s => s[0] === matched);
      payoutMult = row[3];
    }
    const totalReturn = amount * payoutMult;
    this.money += totalReturn;
    if (totalReturn > 0) this.biggest_casino_win = Math.max(this.biggest_casino_win, totalReturn - amount);
    else this.biggest_casino_loss = Math.max(this.biggest_casino_loss, amount);
    this.log(`Слоты: ${reels.join(' ')} — ` +
             (totalReturn > 0 ? 'выигрыш ' + fmtMoney(totalReturn) : 'проигрыш ' + fmtMoney(amount)));
    return { reels, total_return: totalReturn };
  }

  // ---------------------------------------------------------- КАЗИНО: БЛЭКДЖЕК
  blackjackDeal(amount) {
    amount = parseFloat(amount);
    if (!amount || amount <= 0 || amount > this.money || this.bj_active) return null;
    this.money -= amount;
    this.bj_bet = amount;
    this.bj_deck = newDeck();
    this.bj_player = [this.bj_deck.pop(), this.bj_deck.pop()];
    this.bj_dealer = [this.bj_deck.pop(), this.bj_deck.pop()];
    this.bj_active = true;
    if (handValue(this.bj_player) === 21) return this._blackjackResolve();
    return this._bjState();
  }
  blackjackHit() {
    if (!this.bj_active) return null;
    this.bj_player.push(this.bj_deck.pop());
    if (handValue(this.bj_player) > 21) return this._blackjackResolve();
    return this._bjState();
  }
  blackjackStand() {
    if (!this.bj_active) return null;
    while (handValue(this.bj_dealer) < 17) this.bj_dealer.push(this.bj_deck.pop());
    return this._blackjackResolve();
  }
  _blackjackResolve() {
    this.bj_active = false;
    const pv = handValue(this.bj_player), dv = handValue(this.bj_dealer);
    const playerNatural = this.bj_player.length === 2 && pv === 21;
    const dealerNatural = this.bj_dealer.length === 2 && dv === 21;
    let outcome, totalReturn;
    if (pv > 21) { outcome = 'lose'; totalReturn = 0; }
    else if (playerNatural && !dealerNatural) { outcome = 'blackjack'; totalReturn = this.bj_bet * 2.5; }
    else if (dv > 21 || pv > dv) { outcome = 'win'; totalReturn = this.bj_bet * 2; }
    else if (pv === dv) { outcome = 'push'; totalReturn = this.bj_bet; }
    else { outcome = 'lose'; totalReturn = 0; }
    this.money += totalReturn;
    const net = totalReturn - this.bj_bet;
    if (net > 0) this.biggest_casino_win = Math.max(this.biggest_casino_win, net);
    else if (outcome === 'lose') this.biggest_casino_loss = Math.max(this.biggest_casino_loss, this.bj_bet);
    this.log(`Блэкджек: у вас ${pv}, у дилера ${dv} — ${outcome} (${fmtMoney(totalReturn - this.bj_bet)})`);
    return this._bjState(outcome, totalReturn);
  }
  _bjState(outcome, totalReturn) {
    const dealerVisible = this.bj_active ? [this.bj_dealer[0]] : this.bj_dealer.slice();
    return {
      player: this.bj_player.slice(), dealer: dealerVisible,
      player_value: handValue(this.bj_player), dealer_value: handValue(dealerVisible),
      active: this.bj_active, outcome: outcome || null, total_return: totalReturn === undefined ? null : totalReturn,
      bet: this.bj_bet,
    };
  }

  // ---------------------------------------------------------- СОХРАНЕНИЕ / ЗАГРУЗКА
  toDict() {
    const groupExp = {};
    for (const [k, v] of Object.entries(this.group_experience_weeks)) groupExp[k] = v;
    return {
      save_format_version: 1,
      saved_at: new Date().toLocaleString('ru-RU'),
      name: this.name, age: this.age, money: this.money,
      health: this.health, mood: this.mood, food: this.food,
      avatar: Object.assign({}, this.avatar),
      game_minutes: this.game_minutes, speed: this.speed,
      current_job: this.current_job,
      completed_educations: [...this.completed_educations].sort(),
      education_in_progress: Object.assign({}, this.education_in_progress),
      family_members: [...this.family_members].sort(),
      group_experience_weeks: groupExp,
      owned_cars: [...this.owned_cars].sort(), owned_yachts: [...this.owned_yachts].sort(),
      owned_planes: [...this.owned_planes].sort(), owned_apartments: [...this.owned_apartments].sort(),
      stock_prices: Object.fromEntries(Object.entries(this.stocks).map(([nm, s]) => [nm, { current_price: s.current_price, history: s.history.slice() }])),
      crypto_prices: Object.fromEntries(Object.entries(this.crypto).map(([nm, c]) => [nm, { current_price: c.current_price, history: c.history.slice() }])),
      stock_holdings: Object.assign({}, this.stock_holdings),
      crypto_holdings: Object.assign({}, this.crypto_holdings),
      real_estate_owned: Object.fromEntries(Object.entries(this.real_estate_owned).map(([lid, info]) => [lid, { upgrades: info.upgrades.slice() }])),
      week_number: this.week_number,
      event_log: this.event_log.slice(-300),
      warned_low: Object.assign({}, this.warned_low),
      game_over: this.game_over, game_over_reason: this.game_over_reason,
      next_event_minute: this.next_event_minute,
      bj_active: this.bj_active, bj_player: this.bj_player, bj_dealer: this.bj_dealer,
      bj_deck: this.bj_deck, bj_bet: this.bj_bet,
      start_age: this._start_age, inflation_factor: this.inflation_factor,
      weeks_in_debt: this.weeks_in_debt, had_critical_stat: this.had_critical_stat,
      career_history: this.career_history,
      times_fired: this.times_fired,
      biggest_casino_win: this.biggest_casino_win, biggest_casino_loss: this.biggest_casino_loss,
      total_earned_from_job: this.total_earned_from_job, total_earned_from_coin: this.total_earned_from_coin,
      total_tax_paid: this.total_tax_paid,
      net_worth_history: this.net_worth_history.slice(-NET_WORTH_HISTORY_CAP),
      unlocked_achievements: [...this.unlocked_achievements].sort(),
    };
  }

  static fromDict(data) {
    const gs = Object.create(GameState.prototype);
    gs.name = String(data.name || 'Игрок').trim() || 'Игрок';
    gs.age = data.age !== undefined ? data.age : STARTING_AGE;
    gs.money = data.money !== undefined ? data.money : STARTING_MONEY;
    gs.health = data.health !== undefined ? data.health : STARTING_HEALTH;
    gs.mood = data.mood !== undefined ? data.mood : STARTING_MOOD;
    gs.food = data.food !== undefined ? data.food : STARTING_FOOD;
    gs.avatar = sanitizeAvatar(data.avatar);
    gs.game_minutes = data.game_minutes || 0;
    gs.paused = true;
    gs.speed = SPEEDS.includes(data.speed) ? data.speed : 1;

    gs.current_job = D.JOBS[data.current_job] ? data.current_job : null;
    gs.completed_educations = new Set((data.completed_educations || []).filter(e => D.EDUCATION[e]));
    const eduProg = data.education_in_progress || {};
    gs.education_in_progress = {};
    for (const [k, v] of Object.entries(eduProg)) if (D.EDUCATION[k]) gs.education_in_progress[k] = v;
    gs.family_members = new Set((data.family_members || []).filter(f => D.FAMILY[f]));
    gs.group_experience_weeks = Object.assign({}, data.group_experience_weeks || {});

    const catSet = (cat, arr) => new Set((arr || []).filter(n => D.PROPERTY_CATEGORIES[cat][1][n] !== undefined));
    gs.owned_cars = catSet('cars', data.owned_cars);
    gs.owned_yachts = catSet('yachts', data.owned_yachts);
    gs.owned_planes = catSet('planes', data.owned_planes);
    gs.owned_apartments = catSet('apartments', data.owned_apartments);

    gs.stocks = {};
    const savedStocks = data.stock_prices || {};
    for (const [nm, s] of Object.entries(D.STOCKS)) {
      const saved = savedStocks[nm];
      if (saved && saved.history && saved.history.length) {
        gs.stocks[nm] = Object.assign({}, s, { current_price: saved.current_price, history: saved.history.slice() });
      } else {
        gs.stocks[nm] = Object.assign({}, s, { current_price: s.initial_price, history: [s.initial_price] });
      }
    }
    gs.crypto = {};
    const savedCrypto = data.crypto_prices || {};
    for (const [nm, c] of Object.entries(D.CRYPTO)) {
      const saved = savedCrypto[nm];
      if (saved && saved.history && saved.history.length) {
        gs.crypto[nm] = Object.assign({}, c, { current_price: saved.current_price, history: saved.history.slice() });
      } else {
        gs.crypto[nm] = Object.assign({}, c, { current_price: c.initial_price, history: [c.initial_price] });
      }
    }
    gs.stock_holdings = {};
    for (const [nm, q] of Object.entries(data.stock_holdings || {})) if (D.STOCKS[nm] && q > 0) gs.stock_holdings[nm] = q;
    gs.crypto_holdings = {};
    for (const [nm, q] of Object.entries(data.crypto_holdings || {})) if (D.CRYPTO[nm] && q > 1e-9) gs.crypto_holdings[nm] = q;
    gs.real_estate_owned = {};
    for (const [lid, info] of Object.entries(data.real_estate_owned || {})) {
      if (D.REAL_ESTATE[lid]) gs.real_estate_owned[lid] = { upgrades: (info.upgrades || []).filter(u => D.PROPERTY_UPGRADES[u]) };
    }

    gs.week_number = data.week_number || 0;
    gs.event_log = data.event_log || [];
    gs.pending_warnings = [];
    gs.pending_events = [];
    gs.warned_low = Object.assign({ health: false, mood: false, food: false }, data.warned_low || {});
    gs.pending_sounds = [];

    gs.game_over = !!data.game_over;
    gs.game_over_reason = data.game_over_reason || null;
    gs.next_event_minute = data.next_event_minute !== undefined ? data.next_event_minute
      : gs.game_minutes + randInt(...RANDOM_EVENT_INTERVAL_MINUTES);

    gs.last_coin_click_time = 0;
    gs.last_action_time = {};

    gs.bj_active = !!data.bj_active;
    gs.bj_player = data.bj_player || [];
    gs.bj_dealer = data.bj_dealer || [];
    gs.bj_deck = data.bj_deck || [];
    gs.bj_bet = data.bj_bet || 0;

    gs._start_age = data.start_age !== undefined ? data.start_age : STARTING_AGE;
    gs.inflation_factor = data.inflation_factor !== undefined ? data.inflation_factor : 1.0;
    gs.weeks_in_debt = data.weeks_in_debt || 0;
    gs.had_critical_stat = !!data.had_critical_stat;
    gs.career_history = (data.career_history || []).filter(([j]) => D.JOBS[j]);
    gs.times_fired = data.times_fired || 0;
    gs.biggest_casino_win = data.biggest_casino_win || 0;
    gs.biggest_casino_loss = data.biggest_casino_loss || 0;
    gs.total_earned_from_job = data.total_earned_from_job || 0;
    gs.total_earned_from_coin = data.total_earned_from_coin || 0;
    gs.total_tax_paid = data.total_tax_paid || 0;
    gs.net_worth_history = (data.net_worth_history && data.net_worth_history.length) ? data.net_worth_history.slice() : [gs.money];
    const allAchIds = new Set(D.ACHIEVEMENTS.map(a => a.id));
    gs.unlocked_achievements = new Set((data.unlocked_achievements || []).filter(a => allAchIds.has(a)));
    gs.pending_achievements = [];

    gs.log(`Игра загружена (${data.saved_at || '?'}). С возвращением, ${gs.name}!`);
    return gs;
  }
}
