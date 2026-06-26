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

const PAGE_TITLES = {
  home: '首页',
  list: '投递列表',
  calendar: '日历',
  settings: '我的',
};

const VALID_PAGES = ['home', 'list', 'calendar', 'settings'];

let applications = [];
let filterStatus = 'all';
let searchQuery = '';
let deleteTargetId = null;
let detailTargetId = null;
let currentPage = 'home';
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
    applications = applications.map((app) => ({
      ...app,
      status: app.status || 'applied',
    }));
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

function getDeadlineDateTime(app) {
  if (!app.deadlineDate) return null;
  return new Date(`${app.deadlineDate}T23:59:59`);
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

function getUpcomingDeadlines(withinDays = 7) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const limit = new Date(todayStart);
  limit.setDate(limit.getDate() + withinDays);
  limit.setHours(23, 59, 59, 999);

  return applications
    .filter((app) => {
      if (app.status !== 'pending') return false;
      const dt = getDeadlineDateTime(app);
      return dt && dt <= limit;
    })
    .sort((a, b) => getDeadlineDateTime(a) - getDeadlineDateTime(b));
}

function getReminderKey(app) {
  const minutes = app.reminderMinutes || 0;
  return `interview-${app.id}-${app.interviewDate}-${app.interviewTime || ''}-${minutes}`;
}

function getDeadlineReminderKey(app) {
  const minutes = app.deadlineReminderMinutes || 0;
  return `deadline-${app.id}-${app.deadlineDate}-${minutes}`;
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

function getDeadlineUntilLabel(dt) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const deadlineStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const dayDiff = Math.round((deadlineStart - todayStart) / 86400000);

  if (dayDiff < 0) return `已过期 ${Math.abs(dayDiff)} 天`;
  if (dayDiff === 0) return '今日截止';
  if (dayDiff === 1) return '明天截止';
  return `${dayDiff} 天后截止`;
}

function isDeadlineOverdue(app) {
  const dt = getDeadlineDateTime(app);
  if (!dt || app.status !== 'pending') return false;
  return dt < new Date();
}

function isDeadlineSoon(app) {
  const dt = getDeadlineDateTime(app);
  if (!dt || app.status !== 'pending') return false;
  const now = new Date();
  const diff = dt - now;
  return diff >= 0 && diff <= 3 * 24 * 60 * 60 * 1000;
}

function renderReminderCard(app, type) {
  if (type === 'deadline') {
    const dt = getDeadlineDateTime(app);
    const todayKey = toDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const isToday = app.deadlineDate === todayKey;
    const isOverdue = isDeadlineOverdue(app);
    return `
      <div class="reminder-card reminder-card--deadline${isToday ? ' reminder-card--today' : ''}${isOverdue ? ' reminder-card--overdue' : ''}" data-id="${app.id}">
        <div class="reminder-card__time">
          <strong>${isOverdue ? '已过期' : isToday ? '今日' : formatDate(app.deadlineDate)}</strong>
          <span>${getDeadlineUntilLabel(dt)}</span>
        </div>
        <div class="reminder-card__info">
          <div class="reminder-card__company">${escapeHtml(app.company)}</div>
          <div class="reminder-card__position">${escapeHtml(app.position)} · 待投递</div>
        </div>
        <span class="badge badge--pending">待投递</span>
        <button type="button" class="btn btn--ghost btn--sm btn-edit" data-id="${app.id}">编辑</button>
      </div>`;
  }

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
}

function renderRemindersPanel() {
  const panel = $('#remindersPanel');
  const upcomingInterviews = getUpcomingInterviews(7);
  const upcomingDeadlines = getUpcomingDeadlines(7);

  if (upcomingInterviews.length === 0 && upcomingDeadlines.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  const sections = [];

  if (upcomingDeadlines.length > 0) {
    sections.push(`
      <div class="reminders-panel__section">
        <div class="reminders-panel__header">
          <span class="reminders-panel__title">⏰ 待投递截止 (${upcomingDeadlines.length})</span>
        </div>
        <div class="reminders-panel__list">
          ${upcomingDeadlines.map((app) => renderReminderCard(app, 'deadline')).join('')}
        </div>
      </div>`);
  }

  if (upcomingInterviews.length > 0) {
    sections.push(`
      <div class="reminders-panel__section">
        <div class="reminders-panel__header">
          <span class="reminders-panel__title">🔔 近期面试 (${upcomingInterviews.length})</span>
        </div>
        <div class="reminders-panel__list">
          ${upcomingInterviews.map((app) => renderReminderCard(app, 'interview')).join('')}
        </div>
      </div>`);
  }

  panel.innerHTML = sections.join('');

  bindDetailTriggers(panel);
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [page, sub] = raw.split('/');

  const resolvedPage = VALID_PAGES.includes(page) ? page : 'home';
  let status = 'all';

  if (resolvedPage === 'list') {
    if (!sub || sub === 'all') {
      status = 'all';
    } else if (STATUSES.some((s) => s.value === sub)) {
      status = sub;
    }
  }

  return { page: resolvedPage, filterStatus: status };
}

function navigate(path, { replace = false } = {}) {
  const hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
  if (location.hash === hash && !replace) {
    applyRoute();
    return;
  }
  if (replace) {
    history.replaceState(null, '', hash);
    applyRoute();
  } else {
    location.hash = hash.slice(1);
  }
}

function applyRoute() {
  const { page, filterStatus: status } = parseRoute();
  currentPage = page;
  filterStatus = status;

  document.querySelectorAll('.page').forEach((el) => {
    el.classList.toggle('page--active', el.dataset.page === page);
  });

  document.querySelectorAll('.tab-bar__item').forEach((tab) => {
    tab.classList.toggle('tab-bar__item--active', tab.dataset.route === page);
  });

  const titleEl = $('#pageTitle');
  if (titleEl) {
    titleEl.textContent =
      page === 'list' && filterStatus !== 'all'
        ? `${getFilterLabel()}记录`
        : PAGE_TITLES[page];
  }

  const btnAdd = $('#btnAdd');
  if (btnAdd) {
    btnAdd.hidden = page !== 'home' && page !== 'list';
  }

  document.title =
    page === 'list' && filterStatus !== 'all'
      ? `${getFilterLabel()} - 简历投递记录`
      : `${PAGE_TITLES[page]} - 简历投递记录`;

  window.scrollTo(0, 0);
  render();
}

function initRouter() {
  if (!location.hash || location.hash === '#') {
    navigate('home', { replace: true });
  } else {
    applyRoute();
  }
  window.addEventListener('hashchange', applyRoute);
}

function getFilterLabel(status = filterStatus) {
  if (status === 'all') return '全部';
  return getStatusInfo(status).label;
}

function setFilterStatus(status) {
  const path = status === 'all' ? 'list/all' : `list/${status}`;
  navigate(path);
}

function renderListFilterBar() {
  const bar = $('#listFilterBar');
  if (!bar || currentPage !== 'list') return;

  const filtered = getFilteredApplications();
  const label = filterStatus === 'all' ? '全部投递记录' : `${getFilterLabel()}记录`;

  bar.innerHTML = `
    <span class="list-filter-bar__label">${label}</span>
    <span class="list-filter-bar__count">共 ${filtered.length} 条</span>`;
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
    card.addEventListener('click', () => setFilterStatus(card.dataset.status));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setFilterStatus(card.dataset.status);
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
    chip.addEventListener('click', () => setFilterStatus(chip.dataset.status));
  });
}

function renderTable() {
  const tbody = $('#applicationsBody');
  const emptyState = $('#emptyState');
  const emptyTitle = $('#emptyStateTitle');
  const emptyDesc = $('#emptyStateDesc');
  const table = $('#applicationsTable');
  const filtered = getFilteredApplications();

  if (applications.length === 0) {
    table.hidden = true;
    emptyState.hidden = false;
    emptyTitle.textContent = '还没有投递记录';
    emptyDesc.textContent = '点击「新增投递」开始记录你的求职进度';
    tbody.innerHTML = '';
    return;
  }

  if (filtered.length === 0) {
    table.hidden = true;
    emptyState.hidden = false;
    emptyTitle.textContent = `暂无「${getFilterLabel()}」记录`;
    emptyDesc.textContent = '返回首页切换其他状态，或新增一条投递记录';
    tbody.innerHTML = '';
    return;
  }

  table.hidden = false;
  emptyState.hidden = true;

  tbody.innerHTML = filtered
    .map((app) => {
      const status = getStatusInfo(app.status);
      const companyCell = app.link
        ? `<a class="link-external cell-company" href="${escapeAttr(app.link)}" target="_blank" rel="noopener">${escapeHtml(app.company)}</a>`
        : `<span class="cell-company">${escapeHtml(app.company)}</span>`;
      const interviewCell = app.status === 'pending' && app.deadlineDate
        ? `<span class="cell-deadline${isDeadlineOverdue(app) ? ' cell-deadline--overdue' : isDeadlineSoon(app) ? ' cell-deadline--soon' : ''}">截止 ${formatDate(app.deadlineDate)}</span>`
        : app.interviewDate
        ? `<span class="cell-interview${isInterviewSoon(app) ? ' cell-interview--soon' : ''}">${formatInterviewDateTime(app)}</span>`
        : '-';

      return `
      <tr class="table-row--clickable" data-id="${app.id}" tabindex="0" role="button" aria-label="查看 ${escapeAttr(app.company)} 详情">
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

  bindDetailTriggers(tbody);

  tbody.querySelectorAll('.table-row--clickable').forEach((row) => {
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail(row.dataset.id);
      }
    });
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
    (app) => app.date === dateKey || app.interviewDate === dateKey || app.deadlineDate === dateKey
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
  const hasDeadline = apps.some((a) => a.status === 'pending' && a.deadlineDate === dateKey);
  const todayKey = toDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const isToday = dateKey === todayKey;
  const isSelected = dateKey === selectedCalDate;

  let dots = '';
  if (hasInterview) dots += '<i class="dot dot--interview"></i>';
  if (hasApply) dots += '<i class="dot dot--apply"></i>';
  if (hasDeadline) dots += '<i class="dot dot--deadline"></i>';

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
      const isDeadline = app.status === 'pending' && app.deadlineDate === selectedCalDate;
      let tags = '';
      if (isInterview) tags += `<span class="cal-event-tag cal-event-tag--interview">面试 ${app.interviewTime || ''}</span>`;
      if (isApply) tags += '<span class="cal-event-tag cal-event-tag--apply">投递</span>';
      if (isDeadline) tags += '<span class="cal-event-tag cal-event-tag--deadline">待投递截止</span>';

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

  bindDetailTriggers(list);
}

function renderSettingsPage() {
  const countEl = $('#settingsRecordCount');
  if (countEl) countEl.textContent = String(applications.length);
  updateNotifyButton();
  updateThemeButton(document.documentElement.getAttribute('data-theme') || 'light');
}

function render() {
  if (currentPage === 'home') {
    renderRemindersPanel();
    renderStats();
  }
  if (currentPage === 'list') {
    renderStatusFilters();
    renderListFilterBar();
    renderTable();
  }
  if (currentPage === 'calendar') {
    renderCalendar();
  }
  if (currentPage === 'settings') {
    renderSettingsPage();
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

function formatReminderLabel(minutes) {
  if (!minutes) return '不提醒';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${minutes / 60} 小时前`;
  return `${minutes / 1440} 天前`;
}

function getCompanyInitial(company) {
  const text = (company || '?').trim();
  return text ? text.charAt(0) : '?';
}

function buildDetailItem(label, value, options = {}) {
  const { html = false, highlight = false, warn = false } = options;
  if (value === null || value === undefined || value === '') return '';
  return `
    <div class="detail-item${highlight ? ' detail-item--highlight' : ''}${warn ? ' detail-item--warn' : ''}">
      <span class="detail-item__label">${label}</span>
      <span class="detail-item__value">${html ? value : escapeHtml(String(value))}</span>
    </div>`;
}

function buildDetailSection(title, icon, itemsHtml) {
  if (!itemsHtml) return '';
  return `
    <section class="detail-section">
      <h3 class="detail-section__title"><span class="detail-section__icon">${icon}</span>${title}</h3>
      <div class="detail-section__grid">${itemsHtml}</div>
    </section>`;
}

function buildDetailQuickChip(icon, text) {
  if (!text) return '';
  return `
    <span class="detail-chip">
      <span class="detail-chip__icon">${icon}</span>
      <span class="detail-chip__text">${escapeHtml(text)}</span>
    </span>`;
}

function openDetail(id) {
  const app = applications.find((a) => a.id === id);
  if (!app) return;

  detailTargetId = id;
  const status = getStatusInfo(app.status);

  $('#detailAvatar').textContent = getCompanyInitial(app.company);
  $('#detailTitle').textContent = app.company;
  $('#detailPosition').textContent = app.position || '';
  $('#detailPosition').hidden = !app.position;
  const statusEl = $('#detailStatus');
  statusEl.className = `badge detail-hero__badge ${status.badgeClass}`;
  statusEl.textContent = status.label;

  const quickHtml = [
    buildDetailQuickChip('📱', app.platform),
    buildDetailQuickChip('📅', `投递 ${formatDate(app.date)}`),
    buildDetailQuickChip('💰', app.salary),
    buildDetailQuickChip('📍', app.location),
  ]
    .filter(Boolean)
    .join('');
  $('#detailQuick').innerHTML = quickHtml
    ? `<div class="detail-quick__inner">${quickHtml}</div>`
    : '';

  let scheduleHtml = '';
  if (app.status === 'pending') {
    scheduleHtml = [
      buildDetailItem(
        '投递截止',
        app.deadlineDate ? formatDate(app.deadlineDate) : '未设置',
        { warn: app.deadlineDate && isDeadlineOverdue(app) }
      ),
      buildDetailItem(
        '截止提醒',
        app.deadlineDate ? formatReminderLabel(app.deadlineReminderMinutes) : null
      ),
      buildDetailItem(
        '剩余时间',
        app.deadlineDate ? getDeadlineUntilLabel(getDeadlineDateTime(app)) : null,
        { highlight: app.deadlineDate && isDeadlineSoon(app) && !isDeadlineOverdue(app) }
      ),
    ].join('');
  } else {
    scheduleHtml = [
      buildDetailItem(
        '面试时间',
        app.interviewDate ? formatInterviewDateTime(app) : '未安排',
        { highlight: isInterviewSoon(app) }
      ),
      buildDetailItem(
        '面试提醒',
        app.interviewDate ? formatReminderLabel(app.reminderMinutes) : null
      ),
    ].join('');
  }

  const sections = [
    buildDetailSection('时间安排', '🕐', scheduleHtml),
  ];

  if (app.link) {
    sections.push(`
      <section class="detail-section">
        <h3 class="detail-section__title"><span class="detail-section__icon">🔗</span>岗位链接</h3>
        <a class="detail-link-btn" href="${escapeAttr(app.link)}" target="_blank" rel="noopener">
          <span>查看岗位详情</span>
          <span class="detail-link-btn__arrow">→</span>
        </a>
      </section>`);
  }

  sections.push(`
    <section class="detail-section">
      <h3 class="detail-section__title"><span class="detail-section__icon">📝</span>备注</h3>
      <div class="detail-notes${app.notes ? '' : ' detail-notes--empty'}">${app.notes ? escapeHtml(app.notes) : '暂无备注'}</div>
    </section>`);

  if (app.updatedAt || app.createdAt) {
    const meta = app.updatedAt
      ? `更新于 ${formatDate(app.updatedAt.slice(0, 10))}`
      : app.createdAt
      ? `创建于 ${formatDate(app.createdAt.slice(0, 10))}`
      : '';
    if (meta) {
      sections.push(`<p class="detail-meta">${meta}</p>`);
    }
  }

  $('#detailContent').innerHTML = sections.join('');
  $('#detailModal').showModal();
}

function closeDetail() {
  detailTargetId = null;
  $('#detailModal').close();
}

function bindDetailTriggers(container) {
  if (!container) return;

  container.querySelectorAll('[data-id]').forEach((el) => {
    if (el.matches('tr[data-id], .reminder-card[data-id], .cal-event-card[data-id]')) {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.cell-actions, .btn-edit, .btn-delete, a')) return;
        openDetail(el.dataset.id);
      });
    }
  });

  container.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openForm(btn.dataset.id);
    });
  });

  container.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteConfirm(btn.dataset.id);
    });
  });
}

function populateStatusSelect() {
  const select = $('#fieldStatus');
  select.innerHTML = STATUSES.map(
    (s) => `<option value="${s.value}">${s.label}</option>`
  ).join('');
}

function toggleFormFieldsByStatus() {
  const isPending = $('#fieldStatus').value === 'pending';
  $('#deadlineFields').hidden = !isPending;
  $('#interviewFields').hidden = isPending;
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
    $('#fieldDeadlineDate').value = app.deadlineDate || '';
    $('#fieldDeadlineReminder').value = String(app.deadlineReminderMinutes ?? 1440);
    $('#fieldNotes').value = app.notes || '';
  } else {
    $('#modalTitle').textContent = '新增投递';
    $('#fieldId').value = '';
    $('#fieldDate').value = new Date().toISOString().slice(0, 10);
    $('#fieldStatus').value = 'applied';
    $('#fieldReminder').value = '60';
    $('#fieldDeadlineReminder').value = '1440';
  }

  toggleFormFieldsByStatus();
  modal.showModal();
}

function closeForm() {
  $('#formModal').close();
}

function handleFormSubmit(e) {
  e.preventDefault();

  const id = $('#fieldId').value;
  const status = $('#fieldStatus').value;
  const data = {
    company: $('#fieldCompany').value.trim(),
    position: $('#fieldPosition').value.trim(),
    platform: $('#fieldPlatform').value,
    date: $('#fieldDate').value,
    status,
    salary: $('#fieldSalary').value.trim(),
    location: $('#fieldLocation').value.trim(),
    link: $('#fieldLink').value.trim(),
    interviewDate: status === 'pending' ? '' : $('#fieldInterviewDate').value,
    interviewTime: status === 'pending' ? '' : $('#fieldInterviewTime').value,
    reminderMinutes: status === 'pending' ? 0 : parseInt($('#fieldReminder').value, 10) || 0,
    deadlineDate: status === 'pending' ? $('#fieldDeadlineDate').value : '',
    deadlineReminderMinutes:
      status === 'pending' ? parseInt($('#fieldDeadlineReminder').value, 10) || 0 : 0,
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
  if (detailTargetId === deleteTargetId) closeDetail();
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
    alert('提醒已开启！将在面试前和投递截止前收到浏览器通知。');
    return true;
  }
  if (Notification.permission === 'denied') {
    alert('通知权限已被拒绝，请在浏览器设置中允许本站点发送通知。');
    return false;
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    alert('提醒已开启！请保持浏览器标签页打开以接收通知。');
    return true;
  }
  alert('未授予通知权限，将无法收到提醒。');
  return false;
}

function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = new Date();

  applications.forEach((app) => {
    const interviewMinutes = app.reminderMinutes || 0;
    if (app.interviewDate && interviewMinutes > 0) {
      const interviewDt = getInterviewDateTime(app);
      if (interviewDt && interviewDt > now) {
        const remindAt = new Date(interviewDt.getTime() - interviewMinutes * 60000);
        const key = getReminderKey(app);

        if (now >= remindAt && now < interviewDt && !reminderSentIds.has(key)) {
          const timeLabel = app.interviewTime || '待定';
          new Notification('面试提醒', {
            body: `${app.company} - ${app.position}\n面试时间：${formatDate(app.interviewDate)} ${timeLabel}`,
            icon: 'icons/icon-192.png',
            tag: key,
          });
          reminderSentIds.add(key);
          saveReminderSent();
        }
      }
    }

    const deadlineMinutes = app.deadlineReminderMinutes || 0;
    if (app.status === 'pending' && app.deadlineDate && deadlineMinutes > 0) {
      const deadlineDt = getDeadlineDateTime(app);
      if (deadlineDt && deadlineDt > now) {
        const remindAt = new Date(deadlineDt.getTime() - deadlineMinutes * 60000);
        const key = getDeadlineReminderKey(app);

        if (now >= remindAt && now < deadlineDt && !reminderSentIds.has(key)) {
          new Notification('投递截止提醒', {
            body: `${app.company} - ${app.position}\n截止日期：${formatDate(app.deadlineDate)}，请尽快投递`,
            icon: 'icons/icon-192.png',
            tag: key,
          });
          reminderSentIds.add(key);
          saveReminderSent();
        }
      }
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
  const themeStatus = $('#themeStatus');
  if (themeStatus) {
    themeStatus.textContent = theme === 'dark' ? '已开启' : '关闭';
  }
}

function updateNotifyButton() {
  const notifyStatus = $('#notifyStatus');
  if (!('Notification' in window)) {
    if (notifyStatus) notifyStatus.textContent = '不支持';
    return;
  }
  if (notifyStatus) {
    notifyStatus.textContent =
      Notification.permission === 'granted'
        ? '已开启'
        : Notification.permission === 'denied'
        ? '已拒绝'
        : '未开启';
  }
}

function bindEvents() {
  $('#btnAdd').addEventListener('click', () => openForm());
  $('#btnAddEmpty').addEventListener('click', () => openForm());
  $('#btnCloseModal').addEventListener('click', closeForm);
  $('#btnCancel').addEventListener('click', closeForm);
  $('#applicationForm').addEventListener('submit', handleFormSubmit);
  $('#fieldStatus').addEventListener('change', toggleFormFieldsByStatus);

  $('#btnCloseDelete').addEventListener('click', closeDeleteConfirm);
  $('#btnCancelDelete').addEventListener('click', closeDeleteConfirm);
  $('#btnConfirmDelete').addEventListener('click', confirmDelete);

  $('#searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderListFilterBar();
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

  document.querySelectorAll('.tab-bar__item').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const route = tab.dataset.route;
      if (route === 'list' && currentPage === 'list') return;
      if (route === 'list') {
        e.preventDefault();
        navigate(filterStatus === 'all' ? 'list/all' : `list/${filterStatus}`);
      }
    });
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
  $('#detailModal').addEventListener('click', (e) => {
    if (e.target === $('#detailModal')) closeDetail();
  });
  $('#btnCloseDetail').addEventListener('click', closeDetail);
  $('#btnDetailEdit').addEventListener('click', () => {
    const id = detailTargetId;
    closeDetail();
    if (id) openForm(id);
  });
  $('#btnDetailDelete').addEventListener('click', () => {
    if (detailTargetId) openDeleteConfirm(detailTargetId);
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
  initRouter();
  startReminderChecker();
}

init();
