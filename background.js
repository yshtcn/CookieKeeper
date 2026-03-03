// Cookie Keeper - Background Service Worker
// Handles alarm scheduling, tab management, and cookie capture

const ALARM_PREFIX = 'ck_task_';
const TAB_LOAD_TIMEOUT = 25000; // 25 seconds
const EXTRA_WAIT_MS = 1500;     // 1.5s extra for dynamic content

// Track currently running tasks (in-memory, resets with service worker)
const runningTasks = new Set();

// ─── Lifecycle ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[CookieKeeper] Installed');
  await setupAllAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[CookieKeeper] Browser started, restoring alarms');
  await setupAllAlarms();
});

// ─── Alarm Handler ───────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const taskId = alarm.name.slice(ALARM_PREFIX.length);
  executeTask(taskId);
});

// ─── Message Handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RUN_TASK_NOW') {
    executeTask(message.taskId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async
  }

  if (message.type === 'SETUP_ALARMS') {
    setupAllAlarms()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'SETTINGS_UPDATED') {
    // Nothing extra needed; settings are read from storage on each task run
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RUN_ALL_NOW') {
    chrome.storage.local.get('tasks').then(({ tasks = [] }) => {
      tasks.filter((t) => t.enabled).forEach((t) => executeTask(t.id));
      sendResponse({ success: true, count: tasks.filter((t) => t.enabled).length });
    });
    return true;
  }
});

// ─── Alarm Setup ─────────────────────────────────────────────────────────────

async function setupAllAlarms() {
  await chrome.alarms.clearAll();
  const { tasks = [] } = await chrome.storage.local.get('tasks');

  for (const task of tasks) {
    if (task.enabled && task.intervalMinutes >= 1) {
      chrome.alarms.create(`${ALARM_PREFIX}${task.id}`, {
        delayInMinutes: task.intervalMinutes,
        periodInMinutes: task.intervalMinutes,
      });
    }
  }

  console.log(`[CookieKeeper] Set up ${tasks.filter((t) => t.enabled).length} alarm(s)`);
}

// ─── Task Execution ──────────────────────────────────────────────────────────

async function executeTask(taskId) {
  if (runningTasks.has(taskId)) {
    console.log(`[CookieKeeper] Task ${taskId} already running, skipping`);
    return;
  }

  runningTasks.add(taskId);
  notifyPopup({ type: 'TASK_RUNNING', taskId });

  let tab = null;

  try {
    const { tasks = [], cookieStore = {} } = await chrome.storage.local.get([
      'tasks',
      'cookieStore',
    ]);
    const task = tasks.find((t) => t.id === taskId);

    if (!task || !task.enabled) {
      console.log(`[CookieKeeper] Task ${taskId} not found or disabled`);
      runningTasks.delete(taskId);
      return;
    }

    console.log(`[CookieKeeper] Running task: ${task.url}`);

    // Open tab in background (do not activate)
    tab = await chrome.tabs.create({ url: task.url, active: false });

    // Wait for page to finish loading
    await waitForTabLoad(tab.id);

    // Extra wait for JS-driven cookie setting
    await sleep(EXTRA_WAIT_MS);

    // Get the tab's final URL (page may have redirected)
    const finalTab = await chrome.tabs.get(tab.id).catch(() => null);
    const finalUrl = finalTab?.url || task.url;

    // Capture cookies accessible from the final URL
    const cookies = await chrome.cookies.getAll({ url: finalUrl });

    // Close the background tab
    await chrome.tabs.remove(tab.id).catch(() => {});
    tab = null;

    // Persist cookie data
    const freshStore = (await chrome.storage.local.get('cookieStore')).cookieStore || {};
    freshStore[taskId] = {
      url: task.url,
      finalUrl,
      cookies,
      lastUpdated: Date.now(),
    };

    // Update task metadata
    const { tasks: freshTasks = [] } = await chrome.storage.local.get('tasks');
    const idx = freshTasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      freshTasks[idx].lastRun = Date.now();
      freshTasks[idx].lastStatus = 'success';
      freshTasks[idx].cookieCount = cookies.length;
      delete freshTasks[idx].lastError;
    }

    await chrome.storage.local.set({ cookieStore: freshStore, tasks: freshTasks });

    console.log(`[CookieKeeper] Task done: ${cookies.length} cookies captured`);

    // Auto-export if configured (read baseDir from settings)
    if (task.autoSave && task.saveFilename && cookies.length > 0) {
      const { settings = {} } = await chrome.storage.local.get('settings');
      const baseDir = settings.baseDir || 'CookieKeeper';
      await autoExportCookies(task, cookies, baseDir);
    }

    notifyPopup({ type: 'TASK_COMPLETED', taskId, success: true, cookieCount: cookies.length });
  } catch (error) {
    console.error(`[CookieKeeper] Task ${taskId} failed:`, error.message);

    // Clean up orphan tab if any
    if (tab) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }

    // Persist error state
    const { tasks = [] } = await chrome.storage.local.get('tasks');
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      tasks[idx].lastRun = Date.now();
      tasks[idx].lastStatus = 'error';
      tasks[idx].lastError = error.message;
      await chrome.storage.local.set({ tasks });
    }

    notifyPopup({ type: 'TASK_COMPLETED', taskId, success: false, error: error.message });
  } finally {
    runningTasks.delete(taskId);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // proceed after timeout regardless
    }, TAB_LOAD_TIMEOUT);

    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Handle race: tab might already be loaded by the time we attach the listener
    chrome.tabs.get(tabId)
      .then((t) => {
        if (t.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      })
      .catch(() => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup is closed — ignore
  });
}

// ─── Auto-export ─────────────────────────────────────────────────────────────
//
// chrome.downloads.download() from a service worker with a data: URL ignores
// the `filename` parameter (Chrome bug — uses locale default "下载.txt").
//
// Fix: use chrome.downloads.onDeterminingFilename to intercept the download
// event and inject the correct path + filename before Chrome finalizes it.
// This fires asynchronously after the download is registered, so we store the
// intended filename in a Map keyed by download ID and look it up in the listener.

/** downloadId → intended relative path (e.g. "CookieKeeper/site_cookies.txt") */
const filenameOverrides = new Map();

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (!filenameOverrides.has(downloadItem.id)) return;

  const filename = filenameOverrides.get(downloadItem.id);
  filenameOverrides.delete(downloadItem.id);

  suggest({ filename, conflictAction: 'overwrite' });
});

async function autoExportCookies(task, cookies, baseDir = 'CookieKeeper') {
  try {
    const content        = buildNetscapeContent(cookies, task.url);
    const targetFilename = `${baseDir}/${task.saveFilename}`;
    const dataUrl        = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;

    // Start the download (Chrome picks a temp name here; we override it below)
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({ url: dataUrl, saveAs: false }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(id);
        }
      });
    });

    // Register override — onDeterminingFilename fires shortly after, in a
    // later event-loop tick, so this Set always executes before the listener.
    filenameOverrides.set(downloadId, targetFilename);
    console.log(`[CookieKeeper] Auto-save started → Downloads/${targetFilename} (id=${downloadId})`);
  } catch (err) {
    console.error('[CookieKeeper] Auto-export failed:', err.message);
  }
}

function buildNetscapeContent(cookies, sourceUrl) {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# Generated by Cookie Keeper Chrome Extension',
    `# Source:   ${sourceUrl}`,
    `# Exported: ${new Date().toISOString()}`,
    '',
    ...cookies.map((c) => {
      const domain     = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
      const secure     = c.secure ? 'TRUE' : 'FALSE';
      const expiry     = c.expirationDate ? Math.floor(c.expirationDate) : '0';
      const prefix     = c.httpOnly ? '#HttpOnly_' : '';
      return `${prefix}${domain}\tTRUE\t${c.path || '/'}\t${secure}\t${expiry}\t${c.name}\t${c.value}`;
    }),
  ];
  return lines.join('\n');
}
