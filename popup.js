// FreePass v2 — popup.js

const btn       = document.getElementById("btn");
const btnIco    = document.getElementById("btnIco");
const btnTxt    = document.getElementById("btnTxt");
const dot       = document.getElementById("dot");
const cardLabel = document.getElementById("cardLabel");
const cardSub   = document.getElementById("cardSub");
const ringWrap  = document.getElementById("ringWrap");
const ringFill  = document.getElementById("ringFill");
const ringTxt   = document.getElementById("ringTxt");
const logWrap   = document.getElementById("logWrap");
const logInner  = document.getElementById("logInner");
const pdot      = document.getElementById("pdot");
const proxyTxt  = document.getElementById("proxyTxt");

const C = 2 * Math.PI * 21; // circumference ≈ 131.9
const TOTAL = 3600;

let ticker = null;
let isSearching = false;

// ─── Таймер ───────────────────────────────────────────────────────────────────
function updateRing(secsLeft) {
  const p = secsLeft / TOTAL;
  ringFill.style.strokeDasharray  = C;
  ringFill.style.strokeDashoffset = C * (1 - p);
  ringFill.style.stroke = secsLeft > 600 ? "#4f8ef7" : secsLeft > 300 ? "#f59e0b" : "#ef4444";
  const m = Math.floor(secsLeft / 60), s = secsLeft % 60;
  ringTxt.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function startTicker(expiresAt) {
  clearInterval(ticker);
  ticker = setInterval(() => {
    const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    updateRing(left);
    if (left === 0) { clearInterval(ticker); setIdle(); }
  }, 1000);
  updateRing(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
}

// ─── Состояния ────────────────────────────────────────────────────────────────
function setIdle() {
  clearInterval(ticker); isSearching = false;
  dot.className = "dot";
  cardLabel.textContent = "Не подключено";
  cardSub.textContent   = "Нажмите кнопку ниже";
  ringWrap.classList.add("hidden");
  logWrap.classList.remove("open");
  btn.className = "btn btn-connect"; btn.disabled = false;
  btnIco.innerHTML = "⚡"; btnTxt.textContent = "Подключиться";
  pdot.className = "pdot"; proxyTxt.textContent = "Прокси не выбран";
}

function setSearching() {
  isSearching = true;
  dot.className = "dot searching";
  cardLabel.textContent = "Поиск прокси...";
  cardSub.textContent   = "Тестируем серверы";
  ringWrap.classList.add("hidden");
  logWrap.classList.add("open");
  logInner.innerHTML = "";
  btn.className = "btn btn-connect"; btn.disabled = true;
  btnIco.innerHTML = '<div class="spin"></div>';
  btnTxt.textContent = "Подключение...";
  pdot.className = "pdot"; proxyTxt.textContent = "Ищем рабочий прокси...";
}

function setActive(expiresAt, proxyAddr) {
  isSearching = false;
  dot.className = "dot on";
  cardLabel.textContent = "Подключено";
  cardSub.textContent   = "Прокси активен · трафик роутится";
  ringWrap.classList.remove("hidden");
  logWrap.classList.remove("open");
  btn.className = "btn btn-disconnect"; btn.disabled = false;
  btnIco.innerHTML = "⛔"; btnTxt.textContent = "Отключить";
  pdot.className = "pdot on";
  proxyTxt.textContent = proxyAddr ? `Прокси: ${proxyAddr}` : "PAC-прокси активен";
  startTicker(expiresAt);
}

function setError(msg) {
  isSearching = false;
  dot.className = "dot err";
  cardLabel.textContent = "Ошибка";
  cardSub.textContent   = msg || "Попробуйте ещё раз";
  ringWrap.classList.add("hidden");
  btn.className = "btn btn-connect"; btn.disabled = false;
  btnIco.innerHTML = "🔄"; btnTxt.textContent = "Попробовать снова";
}

// ─── Лог прогресса ───────────────────────────────────────────────────────────
function addLog(msg, ok = false) {
  // обновляем последнюю строку если она похожа
  const items = logInner.querySelectorAll(".log-item");
  const last = items[items.length - 1];
  if (last && !last.classList.contains("ok") && items.length >= 4) {
    last.textContent = msg;
    if (ok) last.className = "log-item ok";
    return;
  }
  const el = document.createElement("div");
  el.className = "log-item" + (ok ? " ok" : "");
  el.textContent = msg;
  logInner.appendChild(el);
  // авто-скролл
  el.scrollIntoView({ behavior: "smooth" });
  // ограничиваем 6 строк
  const all = logInner.querySelectorAll(".log-item");
  if (all.length > 6) all[0].remove();
  // обновляем cardSub
  cardSub.textContent = msg;
}

// ─── Слушаем прогресс от background ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "progress" && isSearching) {
    addLog(msg.msg);
  }
});

// ─── Кнопка ───────────────────────────────────────────────────────────────────
btn.addEventListener("click", () => {
  if (btn.disabled) return;

  chrome.runtime.sendMessage({ action: "status" }, (res) => {
    if (res?.sessionActive) {
      // Отключить
      btn.disabled = true;
      btnIco.innerHTML = '<div class="spin"></div>';
      btnTxt.textContent = "Отключение...";
      chrome.runtime.sendMessage({ action: "stop" }, () => setIdle());
    } else {
      // Подключить
      setSearching();
      chrome.runtime.sendMessage({ action: "start" }, (resp) => {
        if (resp?.success) {
          chrome.runtime.sendMessage({ action: "status" }, (st) => {
            if (st?.sessionActive && st?.sessionExpires) {
              addLog(`Найден: ${st.activeProxy}`, true);
              setTimeout(() => setActive(st.sessionExpires, st.activeProxy), 400);
            }
          });
        } else {
          setError(resp?.error || "Попробуйте ещё раз");
          addLog("❌ " + (resp?.error || "Все источники недоступны"));
        }
      });
    }
  });
});

// ─── Инициализация ────────────────────────────────────────────────────────────
function init() {
  chrome.runtime.sendMessage({ action: "status" }, (res) => {
    if (chrome.runtime.lastError) { setIdle(); return; }
    if (res?.sessionActive && res?.sessionExpires) {
      setActive(res.sessionExpires, res.activeProxy);
    } else if (res?.proxyStatus === "searching") {
      setSearching();
      if (res.statusMsg) addLog(res.statusMsg);
    } else {
      setIdle();
    }
  });
}

init();
