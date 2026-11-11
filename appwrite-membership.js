/* UGARIT v0.1 — Appwrite Auth + TablesDB. إنشاء طلب الدفع يتم عبر Netlify Function موثوقة. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const cfg = () => window.UGARIT_APPWRITE_CONFIG || {};
  let sessionSecret = null;
  let currentUser = null;
  const API_VERSION = '1.8.0';

  function endpoint() { return String(cfg().endpoint || '').replace(/\/$/, ''); }
  function configured() {
    const c = cfg();
    return Boolean(c.endpoint && c.projectId && c.databaseId && c.membershipTableId);
  }
  function showStatus(id, message, isError) {
    const el = $(id);
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.style.background = isError ? '#fff0ee' : '#edf5f1';
    el.style.color = isError ? '#8a2f25' : '#23584d';
  }
  function appwriteError(data, status) {
    if (status === 401) return 'بيانات الدخول غير صحيحة أو انتهت الجلسة.';
    if (status === 409) return 'هذا الحساب لديه طلب عضوية سابق. انتقل إلى تسجيل الدخول أو تواصل مع الإدارة.';
    if (status === 404) return 'لم يتم العثور على صف العضوية. تحقق من إعدادات جدول Appwrite.';
    return (data && data.message) || ('تعذر إكمال الطلب (HTTP ' + status + ').');
  }
  async function api(path, options) {
    const c = cfg();
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Appwrite-Project': c.projectId,
      'X-Appwrite-Response-Format': API_VERSION
    };
    if (sessionSecret) headers['X-Appwrite-Session'] = sessionSecret;
    const response = await fetch(endpoint() + path, {
      method: (options && options.method) || 'GET', headers,
      body: options && options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store', credentials: 'omit'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(appwriteError(data, response.status));
    return data;
  }
  function tableRowsPath() {
    const c = cfg();
    return '/tablesdb/' + encodeURIComponent(c.databaseId) + '/tables/' + encodeURIComponent(c.membershipTableId) + '/rows';
  }
  async function createMembershipRequest(user, paymentReference) {
    const response = await fetch('/.netlify/functions/create-membership-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionSecret },
      body: JSON.stringify({ paymentReference: String(paymentReference || '').trim() }),
      cache: 'no-store', credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || ('تعذر حفظ طلب العضوية (HTTP ' + response.status + ').'));
    if (data.userId !== user.$id) throw new Error('تعذر مطابقة الحساب مع طلب العضوية.');
    return data;
  }
  function unlockPlatform() {
    const gate = $('entryGate'); const shell = $('ugaritShell');
    if (gate) gate.hidden = true;
    if (shell) shell.hidden = false;
    document.body.classList.remove('entry-locked');
    window.dispatchEvent(new CustomEvent('ugarit:membership-active', { detail: { user: currentUser } }));
  }
  function setBusy(form, busy, label) {
    const button = form && form.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) { button.dataset.originalLabel = button.textContent; button.disabled = true; button.textContent = label || 'جارٍ التنفيذ…'; }
    else { button.disabled = false; button.textContent = button.dataset.originalLabel || button.textContent; }
  }
  async function register(event) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    if (!configured()) { showStatus('membershipStatus', 'إعدادات Appwrite غير مكتملة؛ لم تُرسل بياناتك.', true); return; }
    setBusy(form, true, 'جارٍ إنشاء الحساب وإرسال الطلب…');
    try {
      const account = await api('/account', { method: 'POST', body: {
        userId: 'unique()', email: String(data.get('email')).trim(),
        password: String(data.get('password')), name: String(data.get('username')).trim()
      }});
      const session = await api('/account/sessions/email', { method: 'POST', body: {
        email: String(data.get('email')).trim(), password: String(data.get('password'))
      }});
      if (!session.secret) throw new Error('تم إنشاء الحساب لكن لم يتم استلام جلسة صالحة.');
      sessionSecret = session.secret; currentUser = account;
      await createMembershipRequest(account, data.get('paymentReference'));
      form.reset();
      showStatus('membershipStatus', 'تم إنشاء الحساب وحفظ طلب العضوية. الحالة: قيد مراجعة الدفع. لم تُفعّل العضوية بعد؛ يلزم التحقق اليدوي من تحويل شام كاش.', false);
    } catch (error) {
      showStatus('membershipStatus', 'تعذر إتمام التسجيل: ' + error.message + ' إذا أُنشئ الحساب بالفعل، انتقل إلى تسجيل الدخول ولا تعاود إنشاء الحساب.', true);
    } finally { setBusy(form, false); }
  }
  async function getMembership(user) {
    return api(tableRowsPath() + '/' + encodeURIComponent(user.$id));
  }
  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    if (!configured()) { showStatus('loginStatus', 'إعدادات Appwrite غير مكتملة.', true); return; }
    setBusy(form, true, 'جارٍ التحقق من الحساب…');
    try {
      const session = await api('/account/sessions/email', { method: 'POST', body: {
        email: String(data.get('email')).trim(), password: String(data.get('password'))
      }});
      if (!session.secret) throw new Error('لم يتم استلام جلسة دخول صالحة.');
      sessionSecret = session.secret; currentUser = await api('/account');
      const membership = await getMembership(currentUser);
      if (membership.status !== 'active') {
        const messages = {
          pending_review: 'طلب عضويتك قيد مراجعة الدفع. لم يتم تفعيل الدخول بعد.',
          refunded: 'تم تسجيل استرداد المبلغ لهذا الطلب. تواصل مع الإدارة عند الحاجة.',
          rejected: 'لم تتم الموافقة على طلب الدفع. تواصل مع الإدارة.'
        };
        showStatus('loginStatus', messages[membership.status] || 'حسابك موجود، لكن العضوية غير مفعّلة بعد.', true);
        return;
      }
      form.reset(); showStatus('loginStatus', 'تم التحقق من الحساب والعضوية بنجاح.', false); unlockPlatform();
    } catch (error) {
      sessionSecret = null; currentUser = null;
      showStatus('loginStatus', 'تعذر تسجيل الدخول: ' + error.message, true);
    } finally { setBusy(form, false); }
  }
  async function logout() {
    if (sessionSecret) { try { await api('/account/sessions/current', { method: 'DELETE' }); } catch (_) {} }
    sessionSecret = null; currentUser = null; location.reload();
  }
  document.addEventListener('DOMContentLoaded', function () {
    const registerForm = $('membershipRegisterForm'); const loginForm = $('membershipLoginForm');
    if (registerForm) registerForm.addEventListener('submit', register);
    if (loginForm) loginForm.addEventListener('submit', login);
    window.UgaritMembership = Object.freeze({ logout, getCurrentUser: () => currentUser, isConfigured: configured });
    if (!configured()) {
      const note = document.querySelector('#registerPanel .entry-disclaimer');
      if (note) note.textContent = 'لم يتم إعداد الاتصال بقاعدة Appwrite بعد. لن تُحفظ بيانات العضوية قبل إكمال الإعداد.';
    }
  });
})();
