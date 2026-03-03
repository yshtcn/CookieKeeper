// popup.js — lightweight status overview
// All task management is in the options page.

let tasks       = [];
let cookieStore = {};

const deleteConfirm = new Map();

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  render();
  setupListeners();
  chrome.runtime.onMessage.addListener(onBackgroundMessage);
});

async function loadData() {
  const r = await chrome.storage.local.get(['tasks', 'cookieStore']);
  tasks       = r.tasks       || [];
  cookieStore = r.cookieStore || {};
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const list  = document.getElementById('taskList');
  const empty = document.getElementById('emptyState');
  list.innerHTML = '';

  if (tasks.length === 0) {
    list.style.display  = 'none';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  list.style.display  = 'flex';
  tasks.forEach((t) => list.appendChild(buildCard(t)));
}

function buildCard(task) {
  const domain    = getDomain(task.url);
  const cookieData = cookieStore[task.id];
  const count     = cookieData?.cookies?.length ?? 0;

  const card = document.createElement('div');
  card.id = `card-${task.id}`;
  card.className = [
    'task-card',
    task.lastStatus === 'running' ? 'running' : '',
    task.lastStatus === 'error'   ? 'error'   : '',
    !task.enabled                  ? 'disabled' : '',
  ].join(' ').trim();

  let badge = '';
  if (task.lastStatus === 'running') {
    badge = `<span class="status-badge running"><span class="spinner"></span> 运行中</span>`;
  } else if (task.lastStatus === 'error') {
    badge = `<span class="status-badge error">⚠ 出错</span>`;
  } else if (task.lastRun) {
    const cls = count < 3 ? 'warn' : 'success';
    badge = `<span class="status-badge ${cls}">${count} cookies</span>`;
  } else {
    badge = `<span class="status-badge never">未运行</span>`;
  }

  card.innerHTML = `
    <div class="task-row-1">
      <img class="task-favicon"
           src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32"
           onerror="this.style.visibility='hidden'" alt="">
      <div class="task-info">
        <div class="task-name">${escHtml(task.note || domain)}</div>
        <div class="task-domain">${escHtml(domain)}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${task.enabled ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="task-row-2">
      <span class="meta-item">⏱ 每 ${formatInterval(task.intervalMinutes)}</span>
      <span class="meta-item">🕐 ${task.lastRun ? timeAgo(task.lastRun) : '从未'}</span>
      ${badge}
    </div>
    <div class="task-row-3">
      <button class="btn-sm btn-run"    ${task.lastStatus === 'running' ? 'disabled' : ''}>▶ 运行</button>
      <button class="btn-sm btn-export" ${!cookieData || count === 0 ? 'disabled' : ''}>⬇ 导出</button>
      <button class="btn-sm btn-delete">✕</button>
    </div>
  `;

  card.querySelector('.toggle input').addEventListener('change', (e) =>
    toggleTask(task.id, e.target.checked));
  card.querySelector('.btn-run').addEventListener('click',    () => runTaskNow(task.id));
  card.querySelector('.btn-export').addEventListener('click', () => exportTaskCookies(task.id));
  card.querySelector('.btn-delete').addEventListener('click', () => handleDelete(task.id));

  return card;
}

function refreshCard(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const old = document.getElementById(`card-${taskId}`);
  if (old) old.replaceWith(buildCard(task));
}

// ─── Listeners ────────────────────────────────────────────────────────────────
function setupListeners() {
  document.getElementById('addBtn').addEventListener('click', openOptions);
  document.getElementById('openOptionsBtn').addEventListener('click', openOptions);
  document.getElementById('runAllBtn').addEventListener('click', runAllTasks);
  document.getElementById('exportAllBtn').addEventListener('click', exportAllCookies);
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function onBackgroundMessage(msg) {
  if (msg.type === 'TASK_RUNNING') {
    const t = tasks.find((t) => t.id === msg.taskId);
    if (t) { t.lastStatus = 'running'; refreshCard(t.id); }
  }
  if (msg.type === 'TASK_COMPLETED') {
    loadData().then(render);
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function toggleTask(id, enabled) {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  tasks[idx].enabled = enabled;
  await chrome.storage.local.set({ tasks });
  chrome.runtime.sendMessage({ type: 'SETUP_ALARMS' }).catch(() => {});
  refreshCard(id);
}

async function runTaskNow(id) {
  const t = tasks.find((t) => t.id === id);
  if (!t) return;
  t.lastStatus = 'running';
  refreshCard(id);
  chrome.runtime.sendMessage({ type: 'RUN_TASK_NOW', taskId: id }).catch(() => {});
}

async function runAllTasks() {
  chrome.runtime.sendMessage({ type: 'RUN_ALL_NOW' }).catch(() => {});
  tasks.filter((t) => t.enabled).forEach((t) => { t.lastStatus = 'running'; refreshCard(t.id); });
}

function handleDelete(id) {
  const card = document.getElementById(`card-${id}`);
  const btn  = card?.querySelector('.btn-delete');
  if (!btn) return;
  if (deleteConfirm.has(id)) {
    clearTimeout(deleteConfirm.get(id));
    deleteConfirm.delete(id);
    doDelete(id);
  } else {
    btn.textContent = '确认?';
    btn.classList.add('confirm-pending');
    const t = setTimeout(() => {
      btn.textContent = '✕';
      btn.classList.remove('confirm-pending');
      deleteConfirm.delete(id);
    }, 2000);
    deleteConfirm.set(id, t);
  }
}

async function doDelete(id) {
  tasks = tasks.filter((t) => t.id !== id);
  const newStore = { ...cookieStore };
  delete newStore[id];
  cookieStore = newStore;
  await chrome.storage.local.set({ tasks, cookieStore });
  chrome.runtime.sendMessage({ type: 'SETUP_ALARMS' }).catch(() => {});
  render();
}

// ─── Export ───────────────────────────────────────────────────────────────────
function exportTaskCookies(id) {
  const task = tasks.find((t) => t.id === id);
  const data = cookieStore[id];
  if (!data?.cookies?.length) return;
  const domain = getDomain(task?.url || data.url).replace(/\./g, '_');
  downloadText(buildNetscapeFile(data.cookies, task?.url || data.url), `${domain}_cookies.txt`);
}

function exportAllCookies() {
  const chunks = tasks.map((t) => ({ task: t, data: cookieStore[t.id] }))
                      .filter(({ data }) => data?.cookies?.length);
  if (!chunks.length) { alert('没有可导出的 Cookie，请先运行任务。'); return; }

  let out = '# Netscape HTTP Cookie File\n# Generated by Cookie Keeper\n';
  out += `# Exported: ${new Date().toISOString()}\n\n`;
  for (const { task, data } of chunks) {
    out += `# ── ${task.note || getDomain(task.url)}\n`;
    out += formatCookieLines(data.cookies) + '\n\n';
  }
  downloadText(out, 'all_cookies.txt');
}

function buildNetscapeFile(cookies, sourceUrl) {
  return [
    '# Netscape HTTP Cookie File',
    '# Generated by Cookie Keeper Chrome Extension',
    `# Source:   ${sourceUrl}`,
    `# Exported: ${new Date().toISOString()}`,
    '',
    formatCookieLines(cookies),
  ].join('\n');
}

function formatCookieLines(cookies) {
  return cookies.map((c) => {
    const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry = c.expirationDate ? Math.floor(c.expirationDate) : '0';
    const prefix = c.httpOnly ? '#HttpOnly_' : '';
    return `${prefix}${domain}\tTRUE\t${c.path || '/'}\t${secure}\t${expiry}\t${c.name}\t${c.value}`;
  }).join('\n');
}

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function formatInterval(minutes) {
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) { const h = minutes / 60; return `${Number.isInteger(h) ? h : h.toFixed(1)} 小时`; }
  const d = minutes / 1440;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} 天`;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return '刚刚';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function escHtml(str) {
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}
