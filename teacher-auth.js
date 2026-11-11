/* UGARIT M16 — دخول مساحة المعلم المستقلة؛ لا توجد حسابات صفية أو صلاحيات مدرسية. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let accessToken = null;
  let currentUser = null;
  const cfg = () => window.UGARIT_CONFIG || {};
  const apiBase = () => String(cfg().apiBaseUrl || '').replace(/\/$/, '');
  const teacherRoles = ['teacher', 'platform_admin'];

  let idleLock = null;
  let sessionExpiryLock = null;
  function scheduleIdleLock() { clearTimeout(idleLock); if (currentUser) idleLock = setTimeout(logout, 15 * 60 * 1000); }
  function status(message) {
    const el = $('ugaritTeacherAuthStatus');
    if (el) el.textContent = message;
  }
  async function rawRequest(path, options = {}) {
    if (!apiBase()) throw new Error('عنوان الخادم المركزي غير مضبوط. يلزم نشر API وضبط apiBaseUrl أولاً.');
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(options.headers || {}) };
    const response = await fetch(apiBase() + path, { ...options, headers, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function renderSession() {
    const allowed = !!currentUser && teacherRoles.includes(currentUser.role);
    document.dispatchEvent(new CustomEvent('ugarit:session-change', { detail: { user: currentUser } }));
    const form = $('ugaritTeacherLoginForm');
    const session = $('ugaritTeacherSession');
    const identity = $('ugaritTeacherIdentity');
    const gate = $('teacherAccessGate');
    const workspace = $('teacherProtectedWorkspace');
    if (form) form.hidden = allowed;
    if (session) session.hidden = !allowed;
    if (identity && allowed) identity.textContent = `${currentUser.fullName || currentUser.full_name} — حساب معلم مخوّل`;
    if (gate) gate.hidden = allowed;
    if (workspace) workspace.hidden = !allowed;
    const nav = document.querySelector('.nav button[data-view="teacher"]');
    if (nav) nav.innerHTML = allowed ? '<span class="ico">✎</span>مساحة المعلم' : '<span class="ico">🔐</span>دخول المعلم';
    const ownerPanel = $('teacherAccountAdminPanel');
    if (ownerPanel) ownerPanel.hidden = !currentUser || currentUser.role !== 'platform_admin';
    if (!allowed) {
      if (form) form.hidden = false;
    }
  }
  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      status('جارٍ التحقق من بيانات الحساب…');
      const data = await rawRequest('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: values.get('email'), password: values.get('password') }) });
      accessToken = typeof data.accessToken === 'string' && data.accessToken.length > 20 ? data.accessToken : null;
      currentUser = data.user;
      if (!accessToken || !currentUser || !teacherRoles.includes(currentUser.role)) { accessToken = null; currentUser = null; renderSession(); throw new Error('هذا الحساب لا يملك صلاحية دخول مساحة المعلم.'); }
      form.reset();
      renderSession();
      clearTimeout(sessionExpiryLock);
      sessionExpiryLock = setTimeout(logout, Math.max(1000, Math.min(15 * 60 * 1000, Number(data.expiresIn || 900) * 1000)));
      scheduleIdleLock();
    } catch (error) {
      accessToken = null; currentUser = null; renderSession();
      status('تعذر تسجيل الدخول: ' + error.message);
    }
  }
  function logout() {
    clearTimeout(idleLock); clearTimeout(sessionExpiryLock); accessToken = null; currentUser = null;
    renderSession();
    status('تم إغلاق مساحة المعلم.');
  }
  function initializeTeacherGate() {
    accessToken = null;
    currentUser = null;
    renderSession();
    status('سجّل الدخول بحساب معلم مخوّل. لا تُستعاد جلسة المعلم تلقائياً بعد إعادة فتح المنصة.');
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('ugaritTeacherLoginForm')?.addEventListener('submit', login);
    $('ugaritTeacherLogout')?.addEventListener('click', logout);

    $('createIndependentTeacherForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (currentUser?.role !== 'platform_admin') return;
      const form = event.currentTarget, values = new FormData(form), out = $('createIndependentTeacherStatus');
      try {
        const result = await rawRequest('/api/v1/admin/teacher-accounts', { method: 'POST', body: JSON.stringify({ fullName: values.get('fullName'), email: values.get('email'), password: values.get('password') }) });
        form.reset(); if (out) out.textContent = result.message || 'تم إنشاء حساب المعلم المستقل.';
      } catch (error) { if (out) out.textContent = 'تعذر إنشاء الحساب: ' + error.message; }
    });
    initializeTeacherGate();
    ['click','keydown','touchstart','pointerdown'].forEach(type => window.addEventListener(type, scheduleIdleLock, { passive: true }));
    window.addEventListener('pagehide', () => { accessToken = null; currentUser = null; });
  });
  window.UgaritTeacherAuth = Object.freeze({ getUser: () => currentUser, request: rawRequest, logout });
})();
