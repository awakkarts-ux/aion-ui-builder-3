'use strict';
/**
 * Снимок HUD поверх настоящего скриншота игры — превью темы, которое
 * совпадает с игрой: окна берутся из сборки в памяти (build.apply dry) и
 * раскладываются движком предпросмотра программы (core/scene.js) там, где их
 * ставит игра, в её масштабе. То, что рисует код игры (заполненность полос,
 * цифры, имена, 3D-портрет), подставляется образцами из sample.json.
 *
 *   node tools/hud-shot.js <клиент> <резерв> <profile.json> <фон.png|webp> <out.html> [sample.json]
 *
 * out.html — самодостаточная страница (canvas); снимок PNG делает Playwright
 * (tools/hud-shot-png.js или вручную).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('../src/core/client');
const build = require('../src/core/build');
const scenelib = require('../src/core/scene');
const hudport = require('../src/core/hudport');
const png = require('../src/core/png');

const [clientDir, backupDir, profilePath, bgPath, outPath, samplePath] = process.argv.slice(2);
if (!outPath) {
  console.log('node tools/hud-shot.js <клиент> <резерв> <profile.json> <фон> <out.html> [sample.json]');
  process.exit(1);
}

const sample = samplePath ? JSON.parse(fs.readFileSync(samplePath, 'utf8')) : {};
const client = new Client(clientDir, backupDir);
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const lang = profile.lang || 'rus';
const t0 = Date.now();
const dry = build.apply(client, profile, null, { dry: true }).dry;
// экран: из образца (как у пользователя), иначе из system.cfg клиента
const screen = sample.screen || hudport.screenOf(client);
const scene = new scenelib.Scene(client, lang, dry, screen, 's1');

// окна и варианты, как в игре; места «цели цели» и группы — по скриншотам пользователя
const WANT = [
  ['hud_s1/exp_bar_dialog.xml'],
  ['hud_s1/basic_status_dialog.xml'],
  ['hud_s1/quickbar_dialog.xml'],
  ['game/quickbar_dialog_ctrl.xml'],
  ['game/quickbar_dialog_alt.xml'],
  ['hud_s1/start_dialog.xml'],
  ['hud_s1/radar_dialog.xml'],
  ['game/target_dialog.xml', sample.targetVariant || 'container3'],
  ['game/target_assist_dialog.xml'],
  ['game/party_dialog.xml'],
];
const wins = [];
for (const [id, variant] of WANT) {
  let w = null;
  try { w = scene.window(id, variant); } catch (e) { w = null; }
  if (!w) { console.log('нет окна', id); continue; }
  const place = (sample.place || {})[id];
  if (place) Object.assign(w, place);
  wins.push(w);
}
// ряды Ctrl/Alt — стопкой над основным рядом панели (как ставит игра)
const qb = wins.find((w) => w.id === 'hud_s1/quickbar_dialog.xml');
let stackY = qb ? qb.y + 81 : 0;
for (const id of ['game/quickbar_dialog_ctrl.xml', 'game/quickbar_dialog_alt.xml']) {
  const w = wins.find((x) => x.id === id);
  if (!w || !qb) continue;
  stackY -= w.h + 3;
  w.x = qb.x + 3;
  w.y = stackY;
}
// «цель цели» — под окном цели, правее центра
const tg = wins.find((w) => w.id === 'game/target_dialog.xml');
const tt = wins.find((w) => w.id === 'game/target_assist_dialog.xml');
if (tg && tt) { tt.x = tg.x + 243; tt.y = tg.y + 42; }

// атласы, которые нужны окнам
const textures = new Map();
for (const w of wins) {
  for (const op of w.ops) {
    if (op.op !== 'skin' || !op.texture || textures.has(op.texture)) continue;
    const img = scene.atlas(op.texture);
    textures.set(op.texture, img ? 'data:image/png;base64,' + png.encode(img.width, img.height, img.rgba).toString('base64') : null);
  }
}
const ext = path.extname(bgPath).slice(1).toLowerCase();
const bg = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + fs.readFileSync(bgPath).toString('base64');
const portrait = sample.portrait ? 'data:image/png;base64,' + fs.readFileSync(sample.portrait).toString('base64') : '';

const data = { screen: scene.screen, px: screen, wins, textures: Object.fromEntries(textures), bg, portrait, sample };
const html = `<!doctype html><html><head><meta charset="utf-8"><title>HUD</title>
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans+Condensed:wght@500;600;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:#000}canvas{display:block;width:100%;height:auto}</style></head><body>
<canvas id="c"></canvas>
<script>const D=${JSON.stringify(data)};
${fs.readFileSync(path.join(__dirname, 'hud-shot.render.js'), 'utf8')}
</script></body></html>`;
fs.writeFileSync(outPath, html);
console.log('готово', outPath, (html.length / 1e6).toFixed(1) + ' МБ', ((Date.now() - t0) / 1000).toFixed(1) + ' с', 'окон', wins.length);
