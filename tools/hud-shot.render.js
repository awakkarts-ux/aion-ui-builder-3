/* Рисование снимка HUD (tools/hud-shot.js): то же, что окно предпросмотра программы (ui/editor.js). */
(async () => {
  const cv = document.getElementById('c');
  const W = D.px.w;
  const H = D.px.h;
  const k = W / D.screen.w; // px на единицу файла (0,945 у пользователя)
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const load = (src) => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  const atl = {};
  for (const [t, src] of Object.entries(D.textures)) atl[t] = await load(src);
  const bg = await load(D.bg);
  const portrait = await load(D.portrait);
  try { await document.fonts.load('600 12px "Fira Sans Condensed"'); } catch (e) { /* без шрифта — системный */ }
  if (bg) g.drawImage(bg, 0, 0, W, H);
  g.imageSmoothingEnabled = true;

  const S = D.sample || {};
  const fill = S.fill || {};
  function skin(d, x, y, w, h) {
    const bmp = atl[d.texture];
    if (!bmp) return;
    const r = d.rects || {};
    if (!d.nine) {
      const s = r.src_image || r.src_middle_middle;
      if (s && s.w > 0 && s.h > 0 && w > 0 && h > 0) g.drawImage(bmp, s.x, s.y, s.w, s.h, x, y, w, h);
      return;
    }
    const z = { x: 0, y: 0, w: 0, h: 0 };
    const q = (n) => r[n] || z;
    const lw = Math.max(q('src_left_top').w, q('src_left_middle').w, q('src_left_bottom').w);
    const rw = Math.max(q('src_right_top').w, q('src_right_middle').w, q('src_right_bottom').w);
    const th = Math.max(q('src_left_top').h, q('src_middle_top').h, q('src_right_top').h);
    const bh = Math.max(q('src_left_bottom').h, q('src_middle_bottom').h, q('src_right_bottom').h);
    const mw = Math.max(0, w - lw - rw);
    const mh = Math.max(0, h - th - bh);
    for (const [cy, ch, rn] of [[y, th, 'top'], [y + th, mh, 'middle'], [y + th + mh, bh, 'bottom']]) {
      for (const [cx, cw, cn] of [[x, lw, 'left'], [x + lw, mw, 'middle'], [x + lw + mw, rw, 'right']]) {
        const s = r[`src_${cn}_${rn}`];
        if (s && s.w > 0 && s.h > 0 && cw > 0 && ch > 0) g.drawImage(bmp, s.x, s.y, s.w, s.h, cx, cy, cw, ch);
      }
    }
  }
  function text(t, x, y, w, h, o = {}) {
    g.save();
    g.font = `${o.weight || 600} ${o.size || 12}px "Fira Sans Condensed", Calibri, sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = o.align || 'center';
    const tx = g.textAlign === 'center' ? x + w / 2 : g.textAlign === 'right' ? x + w - 2 : x + 2;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,.9)';
    g.strokeText(t, tx, y + h / 2 + 0.5);
    g.fillStyle = o.color || '#fff';
    g.fillText(t, tx, y + h / 2 + 0.5);
    g.restore();
  }
  for (const w of D.wins) {
    g.save();
    g.translate(w.x * k, w.y * k);
    g.scale(k, k);
    const f = fill[w.id] || {};
    const pr = (S.portraitRect || {})[w.id];
    // окно, которое игра показывает частично (группа — по числу участников)
    const clipH = (S.clipH || {})[w.id];
    if (clipH) { g.beginPath(); g.rect(-50, -50, w.w + 100, clipH + 50); g.clip(); }
    // полоса: в ops бывает дважды (покой пресета на всю ширину и заливка на 2/3) —
    // рисуем одну заливку на всю ширину виджета × доля из образца
    const fullW = {};
    const hasGauge = new Set();
    for (const o of w.ops) {
      if (o.op === 'text') continue;
      fullW[o.widget] = Math.max(fullW[o.widget] || 0, o.w);
      if (o.state === 'gauge') hasGauge.add(o.widget);
    }
    const drawn = new Set();
    for (const op of w.ops) {
      if (op.op === 'text') { text(op.text, op.x, op.y, op.w, op.h, { color: `rgba(${op.color.slice(0, 3).join(',')},1)`, size: op.size, align: op.align }); continue; }
      const p = f[op.widget];
      const isGauge = p != null || hasGauge.has(op.widget);
      if (isGauge) {
        if (hasGauge.has(op.widget) && op.state !== 'gauge') continue;
        if (drawn.has(op.widget)) continue;
        drawn.add(op.widget);
        const share = p != null ? p : 1;
        if (share > 0) skin(op, op.x, op.y, Math.round(fullW[op.widget] * share), op.h);
        continue;
      }
      skin(op, op.x, op.y, op.w, op.h);
    }
    if (pr && portrait) {
      // модель персонажа игра рисует в круге — образец со скриншота
      g.save(); g.beginPath(); g.arc(pr[0] + pr[2] / 2, pr[1] + pr[3] / 2, pr[2] / 2 - 4, 0, Math.PI * 2); g.clip();
      g.drawImage(portrait, pr[0], pr[1], pr[2], pr[3]); g.restore();
    }
    for (const t of (S.texts || {})[w.id] || []) text(t[4], t[0], t[1], t[2], t[3], t[5] || {});
    g.restore();
  }
  document.title = 'ready';
})();
