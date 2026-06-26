const STORAGE_KEY = 'resume-applications-v1';
const THEME_KEY = 'resume-tracker-theme';
const REMINDER_SENT_KEY = 'resume-reminder-sent-v1';

const STATUSES = [
  { value: 'pending', label: '待投递', badgeClass: 'badge--pending', statClass: 'stat-card--pending' },
  { value: 'applied', label: '已投递', badgeClass: 'badge--applied', statClass: 'stat-card--applied' },
  { value: 'written', label: '笔试', badgeClass: 'badge--written', statClass: 'stat-card--written' },
  { value: 'interview1', label: '一面', badgeClass: 'badge--interview1', statClass: 'stat-card--interview1' },
  { value: 'interview2', label: '二面', badgeClass: 'badge--interview2', statClass: 'stat-card--interview2' },
  { value: 'hr', label: 'HR面', badgeClass: 'badge--hr', statClass: 'stat-card--hr' },
  { value: 'offer', label: 'Offer', badgeClass: 'badge--offer', statClass: 'stat-card--offer' },
  { value: 'rejected', label: '已拒绝', badgeClass: 'badge--rejected', statClass: 'stat-card--rejected' },
  { value: 'giveup', label: '已放弃', badgeClass: 'badge--giveup', statClass: 'stat-card--giveup' },
];

const statusMap = Object.fromEntries(STATUSES.map((s) => [s.value, s]));

let applications = [];
let filterStatus = 'all';
let searchQuery = '';
let deleteTargetId = null;
let currentView = 'list';
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedCalDate = null;
let reminderSentIds = new Set();
let reminderTimer = null;

const $ = (sel) => document.querySelector(sel);

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    applications = raw ? JSON.parse(raw) : [];
  } catch {
    applications = [];
  }
  try {
    const sent = localStorage.getItem(REMINDER_SENT_KEY);
    reminderSentIds = new Set(sent ? JSON.parse(sent) : []);
  } catch {
    reminderSentIds = new Set();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
}

function saveReminderSent() {
  localStorage.setItem(REMINDER_SENT_KEY, JSON.stringify([...reminderSentIds]));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toDateKey(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const [y, m, d] = dateStr.split('-');
  return `${y}/${m}/${d}`;
}

function formatInterviewDateTime(app) {
  if (!app.interviewDate) return '-';
  const date = formatDate(app.interviewDate);
  return app.interviewTime ? `${date} ${app.interviewTime}` : date;
}

function getInterviewDateTime(app) {
  if (!app.interviewDate) return null;
  const time = app.interviewTime || '09:00';
  return new Date(`${app.interviewDate}T${time}:00`);
}

function getStatusInfo(value) {
  return statusMap[value] || STATUSES[1];
}

function getFilteredApplications() {
  return applications
    .filter((app) => {
      if (filterStatus !== 'all' && app.status !== filterStatus) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return [app.company, app.position, app.platform, app.notes, app.location]
        .some((field) => (field || '').toLowerCase().includes(q));
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getUpcomingInterviews(withinDays = 7) {
  const now = new Date();
  const limit = new Date(now);
  limit.setDate(limit.getDate() + withinDays);

  return applications
    .filter((app) => {
      const dt = getInterviewDateTime(app);
      return dt && dt >= now && dt <= limit;
    })
    .sort((a, b) => getInterviewDateTime(a) - getInterviewDateTime(b));
}

function getReminderKey(app) {
  const minutes = app.reminderMinutes || 0;
  return `${app.id}-${app.interviewDate}-${app.interviewTime || ''}-${minutes}`;
}

function getTimeUntilLabel(dt) {
  const diff = dt - new Date();
  if (diff < 0) return '已开始';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分钟后`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.floor(hours / 24);
  return `${days} 天后`;
}

function renderRemindersPanel() {
  const panel = $('#remindersPanel');
  const upcoming = getUpcomingInterviews(7);

  if (upcoming.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  panel.innerHTML = `
    <div class="reminders-panel__header">
      <span class="reminders-panel__title">🔔 近期面试 (${upcoming.length})</span>
    </div>
    <div class="reminders-panel__list">
      ${upcoming
        .map((app) => {
          const dt = getInterviewDateTime(app);
          const status = getStatusInfo(app.status);
          const isToday = app.interviewDate === toDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
          return `
          <div class="reminder-card${isToday ? ' reminder-card--today' : ''}" data-id="${app.id}">
            <div class="reminder-card__time">
              <strong>${app.interviewTime || '全天'}</strong>
              <span>${getTimeUntilLabel(dt)}</span>
            </div>
            <div class="reminder-card__info">
              <div class="reminder-card__company">${escapeHtml(app.company)}</div>
              <div class="reminder-card__position">${escapeHtml(app.position)} · ${formatDate(app.interviewDate)}</div>
            </div>
            <span class="badge ${status.badgeClass}">${status.label}</span>
            <button type="button" class="btn btn--ghost btn--sm btn-edit" data-id="${app.id}">编辑</button>
          </div>`;
        })
        .join('')}
    </div>`;

  panel.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => openForm(btn.dataset.id));
  });
}

function renderStats() {
  const panel = $('#statsPanel');
  const counts = { all: applications.length };
  STATUSES.forEach((s) => {
    counts[s.value] = applications.filter((a) => a.status === s.value).length;
  });

  const cards = [
    { key: 'all', label: '全部', statClass: 'stat-card--all' },
    ...STATUSES.map((s) => ({ key: s.value, label: s.label, statClass: s.statClass })),
  ];

  panel.innerHTML = cards
    .map(
      (c) => `
    <div class="stat-card ${c.statClass}${filterStatus === c.key ? ' stat-card--active' : ''}"
         data-status="${c.key}" role="button" tabindex="0">
      <div class="stat-card__count">${counts[c.key]}</div>
      <div class="stat-card__label">${c.label}</div>
    </div>`
    )
    .join('');

  panel.querySelectorAll('.stat-card').forEach((card) => {
    card.addEventListener('click', () => {
      filterStatus = card.dataset.status;
      render();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        filterStatus = card.dataset.status;
        render();
      }
    });
  });
}

function renderStatusFilters() {
  const container = $('#statusFilters');
  const chips = [
    { key: 'all', label: '全部' },
    ...STATUSES.map((s) => ({ key: s.value, label: s.label })),
  ];

  container.innerHTML = chips
    .map(
      (c) =>
        `<button type="button" class="filter-chip${filterStatus === c.key ? ' filter-chip--active' : ''}" data-status="${c.key}">${c.label}</button>`
    )
    .join('');

  container.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      filterStatus = chip.dataset.status;
      render();
    });
  });
}

function renderTable() {
  const tbody = $('#applicationsBody');
  const emptyState = $('#emptyState');
  const table = $('#applicationsTable');
  const filtered = getFilteredApplications();

  if (applications.length === 0) {
    table.hidden = true;
    emptyState.hidden = false;
    return;
  }

  table.hidden = false;
  emptyState.hidden = filtered.length > 0;

  tbody.innerHTML = filtered
    .map((app) => {
      const status = getStatusInfo(app.status);
      const companyCell = app.link
        ? `<a class="link-external cell-company" href="${escapeAttr(app.link)}" target="_blank" rel="noopener">${escapeHtml(app.company)}</a>`
        : `<span class="cell-company">${escapeHtml(app.company)}</span>`;
      const interviewCell = app.interviewDate
        ? `<span class="cell-interview${isInterviewSoon(app) ? ' cell-interview--soon' : ''}">${formatInterviewDateTime(app)}</span>`
        : '-';

      return `
      <tr data-id="${app.id}">
        <td>${companyCell}</td>
        <td>${escapeHtml(app.position)}</td>
        <td>${escapeHtml(app.platform || '-')}</td>
        <td>${formatDate(app.date)}</td>
        <td>${interviewCell}</td>
        <td><span class="badge ${status.badgeClass}">${status.label}</span></td>
        <td>${escapeHtml(app.salary || '-')}</td>
        <td class="cell-notes" title="${escapeAttr(app.notes || '')}">${escapeHtml(app.notes || '-')}</td>
        <td class="cell-actions">
          <button type="button" class="btn btn--ghost btn--sm btn-edit" data-id="${app.id}">编辑</button>
          <button type="button" class="btn btn--ghost btn--sm btn-delete" data-id="${app.id}">删除</button>
        </td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => openForm(btn.dataset.id));
  });

  tbody.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => openDeleteConfirm(btn.dataset.id));
  });
}

function isInterviewSoon(app) {
  const dt = getInterviewDateTime(app);
  if (!dt) return false;
  const diff = dt - new Date();
  return diff > 0 && diff <= 24 * 60 * 60 * 1000;
}

function getAppsForDate(dateKey) {
  return applications.filter(
    (app) => app.date === dateKey || app.interviewDate === dateKey
  );
}

function renderCalendar() {
  $('#calMonthLabel').textContent = `${calYear} 年 ${calMonth + 1} 月`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  const cells = [];

  const prevMonthDays = new Date(calYear, calMonth, 0).getDate();
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const m = calMonth === 0 ? 11 : calMonth - 1;
    const y = calMonth === 0 ? calYear - 1 : calYear;
    cells.push(renderCalCell(y, m, d, true));
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(renderCalCell(calYear, calMonth, d, false));
  }

  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const m = calMonth === 11 ? 0 : calMonth + 1;
    const y = calMonth === 11 ? calYear + 1 : calYear;
    cells.push(renderCalCell(y, m, d, true));
  }

  const grid = $('#calGrid');
  grid.innerHTML = cells.join('');

  grid.querySelectorAll('.cal-day:not(.cal-day--empty)').forEach((cell) => {
    cell.addEventListener('click', () => {
      selectedCalDate = cell.dataset.date;
      renderCalendarSidebar();
      grid.querySelectorAll('.cal-day--selected').forEach((el) => el.classList.remove('cal-day--selected'));
      cell.classList.add('cal-day--selected');
    });
  });

  if (selectedCalDate) {
    const selected = grid.querySelector(`[data-date="${selectedCalDate}"]`);
    if (selected) selected.classList.add('cal-day--selected');
  }

  renderCalendarSidebar();
}

function renderCalCell(y, m, d, otherMonth) {
  const dateKey = toDateKey(y, m, d);
  const apps = getAppsForDate(dateKey);
  const hasInterview = apps.some((a) => a.interviewDate === dateKey);
  const hasApply = apps.some((a) => a.date === dateKey);
  const todayKey = toDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const isToday = dateKey === todayKey;
  const isSelected = dateKey === selectedCalDate;

  let dots = '';
  if (hasInterview) dots += '<i class="dot dot--interview"></i>';
  if (hasApply) dots += '<i class="dot dot--apply"></i>';

  return `
    <div class="cal-day${otherMonth ? ' cal-day--other' : ''}${isToday ? ' cal-day--today' : ''}${isSelected ? ' cal-day--selected' : ''}${apps.length ? ' cal-day--has-events' : ''}"
         data-date="${dateKey}" role="button" tabindex="0">
      <span class="cal-day__num">${d}</span>
      ${dots ? `<span class="cal-day__dots">${dots}</span>` : ''}
    </div>`;
}

function renderCalendarSidebar() {
  const title = $('#calSidebarTitle');
  const list = $('#calDayList');

  if (!selectedCalDate) {
    title.textContent = '选择日期查看详情';
    list.innerHTML = '<p class="calendar-sidebar__hint">点击日历中的日期，查看当天的投递与面试安排</p>';
    return;
  }

  title.textContent = formatDate(selectedCalDate);
  const apps = getAppsForDate(selectedCalDate);

  if (apps.length === 0) {
    list.innerHTML = '<p class="calendar-sidebar__hint">这一天没有安排</p>';
    return;
  }

  list.innerHTML = apps
    .map((app) => {
      const status = getStatusInfo(app.status);
      const isInterview = app.interviewDate === selectedCalDate;
      const isApply = app.date === selectedCalDate;
      let tags = '';
      if (isInterview) tags += `<span class="cal-event-tag cal-event-tag--interview">面试 ${app.interviewTime || ''}</span>`;
      if (isApply) tags += '<span class="cal-event-tag cal-event-tag--apply">投递</span>';

      return `
      <div class="cal-event-card" data-id="${app.id}">
        <div class="cal-event-card__header">
          <strong>${escapeHtml(app.company)}</strong>
          <span class="badge ${status.badgeClass}">${status.label}</span>
        </div>
        <div class="cal-event-card__position">${escapeHtml(app.position)}</div>
        <div class="cal-event-card__tags">${tags}</div>
        ${app.notes ? `<p class="cal-event-card__notes">${escapeHtml(app.notes)}</p>` : ''}
        <button type="button" class="btn btn--ghost btn--sm btn-edit" data-id="${app.id}">编辑</button>
      </div>`;
    })
    .join('');

  list.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => openForm(btn.dataset.id));
  });
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.classList.toggle('view-tab--active', tab.dataset.view === view);
  });
  $('#listView').hidden = view !== 'list';
  $('#listToolbar').hidden = view !== 'list';
  $('#calendarView').hidden = view !== 'calendar';

  if (view === 'calendar') {
    renderCalendar();
  }
}

function render() {
  renderRemindersPanel();
  renderStats();
  renderStatusFilters();
  renderTable();
  if (currentView === 'calendar') {
    renderCalendar();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function populateStatusSelect() {
  const select = $('#fieldStatus');
  select.innerHTML = STATUSES.map(
    (s) => `<option value="${s.value}">${s.label}</option>`
  ).join('');
}

function openForm(id = null) {
  const modal = $('#formModal');
  const form = $('#applicationForm');
  form.reset();

  if (id) {
    const app = applications.find((a) => a.id === id);
    if (!app) return;
    $('#modalTitle').textContent = '编辑投递';
    $('#fieldId').value = app.id;
    $('#fieldCompany').value = app.company;
    $('#fieldPosition').value = app.position;
    $('#fieldPlatform').value = app.platform || '';
    $('#fieldDate').value = app.date;
    $('#fieldStatus').value = app.status;
    $('#fieldSalary').value = app.salary || '';
    $('#fieldLocation').value = app.location || '';
    $('#fieldLink').value = app.link || '';
    $('#fieldInterviewDate').value = app.interviewDate || '';
    $('#fieldInterviewTime').value = app.interviewTime || '';
    $('#fieldReminder').value = String(app.reminderMinutes ?? 60);
    $('#fieldNotes').value = app.notes || '';
  } else {
    $('#modalTitle').textContent = '新增投递';
    $('#fieldId').value = '';
    $('#fieldDate').value = new Date().toISOString().slice(0, 10);
    $('#fieldStatus').value = 'applied';
    $('#fieldReminder').value = '60';
  }

  modal.showModal();
}

function closeForm() {
  $('#formModal').close();
}

function handleFormSubmit(e) {
  e.preventDefault();

  const id = $('#fieldId').value;
  const data = {
    company: $('#fieldCompany').value.trim(),
    position: $('#fieldPosition').value.trim(),
    platform: $('#fieldPlatform').value,
    date: $('#fieldDate').value,
    status: $('#fieldStatus').value,
    salary: $('#fieldSalary').value.trim(),
    location: $('#fieldLocation').value.trim(),
    link: $('#fieldLink').value.trim(),
    interviewDate: $('#fieldInterviewDate').value,
    interviewTime: $('#fieldInterviewTime').value,
    reminderMinutes: parseInt($('#fieldReminder').value, 10) || 0,
    notes: $('#fieldNotes').value.trim(),
    updatedAt: new Date().toISOString(),
  };

  if (!data.company || !data.position || !data.date) return;

  if (id) {
    const index = applications.findIndex((a) => a.id === id);
    if (index !== -1) {
      applications[index] = { ...applications[index], ...data };
    }
  } else {
    applications.push({
      id: generateId(),
      ...data,
      createdAt: new Date().toISOString(),
    });
  }

  saveData();
  closeForm();
  render();
}

function openDeleteConfirm(id) {
  const app = applications.find((a) => a.id === id);
  if (!app) return;
  deleteTargetId = id;
  $('#deleteTargetName').textContent = `${app.company} - ${app.position}`;
  $('#deleteModal').showModal();
}

function closeDeleteConfirm() {
  deleteTargetId = null;
  $('#deleteModal').close();
}

function confirmDelete() {
  if (!deleteTargetId) return;
  applications = applications.filter((a) => a.id !== deleteTargetId);
  saveData();
  closeDeleteConfirm();
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(applications, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `简历投递记录_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('格式错误');
      const valid = data.every(
        (item) => item.company && item.position && item.date
      );
      if (!valid) throw new Error('数据字段不完整');

      const merge = confirm(
        `检测到 ${data.length} 条记录。\n\n点击「确定」合并到现有数据，点击「取消」替换全部数据。`
      );

      if (merge) {
        const existingIds = new Set(applications.map((a) => a.id));
        data.forEach((item) => {
          if (!item.id || existingIds.has(item.id)) {
            item.id = generateId();
          }
          applications.push(item);
        });
      } else {
        applications = data.map((item) => ({
          ...item,
          id: item.id || generateId(),
        }));
      }

      saveData();
      render();
      alert('导入成功！');
    } catch (err) {
      alert(`导入失败：${err.message}`);
    }
  };
  reader.readAsText(file);
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('您的浏览器不支持桌面通知');
    return false;
  }
  if (Notification.permission === 'granted') {
    alert('面试提醒已开启！到达设定时间前会收到浏览器通知。');
    return true;
  }
  if (Notification.permission === 'denied') {
    alert('通知权限已被拒绝，请在浏览器设置中允许本站点发送通知。');
    return false;
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    alert('面试提醒已开启！请保持浏览器标签页打开以接收提醒。');
    return true;
  }
  alert('未授予通知权限，将无法收到面试提醒。');
  return false;
}

function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = new Date();

  applications.forEach((app) => {
    const minutes = app.reminderMinutes || 0;
    if (!app.interviewDate || minutes <= 0) return;

    const interviewDt = getInterviewDateTime(app);
    if (!interviewDt || interviewDt <= now) return;

    const remindAt = new Date(interviewDt.getTime() - minutes * 60000);
    const key = getReminderKey(app);

    if (now >= remindAt && now < interviewDt && !reminderSentIds.has(key)) {
      const timeLabel = app.interviewTime || '待定';
      new Notification('面试提醒', {
        body: `${app.company} - ${app.position}\n面试时间：${formatDate(app.interviewDate)} ${timeLabel}`,
        icon: '📋',
        tag: key,
      });
      reminderSentIds.add(key);
      saveReminderSent();
    }
  });

  renderRemindersPanel();
}

function startReminderChecker() {
  checkReminders();
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(checkReminders, 60000);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeButton(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
  updateThemeButton(next);
}

function updateThemeButton(theme) {
  $('#btnTheme').textContent = theme === 'dark' ? '☀️' : '🌙';
}

function updateNotifyButton() {
  const btn = $('#btnNotify');
  if (!('Notification' in window)) {
    btn.textContent = '🔕 不支持';
    return;
  }
  if (Notification.permission === 'granted') {
    btn.textContent = '🔔 已开启';
    btn.classList.add('btn--notify-on');
  } else {
    btn.textContent = '🔔 提醒';
    btn.classList.remove('btn--notify-on');
  }
}

function bindEvents() {
  $('#btnAdd').addEventListener('click', () => openForm());
  $('#btnAddEmpty').addEventListener('click', () => openForm());
  $('#btnCloseModal').addEventListener('click', closeForm);
  $('#btnCancel').addEventListener('click', closeForm);
  $('#applicationForm').addEventListener('submit', handleFormSubmit);

  $('#btnCloseDelete').addEventListener('click', closeDeleteConfirm);
  $('#btnCancelDelete').addEventListener('click', closeDeleteConfirm);
  $('#btnConfirmDelete').addEventListener('click', confirmDelete);

  $('#searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderTable();
  });

  $('#btnExport').addEventListener('click', exportData);

  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });

  $('#btnTheme').addEventListener('click', toggleTheme);

  $('#btnNotify').addEventListener('click', async () => {
    await requestNotificationPermission();
    updateNotifyButton();
  });

  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  $('#calPrev').addEventListener('click', () => {
    calMonth -= 1;
    if (calMonth < 0) {
      calMonth = 11;
      calYear -= 1;
    }
    renderCalendar();
  });

  $('#calNext').addEventListener('click', () => {
    calMonth += 1;
    if (calMonth > 11) {
      calMonth = 0;
      calYear += 1;
    }
    renderCalendar();
  });

  $('#calToday').addEventListener('click', () => {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    selectedCalDate = toDateKey(now.getFullYear(), now.getMonth(), now.getDate());
    renderCalendar();
  });

  $('#formModal').addEventListener('click', (e) => {
    if (e.target === $('#formModal')) closeForm();
  });
  $('#deleteModal').addEventListener('click', (e) => {
    if (e.target === $('#deleteModal')) closeDeleteConfirm();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkReminders();
  });
}

function init() {
  initTheme();
  populateStatusSelect();
  loadData();
  bindEvents();
  updateNotifyButton();
  render();
  startReminderChecker();
}

init();
