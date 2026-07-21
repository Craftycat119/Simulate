// achievements.js — условия разблокировки (порт lambda-функций из data_achievements.py)
'use strict';

const ACHIEVEMENT_CHECKS = {
  first_thousand: gs => gs.getNetWorth() >= 1000,
  first_hundred_k: gs => gs.getNetWorth() >= 100000,
  first_million: gs => gs.getNetWorth() >= 1000000,
  ten_million: gs => gs.getNetWorth() >= 10000000,
  billionaire: gs => gs.getNetWorth() >= 1000000000,
  bankrupt: gs => gs.money < 0,

  first_job: gs => gs.current_job !== null || gs.career_history.length > 0,
  ceo: gs => gs.current_job === 'Директор СЕО компании',
  fired: gs => gs.times_fired > 0,
  career_hopper: gs => new Set(gs.career_history.map(([j]) => j)).size >= 5,

  first_diploma: gs => gs.completed_educations.size >= 1,
  triple_diploma: gs => gs.completed_educations.size >= 3,

  best_friend: gs => gs.family_members.has('Лучший друг'),
  family_started: gs => gs.family_members.has('Жена и дети'),
  double_life: gs => gs.family_members.has('Жена и дети') && gs.family_members.has('Любовница'),
  pet_owner: gs => gs.family_members.has('Домашняя собака') || gs.family_members.has('Домашняя кошка'),

  car_owner: gs => gs.owned_cars.size >= 1,
  car_collector: gs => gs.owned_cars.size >= 5,
  yacht_owner: gs => gs.owned_yachts.size >= 1,
  plane_owner: gs => gs.owned_planes.size >= 1,
  real_estate_mogul: gs => Object.keys(gs.real_estate_owned).length >= 10,

  investor: gs => gs.stockPortfolioValue() >= 100000,
  crypto_bro: gs => Object.values(gs.crypto_holdings).some(q => q > 0),
  high_roller: gs => gs.biggest_casino_win >= 5000,
  gambler_regret: gs => gs.biggest_casino_loss >= 5000,

  survive_one_year: gs => gs.age >= gs._start_age + 1,
  close_call: gs => gs.had_critical_stat,
};
