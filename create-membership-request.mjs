const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  body: JSON.stringify(body)
});

export const handler = async (event) => {
  if (String(event.httpMethod || '').toUpperCase() !== 'POST') {
    return json(405, { message: 'طريقة الطلب غير مسموحة.' });
  }

  const endpoint = process.env.APPWRITE_ENDPOINT || '';
  const projectId = process.env.APPWRITE_PROJECT_ID || '';
  const apiKey = process.env.APPWRITE_API_KEY || '';
  const databaseId = process.env.APPWRITE_DATABASE_ID || '';
  const tableId = process.env.APPWRITE_MEMBERSHIP_TABLE_ID || '';
  if (!endpoint || !projectId || !apiKey || !databaseId || !tableId) {
    return json(503, { message: 'لم يكتمل إعداد متغيرات Appwrite السرية في Netlify.' });
  }

  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  const sessionSecret = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!sessionSecret) return json(401, { message: 'جلسة الدخول غير موجودة.' });

  try {
    const base = endpoint.replace(/\/$/, '');
    const accountResponse = await fetch(`${base}/account`, {
      headers: { 'X-Appwrite-Project': projectId, 'X-Appwrite-Session': sessionSecret, 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (!accountResponse.ok) return json(401, { message: 'جلسة Appwrite غير صالحة أو منتهية.' });
    const user = await accountResponse.json();
    let input;
    try { input = JSON.parse(event.body || '{}'); }
    catch { return json(400, { message: 'بيانات الطلب غير صالحة.' }); }
    const paymentReference = String(input.paymentReference || '').trim().slice(0, 120);

    const rowUrl = `${base}/tablesdb/${encodeURIComponent(databaseId)}/tables/${encodeURIComponent(tableId)}/rows`;
    const rowResponse = await fetch(rowUrl, {
      method: 'POST',
      headers: {
        'X-Appwrite-Project': projectId,
        'X-Appwrite-Key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        rowId: user.$id,
        data: {
          userId: user.$id,
          amount: 1,
          currency: 'USD',
          status: 'pending_review',
          ...(paymentReference ? { paymentReference } : {})
        },
        permissions: [`read(\"user:${user.$id}\")`]
      }),
      cache: 'no-store'
    });
    if (!rowResponse.ok) {
      const details = await rowResponse.json().catch(() => ({}));
      const error = new Error(details.message || 'Appwrite row creation failed');
      error.code = details.code || rowResponse.status;
      throw error;
    }
    return json(201, { ok: true, userId: user.$id, status: 'pending_review' });
  } catch (error) {
    const message = String(error?.message || 'تعذر إنشاء طلب العضوية.');
    if (/already exists|duplicate|conflict/i.test(message)) return json(409, { message: 'يوجد طلب عضوية سابق لهذا الحساب.' });
    return json(400, { message: 'تعذر إنشاء طلب العضوية. تحقق من إعداد جدول Appwrite وصلاحياته.' });
  }
};
