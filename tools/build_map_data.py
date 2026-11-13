#!/usr/bin/env python3
"""상권 지도 데이터 만들기: 서울 열린데이터·data.go.kr 원자료 → map/data.json.
새 분기 자료가 나오면 한 번 실행: python3 tools/build_map_data.py  (pip install pyshp pyproj)"""
import calendar, csv, math, datetime, io, json, os, re, time, urllib.parse, urllib.request
import pyproj, shapefile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'map', 'data.json')
CACHE = os.path.join(ROOT, 'tools', '.cache', datetime.date.today().strftime('%Y%m%d'))  # 같은 날 다시 돌리면 다시 안 받음
SEOUL_FILE = 'https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false'
SEOUL_SHEET = 'https://datafile.seoul.go.kr/bigfile/iot/sheet/csv/download.do'
TOUR = '관광특구'  # 다른 상권과 겹쳐서 원 계산 밀도에서 뺀다
TO_WGS = pyproj.Transformer.from_crs(5181, 4326, always_xy=True)  # 원자료 좌표계 EPSG:5181


def fetch(name, url, data=None):
    """원자료 받기. 열린데이터광장이 연결을 자주 끊어서 4번까지 다시 시도."""
    dest = os.path.join(CACHE, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(CACHE, exist_ok=True)
    body = urllib.parse.urlencode(data).encode() if data else None
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, body), timeout=600) as r:
                raw = r.read()
            if raw[:20].lstrip().startswith(b'<'):
                raise IOError(f'{name}: 파일 대신 웹페이지가 왔어요 ({raw[:80]!r})')
            with open(dest, 'wb') as f:
                f.write(raw)
            return dest
        except Exception as e:
            if i == 3:
                raise
            print('다시 시도', name, e)
            time.sleep(5 * (i + 1))


def seoul_file(inf_id, seq, inf_seq):
    return fetch(f'{inf_id}.zip', SEOUL_FILE, {'infId': inf_id, 'seq': seq, 'infSeq': inf_seq, 'seqNo': ''})


def seoul_sheet(inf_id):
    path = fetch(f'{inf_id}.csv', SEOUL_SHEET, {
        'srvType': 'S', 'infId': inf_id, 'serviceKind': '1', 'pageNo': '1', 'gridTotalCnt': '',
        'ssUserId': 'SAMPLE_VIEW', 'strWhere': '', 'strOrderby': 'STDR_YYQU_CD DESC',
        'filterCol': '필터선택', 'txtFilter': ''})
    with open(path, encoding='cp949') as f:
        return list(csv.DictReader(f))


def household_types():
    """통계청 2023 센서스 가구(재정의세대유형) — 집계구 행을 동 이름별로 합친다."""
    tok = json.load(open(fetch('hh-token.json', 'https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?'
                                 'publicDataPk=15159227&publicDataDetailPk=uddi:9c344b0d-9433-46ae-9784-aa1d26d155e8&fileDetailSn=1')))
    path = fetch('hh.csv', f"https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId={tok['atchFileId']}&fileDetailSn=1&insertDataPrcus=N")
    out = {}
    with open(path, encoding='cp949') as f:
        for r in csv.DictReader(f):
            if r['행정동명'].startswith('서울특별시 '):
                t = out.setdefault(norm(r['행정동명'][6:]), {})
                t[r['재정의세대유형']] = t.get(r['재정의세대유형'], 0) + int(r['가구수'])
    return out


def norm(name):
    return re.sub(r'[^0-9가-힣]', '', name)  # '종로1·2·3·4가동' 과 '종로1.2.3.4가동' 을 같게


def simplify(pts, tol):
    """Douglas–Peucker (미터 좌표)."""
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        far, idx = 0, -1
        for i in range(a + 1, b):
            px, py = pts[i][0] - ax, pts[i][1] - ay
            d = abs(dy * px - dx * py) / L if L else math.hypot(px, py)  # 닫힌 고리는 시작=끝이라 L=0
            if d > far:
                far, idx = d, i
        if far > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def rings(shape, tol=8):
    out = []
    bounds = list(shape.parts) + [len(shape.points)]
    for a, b in zip(bounds, bounds[1:]):
        pts = simplify(shape.points[a:b], tol)
        if len(pts) >= 4:
            flat = []
            for x, y in pts:
                lng, lat = TO_WGS.transform(x, y)
                flat += [round(lng, 5), round(lat, 5)]
            out.append(flat)
    return out


def quarter_days(q):
    y, n = int(q[:4]), int(q[4])
    return sum(calendar.monthrange(y, m)[1] for m in range(3 * n - 2, 3 * n + 1))


def latest(rows, q=None):
    q = q or max(r['기준_년분기_코드'] for r in rows)
    return q, [r for r in rows if r['기준_년분기_코드'] == q]


def build():
    q, foot_t = latest(seoul_sheet('OA-15568'))   # 길단위인구-상권
    _, res_t = latest(seoul_sheet('OA-15584'), q)  # 상주인구-상권
    _, foot_d = latest(seoul_sheet('OA-22178'), q)  # 길단위인구-행정동
    _, res_d = latest(seoul_sheet('OA-22183'), q)  # 상주인구-행정동
    assert res_t and foot_d and res_d, f'{q} 분기 자료가 일부 없어요'
    days = quarter_days(q)
    foot_t = {r['상권_코드']: int(r['총_유동인구_수']) / days for r in foot_t}
    res_t = {r['상권_코드']: r for r in res_t}
    foot_d = {r['행정동_코드']: int(r['총_유동인구_수']) / days for r in foot_d}
    res_d = {r['행정동_코드']: r for r in res_d}

    trdar, gu = [], {}
    for sr in shapefile.Reader(seoul_file('OA-15560', 5, 3), encoding='utf-8').iterShapeRecords():
        r = sr.record.as_dict()
        gu[r['SIGNGU_CD']] = r['SIGNGU_CD_']
        c, res = r['TRDAR_CD'], res_t.get(r['TRDAR_CD'])
        trdar.append({'c': c, 'n': r['TRDAR_CD_N'], 'k': r['TRDAR_SE_1'], 'd': r['ADSTRD_CD'],
                      'foot': round(foot_t[c]) if c in foot_t else None,
                      'resid': int(res['총_상주인구_수']) if res else None,
                      'hh': int(res['총_가구_수']) if res else None,
                      'area': int(r['RELM_AR']), 'rings': rings(sr.shape)})

    types = household_types()
    dong, clamped, missing = [], 0, []
    for sr in shapefile.Reader(seoul_file('OA-22160', 1, 3), encoding='utf-8').iterShapeRecords():
        r = sr.record.as_dict()
        c, res = r['ADSTRD_CD'], res_d.get(r['ADSTRD_CD'])
        name = f"{gu[c[:5]]} {r['ADSTRD_NM']}"
        d = {'c': c, 'n': name, 'foot': foot_d.get(c, 0), 'resid': int(res['총_상주인구_수']) if res else 0,
             'hh': int(res['총_가구_수']) if res else 0, 'area': int(r['RELM_AR'])}
        rest = {k: d[k] for k in ('foot', 'resid', 'hh', 'area')}
        for t in trdar:
            if t['d'] == c and t['k'] != TOUR:
                for k in rest:
                    rest[k] -= t[k] or 0
        if any(v < 0 for v in rest.values()):
            clamped += 1
        d['rest'] = {k: max(0, round(v)) for k, v in rest.items()}
        d['foot'] = round(d['foot'])
        d['types'] = types.get(norm(name))
        if d['types'] is None:
            missing.append(name)
        d['rings'] = rings(sr.shape)
        dong.append(d)
    print('남은 밀도가 0 아래라 0으로 자른 동:', clamped, '/ 가구 형태 못 맞춘 동:', missing)

    seoul = {k: sum(d[k] for d in dong) for k in ('foot', 'resid', 'hh', 'area')}
    return {'q': q, 'hhYear': 2023, 'seoul': seoul, 'trdar': trdar, 'dong': dong}


def check(data):
    assert len(data['dong']) >= 420, len(data['dong'])
    dong = {d['c']: d for d in data['dong']}
    if data['q'] == '20262':  # 상권분석서비스 화면에서 확인한 2026년 2분기 값
        assert (round(dong['11440565']['foot']), dong['11440565']['hh']) == (131237, 18559), dong['11440565']
        assert (round(dong['11650581']['foot']), dong['11650581']['hh']) == (55522, 7024), dong['11650581']
    full = [t for t in data['trdar'] if t['rings'] and t['foot'] is not None]
    assert len(full) >= 1600, len(full)
    assert sum(d['types'] is not None for d in data['dong']) >= 400
    assert all(v >= 0 for d in data['dong'] for v in d['rest'].values())
    assert data['seoul']['area'] > 5e8 and data['seoul']['foot'] > 0


if __name__ == '__main__':
    data = build()
    check(data)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(OUT)
    assert size < 3e6, size
    print('OK', data['q'], len(data['trdar']), '상권', len(data['dong']), '동', f'{size / 1e6:.2f}MB')
