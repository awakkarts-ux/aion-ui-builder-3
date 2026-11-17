'use strict';
/**
 * Готовые шрифты для раздела «Шрифт» (17.11.2026).
 *
 * Все с кириллицей и под лицензией SIL OFL (тексты лицензий лежат рядом с
 * файлами в src/ui/fonts/game). Шрифты с переменной толщиной заранее
 * сохранены одной толщиной: игре нужен обычный статичный файл.
 *
 * Профиль: `font.builtin = <id>` — готовый шрифт, иначе `font.file` — свой.
 * Тема может принести свой шрифт (theme.font): он ставится, только если
 * пользователь не включил шрифт сам.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'ui', 'fonts', 'game');

/** id -> файл и подпись. Порядок — порядок карточек. */
const BUILTIN = [
  { id: 'fira-cond', title: 'Fira Sans Condensed', file: 'FiraSansCondensed-Medium.ttf', note: 'узкий, как в Night City' },
  { id: 'roboto-cond', title: 'Roboto Condensed', file: 'RobotoCondensed-Medium.ttf', note: 'узкий, нейтральный' },
  { id: 'oswald', title: 'Oswald', file: 'Oswald-Medium.ttf', note: 'плакатный, очень узкий' },
  { id: 'exo2', title: 'Exo 2', file: 'Exo2-SemiBold.ttf', note: 'технический, фантастика' },
  { id: 'rubik', title: 'Rubik', file: 'Rubik-Medium.ttf', note: 'мягкий, круглый' },
  { id: 'russo', title: 'Russo One', file: 'RussoOne-Regular.ttf', note: 'жирный, игровой' },
  { id: 'play', title: 'Play', file: 'Play-Bold.ttf', note: 'квадратный, плотный' },
];

const byId = (id) => BUILTIN.find((f) => f.id === id) || null;

/** Абсолютный путь готового шрифта или null. */
function builtinPath(id) {
  const f = byId(id);
  return f ? path.join(DIR, f.file) : null;
}

/**
 * Какой файл шрифта ставить при сборке.
 * @param {object} profile
 * @param {{font?: string}|null} theme тема из theme.resolve
 * @returns {{file: string, label: string, langs: string[]|null}|null}
 */
function resolve(profile, theme) {
  const font = (profile && profile.font) || {};
  if (font.enabled) {
    if (font.builtin && byId(font.builtin)) {
      return { file: builtinPath(font.builtin), label: byId(font.builtin).title, langs: font.langs || null };
    }
    if (font.file) return { file: font.file, label: path.basename(font.file), langs: font.langs || null };
  }
  if (theme && theme.font && byId(theme.font)) {
    return { file: builtinPath(theme.font), label: `${byId(theme.font).title} (тема ${theme.title})`, langs: font.langs || null };
  }
  return null;
}

/** Для окна: список без путей, файл — относительно src/ui. */
function list() {
  return BUILTIN.map((f) => ({ id: f.id, title: f.title, note: f.note, url: 'fonts/game/' + f.file }));
}

function exists(id) {
  const p = builtinPath(id);
  return !!p && fs.existsSync(p);
}

module.exports = { BUILTIN, builtinPath, resolve, list, exists };
