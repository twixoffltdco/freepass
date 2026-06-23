// ─── FreePass v2 — background.js ─────────────────────────────────────────────
// Динамически загружает свежие прокси с публичных API,
// проверяет их доступность и применяет лучший рабочий.

// ─── Источники свежих прокси (обновляются каждую минуту) ─────────────────────
const PROXY_SOURCES = [
  // ProxyScrape API — тысячи прокси, обновляются каждую минуту
  "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=http&timeout=3000&anonymity=elite,anonymous",
  // Proxifly via jsDelivr (GitHub CDN, не блокируется в РФ)
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt",
  // Ещё один GitHub-зеркальный источник
  "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/http/data.txt",
  // Резервный список через raw.githubusercontent
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt"
];

// ─── Тест-URL для проверки прокси ─────────────────────────────────────────────
// Лёгкий эндпоинт, быстро отвечает
const CHECK_URL = "http://httpbin.org/ip";
const CHECK_TIMEOUT_MS = 4000;
const MAX_PROXIES_TO_TEST = 30; // тестируем первые 30 из списка параллельно

// ─── Заблокированные домены (роутятся через прокси) ──────────────────────────
const BLOCKED_DOMAINS = [
  "youtube.com","youtu.be","ytimg.com","yt3.ggpht.com","googlevideo.com",
  "youtube-nocookie.com","youtubei.googleapis.com","gvt1.com","gvt2.com",
  "telegram.org","t.me","telegram.me","web.telegram.org","core.telegram.org",
  "cdn.telegram.org","cdn1.telegram.org","cdn2.telegram.org","cdn3.telegram.org",
  "cdn4.telegram.org","cdn5.telegram.org","tdesktop.com","telesco.pe",
  "google.com","googleapis.com","googleusercontent.com","gstatic.com",
  "instagram.com","facebook.com","fbcdn.net","fb.com","meta.com","threads.net",
  "twitter.com","x.com","twimg.com","t.co",
  "discord.com","discordapp.com","discord.gg","discordcdn.com",
  "tiktok.com","tiktokcdn.com","ttwstatic.com",
  "soundcloud.com","spotify.com","scdn.co",
  "linkedin.com","licdn.com",
  "github.com","githubusercontent.com","githubassets.com",
  "wikipedia.org","wikimedia.org",
  "medium.com","reddit.com","redd.it","redditmedia.com",
  "claude.ai","anthropic.com",
  "twitch.tv","twitchsvc.net",
  "netflix.com","nflximg.net","nflxvideo.net",
  "openai.com","chatgpt.com"
];

// ─── Генерация PAC-скрипта ────────────────────────────────────────────────────
function buildPacScript(host, port) {
  const domainList = BLOCKED_DOMAINS.map(d => `"${d}"`).join(",");
  return `
function FindProxyForURL(url, host) {
  var blocked = [${domainList}];
  var h = host.toLowerCase().replace(/^www\\./, "").replace(/:\\d+$/, "");
  for (var i = 0; i < blocked.length; i++) {
    if (h === blocked[i] || h.endsWith("." + blocked[i])) {
      return "PROXY ${host}:${port}; DIRECT";
    }
  }
  return "DIRECT";
}`;
}

// ─── Применить конкретный прокси ──────────────────────────────────────────────
function applyProxySettings(host, port) {
  return new Promise((resolve) => {
    chrome.proxy.settings.set({
      value: { mode: "pac_script", pacScript: { data: buildPacScript(host, port) } },
      scope: "regular"
    }, () => {
      if (chrome.runtime.lastError) resolve(false);
      else resolve(true);
    });
  });
}

// ─── Снять прокси ─────────────────────────────────────────────────────────────
function removeProxy() {
  return new Promise((resolve) => {
    chrome.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" }, resolve);
  });
}

// ─── Загрузить список прокси из источника ─────────────────────────────────────
async function fetchProxyList(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const text = await res.text();
    const proxies = [];
    for (const line of text.split("\n")) {
      const clean = line.trim();
      // Формат: http://1.2.3.4:8080 или 1.2.3.4:8080
      const match = clean.match(/^(?:https?:\/\/)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})$/);
      if (match) {
        proxies.push({ host: match[1], port: parseInt(match[2]) });
      }
    }
    return proxies;
  } catch {
    return [];
  }
}

// ─── Проверить один прокси через PAC + fetch ──────────────────────────────────
// Применяем временно, делаем запрос, снимаем
async function testProxy(host, port) {
  try {
    // Временно ставим прокси
    const ok = await applyProxySettings(host, port);
    if (!ok) return false;

    // Пробуем достучаться до лёгкого URL
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(CHECK_URL, {
        signal: ctrl.signal,
        cache: "no-store"
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      clearTimeout(timer);
      return false;
    }
  } catch {
    return false;
  }
}

// ─── Найти первый рабочий прокси ──────────────────────────────────────────────
async function findWorkingProxy(onProgress) {
  onProgress?.("Загружаем список прокси...");

  let allProxies = [];

  // Пробуем каждый источник по очереди
  for (const src of PROXY_SOURCES) {
    onProgress?.(`Источник: ${new URL(src).hostname}...`);
    const list = await fetchProxyList(src);
    if (list.length > 0) {
      allProxies = list;
      onProgress?.(`Получено ${list.length} прокси`);
      break;
    }
  }

  if (allProxies.length === 0) {
    return null;
  }

  // Перемешиваем чтобы не брать всегда одни и те же
  for (let i = allProxies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allProxies[i], allProxies[j]] = [allProxies[j], allProxies[i]];
  }

  const toTest = allProxies.slice(0, MAX_PROXIES_TO_TEST);
  onProgress?.(`Проверяем ${toTest.length} прокси...`);

  // Параллельная проверка батчами по 5
  const BATCH = 5;
  for (let i = 0; i < toTest.length; i += BATCH) {
    const batch = toTest.slice(i, i + BATCH);
    onProgress?.(`Тест ${i + 1}–${Math.min(i + BATCH, toTest.length)} из ${toTest.length}...`);

    const results = await Promise.all(
      batch.map(async (p) => {
        const ok = await testProxy(p.host, p.port);
        return ok ? p : null;
      })
    );

    const working = results.find(r => r !== null);
    if (working) {
      // Нашли — применяем окончательно
      await applyProxySettings(working.host, working.port);
      return working;
    }
  }

  // Если ничего не нашли — снимаем прокси
  await removeProxy();
  return null;
}

// ─── Запустить сессию ─────────────────────────────────────────────────────────
async function startSession() {
  await chrome.storage.local.set({ sessionActive: false, proxyStatus: "searching", statusMsg: "Загружаем прокси..." });

  const proxy = await findWorkingProxy((msg) => {
    chrome.storage.local.set({ statusMsg: msg });
    // Шлём попапу
    chrome.runtime.sendMessage({ type: "progress", msg }).catch(() => {});
  });

  if (!proxy) {
    await chrome.storage.local.set({ proxyStatus: "error", statusMsg: "Не найдено рабочих прокси" });
    return { success: false, error: "Не удалось найти рабочий прокси. Попробуйте ещё раз." };
  }

  const expiresAt = Date.now() + 60 * 60 * 1000;
  await chrome.storage.local.set({
    sessionActive: true,
    sessionStart: Date.now(),
    sessionExpires: expiresAt,
    activeProxy: `${proxy.host}:${proxy.port}`,
    proxyStatus: "ok",
    statusMsg: `Прокси: ${proxy.host}:${proxy.port}`
  });

  chrome.alarms.create("freepass_warn", { delayInMinutes: 55 });
  chrome.alarms.create("freepass_end",  { delayInMinutes: 60 });

  updateIcon(true);
  return { success: true, proxy: `${proxy.host}:${proxy.port}` };
}

// ─── Остановить сессию ────────────────────────────────────────────────────────
async function stopSession(reason = "manual") {
  await removeProxy();
  await chrome.storage.local.set({
    sessionActive: false,
    sessionExpires: null,
    activeProxy: null,
    proxyStatus: "off",
    statusMsg: "Отключено"
  });
  chrome.alarms.clearAll();
  updateIcon(false);

  if (reason === "expired") {
    chrome.notifications.create("freepass_expired", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "⏱ FreePass — сессия завершена",
      message: "60 минут истекли. Нажмите на значок расширения чтобы подключиться снова.",
      priority: 2
    });
  }
}

// ─── Иконка ───────────────────────────────────────────────────────────────────
function updateIcon(active) {
  const suffix = active ? "_active" : "";
  chrome.action.setIcon({
    path: {
      16:  `icons/icon16${suffix}.png`,
      48:  `icons/icon48${suffix}.png`,
      128: `icons/icon128${suffix}.png`
    }
  });
  chrome.action.setTitle({ title: active ? "FreePass — активен" : "FreePass" });
}

// ─── Alarms ───────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "freepass_warn") {
    chrome.notifications.create("freepass_warn", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "⏳ FreePass — осталось 5 минут",
      message: "Сессия завершится через 5 минут. Прокси отключится автоматически.",
      priority: 1
    });
  }
  if (alarm.name === "freepass_end") {
    await stopSession("expired");
  }
});

// ─── Сообщения от popup ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "start") {
    startSession().then(sendResponse);
    return true;
  }
  if (msg.action === "stop") {
    stopSession("manual").then(() => sendResponse({ success: true }));
    return true;
  }
  if (msg.action === "status") {
    chrome.storage.local.get(
      ["sessionActive", "sessionExpires", "activeProxy", "proxyStatus", "statusMsg"],
      sendResponse
    );
    return true;
  }
});

// ─── Восстановление после перезапуска браузера ────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get(["sessionActive", "sessionExpires", "activeProxy"]);
  if (data.sessionActive && data.sessionExpires && data.activeProxy) {
    const remaining = data.sessionExpires - Date.now();
    if (remaining > 30000) {
      const [host, port] = data.activeProxy.split(":");
      // Проверяем сохранённый прокси
      const still_ok = await testProxy(host, parseInt(port));
      if (still_ok) {
        await applyProxySettings(host, parseInt(port));
        const minLeft = Math.ceil(remaining / 60000);
        if (minLeft > 5) chrome.alarms.create("freepass_warn", { delayInMinutes: minLeft - 5 });
        chrome.alarms.create("freepass_end", { delayInMinutes: minLeft });
        updateIcon(true);
        return;
      }
      // Прокси умер — ищем новый
      await startSession();
    } else {
      await stopSession("expired");
    }
  }
});
