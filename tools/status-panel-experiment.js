'use strict';

/**
 * Профиль экспериментальной панели HP/MP.
 *
 * По умолчанию выполняется dry-run. Для записи в клиент нужно явно передать
 * --apply. Исходный профиль и резервные копии сборщика не перезаписываются.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('../src/core/client');
const build = require('../src/core/build');

const appDir = path.join(process.env.APPDATA || os.homedir(), 'aion-ui-builder');
const profilePath = path.join(appDir, 'profile.json');
const configPath = path.join(appDir, 'config.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function panelEdit() {
  return {
    frame: { w: 430, h: 118 },
    widgets: {
      portrait: { frame: { x: 20, y: 10, w: 96, h: 96 } },
      level: { frame: { x: 5, y: 47, w: 24, h: 22 } },
      hp_gauge_bg: { frame: { x: 122, y: 28, w: 280, h: 20 } },
      hp_gauge: { frame: { x: 122, y: 28, w: 280, h: 20 } },
      mp_gauge_bg: { frame: { x: 122, y: 50, w: 280, h: 20 } },
      mp_gauge: { frame: { x: 122, y: 50, w: 280, h: 20 } },
      dp_gauge_1: { frame: { x: 115, y: 76, w: 300, h: 8 } },
      dp_gauge_2: { frame: { x: 115, y: 76, w: 300, h: 8 } },
      dp_gauge_3: { frame: { x: 115, y: 76, w: 300, h: 8 } },
      dp_gauge_text: { frame: { x: 210, y: 88, w: 190, h: 14 } },
      dp_level: { frame: { x: 145, y: 88, w: 28, h: 14 } },
      boost_marker: { frame: { x: 380, y: 34, w: 33, h: 33 } },
    },
  };
}

function aion2PanelEdit() {
  return {
    frame: { w: 360, h: 86 },
    widgets: {
      portrait: { frame: { x: 12, y: 11, w: 64, h: 64 } },
      level: { frame: { x: 31, y: 67, w: 24, h: 16 } },
      hp_gauge_bg: { frame: { x: 86, y: 17, w: 255, h: 14 } },
      hp_gauge: { frame: { x: 86, y: 17, w: 255, h: 14 } },
      mp_gauge_bg: { frame: { x: 86, y: 34, w: 255, h: 14 } },
      mp_gauge: { frame: { x: 86, y: 34, w: 255, h: 14 } },
      dp_gauge_1: { frame: { x: 84, y: 55, w: 260, h: 6 } },
      dp_gauge_2: { frame: { x: 84, y: 55, w: 260, h: 6 } },
      dp_gauge_3: { frame: { x: 84, y: 55, w: 260, h: 6 } },
      dp_gauge_text: { frame: { x: 185, y: 64, w: 156, h: 14 } },
      dp_level: { frame: { x: 122, y: 64, w: 28, h: 14 } },
      boost_marker: { frame: { x: 302, y: 4, w: 33, h: 33 } },
    },
  };
}

function experimentProfile(base) {
  const profile = JSON.parse(JSON.stringify(base));
  const aion2 = process.argv.includes('--aion2');
  const edit = aion2 ? aion2PanelEdit() : panelEdit();
  profile.layout = Object.assign({}, profile.layout);
  profile.layout['hud_s1/basic_status_dialog.xml'] = edit;
  profile.layout['hud_s2/basic_status_dialog.xml'] = edit;
  profile.skins = Object.assign({}, profile.skins, {
    'version4.xml|classic_hud|v3_gauge_red_bg': {
      texture: 'Textures/ui/v5_common',
      rects: { src_image: { x: 210, y: 726, w: 179, h: 13 } },
    },
    'version4.xml|classic_hud|v3_gauge_red': {
      texture: 'Textures/ui/v5_common',
      rects: { src_image: { x: 210, y: 741, w: 179, h: 13 } },
    },
    'version4.xml|classic_hud|v3_gauge_blue_bg': {
      texture: 'Textures/ui/v5_common',
      rects: { src_image: { x: 210, y: 756, w: 179, h: 13 } },
    },
    'version4.xml|classic_hud|v3_gauge_blue': {
      texture: 'Textures/ui/v5_common',
      rects: { src_image: { x: 210, y: 771, w: 179, h: 13 } },
    },
  });
  if (aion2) {
    profile.skins['version4.xml|classic_hud|v3_hud_char'] = {
      texture: 'Textures/ui/v5_hud_s1',
      rects: { src_image: { x: 1, y: 360, w: 353, h: 151 } },
    };
  }
  return profile;
}

const base = readJson(profilePath);
const config = readJson(configPath);
const profile = experimentProfile(base);
const clientRoot = profile.clientRoot || config.clientRoot;
const backupDir = path.join(appDir, 'backup');
const client = new Client(clientRoot, backupDir);
const apply = process.argv.includes('--apply');

console.log(`клиент: ${clientRoot}`);
console.log(`вариант: ${process.argv.includes('--aion2') ? 'aion2' : 'expanded'}`);
console.log(`режим: ${apply ? 'запись' : 'dry-run'}`);
const report = build.apply(client, profile, (message) => console.log('  ' + message), { dry: !apply });
console.log(`диалогов ${report.dialogs}, файлов ${report.files}, паков: ${report.paks.join(', ') || 'нет'}`);
if (!apply) console.log('изменения не записаны. Для применения запусти скрипт с --apply');
else console.log('эксперимент записан. Чтобы вернуть исходный вид, используй кнопку восстановления в приложении.');
