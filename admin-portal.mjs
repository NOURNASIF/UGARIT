import crypto from 'node:crypto';

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers
  },
  body: JSON.stringify(body)
});

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verify(token, secret, expectedUsername) {
  const [body, signature, ...extra] = String(token || '').split('.');
  if (!body || !signature || extra.length) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.u === expectedUsername && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function readCookie(headers, name) {
  const raw = headers?.cookie || headers?.Cookie || '';
  for (const part of String(raw).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

const clearCookie = 'ugarit_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

export const handler = async (event) => {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  let url;
  try {
    url = new URL(event.rawUrl || `https://${event.headers?.host || 'localhost'}${event.path || '/'}`);
  } catch {
    return json(400, { message: 'عنوان الطلب غير صالح.' });
  }
  const action = url.searchParams.get('action') || 'health';

  // A safe, non-secret health response makes the function URL testable.
  // The previous implementation returned 404 when opened without ?action=.
  if (action === 'health') {
    if (method !== 'GET') return json(405, { message: 'طريقة الطلب غير مسموحة.' }, { Allow: 'GET' });
    return json(200, { ok: true, service: 'UGARIT admin portal', status: 'available' });
  }

  // Logout must always be available, even if an unrelated environment setting
  // is incomplete, so a stale administrator cookie can still be cleared.
  if (action === 'logout') {
    if (method !== 'POST') return json(405, { message: 'طريقة الطلب غير مسموحة.' }, { Allow: 'POST' });
    return json(200, { ok: true }, { 'Set-Cookie': clearCookie });
  }

  const username = process.env.UGARIT_ADMIN_USERNAME || '';
  const password = process.env.UGARIT_ADMIN_PASSWORD || '';
  const secret = process.env.UGARIT_ADMIN_SESSION_SECRET || '';

  if (!username || !password || !secret || secret.length < 32) {
    return json(503, { message: 'إعداد دخول المدير غير مكتمل في متغيرات Netlify السرية.' });
  }

  if (action === 'login') {
    if (method !== 'POST') return json(405, { message: 'طريقة الطلب غير مسموحة.' }, { Allow: 'POST' });
    let input;
    try { input = JSON.parse(event.body || '{}'); }
    catch { return json(400, { message: 'بيانات الطلب غير صالحة.' }); }

    if (!safeEqual(String(input.username || '').trim(), username) || !safeEqual(String(input.password || ''), password)) {
      return json(401, { message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    const token = sign({ u: username, exp: Date.now() + 8 * 60 * 60 * 1000 }, secret);
    return json(200, { ok: true }, {
      'Set-Cookie': `ugarit_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`
    });
  }

  if (action === 'session') {
    if (method !== 'GET') return json(405, { message: 'طريقة الطلب غير مسموحة.' }, { Allow: 'GET' });
    const token = readCookie(event.headers, 'ugarit_admin');
    if (!verify(token, secret, username)) return json(401, { message: 'لا توجد جلسة مدير صالحة.' });
    return json(200, { ok: true, username });
  }

  if (action !== 'requests') return json(404, { message: 'المسار غير موجود.' });
  if (method !== 'GET') return json(405, { message: 'طريقة الطلب غير مسموحة.' }, { Allow: 'GET' });

  const token = readCookie(event.headers, 'ugarit_admin');
  if (!verify(token, secret, username)) return json(401, { message: 'انتهت جلسة المدير أو لم يتم تسجيل الدخول. سجّل الدخول مجدداً.' });

  const endpoint = String(process.env.APPWRITE_ENDPOINT || '').replace(/\/$/, '');
  const project = process.env.APPWRITE_PROJECT_ID || '';
  const key = process.env.APPWRITE_API_KEY || '';
  const database = process.env.APPWRITE_DATABASE_ID || '';
  const table = process.env.APPWRITE_MEMBERSHIP_TABLE_ID || '';
  if (!endpoint || !project || !key || !database || !table) {
    return json(503, { message: 'إعدادات Appwrite السرية غير مكتملة في Netlify.' });
  }

  try {
    // Do not hand-build Appwrite query expressions as `limit(100)`.
    // The REST API expects serialized Query objects; malformed strings cause
    // a 400 response. The default list limit (25) is sufficient for this
    // owner panel and avoids sending a malformed query altogether.
    const response = await fetch(`${endpoint}/tablesdb/${encodeURIComponent(database)}/tables/${encodeURIComponent(table)}/rows`, {
      headers: {
        'X-Appwrite-Project': project,
        'X-Appwrite-Key': key,
        'Accept': 'application/json',
        'X-Appwrite-Response-Format': '1.8.0'
      },
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('UGARIT Appwrite list rows failed:', response.status, data?.type || '', data?.message || '');
      return json(502, { message: 'تعذر قراءة جدول العضويات من Appwrite. راجع سجل وظيفة admin-portal في Netlify لمعرفة رمز الخطأ.' });
    }
    return json(200, { rows: Array.isArray(data.rows) ? data.rows : [] });
  } catch {
    return json(502, { message: 'تعذر الاتصال بخدمة Appwrite حالياً.' });
  }
};
