/* UGARIT Owner Portal — server-authenticated owner session. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('ugaritAdminLoginForm');
  if (!form) return;
  // Expose readiness so a missing/stale script cannot submit the form back to the membership page.
  window.UGARIT_ADMIN_HANDLER_READY = true;

  const tabAdmin = $('tabAdmin');
  const tabRegister = $('tabRegister');
  const tabLogin = $('tabLogin');
  const panels = {
    register: $('registerPanel'),
    login: $('loginPanel'),
    admin: $('adminLoginPanel')
  };

  function show(which) {
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.hidden = key !== which;
    });
    [[tabRegister, 'register'], [tabLogin, 'login'], [tabAdmin, 'admin']].forEach(([button, key]) => {
      if (!button) return;
      const selected = key === which;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  if (tabAdmin) tabAdmin.addEventListener('click', () => show('admin'));
  if (tabRegister) tabRegister.addEventListener('click', () => show('register'));
  if (tabLogin) tabLogin.addEventListener('click', () => show('login'));

  function status(id, message, isError) {
    const element = $(id);
    if (!element) return;
    element.hidden = false;
    element.textContent = message;
    element.style.background = isError ? '#fff0ee' : '#edf5f1';
    element.style.color = isError ? '#8a2f25' : '#23584d';
  }

  async function api(action, body) {
    const response = await fetch('/.netlify/functions/admin-portal?action=' + encodeURIComponent(action), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'تعذر تنفيذ العملية.');
    return data;
  }

  function unlock() {
    const gate = $('entryGate');
    const shell = $('ugaritShell');
    const dock = $('ugaritAdminDock');
    if (gate) gate.hidden = true;
    if (shell) shell.hidden = false;
    document.body.classList.remove('entry-locked');
    if (dock) dock.hidden = false;
  }

  function statCard(label, value) {
    const card = document.createElement('div');
    card.style.cssText = 'background:#f2f7f5;border:1px solid #dce8e2;border-radius:11px;padding:12px';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:12px;color:#61777a';
    title.textContent = label;
    const number = document.createElement('strong');
    number.style.cssText = 'display:block;font-size:23px;margin-top:5px';
    number.textContent = String(value);
    card.append(title, number);
    return card;
  }

  function renderRows(rows) {
    const tableBody = $('adminMembershipRows');
    const stats = $('adminDashboardStats');
    if (!tableBody || !stats) return;
    tableBody.replaceChildren();
    stats.replaceChildren();
    const counts = { pending_review: 0, paid_verified: 0, active: 0, refunded: 0, other: 0 };
    (rows || []).forEach(row => {
      if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status]++;
      else counts.other++;
    });
    [
      ['إجمالي الطلبات', (rows || []).length],
      ['قيد المراجعة', counts.pending_review],
      ['مدفوعة ومتحقق منها', counts.paid_verified],
      ['عضويات مفعّلة', counts.active],
      ['مستردة', counts.refunded]
    ].forEach(item => stats.appendChild(statCard(item[0], item[1])));

    (rows || []).forEach(row => {
      const tr = document.createElement('tr');
      [row.userId || row.$id || '—', (String(row.amount ?? '—') + ' ' + (row.currency || '')), row.status || '—', row.paymentReference || '—', row.$createdAt || row.createdAt || '—'].forEach(value => {
        const td = document.createElement('td');
        td.style.cssText = 'padding:9px;border-bottom:1px solid #e6eeea;font-size:12px;max-width:220px;overflow-wrap:anywhere';
        td.textContent = String(value);
        tr.appendChild(td);
      });
      tableBody.appendChild(tr);
    });
    if (!(rows || []).length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'لا توجد طلبات عضوية مسجلة حتى الآن.';
      td.style.padding = '14px';
      tr.appendChild(td);
      tableBody.appendChild(tr);
    }
  }

  async function refresh() {
    status('adminDashboardStatus', 'جارٍ جلب طلبات العضوية من Appwrite…', false);
    try {
      const data = await api('requests');
      renderRows(data.rows || []);
      status('adminDashboardStatus', 'تم تحميل بيانات طلبات العضوية. آخر تحديث: ' + new Date().toLocaleString('ar'), false);
    } catch (error) {
      status('adminDashboardStatus', error.message, true);
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.textContent = 'جارٍ التحقق…'; }
    const values = new FormData(form);
    try {
      await api('login', {
        username: String(values.get('username') || '').trim(),
        password: String(values.get('password') || '')
      });
      // Verify that the browser received the HttpOnly cookie before navigating.
      // The next page load restores the owner session and opens the platform shell.
      await api('session');
      form.reset();
      const dashboard = $('ugaritAdminDashboard');
      if (dashboard) dashboard.hidden = true;
      unlock();

    } catch (error) {
      status('adminLoginStatus', error.message, true);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'دخول إلى الموقع'; }
    }
  });

  const openButton = $('openAdminDashboard');
  if (openButton) openButton.addEventListener('click', () => {
    const dashboard = $('ugaritAdminDashboard');
    if (dashboard) dashboard.hidden = false;
    refresh();
  });
  const closeButton = $('closeAdminDashboard');
  if (closeButton) closeButton.addEventListener('click', () => {
    const dashboard = $('ugaritAdminDashboard');
    if (dashboard) dashboard.hidden = true;
  });
  const refreshButton = $('refreshAdminDashboard');
  if (refreshButton) refreshButton.addEventListener('click', refresh);
  const logoutButton = $('adminLogout');
  if (logoutButton) logoutButton.addEventListener('click', async () => {
    try { await api('logout', {}); } catch (_) {}
    location.reload();
  });

  // Never restore an administrator session automatically on a fresh site load.
  // Revoke any cookie left by a previous visit; the owner must authenticate again.
  // Ordinary visitors remain at the normal entry screen and never see the owner dock.
  api('logout').catch(error => {
    status('adminLoginStatus', 'تعذر إنهاء جلسة المدير السابقة. تحقق من الاتصال ثم أعد تحميل الصفحة.', true);
  });
})();
