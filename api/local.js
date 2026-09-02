// 카카오 로컬 API 프록시
// 브라우저는 이 함수만 호출하고, 카카오 키는 서버 환경변수에만 둔다.
// 방문자는 각자 키를 준비할 필요 없이 이 함수를 통해 주소를 검색한다.
// 필요한 환경변수: KAKAO_REST_KEY

// 한 사람이 지나치게 많이 부르는 것을 막아 카카오 할당량을 지킨다.
// 함수 인스턴스마다 따로 세므로 정확한 총량 제한은 아니고, 대량 호출을 늦추는 용도다.
const WINDOW_MS = 60 * 1000; // 1분
const MAX_PER_WINDOW = 60;   // 1분에 60번. 사람이 손으로 쓰기에는 넉넉하다.
const hits = new Map();

function tooMany(ip) {
  const now = Date.now();
  const seen = hits.get(ip);

  if (!seen || now > seen.reset) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    // 오래된 기록을 치워 메모리가 계속 늘지 않게 한다.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    return false;
  }

  seen.count += 1;
  return seen.count > MAX_PER_WINDOW;
}

export default async function handler(req, res) {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) {
    return res.status(500).json({ error: 'no_key', message: 'KAKAO_REST_KEY 환경변수가 없습니다.' });
  }

  // 다른 사이트가 이 주소를 자기 앱에 가져다 쓰는 것만 막는다.
  // 이 앱을 브라우저로 직접 방문한 사람은 referer 가 같은 도메인이라 통과한다.
  const referer = req.headers.referer || '';
  if (referer) {
    try {
      const from = new URL(referer).host;
      if (from !== req.headers.host) {
        return res.status(403).json({ error: 'forbidden' });
      }
    } catch (e) {
      // 해석이 안 되면 통과시킨다
    }
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({
      error: 'rate_limited',
      message: '주소 검색을 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.'
    });
  }

  const type = req.query.type === 'keyword' ? 'keyword' : 'address';
  const query = String(req.query.query || '').trim().slice(0, 120);
  if (!query) {
    return res.status(400).json({ error: 'no_query' });
  }

  const params = new URLSearchParams({
    query,
    size: String(Math.min(Math.max(parseInt(req.query.size, 10) || 5, 1), 10))
  });
  if (req.query.x && req.query.y) {
    params.set('x', String(req.query.x));
    params.set('y', String(req.query.y));
  }

  try {
    const r = await fetch(
      `https://dapi.kakao.com/v2/local/search/${type}.json?${params.toString()}`,
      { headers: { Authorization: `KakaoAK ${key}` } }
    );
    const data = await r.json();

    // 같은 주소를 반복 조회할 때 카카오 호출을 줄인다.
    // 여러 방문자가 같은 주소를 찾으면 앞사람 결과를 그대로 돌려준다.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'upstream' });
  }
}
