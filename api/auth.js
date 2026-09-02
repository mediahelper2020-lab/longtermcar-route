// 이용 신청(로그인). 관리자가 등록한 이메일인지 Edge Config 명단으로
// 확인하고, 맞으면 서명된 쿠키를 내려 다음 방문부터는 다시 입력하지
// 않아도 되게 한다. 비밀번호는 없다 — 그 이메일을 아는 사람이면 통과되는
// 가벼운 방식이다(내부 직원용 도구로 설계됨).
//
// GET  : 지금 브라우저가 이미 확인된 상태인지 본다 (페이지를 열 때마다)
// POST : 이메일을 받아 명단과 대조하고, 맞으면 쿠키를 내려 준다
// DELETE : 로그아웃(쿠키를 지운다)

import { normEmail, validEmail, makeCookie, clearCookie, emailFromCookie, getAllowedUsers, isActive } from './_auth.js';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20; // 이메일 낮은 확률로 반복 시도하는 것을 막는 정도면 충분하다
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

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const email = emailFromCookie(req);
    if (!email) return res.status(200).json({ ok: false });
    const users = await getAllowedUsers();
    if (users === null) return res.status(200).json({ ok: false, error: 'directory_unavailable' });
    if (!isActive(users, email)) return res.status(200).json({ ok: false, error: 'expired' });
    return res.status(200).json({ ok: true, email: email, expiresAt: users[email].expiresAt });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearCookie());
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: false, error: 'method' });
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
  const email = normEmail(body && body.email);
  if (!validEmail(email)) {
    return res.status(200).json({ ok: false, error: 'bad_email' });
  }

  const users = await getAllowedUsers();
  if (users === null) {
    return res.status(200).json({ ok: false, error: 'directory_unavailable' });
  }
  if (!isActive(users, email)) {
    const known = !!users[email];
    return res.status(200).json({ ok: false, error: known ? 'expired' : 'not_registered' });
  }

  const cookie = makeCookie(email);
  if (!cookie) {
    return res.status(200).json({ ok: false, error: 'directory_unavailable' });
  }
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ ok: true, email: email, expiresAt: users[email].expiresAt });
}
