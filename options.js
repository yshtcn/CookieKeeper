// ─── State ───────────────────────────────────────────────────────────────────
let tasks      = [];
let cookieStore = {};
let settings   = { baseDir: 'CookieKeeper' };
let editingTaskId = null;

const deleteConfirm = new Map();

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  renderSettings();
  renderTasks();
  setupListeners();
  chrome.runtime.onMessage.addListener(onBackgroundMessage);
});

async function loadAll() {
  const result = await chrome.storage.local.get(['tasks', 'cookieStore', 'settings']);
  tasks       = result.tasks       || [];
  cookieStore = result.cookieStore || {};
  settings    = result.settings    || { baseDir: 'CookieKeeper' };
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('inputBaseDir').value = settings.baseDir || 'CookieKeeper';
  updatePathPreview();
}

function updatePathPreview() {
  const base = document.getElementById('inputBaseDir').value.trim() || 'CookieKeeper';
  document.getElementById('pathPreview').textContent =
    `示例完整路径：下载目录 / ${base} / youtube_com_cookies.txt`;
  document.getElementById('baseDirLabel').textContent = `${base} /`;
  updateFullPathHint();
}

function updateFullPathHint() {
  const base = document.getElementById('inputBaseDir').value.trim() || 'CookieKeeper';
  const file = document.getElementById('inputFilename')?.value.trim() || 'filename_cookies.txt';
  const hint = document.getElementById('fullPathHint');
  if (hint) hint.textContent = `完整路径：下载目录 / ${base} / ${file}`;
}

async function saveSettings() {
  const baseDir = document.getElementById('inputBaseDir').value.trim() || 'CookieKeeper';
  settings = { ...settings, baseDir };
  await chrome.storage.local.set({ settings });
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings }).catch(() => {});
  const btn = document.getElementById('saveDirBtn');
  btn.textContent = '已保存 ✓';
  setTimeout(() => { btn.textContent = '保存'; }, 2000);
}

// ─── Task Rendering ───────────────────────────────────────────────────────────
function renderTasks() {
  const list  = document.getElementById('taskList');
  const empty = document.getElementById('emptyState');
  list.innerHTML = '';

  if (tasks.length === 0) {
    list.style.display   = 'none';
    empty.style.display  = 'flex';
    return;
  }
  empty.style.display = 'none';
  list.style.display  = 'flex';
  tasks.forEach((t) => list.appendChild(buildTaskRow(t)));
}

function buildTaskRow(task) {
  const domain    = getDomain(task.url);
  const data      = cookieStore[task.id];
  const count     = data?.cookies?.length ?? 0;
  const base      = settings.baseDir || 'CookieKeeper';

  const row = document.createElement('div');
  row.id        = `row-${task.id}`;
  row.className = [
    'task-row',
    task.lastStatus === 'running' ? 'running' : '',
    task.lastStatus === 'error'   ? 'error'   : '',
    !task.enabled                  ? 'disabled' : '',
  ].join(' ').trim();

  // Status badge
  let badge = '';
  if (task.lastStatus === 'running') {
    badge = `<span class="status-badge running"><span class="spinner"></span> 运行中</span>`;
  } else if (task.lastStatus === 'error') {
    const tip = task.lastError ? escHtml(task.lastError.slice(0, 60)) : '';
    badge = `<span class="status-badge error" title="${tip}">⚠ 出错</span>`;
  } else if (task.lastRun) {
    const cls = count < 3 ? 'warn' : 'success';
    const tip = count < 3 ? '请确认已在 Chrome 中登录该网站' : '';
    badge = `<span class="status-badge ${cls}" title="${tip}">${count} cookies</span>`;
  } else {
    badge = `<span class="status-badge never">未运行</span>`;
  }

  // Auto-save badge
  const saveBadge = task.autoSave && task.saveFilename
    ? `<span class="status-badge save-badge" title="下载目录/${base}/${task.saveFilename}">💾 ${task.saveFilename}</span>`
    : '';

  row.innerHTML = `
    <img class="task-favicon"
         src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32"
         onerror="this.style.visibility='hidden'" alt="">

    <div class="task-main">
      <div class="task-name">${escHtml(task.note || domain)}</div>
      <div class="task-domain">${escHtml(domain)}</div>
      <div class="task-meta">
        <span>⏱ 每 ${formatInterval(task.intervalMinutes)}</span>
        <span>🕐 ${task.lastRun ? timeAgo(task.lastRun) : '从未运行'}</span>
        ${badge}
        ${saveBadge}
      </div>
    </div>

    <div class="task-toggle">
      <label class="toggle" title="${task.enabled ? '点击停用' : '点击启用'}">
        <input type="checkbox" ${task.enabled ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>

    <div class="task-actions">
      <button class="btn btn-sm btn-run" ${task.lastStatus === 'running' ? 'disabled' : ''}>▶ 运行</button>
      <button class="btn btn-sm btn-export" ${!data || count === 0 ? 'disabled' : ''}>⬇ 导出</button>
      <button class="btn btn-sm btn-edit">✏ 编辑</button>
      <button class="btn btn-sm btn-delete btn-danger">✕</button>
    </div>
  `;

  row.querySelector('.toggle input').addEventListener('change', (e) =>
    toggleTask(task.id, e.target.checked));
  row.querySelector('.btn-run').addEventListener('click',    () => runTaskNow(task.id));
  row.querySelector('.btn-export').addEventListener('click', () => exportTaskCookies(task.id));
  row.querySelector('.btn-edit').addEventListener('click',   () => openEditModal(task.id));
  row.querySelector('.btn-delete').addEventListener('click', () => handleDelete(task.id));

  return row;
}

function refreshRow(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const old = document.getElementById(`row-${taskId}`);
  if (old) old.replaceWith(buildTaskRow(task));
}

// ─── Background messages ──────────────────────────────────────────────────────
function onBackgroundMessage(msg) {
  if (msg.type === 'TASK_RUNNING') {
    const t = tasks.find((t) => t.id === msg.taskId);
    if (t) { t.lastStatus = 'running'; refreshRow(t.id); }
  }
  if (msg.type === 'TASK_COMPLETED') {
    loadAll().then(renderTasks);
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupListeners() {
  document.getElementById('addTaskBtn').addEventListener('click', openAddModal);
  document.getElementById('exportAllBtn').addEventListener('click', exportAllCookies);
  document.getElementById('runAllBtn').addEventListener('click', runAllTasks);

  // Settings
  document.getElementById('saveDirBtn').addEventListener('click', saveSettings);
  document.getElementById('inputBaseDir').addEventListener('input', updatePathPreview);

  // Modal
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('saveBtn').addEventListener('click', saveTask);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // AutoSave toggle inside modal
  document.getElementById('inputAutoSave').addEventListener('change', syncFilenameGroup);

  // Auto-fill filename when URL loses focus
  document.getElementById('inputUrl').addEventListener('blur', () => {
    const fn  = document.getElementById('inputFilename');
    const url = document.getElementById('inputUrl').value.trim();
    if (!fn.value && url) {
      try { fn.value = new URL(url).hostname.replace(/\./g, '_') + '_cookies.txt'; } catch {}
    }
    updateFullPathHint();
  });

  document.getElementById('inputFilename').addEventListener('input', updateFullPathHint);
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openAddModal() {
  editingTaskId = null;
  document.getElementById('modalTitle').textContent = '添加网站';
  document.getElementById('inputUrl').value = '';
  document.getElementById('inputInterval').value = '1';
  document.getElementById('inputUnit').value = '60';
  document.getElementById('inputNote').value = '';
  document.getElementById('inputAutoSave').checked = false;
  document.getElementById('inputFilename').value = '';
  syncFilenameGroup();
  clearErrors();
  document.getElementById('modalOverlay').classList.add('active');
  setTimeout(() => document.getElementById('inputUrl').focus(), 50);
}

function openEditModal(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  editingTaskId = id;

  document.getElementById('modalTitle').textContent = '编辑网站';
  document.getElementById('inputUrl').value = task.url;
  document.getElementById('inputNote').value = task.note || '';
  document.getElementById('inputAutoSave').checked = !!task.autoSave;
  document.getElementById('inputFilename').value = task.saveFilename || '';

  if (task.intervalMinutes % 1440 === 0) {
    document.getElementById('inputInterval').value = task.intervalMinutes / 1440;
    document.getElementById('inputUnit').value = '1440';
  } else if (task.intervalMinutes % 60 === 0) {
    document.getElementById('inputInterval').value = task.intervalMinutes / 60;
    document.getElementById('inputUnit').value = '60';
  } else {
    document.getElementById('inputInterval').value = task.intervalMinutes;
    document.getElementById('inputUnit').value = '1';
  }

  syncFilenameGroup();
  updateFullPathHint();
  clearErrors();
  document.getElementById('modalOverlay').classList.add('active');
  setTimeout(() => document.getElementById('inputUrl').focus(), 50);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  editingTaskId = null;
}

function syncFilenameGroup() {
  const on = document.getElementById('inputAutoSave').checked;
  document.getElementById('filenameGroup').classList.toggle('hidden', !on);
  if (on) updateFullPathHint();
}

function clearErrors() {
  document.getElementById('urlError').textContent = '';
  document.getElementById('inputUrl').classList.remove('invalid');
  document.getElementById('inputInterval').classList.remove('invalid');
}

// ─── Save Task ────────────────────────────────────────────────────────────────
async function saveTask() {
  clearErrors();
  const url        = document.getElementById('inputUrl').value.trim();
  const num        = parseFloat(document.getElementById('inputInterval').value);
  const mult       = parseInt(document.getElementById('inputUnit').value, 10);
  const note       = document.getElementById('inputNote').value.trim();
  const autoSave   = document.getElementById('inputAutoSave').checked;
  const rawFile    = document.getElementById('inputFilename').value.trim();

  let urlObj;
  try {
    urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) throw new Error();
  } catch {
    document.getElementById('inputUrl').classList.add('invalid');
    document.getElementById('urlError').textContent = '请输入有效的 http/https 地址';
    document.getElementById('inputUrl').focus();
    return;
  }

  if (!num || num <= 0) {
    document.getElementById('inputInterval').classList.add('invalid');
    document.getElementById('inputInterval').focus();
    return;
  }

  const intervalMinutes = Math.max(1, Math.round(num * mult));
  const saveFilename = autoSave
    ? (rawFile || `${getDomain(url).replace(/\./g, '_')}_cookies.txt`)
    : '';

  if (editingTaskId) {
    const idx = tasks.findIndex((t) => t.id === editingTaskId);
    if (idx !== -1) tasks[idx] = { ...tasks[idx], url, intervalMinutes, note, autoSave, saveFilename };
  } else {
    tasks.push({
      id: genId(), url, intervalMinutes, note, autoSave, saveFilename,
      enabled: true, lastRun: null, lastStatus: null, cookieCount: 0, createdAt: Date.now(),
    });
  }

  await chrome.storage.local.set({ tasks });
  chrome.runtime.sendMessage({ type: 'SETUP_ALARMS' }).catch(() => {});
  closeModal();
  renderTasks();
}

// ─── Task Actions ─────────────────────────────────────────────────────────────
async function toggleTask(id, enabled) {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  tasks[idx].enabled = enabled;
  await chrome.storage.local.set({ tasks });
  chrome.runtime.sendMessage({ type: 'SETUP_ALARMS' }).catch(() => {});
  refreshRow(id);
}

async function runTaskNow(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.lastStatus = 'running';
  refreshRow(id);
  chrome.runtime.sendMessage({ type: 'RUN_TASK_NOW', taskId: id }).catch(() => {});
}

async function runAllTasks() {
  chrome.runtime.sendMessage({ type: 'RUN_ALL_NOW' }).catch(() => {});
  tasks.filter((t) => t.enabled).forEach((t) => { t.lastStatus = 'running'; refreshRow(t.id); });
}

function handleDelete(id) {
  const row = document.getElementById(`row-${id}`);
  const btn = row?.querySelector('.btn-delete');
  if (!btn) return;

  if (deleteConfirm.has(id)) {
    clearTimeout(deleteConfirm.get(id));
    deleteConfirm.delete(id);
    doDelete(id);
  } else {
    btn.textContent = '确认删除?';
    btn.classList.add('btn-confirm');
    const t = setTimeout(() => {
      btn.textContent = '✕';
      btn.classList.remove('btn-confirm');
      deleteConfirm.delete(id);
    }, 2500);
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
  renderTasks();
}

// ─── Export ───────────────────────────────────────────────────────────────────
function exportTaskCookies(id) {
  const task = tasks.find((t) => t.id === id);
  const data = cookieStore[id];
  if (!data?.cookies?.length) return;
  const filename = `${getDomain(task?.url || data.url).replace(/\./g, '_')}_cookies.txt`;
  downloadText(buildNetscapeFile(data.cookies, task?.url || data.url), filename);
}

function exportAllCookies() {
  const chunks = tasks
    .map((t) => ({ task: t, data: cookieStore[t.id] }))
    .filter(({ data }) => data?.cookies?.length);
  if (!chunks.length) { alert('没有可导出的 Cookie，请先运行任务。'); return; }

  let out = '# Netscape HTTP Cookie File\n# Generated by Cookie Keeper\n';
  out += `# Exported: ${new Date().toISOString()}\n\n`;
  for (const { task, data } of chunks) {
    out += `# ── ${task.note || getDomain(task.url)} (${task.url})\n`;
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
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

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
