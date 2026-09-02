// 카카오모빌리티 자동차 길찾기 프록시.
// 이미 정한 방문 순서(센터 → 어르신들 → 센터)를 그대로 실제 도로 경로로
// 바꿔 준다. 브라우저는 이 함수만 부르고, 키는 여기서만 쓴다.
// 필요한 환경변수: KAKAO_REST_KEY (주소 검색과 같은 키를 쓰되, 카카오
// 개발자 사이트에서 '모빌리티 - 길찾기' 상품도 함께 신청해야 동작한다.
// 신청하지 않았거나 이 API 가 실패해도 문제 없다 — 화면은 자동으로
// 직선거리 추정으로 대체된다.)

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30; // 길찾기는 주소 검색보다 무거우니 더 낮게 잡는다
const hits = new Map();

function tooMany(ip) {
  const now = Date.now();
  const seen = hits.get(ip);
  if (!seen || now > seen.reset) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    return false;
  }
  seen.count += 1;
  return seen.count > MAX_PER_WINDOW;
}

function pt(p) {
  if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' ||
      !isFinite(p.lat) || !isFinite(p.lng)) return null;
  return { x: p.lng, y: p.lat };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: false, error: 'method' });
  }

  const key = process.env.KAKAO_REST_KEY;
  if (!key) {
    return res.status(200).json({ ok: false, error: 'no_key' });
  }

  const referer = req.headers.referer || '';
  if (referer) {
    try {
      const from = new URL(referer).host;
      if (from !== req.headers.host) {
        return res.status(200).json({ ok: false, error: 'forbidden' });
      }
    } catch (e) {
      // 해석이 안 되면 통과시킨다
    }
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(200).json({ ok: false, error: 'rate_limited' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  const o = pt(body && body.origin);
  const d = pt(body && body.destination);
  const waypointsIn = (body && Array.isArray(body.waypoints)) ? body.waypoints : [];

  if (!o || !d) {
    return res.status(200).json({ ok: false, error: 'bad_points' });
  }
  if (!waypointsIn.length || waypointsIn.length > 28) {
    return res.status(200).json({ ok: false, error: 'bad_waypoints' });
  }

  const waypoints = [];
  for (let i = 0; i < waypointsIn.length; i++) {
    const q = pt(waypointsIn[i]);
    if (!q) return res.status(200).json({ ok: false, error: 'bad_points' });
    waypoints.push({ name: 'wp' + i, x: q.x, y: q.y });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const r = await fetch('https://apis-navi.kakaomobility.com/v1/waypoints/directions', {
      method: 'POST',
      headers: {
        Authorization: `KakaoAK ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ origin: o, destination: d, waypoints, priority: 'RECOMMEND' }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!r.ok) {
      return res.status(200).json({ ok: false, error: 'upstream', status: r.status });
    }
    const data = await r.json();
    const route = data && data.routes && data.routes[0];
    if (!route || route.result_code !== 0) {
      return res.status(200).json({ ok: false, error: 'no_route' });
    }

    const legs = (route.sections || []).map(function (sec) {
      const path = [];
      (sec.roads || []).forEach(function (road) {
        const v = road.vertexes || [];
        for (let i = 0; i + 1 < v.length; i += 2) path.push([v[i + 1], v[i]]); // x,y(경도,위도) → [위도,경도]
      });
      return { distance: sec.distance || 0, duration: sec.duration || 0, path: path };
    });

    if (legs.length !== waypoints.length + 1) {
      return res.status(200).json({ ok: false, error: 'leg_mismatch' });
    }

    const summary = route.summary || {};
    return res.status(200).json({
      ok: true,
      distance: typeof summary.distance === 'number' ? summary.distance
               : legs.reduce(function (s, l) { return s + l.distance; }, 0),
      duration: typeof summary.duration === 'number' ? summary.duration
               : legs.reduce(function (s, l) { return s + l.duration; }, 0),
      legs: legs
    });
  } catch (e) {
    clearTimeout(timer);
    return res.status(200).json({ ok: false, error: 'upstream' });
  }
}
