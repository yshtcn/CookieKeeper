// ─── State ───────────────────────────────────────────────────────────────────
let tasks = [];
let cookieStore = {};
let editingTaskId = null;

/** Track cards pending delete confirmation: taskId → timeoutId */
const deleteConfirm = new Map();

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  render();
  setupListeners();
  chrome.runtime.onMessage.addListener(onBackgroundMessage);
});

async function loadData() {
  const result = await chrome.storage.local.get(['tasks', 'cookieStore']);
  tasks = result.tasks || [];
  cookieStore = result.cookieStore || {};
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function render() {
  const list = document.getElementById('taskList');
  const empty = document.getElementById('emptyState');

  list.innerHTML = '';

  if (tasks.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'flex';
  tasks.forEach((task) => list.appendChild(buildCard(task)));
}

function buildCard(task) {
  const domain = getDomain(task.url);
  const cookieData = cookieStore[task.id];
  const count = cookieData?.cookies?.length ?? 0;

  const card = document.createElement('div');
  card.id = `card-${task.id}`;
  card.className = [
    'task-card',
    task.lastStatus === 'running' ? 'running' : '',
    task.lastStatus === 'error'   ? 'error'   : '',
    !task.enabled                  ? 'disabled' : '',
  ].join(' ').trim();

  // ── Status badge ──
  let badge = '';
  if (task.lastStatus === 'running') {
    badge = `<span class="status-badge running"><span class="spinner"></span> 运行中</span>`;
  } else if (task.lastStatus === 'error') {
    const tip = task.lastError ? escHtml(task.lastError.slice(0, 40)) : '未知错误';
    badge = `<span class="status-badge error" title="${tip}">⚠ 出错</span>`;
  } else if (task.lastRun) {
    const warnClass = count < 3 ? 'warn' : 'success';
    const warnTip   = count < 3 ? 'Cookie 数量少，请确认已登录该网站' : '';
    badge = `<span class="status-badge ${warnClass}" title="${warnTip}">${count} cookies</span>`;
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
      <label class="toggle" title="${task.enabled ? '点击停用' : '点击启用'}">
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
      <button class="btn-sm btn-edit">✏ 编辑</button>
      <button class="btn-sm btn-delete">✕</button>
    </div>
  `;

  // Attach listeners
  card.querySelector('.toggle input').addEventListener('change', (e) =>
    toggleTask(task.id, e.target.checked)
  );
  card.querySelector('.btn-run').addEventListener('click',    () => runTaskNow(task.id));
  card.querySelector('.btn-export').addEventListener('click', () => exportTaskCookies(task.id));
  card.querySelector('.btn-edit').addEventListener('click',   () => openEditModal(task.id));
  card.querySelector('.btn-delete').addEventListener('click', () => handleDelete(task.id));

  return card;
}

/** Refresh a single card without full re-render */
function refreshCard(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const old = document.getElementById(`card-${taskId}`);
  if (old) old.replaceWith(buildCard(task));
}

// ─── Background message handler ───────────────────────────────────────────────
function onBackgroundMessage(message) {
  if (message.type === 'TASK_RUNNING') {
    const task = tasks.find((t) => t.id === message.taskId);
    if (task) { task.lastStatus = 'running'; refreshCard(task.id); }
  }

  if (message.type === 'TASK_COMPLETED') {
    loadData().then(() => {
      render(); // full re-render to get fresh cookie counts
    });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────
function setupListeners() {
  document.getElementById('addTaskBtn').addEventListener('click', openAddModal);
  document.getElementById('exportAllBtn').addEventListener('click', exportAllCookies);
  document.getElementById('runAllBtn').addEventListener('click', runAllTasks);

  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('saveBtn').addEventListener('click', saveTask);

  // Auto-save toggle → show/hide filename field
  document.getElementById('inputAutoSave').addEventListener('change', syncFilenameGroup);

  // When URL changes and filename is empty, auto-fill filename
  document.getElementById('inputUrl').addEventListener('blur', () => {
    const fn = document.getElementById('inputFilename');
    const url = document.getElementById('inputUrl').value.trim();
    if (!fn.value && url) {
      try {
        fn.value = new URL(url).hostname.replace(/\./g, '_') + '_cookies.txt';
      } catch {}
    }
  });

  // Click outside modal to close
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
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
  clearFormErrors();
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
  syncFilenameGroup();

  // Reverse-convert minutes → display value + unit
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

  clearFormErrors();
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
}

function clearFormErrors() {
  document.getElementById('urlError').textContent = '';
  document.getElementById('inputUrl').classList.remove('invalid');
  document.getElementById('inputInterval').classList.remove('invalid');
}

// ─── Save task ────────────────────────────────────────────────────────────────
async function saveTask() {
  clearFormErrors();

  const urlInput      = document.getElementById('inputUrl');
  const intervalInput = document.getElementById('inputInterval');
  const unitSelect    = document.getElementById('inputUnit');
  const noteInput     = document.getElementById('inputNote');

  const url      = urlInput.value.trim();
  const note     = noteInput.value.trim();
  const autoSave = document.getElementById('inputAutoSave').checked;
  const rawFilename = document.getElementById('inputFilename').value.trim();
  const num  = parseFloat(intervalInput.value);
  const mult = parseInt(unitSelect.value, 10);

  // Validate URL
  let urlObj;
  try {
    urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) throw new Error();
  } catch {
    urlInput.classList.add('invalid');
    document.getElementById('urlError').textContent = '请输入有效的 http/https 地址';
    urlInput.focus();
    return;
  }

  // Validate interval
  if (!num || num <= 0 || isNaN(num)) {
    intervalInput.classList.add('invalid');
    intervalInput.focus();
    return;
  }

  const intervalMinutes = Math.max(1, Math.round(num * mult));

  // Derive a safe default filename from domain if user left it blank
  const saveFilename = autoSave
    ? (rawFilename || `${getDomain(url).replace(/\./g, '_')}_cookies.txt`)
    : '';

  if (editingTaskId) {
    const idx = tasks.findIndex((t) => t.id === editingTaskId);
    if (idx !== -1) {
      tasks[idx] = { ...tasks[idx], url, intervalMinutes, note, autoSave, saveFilename };
    }
  } else {
    tasks.push({
      id: genId(),
      url,
      intervalMinutes,
      note,
      autoSave,
      saveFilename,
      enabled: true,
      lastRun: null,
      lastStatus: null,
      cookieCount: 0,
      createdAt: Date.now(),
    });
  }

  await chrome.storage.local.set({ tasks });
  chrome.runtime.sendMessage({ type: 'SETUP_ALARMS' }).catch(() => {});

  closeModal();
  render();
}

// ─── Task actions ─────────────────────────────────────────────────────────────
async function toggleTask(id, enabled) {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  tasks[idx].enabled = enabled;
  await chrome.storage.local.set({ tasks });
  chrome.runtime.sendMessage({ type: 'SETUP_ALARMS' }).catch(() => {});
  refreshCard(id);
}

async function runTaskNow(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.lastStatus = 'running';
  refreshCard(id);
  chrome.runtime.sendMessage({ type: 'RUN_TASK_NOW', taskId: id }).catch(() => {});
}

async function runAllTasks() {
  chrome.runtime.sendMessage({ type: 'RUN_ALL_NOW' }).catch(() => {});
  tasks.filter((t) => t.enabled).forEach((t) => {
    t.lastStatus = 'running';
    refreshCard(t.id);
  });
}

/** Two-step delete: first click shows confirmation, second click within 2s deletes */
function handleDelete(id) {
  const card = document.getElementById(`card-${id}`);
  const btn  = card?.querySelector('.btn-delete');
  if (!btn) return;

  if (deleteConfirm.has(id)) {
    clearTimeout(deleteConfirm.get(id));
    deleteConfirm.delete(id);
    doDeleteTask(id);
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

async function doDeleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  const newStore = { ...cookieStore };
  delete newStore[id];
  cookieStore = newStore;
  await chrome.storage.local.set({ tasks, cookieStore });
  chrome.runtime.sendMessage({ type: 'SETUP_ALARMS' }).catch(() => {});
  render();
}

// ─── Cookie export ────────────────────────────────────────────────────────────
function exportTaskCookies(id) {
  const task = tasks.find((t) => t.id === id);
  const data = cookieStore[id];
  if (!data?.cookies?.length) return;

  const domain   = getDomain(task?.url || data.url).replace(/\./g, '_');
  const content  = buildNetscapeFile(data.cookies, task?.url || data.url);
  downloadText(content, `${domain}_cookies.txt`);
}

function exportAllCookies() {
  const chunks = tasks
    .map((t) => ({ task: t, data: cookieStore[t.id] }))
    .filter(({ data }) => data?.cookies?.length);

  if (!chunks.length) {
    alert('没有可导出的 Cookie，请先运行任务。');
    return;
  }

  let out = '# Netscape HTTP Cookie File\n';
  out += '# Generated by Cookie Keeper Chrome Extension\n';
  out += `# Exported: ${new Date().toISOString()}\n\n`;

  for (const { task, data } of chunks) {
    out += `# ── ${task.note || getDomain(task.url)} (${task.url})\n`;
    out += formatCookieLines(data.cookies);
    out += '\n\n';
  }

  downloadText(out, 'all_cookies.txt');
}

/**
 * Build a complete Netscape HTTP Cookie File string.
 * Compatible with yt-dlp --cookies flag.
 */
function buildNetscapeFile(cookies, sourceUrl) {
  let out = '# Netscape HTTP Cookie File\n';
  out += '# Generated by Cookie Keeper Chrome Extension\n';
  out += `# Source:   ${sourceUrl}\n`;
  out += `# Exported: ${new Date().toISOString()}\n\n`;
  out += formatCookieLines(cookies);
  return out;
}

/** Format an array of Chrome Cookie objects into Netscape tab-separated lines. */
function formatCookieLines(cookies) {
  return cookies
    .map((c) => {
      // Ensure domain has a leading dot for subdomain matching
      const domain     = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
      const subdomains = 'TRUE';
      const path       = c.path || '/';
      const secure     = c.secure ? 'TRUE' : 'FALSE';
      const expiry     = c.expirationDate ? Math.floor(c.expirationDate) : '0';
      const prefix     = c.httpOnly ? '#HttpOnly_' : '';
      return `${prefix}${domain}\t${subdomains}\t${path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`;
    })
    .join('\n');
}

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getDomain(url) {
  try { return new URL(url).hostname; }
  catch { return url; }
}

function formatInterval(minutes) {
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) {
    const h = minutes / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} 小时`;
  }
  const d = minutes / 1440;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} 天`;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return '刚刚';
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
