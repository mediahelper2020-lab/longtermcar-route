// 이용 신청(로그인) 공통 도구. api/auth.js, api/admin-users.js 와
// local.js / mapkey.js / directions.js 가 함께 쓴다.
//
// 필요한 환경변수
//   AUTH_SECRET        쿠키에 서명할 임의의 긴 문자열 (아무 값이나, 재배포해도 안 바뀌게)
//   EDGE_CONFIG         버셀 Edge Config 연결 문자열 (프로젝트에 Edge Config 를
//                       연결하면 버셀이 자동으로 넣어 준다)
//   EDGE_CONFIG_ID      쓰기(등록/삭제)에 필요. Edge Config 화면의 아이디(ecfg_...)
//   VERCEL_API_TOKEN    쓰기에 필요. 버셀 개인/팀 토큰
//   VERCEL_TEAM_ID      팀 계정일 때만 필요
//   ADMIN_PASSWORD      관리자 화면 비밀번호
//
// 명단은 Edge Config 의 "allowed_users" 키 하나에 이메일 → {expiresAt, addedAt}
// 객체로 통째로 저장한다. 등록 인원이 많지 않은(수십~수백 명) 기관용 도구라
// 값 하나로도 충분하고, 읽기가 한 번으로 끝난다.

import crypto from 'crypto';

const COOKIE_NAME = 'syauth';

function hmac(s) {
  const secret = process.env.AUTH_SECRET || '';
  return crypto.createHmac('sha256', secret).update(s).digest('hex');
}

export function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

export function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/* ----- 쿠키: "이 브라우저가 한 번 이 이메일로 확인받았다"는 서명만 담는다.
   실제로 아직 등록돼 있는지·만료 안 됐는지는 매번 명단에서 다시 확인한다
   (관리자가 삭제하면 즉시 막히도록). ----- */
export function makeCookie(email) {
  if (!process.env.AUTH_SECRET) return null;
  const b64 = Buffer.from(email, 'utf8').toString('base64url');
  const sig = hmac(email);
  const maxAge = 365 * 24 * 60 * 60; // 1년
  return COOKIE_NAME + '=' + b64 + '.' + sig +
    '; Path=/; Max-Age=' + maxAge + '; HttpOnly; Secure; SameSite=Lax';
}

export function clearCookie() {
  return COOKIE_NAME + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
}

function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  h.split(';').forEach(function (p) {
    const i = p.indexOf('=');
    if (i < 0) return;
    out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}

/* 쿠키가 있고 서명이 맞으면 그 이메일을 돌려준다. 없거나 위조됐으면 null. */
export function emailFromCookie(req) {
  const raw = parseCookies(req)[COOKIE_NAME];
  if (!raw || !process.env.AUTH_SECRET) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return null;
  let email;
  try {
    email = Buffer.from(raw.slice(0, dot), 'base64url').toString('utf8');
  } catch (e) {
    return null;
  }
  const sig = raw.slice(dot + 1);
  const expected = hmac(email);
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return email;
}

function parseEdgeConfigConn(conn) {
  const u = new URL(conn);
  return { id: u.pathname.replace(/^\//, ''), token: u.searchParams.get('token') };
}

/* 지금 등록된 전체 명단을 읽는다. Edge Config 연결이 안 돼 있으면 null. */
export async function getAllowedUsers() {
  const conn = process.env.EDGE_CONFIG;
  if (!conn) return null;
  try {
    const { id, token } = parseEdgeConfigConn(conn);
    if (!id || !token) return null;
    const r = await fetch('https://edge-config.vercel.com/' + id + '/item/allowed_users', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (r.status === 404) return {}; // 아직 한 명도 등록 안 함
    if (!r.ok) return null;
    const data = await r.json();
    return (data && typeof data === 'object') ? data : {};
  } catch (e) {
    return null;
  }
}

/* 명단을 통째로 다시 쓴다. 관리자 화면에서 등록/삭제할 때만 부른다. */
export async function saveAllowedUsers(users) {
  const token = process.env.VERCEL_API_TOKEN;
  const id = process.env.EDGE_CONFIG_ID;
  if (!token || !id) return { ok: false, error: 'no_write_config' };
  const qs = process.env.VERCEL_TEAM_ID ? ('?teamId=' + encodeURIComponent(process.env.VERCEL_TEAM_ID)) : '';
  try {
    const r = await fetch('https://api.vercel.com/v1/edge-config/' + id + '/items' + qs, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ operation: 'upsert', key: 'allowed_users', value: users }] })
    });
    if (!r.ok) return { ok: false, error: 'upstream', status: r.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'upstream' };
  }
}

/* 이메일이 지금 시점에 유효한 등록 상태인지 (있고, 만료 전인지) */
export function isActive(users, email) {
  const e = users && users[email];
  if (!e || !e.expiresAt) return false;
  return new Date(e.expiresAt).getTime() > Date.now();
}

/* local.js / mapkey.js / directions.js 에서 맨 앞에 부른다.
   등록된 사람이 아니면 401 로 끊는다 — 프런트 화면의 가림막을 우회해도
   실제로 카카오 API 를 대신 불러 주지는 않게 하기 위해서다. */
export async function requireUser(req, res) {
  const email = emailFromCookie(req);
  if (!email) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const users = await getAllowedUsers();
  if (users === null) {
    // 명단을 확인할 수 없으면(설정 오류 등) 열어 주지 않는다 — 막힌 채
    // 배포되는 쪽이, 잘못 열리는 쪽보다 안전하다.
    res.status(503).json({ error: 'directory_unavailable' });
    return null;
  }
  if (!isActive(users, email)) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return email;
}

export function checkAdminPassword(req) {
  const want = process.env.ADMIN_PASSWORD;
  if (!want) return false;
  const got = req.headers['x-admin-password'] || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(want));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
