import test from 'node:test';
import assert from 'node:assert/strict';
import { circleStats, trdarRank, seoulRatio } from './calc.js';

const LAT = 37.5, LNG = 127, M = 111320;
// 중심에서 동서 x, 남북 y 미터 떨어진 정사각형 고리
const square = (x0, y0, w) => [[[x0, y0], [x0 + w, y0], [x0 + w, y0 + w], [x0, y0 + w], [x0, y0]]
  .flatMap(([x, y]) => [LNG + x / (M * Math.cos(LAT * Math.PI / 180)), LAT + y / M])];
const dong = (over = {}) => ({ c: 'D', n: '테스트동', foot: 1e6, resid: 1000, hh: 400, area: 1e6,
  rest: { foot: 1e6, resid: 1000, hh: 400, area: 1e6 }, types: { '1인가구': 300, '2세대가구': 100 },
  rings: square(-500, -500, 1000), ...over });
const near = (got, want, tol) => assert.ok(Math.abs(got - want) <= want * tol, `${got} vs ${want}`);

test('원이 동 안에 있으면 넓이 비례로 더한다', () => {
  const s = circleStats({ trdar: [], dong: [dong()] }, LAT, LNG, 100);
  near(s.foot, Math.PI * 100 ** 2, 0.05);
  near(s.area, Math.PI * 100 ** 2, 0.001);
});

test('원이 반쯤 동 밖이면 약 절반', () => {
  const east = LNG + 500 / (M * Math.cos(LAT * Math.PI / 180));
  near(circleStats({ trdar: [], dong: [dong()] }, LAT, east, 100).foot, Math.PI * 100 ** 2 / 2, 0.1);
});

test('상권 안은 상권 밀도를 쓴다', () => {
  const t = { c: 'T', n: '상권', k: '골목상권', d: 'D', foot: 400000, resid: 0, hh: 0, area: 40000, rings: square(-100, -100, 200) };
  near(circleStats({ trdar: [t], dong: [dong()] }, LAT, LNG, 50).foot, Math.PI * 50 ** 2 * 10, 0.1);
});

test('관광특구는 원 계산에서 빼고 동 밀도를 쓴다', () => {
  const t = { c: 'T', n: '특구', k: '관광특구', d: 'D', foot: 400000, resid: 0, hh: 0, area: 40000, rings: square(-100, -100, 200) };
  near(circleStats({ trdar: [t], dong: [dong()] }, LAT, LNG, 50).foot, Math.PI * 50 ** 2, 0.1);
});

test('가구 형태는 동 비율 그대로 나눠 담는다', () => {
  const s = circleStats({ trdar: [], dong: [dong()] }, LAT, LNG, 100);
  near(s.types['1인가구'] / s.types['2세대가구'], 3, 0.001);
  near(s.types['1인가구'], 300 * s.resid / 1000, 0.001);
});

test('서울 밖·강 위 점은 0, 가구 형태 없는 동만 걸리면 types는 null', () => {
  const s = circleStats({ trdar: [], dong: [dong({ types: null })] }, LAT + 0.05, LNG, 100);
  assert.equal(s.foot, 0);
  assert.equal(s.types, null);
});

test('상권 순위는 큰 값이 1위, 값 없는 상권은 빼고 센다', () => {
  const data = { trdar: [{ c: 'a', foot: 10 }, { c: 'b', foot: 30 }, { c: 'c', foot: 20 }, { c: 'd', foot: null }] };
  assert.deepEqual(trdarRank(data, 'b', 'foot'), { rank: 1, total: 3 });
  assert.deepEqual(trdarRank(data, 'a', 'foot'), { rank: 3, total: 3 });
  assert.equal(trdarRank(data, 'd', 'foot'), null);
});

test('서울 평균 대비 배수는 같은 넓이 기준', () => {
  assert.equal(seoulRatio({ seoul: { foot: 1e6, area: 1e7 } }, { foot: 100, area: 1000 }, 'foot'), 1);
});
