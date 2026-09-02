// 카카오 로컬 API 프록시
// 브라우저는 이 함수만 호출하고, 카카오 키는 서버 환경변수에만 둔다.
// 필요한 환경변수: KAKAO_REST_KEY

export default async function handler(req, res) {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) {
    return res.status(500).json({ error: 'no_key', message: 'KAKAO_REST_KEY 환경변수가 없습니다.' });
  }

  // 다른 사이트에서 이 주소를 가져다 쓰는 것만 막는다.
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
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'upstream' });
  }
}
