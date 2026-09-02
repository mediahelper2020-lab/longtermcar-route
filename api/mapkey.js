// 카카오맵(자바스크립트 SDK) 키를 브라우저에 알려 준다.
// 필요한 환경변수: KAKAO_JS_KEY
//
// 이 키는 주소 검색용 REST 키와 다른 키다. 지도 SDK 는 브라우저에서
// 직접 불러오므로 이 키는 어차피 화면 소스에 드러난다. 감추는 대신
// 카카오 개발자 사이트에서 우리 도메인만 쓰도록 등록해 두는 것이
// 정해진 보호 방법이다. 그래서 여기서는 값을 그대로 내려 준다.
// REST 키는 절대 이쪽으로 내려보내지 않는다.

export default async function handler(req, res) {
  const key = process.env.KAKAO_JS_KEY || '';
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ key: key || null });
}
