import { bbox, circleStats, contains, seoulRatio, trdarRank } from './calc.js';

const KAKAO_KEY = ''; // 카카오 개발자 사이트 → 내 애플리케이션 → 앱 키 → JavaScript 키
const START = [37.5081, 127.0116]; // 반포역
const TYPES = [['1인가구', '1인', '#60a5fa'], ['1세대가구', '부부 등', '#a78bfa'], ['2세대가구', '부모+자녀', '#34d399'],
  ['3세대가구', '3대', '#fbbf24'], ['비혈연가구', '기타', '#94a3b8']];
const COLS = [['foot', '유동/일'], ['resid', '주거인구'], ['hh', '가구'], ['per', '가구당'], ['one', '1인%']];
const $ = id => document.getElementById(id);
const fmt = (n, d = 0) => n == null || isNaN(n) ? '–' : n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

let data, map, mode = 'trdar', current = null, selShape = null;
const sortKey = { t: 'foot', c: 'foot' };
const polys = new Map();
let saved = (() => { try { return JSON.parse(localStorage.getItem('tmtmap.saved')) || []; } catch { return []; } })();

function store() {
  try { localStorage.setItem('tmtmap.saved', JSON.stringify(saved)); } catch { /* 사생활 모드: 이번 방문 동안만 유지 */ }
  $('count').textContent = saved.length || '';
}

const sameEntry = (a, b) => a.kind === b.kind && (a.kind === 't' ? a.code === b.code : a.lat === b.lat && a.lng === b.lng && a.r === b.r);
const typeSum = t => t ? Object.values(t).reduce((a, b) => a + b, 0) : 0;
const rLabel = r => r >= 1000 ? `${r / 1000}km` : `${r}m`;

function stats(e) {
  if (e.kind === 't') {
    const t = data.trdar.find(t => t.c === e.code);
    if (!t) return { name: '사라진 상권 (새 분기 자료에 없음)', sub: '', foot: null, resid: null, hh: null, types: null };
    const d = data.dong.find(d => d.c === t.d);
    return { name: t.n, sub: `${t.k} · ${d ? d.n : ''}`, foot: t.foot, resid: t.resid, hh: t.hh, types: d ? d.types : null };
  }
  const s = circleStats(data, e.lat, e.lng, e.r);
  const d = data.dong.find(d => contains(d, e.lng, e.lat));
  return { ...s, name: `${d ? d.n.split(' ')[1] : '원'} 부근 ${rLabel(e.r)}`, sub: `${d ? d.n : ''} · 원 안 동·상권 넓이 비례 어림` };
}

const value = (s, k) => k === 'per' ? (s.hh ? s.resid / s.hh : null)
  : k === 'one' ? (s.types ? 100 * (s.types['1인가구'] || 0) / typeSum(s.types) : null) : s[k];

function typesHtml(types) {
  if (!types) return '<div class="sub">가구 형태: 자료 없음</div>';
  const sum = typeSum(types);
  const pct = k => 100 * (types[k] || 0) / sum;
  return `<div class="types">${TYPES.map(([k, , c]) => `<span style="width:${pct(k)}%;background:${c}"></span>`).join('')}</div>
    <div class="legend">${TYPES.map(([k, label, c]) => `<span><i style="background:${c}"></i>${label} ${fmt(pct(k))}%</span>`).join('')}</div>`;
}

function showSheet() {
  const sheet = $('sheet');
  if (!current) { sheet.hidden = true; return; }
  const s = stats(current);
  const extra = k => {
    if (current.kind === 'c') return `서울 평균의 ${fmt(seoulRatio(data, s, k), 1)}배`;
    const r = trdarRank(data, current.code, k);
    return r ? `서울 ${fmt(r.rank)}위 / ${fmt(r.total)}` : '';
  };
  const isSaved = saved.some(e => sameEntry(e, current));
  sheet.innerHTML = `<h2><span>${esc(s.name)}</span><button id="save" ${isSaved ? 'disabled' : ''}>${isSaved ? '담음' : '담기'}</button></h2>
    <div class="sub">${esc(s.sub)}</div>
    <div class="row">하루 유동인구<span><b>${fmt(s.foot)}명</b><small>${extra('foot')}</small></span></div>
    <div class="row">주거인구<span><b>${fmt(s.resid)}명</b><small>${extra('resid')}</small></span></div>
    <div class="row">가구 수<span><b>${fmt(s.hh)}</b><small>가구당 ${fmt(value(s, 'per'), 2)}명</small></span></div>
    ${typesHtml(s.types)}`;
  sheet.hidden = false;
  $('save').onclick = () => { saved.push(current); store(); showSheet(); };
}

function renderCompare() {
  const box = $('compare');
  if (!saved.length) { box.innerHTML = '<p class="note">지도에서 골목이나 원을 고르고 [담기]를 누르면 여기서 비교할 수 있어요.</p>'; return; }
  let html = '';
  for (const [kind, title] of [['t', '골목(상권)'], ['c', '원']]) {
    const rows = saved.map((e, i) => ({ e, i, s: stats(e) })).filter(r => r.e.kind === kind);
    if (!rows.length) continue;
    const key = sortKey[kind];
    rows.sort((a, b) => (value(b.s, key) ?? -Infinity) - (value(a.s, key) ?? -Infinity));
    const cell = (s, k) => {
      const v = value(s, k);
      const ratio = kind === 'c' && ['foot', 'resid', 'hh'].includes(k) ? `<br><small>${fmt(seoulRatio(data, s, k), 1)}배</small>` : '';
      return `<td>${fmt(v, k === 'per' ? 2 : 0)}${ratio}</td>`;
    };
    html += `<h3>${title}</h3><div class="scroll"><table><thead><tr><th>#</th><th>이름</th>${COLS.map(([k, label]) =>
      `<th ${k === key ? 'aria-sort="descending"' : ''}><button class="sort" data-kind="${kind}" data-key="${k}">${label}</button></th>`).join('')}<th></th></tr></thead><tbody>`;
    rows.forEach((r, n) => {
      html += `<tr><td>${n + 1}</td><td>${esc(r.s.name)}</td>${COLS.map(([k]) => cell(r.s, k)).join('')}<td><button class="del" data-i="${r.i}" aria-label="${esc(r.s.name)} 빼기">빼기</button></td></tr>`;
    });
    if (kind === 't') html += avgRow();
    html += '</tbody></table></div>';
  }
  html += `<p class="note">${data.q.slice(0, 4)}년 ${data.q[4]}분기 서울시 상권분석서비스 · 가구 형태 통계청 ${data.hhYear}년<br>
    항목 이름을 누르면 그 기준으로 순위가 바뀌어요. 원의 '배'는 같은 넓이의 서울 평균과 비교한 값이에요.</p>`;
  box.innerHTML = html;
}

function avgRow() {
  const ts = data.trdar.filter(t => t.foot != null && t.resid != null);
  const mean = k => ts.reduce((a, t) => a + t[k], 0) / ts.length;
  const types = {};
  for (const d of data.dong) if (d.types) for (const [k, n] of Object.entries(d.types)) types[k] = (types[k] || 0) + n;
  const s = { foot: mean('foot'), resid: mean('resid'), hh: mean('hh'), types };
  return `<tr class="avg"><td></td><td>서울 상권 평균</td>${COLS.map(([k]) => `<td>${fmt(value(s, k), k === 'per' ? 2 : 0)}</td>`).join('')}<td></td></tr>`;
}

$('compare').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.classList.contains('sort')) sortKey[b.dataset.kind] = b.dataset.key;
  if (b.classList.contains('del')) { saved.splice(+b.dataset.i, 1); store(); }
  renderCompare();
});

function setTab(compare) {
  $('tabMap').setAttribute('aria-pressed', !compare);
  $('tabCompare').setAttribute('aria-pressed', compare);
  $('compare').hidden = !compare;
  if (compare) { $('sheet').hidden = true; renderCompare(); } else showSheet();
}
$('tabMap').onclick = () => setTab(false);
$('tabCompare').onclick = () => setTab(true);

function setMode(m) {
  mode = m;
  $('modeTrdar').setAttribute('aria-pressed', m === 'trdar');
  $('modeCircle').setAttribute('aria-pressed', m === 'circle');
}
$('modeTrdar').onclick = () => setMode('trdar');
$('modeCircle').onclick = () => setMode('circle');
$('radius').onchange = () => {
  setMode('circle');
  if (current && current.kind === 'c') { current = { ...current, r: +$('radius').value }; drawSelection(); showSheet(); }
};

// ── 카카오 지도 ──
const path = item => item.rings.map(r => { const p = []; for (let i = 0; i < r.length; i += 2) p.push(new kakao.maps.LatLng(r[i + 1], r[i])); return p; });

function drawSelection() {
  if (selShape) selShape.setMap(null);
  if (!current) return;
  if (current.kind === 't') {
    const t = data.trdar.find(t => t.c === current.code);
    selShape = new kakao.maps.Polygon({ path: path(t), strokeWeight: 3, strokeColor: '#fb923c', fillColor: '#fb923c', fillOpacity: 0.25 });
  } else {
    selShape = new kakao.maps.Circle({ center: new kakao.maps.LatLng(current.lat, current.lng), radius: current.r,
      strokeWeight: 3, strokeColor: '#fb923c', fillColor: '#fb923c', fillOpacity: 0.18 });
  }
  selShape.setMap(map);
}

// 상권 경계선: 많이 확대했을 때 화면 안에 있는 것만 그린다 (휴대폰에서 1,650개를 한꺼번에 그리면 느림)
function refreshOutlines() {
  const show = map.getLevel() <= 6;
  const b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
  for (const t of data.trdar) {
    if (!t.rings.length) continue;
    const [x0, y0, x1, y1] = bbox(t);
    const vis = show && x0 <= ne.getLng() && x1 >= sw.getLng() && y0 <= ne.getLat() && y1 >= sw.getLat();
    let p = polys.get(t.c);
    if (vis && !p) {
      p = new kakao.maps.Polygon({ path: path(t), strokeWeight: 1, strokeColor: '#2563eb', strokeOpacity: 0.8, fillColor: '#2563eb', fillOpacity: 0.06 });
      polys.set(t.c, p);
    }
    if (p && (p.getMap() ? !vis : vis)) p.setMap(vis ? map : null);
  }
}

function initMap() {
  map = new kakao.maps.Map($('map'), { center: new kakao.maps.LatLng(...START), level: 5 });
  kakao.maps.event.addListener(map, 'idle', refreshOutlines);
  kakao.maps.event.addListener(map, 'click', ev => {
    const lat = ev.latLng.getLat(), lng = ev.latLng.getLng();
    if (mode === 'trdar') {
      // 겹치면 가장 작은 상권(관광특구보다 골목상권)
      const hit = data.trdar.filter(t => t.rings.length && contains(t, lng, lat)).sort((a, b) => a.area - b.area)[0];
      current = hit ? { kind: 't', code: hit.c } : null;
    } else {
      current = { kind: 'c', lat: +lat.toFixed(5), lng: +lng.toFixed(5), r: +$('radius').value };
    }
    drawSelection();
    showSheet();
  });
  refreshOutlines();
}

function fail(msg) { $('nokey').hidden = false; $('nokey').textContent = msg; }

(async () => {
  try { data = await (await fetch('data.json')).json(); } catch { return fail('데이터를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  store();
  if (!KAKAO_KEY) return fail('카카오 JavaScript 키를 넣으면 지도가 떠요. (map/app.js 맨 위 KAKAO_KEY)');
  const s = document.createElement('script');
  s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false`;
  s.onload = () => kakao.maps.load(initMap);
  s.onerror = () => fail('카카오 지도를 불러오지 못했어요. 키와 등록한 사이트 주소를 확인해 주세요.');
  document.head.append(s);
})();
