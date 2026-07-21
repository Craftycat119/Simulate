// avatar.js — выбор и отрисовка внешности персонажа (порт avatar.py на Canvas).
'use strict';

const SKIN_TONES = ["#FFDBB4", "#EEC39A", "#D1A374", "#C68642", "#8D5524", "#5C3A21"];
const HAIR_COLORS = ["#1A1A1A", "#3D2817", "#8B5E3C", "#C9A227", "#B0453D", "#D9D9D9"];
const EYE_COLORS = ["#3D2817", "#4A7C8C", "#4A8C4A", "#6B4226"];
const HAIR_STYLES = [["short", "Короткие"], ["long", "Длинные"], ["ponytail", "Хвост"],
                      ["mohawk", "Ирокез"], ["bald", "Лысина"]];

const DEFAULT_AVATAR = {
  skin: SKIN_TONES[0], hair_color: HAIR_COLORS[1], eyes: EYE_COLORS[0], hair_style: "short",
};

function sanitizeAvatar(cfg) {
  cfg = Object.assign({}, DEFAULT_AVATAR, cfg || {});
  if (!SKIN_TONES.includes(cfg.skin)) cfg.skin = DEFAULT_AVATAR.skin;
  if (!HAIR_COLORS.includes(cfg.hair_color)) cfg.hair_color = DEFAULT_AVATAR.hair_color;
  if (!EYE_COLORS.includes(cfg.eyes)) cfg.eyes = DEFAULT_AVATAR.eyes;
  if (!HAIR_STYLES.some(([k]) => k === cfg.hair_style)) cfg.hair_style = DEFAULT_AVATAR.hair_style;
  return cfg;
}

// Рисует персонажа на 2D canvas context. cx,cy — центр головы, scale — масштаб.
function drawAvatar(ctx, cx, cy, scale, cfg, mood, health, netWorth) {
  cfg = sanitizeAvatar(cfg);
  mood = mood === undefined ? 70 : mood;
  health = health === undefined ? 100 : health;
  netWorth = netWorth || 0;
  const r = 34 * scale;
  const skin = cfg.skin, hairColor = cfg.hair_color, eyes = cfg.eyes, hairStyle = cfg.hair_style;

  ctx.save();
  const circle = (x, y, rad, fill) => { ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  const ellipse = (x0, y0, x1, y1, fill) => {
    const ex = (x0 + x1) / 2, ey = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    ctx.beginPath(); ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  };

  const suitColor = netWorth >= 1000000 ? '#1a1a2e' : (netWorth >= 100000 ? '#2c3e6b' : '#3b4252');
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.3, cy + r * 3.2);
  ctx.quadraticCurveTo(cx - r * 1.3, cy + r * 0.9, cx, cy + r * 0.7);
  ctx.quadraticCurveTo(cx + r * 1.3, cy + r * 0.9, cx + r * 1.3, cy + r * 3.2);
  ctx.closePath();
  ctx.fillStyle = suitColor;
  ctx.fill();

  if (['short', 'long', 'ponytail'].includes(hairStyle)) {
    ellipse(cx - r * 1.1, cy - r * 1.35, cx + r * 1.1, cy + r * 0.35, hairColor);
  }
  if (hairStyle === 'long') {
    ellipse(cx - r * 1.35, cy - r * 0.15, cx - r * 0.55, cy + r * 1.55, hairColor);
    ellipse(cx + r * 0.55, cy - r * 0.15, cx + r * 1.35, cy + r * 1.55, hairColor);
  } else if (hairStyle === 'ponytail') {
    ellipse(cx + r * 0.65, cy - r * 0.05, cx + r * 1.45, cy + r * 1.15, hairColor);
  }
  if (hairStyle === 'mohawk') {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.18, cy - r * 0.9);
    ctx.lineTo(cx + r * 0.18, cy - r * 0.9);
    ctx.lineTo(cx + r * 0.12, cy - r * 1.6);
    ctx.lineTo(cx - r * 0.12, cy - r * 1.6);
    ctx.closePath();
    ctx.fillStyle = hairColor;
    ctx.fill();
  }

  circle(cx, cy, r, skin);
  circle(cx - r * 0.98, cy + r * 0.1, r * 0.16, skin);
  circle(cx + r * 0.98, cy + r * 0.1, r * 0.16, skin);

  const eyeR = 4.5 * scale, irisR = eyeR * 0.8, pupilR = irisR * 0.4;
  for (const sign of [-1, 1]) {
    const ex = cx + sign * r * 0.35;
    circle(ex, cy, eyeR, '#ffffff');
    circle(ex, cy, irisR, eyes);
    circle(ex, cy, pupilR, '#1a1a1a');
  }

  ctx.strokeStyle = hairColor; ctx.lineWidth = 2 * scale; ctx.lineCap = 'round';
  for (const sign of [-1, 1]) {
    const ex = cx + sign * r * 0.35;
    ctx.beginPath();
    ctx.moveTo(ex - 5 * scale, cy - 8 * scale);
    ctx.lineTo(ex + 5 * scale, cy - 9 * scale);
    ctx.stroke();
  }

  ctx.strokeStyle = '#8a4a4a'; ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  if (mood >= 60) {
    ctx.arc(cx, cy + r * 0.35, r * 0.32, 0.15 * Math.PI, 0.85 * Math.PI);
  } else if (mood >= 30) {
    ctx.moveTo(cx - r * 0.25, cy + r * 0.5);
    ctx.lineTo(cx + r * 0.25, cy + r * 0.5);
  } else {
    ctx.arc(cx, cy + r * 0.75, r * 0.32, 1.15 * Math.PI, 1.85 * Math.PI);
  }
  ctx.stroke();

  if (health < 30) {
    ctx.fillStyle = 'rgba(120,120,140,0.35)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}
