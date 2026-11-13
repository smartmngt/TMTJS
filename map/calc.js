// 원 안 숫자 계산과 순위. 브라우저와 node 테스트가 같이 쓴다.
const M_PER_DEG = 111320;
const STEP = 20; // 원 안에 20m 간격으로 점을 찍어 넓이 비례로 더한다
const KEYS = ['foot', 'resid', 'hh'];
const TOUR = '관광특구'; // 다른 상권과 겹쳐서 원 계산에서 뺀다

export function bbox(item) {
  if (!item._b) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of item.rings) for (let i = 0; i < r.length; i += 2) {
      b[0] = Math.min(b[0], r[i]); b[1] = Math.min(b[1], r[i + 1]);
      b[2] = Math.max(b[2], r[i]); b[3] = Math.max(b[3], r[i + 1]);
    }
    item._b = b;
  }
  return item._b;
}

// 짝홀 규칙: 구멍 난 고리도 그대로 처리
export function contains(item, lng, lat) {
  const b = bbox(item);
  if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) return false;
  let inside = false;
  for (const r of item.rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function circleStats(data, lat, lng, radiusM) {
  const mLng = M_PER_DEG * Math.cos(lat * Math.PI / 180);
  const dLat = radiusM / M_PER_DEG, dLng = radiusM / mLng;
  const hit = it => { const b = bbox(it); return b[0] <= lng + dLng && b[2] >= lng - dLng && b[1] <= lat + dLat && b[3] >= lat - dLat; };
  const trdar = data.trdar.filter(t => t.k !== TOUR && t.rings.length && hit(t));
  const dongs = data.dong.filter(hit);
  const byCode = new Map(data.dong.map(d => [d.c, d]));
  const out = { foot: 0, resid: 0, hh: 0, area: Math.PI * radiusM ** 2 };
  const residByDong = new Map();
  const cell = STEP * STEP;

  for (let y = -radiusM + STEP / 2; y < radiusM; y += STEP) {
    for (let x = -radiusM + STEP / 2; x < radiusM; x += STEP) {
      if (x * x + y * y > radiusM * radiusM) continue;
      const pLng = lng + x / mLng, pLat = lat + y / M_PER_DEG;
      const t = trdar.find(t => contains(t, pLng, pLat));
      const src = t || dongs.find(d => contains(d, pLng, pLat));
      if (!src) continue; // 강·서울 밖
      const v = t || src.rest;
      if (!v.area) continue;
      for (const k of KEYS) out[k] += (v[k] || 0) / v.area * cell;
      const dc = t ? t.d : src.c;
      residByDong.set(dc, (residByDong.get(dc) || 0) + (v.resid || 0) / v.area * cell);
    }
  }

  // 원 안 주거인구를 동별로 나눠, 그 동의 가구 형태를 같은 비율로 담는다
  let types = null;
  for (const [dc, r] of residByDong) {
    const d = byCode.get(dc);
    if (!d || !d.types || !d.resid) continue;
    types ??= {};
    for (const [k, n] of Object.entries(d.types)) types[k] = (types[k] || 0) + n * r / d.resid;
  }
  out.types = types;
  return out;
}

export function trdarRank(data, code, key) {
  const me = data.trdar.find(t => t.c === code);
  if (!me || me[key] == null) return null;
  const vals = data.trdar.filter(t => t[key] != null);
  return { rank: 1 + vals.filter(t => t[key] > me[key]).length, total: vals.length };
}

export function seoulRatio(data, stats, key) {
  return stats[key] / (data.seoul[key] * stats.area / data.seoul.area);
}
