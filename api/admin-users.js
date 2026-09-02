// 관리자 화면(admin.html)이 부르는 창구. 요청마다 X-Admin-Password
// 헤더가 ADMIN_PASSWORD 환경변수와 같아야 한다.
//
// GET    : 등록된 이메일 명단(만료일 포함)을 돌려준다
// POST   : {email, years?} 을 받아 등록하거나 기간을 늘린다 (기본 1년)
// DELETE : {email} 을 받아 명단에서 뺀다

import { normEmail, validEmail, getAllowedUsers, saveAllowedUsers, checkAdminPassword } from './_auth.js';

export default async function handler(req, res) {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(200).json({ ok: false, error: 'admin_not_configured' });
  }
  if (!checkAdminPassword(req)) {
    return res.status(200).json({ ok: false, error: 'bad_password' });
  }

  if (req.method === 'GET') {
    const users = await getAllowedUsers();
    if (users === null) return res.status(200).json({ ok: false, error: 'directory_unavailable' });
    return res.status(200).json({ ok: true, users: users });
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
  if (users === null) return res.status(200).json({ ok: false, error: 'directory_unavailable' });

  if (req.method === 'POST') {
    const years = Math.min(Math.max(parseFloat(body && body.years) || 1, 0.1), 5);
    const now = new Date();
    const expires = new Date(now);
    expires.setFullYear(expires.getFullYear() + Math.floor(years));
    expires.setDate(expires.getDate() + Math.round((years % 1) * 365));
    const next = Object.assign({}, users);
    next[email] = {
      expiresAt: expires.toISOString(),
      addedAt: (next[email] && next[email].addedAt) || now.toISOString()
    };
    const w = await saveAllowedUsers(next);
    if (!w.ok) return res.status(200).json({ ok: false, error: w.error || 'write_failed' });
    return res.status(200).json({ ok: true, users: next });
  }

  if (req.method === 'DELETE') {
    if (!users[email]) return res.status(200).json({ ok: true, users: users });
    const next = Object.assign({}, users);
    delete next[email];
    const w = await saveAllowedUsers(next);
    if (!w.ok) return res.status(200).json({ ok: false, error: w.error || 'write_failed' });
    return res.status(200).json({ ok: true, users: next });
  }

  return res.status(200).json({ ok: false, error: 'method' });
}
