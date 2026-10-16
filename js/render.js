// 맵을 한 장의 캔버스 텍스처로 그린다(실사 텍스처 + 그림자 + 핏자국/낙서 등 아포칼립스 디테일)
import { TILE } from './config.js';
import { mulberry32 } from './map.js';

export function buildMapTexture(scene, map, key = 'map') {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const cv = document.createElement('canvas');
  cv.width = map.pw;
  cv.height = map.ph;
  const ctx = cv.getContext('2d');
  const rng = mulberry32(1016);
  const floorImg = scene.textures.get('floor').getSourceImage();
  const grassImg = scene.textures.get('grass').getSourceImage();

  const pattern = (img, scale) => {
    const p = ctx.createPattern(img, 'repeat');
    p.setTransform(new DOMMatrix().scale(scale));
    return p;
  };
  const floorPat = pattern(floorImg, 0.5);
  const grassPat = pattern(grassImg, 0.55);

  const each = (fn) => {
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) fn(x, y, map.ch(x, y));
  };

  // 1) 바닥
  ctx.fillStyle = floorPat;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = grassPat;
  each((x, y, c) => { if (c === ',') ctx.fillRect(x * TILE, y * TILE, TILE, TILE); });

  // 구역별 색조
  const tint = (x1, y1, x2, y2, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x1 * TILE, y1 * TILE, (x2 - x1 + 1) * TILE, (y2 - y1 + 1) * TILE);
  };
  tint(1, 1, 22, 13, 'rgba(40,30,20,0.25)');
  tint(24, 1, 42, 14, 'rgba(30,40,35,0.22)');
  tint(24, 22, 36, 34, 'rgba(20,30,50,0.25)');
  tint(1, 20, 20, 34, 'rgba(30,45,50,0.25)');
  tint(44, 1, 58, 34, 'rgba(30,20,10,0.25)');

  // 바닥 타일 줄눈(실내)
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  each((x, y, c) => {
    if (c === '.' || c === 'D' || c === 'L') ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE, TILE);
  });

  // 얼룩/그을음
  for (let i = 0; i < 140; i++) {
    const x = rng() * cv.width, y = rng() * cv.height, r = 20 + rng() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${0.15 + rng() * 0.25})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // 핏자국 + 끌린 자국
  const blood = (x, y, s) => {
    ctx.fillStyle = `rgba(${70 + rng() * 40},${5 + rng() * 10},${5 + rng() * 8},${0.55 + rng() * 0.3})`;
    ctx.beginPath(); ctx.ellipse(x, y, s, s * (0.6 + rng() * 0.4), rng() * 3, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 7; k++) {
      const a = rng() * Math.PI * 2, d = s * (0.8 + rng() * 1.4);
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + rng() * s * 0.25, 0, Math.PI * 2); ctx.fill();
    }
  };
  for (let i = 0; i < 45; i++) {
    const tx = 1 + Math.floor(rng() * (map.w - 2)), ty = 1 + Math.floor(rng() * (map.h - 2));
    if ('.,'.includes(map.ch(tx, ty))) blood(tx * TILE + rng() * TILE, ty * TILE + rng() * TILE, 4 + rng() * 12);
  }
  for (let i = 0; i < 8; i++) {
    let x = rng() * cv.width, y = rng() * cv.height;
    const a = rng() * Math.PI * 2;
    ctx.strokeStyle = 'rgba(80,8,6,0.35)'; ctx.lineWidth = 6 + rng() * 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += Math.cos(a + (rng() - 0.5)) * 25; y += Math.sin(a + (rng() - 0.5)) * 25; ctx.lineTo(x, y); }
    ctx.stroke();
  }

  // 균열
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 60; i++) {
    let x = rng() * cv.width, y = rng() * cv.height;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (rng() - 0.5) * 40; y += (rng() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }

  // 잔해(종이, 파편)
  for (let i = 0; i < 260; i++) {
    const x = rng() * cv.width, y = rng() * cv.height;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(200,190,170,0.35)' : 'rgba(30,30,30,0.6)';
    ctx.save(); ctx.translate(x, y); ctx.rotate(rng() * 3);
    ctx.fillRect(-2, -1.5, 3 + rng() * 6, 2 + rng() * 4);
    ctx.restore();
  }

  // 2) 하수구/환풍구
  map.vents.forEach((v) => {
    const x = v.tx * TILE + 3, y = v.ty * TILE + 3, s = TILE - 6;
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, s, s);
    ctx.fillStyle = '#4a3c30';
    for (let k = 0; k < 5; k++) ctx.fillRect(x + 2, y + 3 + k * 5, s - 4, 2);
    // 녹물/점액
    const g = ctx.createRadialGradient(x + s / 2, y + s / 2, 4, x + s / 2, y + s / 2, 30);
    g.addColorStop(0, 'rgba(70,90,20,0.35)'); g.addColorStop(1, 'rgba(70,90,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 20, y - 20, s + 40, s + 40);
  });

  // 3) 벽 (그림자 → 상판)
  const isWall = (c) => c === '#' || c === 'G';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetX = 7;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#000';
  each((x, y, c) => { if (isWall(c)) ctx.fillRect(x * TILE, y * TILE, TILE, TILE); });
  ctx.restore();

  ctx.fillStyle = floorPat;
  each((x, y, c) => { if (c === '#') ctx.fillRect(x * TILE, y * TILE, TILE, TILE); });
  ctx.fillStyle = 'rgba(18,18,20,0.72)';
  each((x, y, c) => { if (c === '#') ctx.fillRect(x * TILE, y * TILE, TILE, TILE); });
  // 벽 가장자리 하이라이트
  ctx.fillStyle = 'rgba(190,180,160,0.12)';
  each((x, y, c) => {
    if (c !== '#') return;
    if (!isWall(map.ch(x, y - 1))) ctx.fillRect(x * TILE, y * TILE, TILE, 3);
    if (!isWall(map.ch(x - 1, y))) ctx.fillRect(x * TILE, y * TILE, 2, TILE);
  });
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  each((x, y, c) => {
    if (c !== '#') return;
    if (!isWall(map.ch(x, y + 1))) ctx.fillRect(x * TILE, y * TILE + TILE - 4, TILE, 4);
    if (!isWall(map.ch(x + 1, y))) ctx.fillRect(x * TILE + TILE - 3, y * TILE, 3, TILE);
  });
  // 철조망(운동장 바깥 벽 위)
  ctx.strokeStyle = 'rgba(160,160,160,0.5)'; ctx.lineWidth = 1;
  each((x, y, c) => {
    if (c !== '#' || x < 43) return;
    if (y === 0 || y === map.h - 1 || x === map.w - 1) {
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.arc(x * TILE + 4 + k * 8, y * TILE + TILE / 2, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });

  // 4) 가구
  const shadowed = (fn) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 10; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 6;
    fn();
    ctx.restore();
  };
  each((x, y, c) => {
    const px = x * TILE, py = y * TILE;
    if (c === 'T') {
      shadowed(() => {
        const g = ctx.createLinearGradient(px, py, px, py + TILE);
        g.addColorStop(0, '#5d6266'); g.addColorStop(1, '#33373a');
        ctx.fillStyle = g; ctx.fillRect(px + 1, py + 4, TILE - 2, TILE - 8);
      });
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(px + 1, py + 4, TILE - 2, 2);
      if (rng() < 0.3) { ctx.fillStyle = 'rgba(120,110,90,0.8)'; ctx.beginPath(); ctx.arc(px + 10 + rng() * 12, py + 14, 4, 0, Math.PI * 2); ctx.fill(); }
    } else if (c === 'b') {
      shadowed(() => { ctx.fillStyle = '#2a2a2a'; ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 2); });
      ctx.fillStyle = '#8c8676'; ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 6);
      ctx.fillStyle = 'rgba(90,10,8,0.6)'; ctx.beginPath(); ctx.arc(px + 12 + rng() * 8, py + 16, 4 + rng() * 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b9b3a2'; ctx.fillRect(px + 6, py + 5, TILE - 12, 6);
    } else if (c === 'G') {
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(px, py, TILE, TILE);
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k % 2 ? '#c9a21e' : '#111';
        ctx.fillRect(px + k * 8, py, 8, TILE);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = '#6b6b6b';
      for (let k = 0; k < 4; k++) ctx.fillRect(px + 2, py + 3 + k * 8, TILE - 4, 3);
    }
  });

  // 5) 바닥 글씨/낙서
  const stencil = (text, tx, ty, size, color, rot = 0) => {
    ctx.save();
    ctx.translate(tx * TILE, ty * TILE);
    ctx.rotate(rot);
    ctx.font = `${size}px "Special Elite", "Courier New", monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  stencil('C-BLOCK', 11, 7.4, 26, 'rgba(220,200,150,0.18)');
  stencil('MESS HALL', 33.5, 14.2, 28, 'rgba(220,200,150,0.16)');
  stencil('YARD', 51, 22, 52, 'rgba(240,230,200,0.10)');
  stencil('GUARD', 30.5, 23.5, 26, 'rgba(150,180,230,0.2)');
  stencil('LAUNDRY', 10.5, 25.5, 24, 'rgba(200,220,220,0.15)');
  stencil('EXIT →', 56, 15.6, 22, 'rgba(240,200,60,0.45)');
  stencil('THEY ARE INSIDE', 33, 11.4, 22, 'rgba(150,10,8,0.55)', -0.06);
  stencil('HELP US', 6, 15, 28, 'rgba(140,10,8,0.5)', 0.05);
  stencil('DON\'T RUN', 30, 33.6, 18, 'rgba(150,10,8,0.5)');
  stencil('DAY 47', 53, 30, 30, 'rgba(160,15,10,0.45)', -0.12);

  scene.textures.addCanvas(key, cv);
  return key;
}

/** 작은 보조 텍스처들(그림자, 재, 광원) */
export function buildFxTextures(scene) {
  const make = (key, w, h, draw) => {
    if (scene.textures.exists(key)) return;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    scene.textures.addCanvas(key, cv);
  };
  make('shadow', 64, 40, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.save(); c.scale(1, h / w); c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); c.fill(); c.restore();
  });
  make('ash', 8, 8, (c) => {
    const g = c.createRadialGradient(4, 4, 0, 4, 4, 4);
    g.addColorStop(0, 'rgba(220,210,200,1)'); g.addColorStop(1, 'rgba(220,210,200,0)');
    c.fillStyle = g; c.fillRect(0, 0, 8, 8);
  });
  make('glow', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  });
  make('locker', 32, 32, (c) => {
    const g = c.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, '#3e4a44'); g.addColorStop(0.5, '#56635c'); g.addColorStop(1, '#2f3833');
    c.fillStyle = g; c.fillRect(3, 1, 26, 30);
    c.fillStyle = 'rgba(0,0,0,0.55)';
    for (let k = 0; k < 4; k++) c.fillRect(8, 5 + k * 3, 16, 1.5);
    c.fillRect(15.5, 1, 1, 30);
    c.fillStyle = '#9a9a8a'; c.fillRect(20, 16, 3, 5);
    c.fillStyle = 'rgba(100,60,30,0.5)'; c.fillRect(4, 24, 10, 6);
    c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeRect(3.5, 1.5, 25, 29);
  });
}
