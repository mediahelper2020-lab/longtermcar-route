// 관리자 화면(admin.html)이 부르는 창구. 요청마다 X-Admin-Password
// 헤더가 ADMIN_PASSWORD 환경변수와 같아야 한다.
//
// GET    : 등록된 이메일 명단(만료일 포함)을 돌려준다
// POST   : {email, months?, mode?} 을 받아 등록하거나 기간을 늘린다
//          mode 'renew'  (기본) — 오늘부터 다시 months 개월로 재설정 (기본 12개월)
//          mode 'extend'          — 지금 남은 기간(또는 이미 지났으면 오늘)에
//                                    months 개월을 보너스로 더한다
// DELETE : {email} 을 받아 명단에서 뺀다

import { normEmail, validEmail, getAllowedUsers, saveAllowedUsers, checkAdminPassword } from './_auth.js';

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + Math.floor(months));
  d.setDate(d.getDate() + Math.round((months % 1) * 30));
  return d;
}

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
    // years 는 예전 관리 화면과의 호환용. 새 화면은 months 를 보낸다.
    const rawMonths = body && body.months != null ? body.months
                    : body && body.years != null ? body.years * 12
                    : 12;
    const months = Math.min(Math.max(parseFloat(rawMonths) || 12, 0.5), 60);
    const mode = (body && body.mode === 'extend') ? 'extend' : 'renew';
    const now = new Date();
    const existing = users[email];
    const baseline = (mode === 'extend' && existing && existing.expiresAt && new Date(existing.expiresAt) > now)
      ? new Date(existing.expiresAt)
      : now;
    const expires = addMonths(baseline, months);
    const next = Object.assign({}, users);
    next[email] = {
      expiresAt: expires.toISOString(),
      addedAt: (existing && existing.addedAt) || now.toISOString()
    };
    const w = await saveAllowedUsers(next);
    if (!w.ok) return res.status(200).json({ ok: false, error: w.error || 'write_failed', status: w.status, detail: w.detail });
    return res.status(200).json({ ok: true, users: next });
  }

  if (req.method === 'DELETE') {
    if (!users[email]) return res.status(200).json({ ok: true, users: users });
    const next = Object.assign({}, users);
    delete next[email];
    const w = await saveAllowedUsers(next);
    if (!w.ok) return res.status(200).json({ ok: false, error: w.error || 'write_failed', status: w.status, detail: w.detail });
    return res.status(200).json({ ok: true, users: next });
  }

  return res.status(200).json({ ok: false, error: 'method' });
}
