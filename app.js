const FIXED_USERNAME = "meandme";
const FIXED_PASSWORD = "nubKos-viwtan-1xyjte";
const AUTO_LOGOUT_MS = 15 * 60 * 1000;
const MAX_STORAGE_NUMBER = 500;
const SESSION_KEY = "paketlager_session_v11";
const STORAGE_KEY = "paketlager_packages_v11";

/* ================================
   AUDIO
================================ */

let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function tone(freq = 800, duration = 120, type = "sine", volume = 0.2, delay = 0) {
  try {
    const ctx = ensureAudio();
    const now = ctx.currentTime + delay / 1000;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration / 1000 + 0.02);
  } catch {}
}

function barcodeSound() {
  tone(1200, 70, "square", 0.18, 0);
  tone(1600, 70, "square", 0.18, 100);
}

function ocrSound() {
  tone(900, 120, "triangle", 0.18, 0);
}

function successSound() {
  tone(700, 140, "sine", 0.2, 0);
}

function errorSound() {
  tone(520, 140, "sawtooth", 0.2, 0);
  tone(390, 160, "sawtooth", 0.22, 120);
  tone(260, 220, "sawtooth", 0.24, 260);
}

/* ================================
   ELEMENTS
================================ */

const els = {
  loginScreen: document.getElementById("loginScreen"),
  appScreen: document.getElementById("appScreen"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  loginBtn: document.getElementById("loginBtn"),
  loginMsg: document.getElementById("loginMsg"),
  logoutBtn: document.getElementById("logoutBtn"),

  tabs: document.querySelectorAll(".tab-btn"),
  panels: document.querySelectorAll(".tab-panel"),

  statUsed: document.getElementById("statUsed"),
  statFree: document.getElementById("statFree"),

  scanAddressBtn: document.getElementById("scanAddressBtn"),
  packageImageInput: document.getElementById("packageImageInput"),

  startBarcodeBtn: document.getElementById("startBarcodeBtn"),
  stopBarcodeBtn: document.getElementById("stopBarcodeBtn"),
  scannerWrap: document.getElementById("scannerWrap"),

  statusStorage: document.getElementById("statusStorage"),
  statusBarcode: document.getElementById("statusBarcode"),
  statusAddress: document.getElementById("statusAddress"),
  statusReady: document.getElementById("statusReady"),

  currentStorageBig: document.getElementById("currentStorageBig"),
  showStorageOverlayBtn: document.getElementById("showStorageOverlayBtn"),

  storageOverlay: document.getElementById("storageOverlay"),
  overlayStorageNumber: document.getElementById("overlayStorageNumber"),
  overlayStorageMeta: document.getElementById("overlayStorageMeta"),
  closeStorageOverlayBtn: document.getElementById("closeStorageOverlayBtn"),

  trackingNumber: document.getElementById("trackingNumber"),
  ocrText: document.getElementById("ocrText"),
  firstName: document.getElementById("firstName"),
  lastName: document.getElementById("lastName"),
  street: document.getElementById("street"),
  houseNumber: document.getElementById("houseNumber"),
  postalCode: document.getElementById("postalCode"),
  city: document.getElementById("city"),
  storageNumber: document.getElementById("storageNumber"),
  notes: document.getElementById("notes"),

  saveBtn: document.getElementById("saveBtn"),
  saveAndZplBtn: document.getElementById("saveAndZplBtn"),
  clearBtn: document.getElementById("clearBtn"),
  acceptStatus: document.getElementById("acceptStatus"),

  searchInput: document.getElementById("searchInput"),
  searchBtn: document.getElementById("searchBtn"),
  showAllBtn: document.getElementById("showAllBtn"),
  searchStatus: document.getElementById("searchStatus"),
  results: document.getElementById("results"),

  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
  clearCollectedBtn: document.getElementById("clearCollectedBtn"),
  zplOutput: document.getElementById("zplOutput")
};

/* ================================
   STATE
================================ */

let packages = [];
let logoutTimer = null;
let html5Qr = null;
let scannerRunning = false;

/* ================================
   HELPERS
================================ */

function setStatus(el, text) {
  if (el) el.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(iso) {
  try {
    return new Date(iso).toLocaleString("de-DE");
  } catch {
    return iso || "";
  }
}

function generateId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/* ================================
   STORAGE
================================ */

function savePackages() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packages));
}

function loadPackages() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    packages = [];
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    packages = Array.isArray(parsed) ? parsed : [];
  } catch {
    packages = [];
  }
}

/* ================================
   SESSION
================================ */

function setSessionAuthenticated() {
  sessionStorage.setItem(SESSION_KEY, "1");
}

function isSessionAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

/* ================================
   LOGIN
================================ */

function showLogin() {
  els.loginScreen.classList.remove("hidden");
  els.appScreen.classList.add("hidden");
}

function showApp() {
  els.loginScreen.classList.add("hidden");
  els.appScreen.classList.remove("hidden");
}

function login() {
  const user = els.username.value.trim();
  const pass = els.password.value;

  if (user === FIXED_USERNAME && pass === FIXED_PASSWORD) {
    setSessionAuthenticated();
    els.password.value = "";
    showApp();
    resetLogoutTimer();
    setStatus(els.loginMsg, "Login erfolgreich.");
    return;
  }

  errorSound();
  setStatus(els.loginMsg, "Login falsch.");
}

function logout(message = "Abgemeldet.") {
  clearSession();
  stopBarcodeScan().catch(() => {});
  showLogin();
  setStatus(els.loginMsg, message);
}

/* ================================
   AUTO LOGOUT
================================ */

function resetLogoutTimer() {
  if (!isSessionAuthenticated()) return;

  clearTimeout(logoutTimer);
  logoutTimer = setTimeout(() => {
    logout("Automatisch wegen Inaktivität abgemeldet.");
  }, AUTO_LOGOUT_MS);
}

function bindActivityReset() {
  ["click", "keydown", "touchstart", "mousemove", "scroll"].forEach(eventName => {
    document.addEventListener(
      eventName,
      () => {
        resetLogoutTimer();
      },
      { passive: true }
    );
  });
}

/* ================================
   TABS
================================ */

function switchTab(name) {
  els.tabs.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });

  els.panels.forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== `tab-${name}`);
  });
}

/* ================================
   PACKAGES / STORAGE NUMBERS
================================ */

function getActivePackages() {
  return packages.filter(pkg => pkg.status !== "collected");
}

function getNextFreeStorageNumber() {
  const used = new Set(
    getActivePackages()
      .map(pkg => Number(pkg.storageNumber))
      .filter(num => Number.isInteger(num) && num >= 1 && num <= MAX_STORAGE_NUMBER)
  );

  for (let i = 1; i <= MAX_STORAGE_NUMBER; i++) {
    if (!used.has(i)) return i;
  }

  return null;
}

function ensureStorageNumber() {
  const existing = Number(els.storageNumber.value);
  if (Number.isInteger(existing) && existing >= 1 && existing <= MAX_STORAGE_NUMBER) {
    return existing;
  }

  const next = getNextFreeStorageNumber();
  if (!next) {
    throw new Error("Keine freie Lagernummer mehr verfügbar.");
  }

  els.storageNumber.value = String(next);
  return next;
}

function getFormData() {
  return {
    trackingNumber: els.trackingNumber.value.trim(),
    ocrText: els.ocrText.value,
    firstName: els.firstName.value.trim(),
    lastName: els.lastName.value.trim(),
    street: els.street.value.trim(),
    houseNumber: els.houseNumber.value.trim(),
    postalCode: els.postalCode.value.trim(),
    city: els.city.value.trim(),
    storageNumber: Number(els.storageNumber.value || 0),
    notes: els.notes.value.trim()
  };
}

function hasMeaningfulData() {
  return !!(
    els.trackingNumber.value.trim() ||
    els.firstName.value.trim() ||
    els.lastName.value.trim() ||
    els.street.value.trim() ||
    els.houseNumber.value.trim() ||
    els.postalCode.value.trim() ||
    els.city.value.trim() ||
    els.notes.value.trim() ||
    els.ocrText.value.trim()
  );
}

function clearAddressFieldsOnly() {
  els.firstName.value = "";
  els.lastName.value = "";
  els.street.value = "";
  els.houseNumber.value = "";
  els.postalCode.value = "";
  els.city.value = "";
}

function prepareNextPackageForm() {
  els.trackingNumber.value = "";
  els.ocrText.value = "";
  clearAddressFieldsOnly();
  els.notes.value = "";

  const next = getNextFreeStorageNumber();
  els.storageNumber.value = next ? String(next) : "";
  updateCompletionStatus();
  updateCurrentStorageDisplay();
}

function clearForm() {
  prepareNextPackageForm();
  els.zplOutput.value = "";
  setStatus(els.acceptStatus, "Formular geleert.");
}

/* ================================
   STATUS DISPLAY
================================ */

function setPill(el, text, mode) {
  el.textContent = text;
  el.classList.remove("ok", "warn", "bad");
  el.classList.add(mode);
}

function getAddressFilledCount() {
  const fields = [
    els.firstName.value.trim(),
    els.lastName.value.trim(),
    els.street.value.trim(),
    els.houseNumber.value.trim(),
    els.postalCode.value.trim(),
    els.city.value.trim()
  ];
  return fields.filter(Boolean).length;
}

function updateCurrentStorageDisplay() {
  els.currentStorageBig.textContent = els.storageNumber.value || "-";
}

function updateCompletionStatus() {
  const hasStorage = !!els.storageNumber.value.trim();
  const hasBarcode = !!els.trackingNumber.value.trim();
  const addressCount = getAddressFilledCount();
  const ready = hasStorage && hasMeaningfulData();

  setPill(
    els.statusStorage,
    hasStorage ? `Lagernummer ${els.storageNumber.value}` : "Lagernummer fehlt",
    hasStorage ? "ok" : "bad"
  );

  setPill(
    els.statusBarcode,
    hasBarcode ? "Barcode vorhanden" : "Barcode fehlt",
    hasBarcode ? "ok" : "warn"
  );

  if (addressCount >= 4) {
    setPill(els.statusAddress, `Adresse gut erkannt (${addressCount}/6)`, "ok");
  } else if (addressCount >= 1) {
    setPill(els.statusAddress, `Adresse teilweise (${addressCount}/6)`, "warn");
  } else {
    setPill(els.statusAddress, "Adresse fehlt", "bad");
  }

  setPill(
    els.statusReady,
    ready ? "Speicherbereit" : "Nicht speicherbereit",
    ready ? "ok" : "bad"
  );
}

/* ================================
   OCR
================================ */

function normalizeSpaces(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function looksLikeStreet(line) {
  return /(\bstraße\b|\bstrasse\b|\bweg\b|\ballee\b|\bgasse\b|\bplatz\b|\bring\b|\bufer\b|\bchaussee\b|\bdamm\b|\bstieg\b|\bpfad\b)/i.test(line)
    || /^([A-Za-zÄÖÜäöüß.\-]+(?:\s+[A-Za-zÄÖÜäöüß.\-]+)*)\s+\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?$/.test(line);
}

function parseAddressFromOCR(text) {
  const raw = normalizeSpaces(text);
  const lines = raw
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line =>
      line
        .replace(/[|]/g, "I")
        .replace(/[„“"]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    );

  let firstName = "";
  let lastName = "";
  let street = "";
  let houseNumber = "";
  let postalCode = "";
  let city = "";

  const ignoreLine = line =>
    /(dhl|dpd|gls|hermes|ups|fedex|sendung|paket|tracking|label|retoure|deutschland|frankiert|porto|zustellung|express|postfach)/i.test(line);

  const postalIndex = lines.findIndex(line => /\b\d{5}\b/.test(line));
  if (postalIndex >= 0) {
    const match = lines[postalIndex].match(/\b(\d{5})\b\s+(.+)$/);
    if (match) {
      postalCode = match[1].trim();
      city = match[2]
        .replace(/[^A-Za-zÄÖÜäöüß\- ]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
  }

  const streetIndex = lines.findIndex(line => looksLikeStreet(line) && !ignoreLine(line));
  if (streetIndex >= 0) {
    const cleanStreetLine = lines[streetIndex]
      .replace(/,\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    const streetMatch = cleanStreetLine.match(
      /^(.+?)\s+(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)$/
    );

    if (streetMatch) {
      street = streetMatch[1].trim();
      houseNumber = streetMatch[2].trim();
    } else {
      street = cleanStreetLine;
    }
  }

  let chosenNameLine = "";
  if (streetIndex > 0) {
    for (let i = streetIndex - 1; i >= 0; i--) {
      const line = lines[i];
      if (
        !ignoreLine(line) &&
        !/\d/.test(line) &&
        !looksLikeStreet(line) &&
        !/\b\d{5}\b/.test(line) &&
        /[A-Za-zÄÖÜäöüß]/.test(line)
      ) {
        chosenNameLine = line;
        break;
      }
    }
  }

  if (!chosenNameLine) {
    const fallback = lines.find(line =>
      !ignoreLine(line) &&
      !/\d/.test(line) &&
      !looksLikeStreet(line) &&
      !/\b\d{5}\b/.test(line) &&
      /^[A-Za-zÄÖÜäöüß\- ]{3,}$/.test(line)
    );
    chosenNameLine = fallback || "";
  }

  if (chosenNameLine) {
    const parts = chosenNameLine
      .replace(/[^A-Za-zÄÖÜäöüß\- ]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);

    if (parts.length >= 2) {
      firstName = parts.slice(0, -1).join(" ");
      lastName = parts[parts.length - 1];
    } else if (parts.length === 1) {
      lastName = parts[0];
    }
  }

  return { firstName, lastName, street, houseNumber, postalCode, city };
}

async function processAddressImage(file) {
  if (!file) return;

  if (typeof Tesseract === "undefined") {
    throw new Error("Tesseract wurde nicht geladen.");
  }

  setStatus(els.acceptStatus, "OCR läuft ...");

  clearAddressFieldsOnly();
  els.ocrText.value = "";
  updateCompletionStatus();

  const result = await Tesseract.recognize(file, "deu+eng", {
    logger: m => {
      if (m?.status === "recognizing text") {
        const pct = Math.round((m.progress || 0) * 100);
        setStatus(els.acceptStatus, `OCR läuft ... ${pct}%`);
      }
    }
  });

  const rawText = result?.data?.text || "";
  els.ocrText.value = rawText;

  const parsed = parseAddressFromOCR(rawText);

  els.firstName.value = parsed.firstName || "";
  els.lastName.value = parsed.lastName || "";
  els.street.value = parsed.street || "";
  els.houseNumber.value = parsed.houseNumber || "";
  els.postalCode.value = parsed.postalCode || "";
  els.city.value = parsed.city || "";

  const free = getNextFreeStorageNumber();
  els.storageNumber.value = free ? String(free) : "";

  ocrSound();
  updateCompletionStatus();
  updateCurrentStorageDisplay();

  setStatus(
    els.acceptStatus,
    `Adressscan abgeschlossen. Lagernummer ${els.storageNumber.value || "-"} gesetzt.`
  );
}

/* ================================
   BARCODE
================================ */

async function startBarcodeScan() {
  if (scannerRunning) return;

  if (typeof Html5Qrcode === "undefined") {
    throw new Error("Barcode-Scanner wurde nicht geladen.");
  }

  html5Qr = new Html5Qrcode("barcodeScanner");
  els.scannerWrap.classList.remove("hidden");

  await html5Qr.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 280, height: 180 } },
    decodedText => {
      els.trackingNumber.value = decodedText;
      barcodeSound();
      stopBarcodeScan().catch(() => {});

      if (!els.storageNumber.value) {
        const next = getNextFreeStorageNumber();
        els.storageNumber.value = next ? String(next) : "";
      }

      updateCompletionStatus();
      updateCurrentStorageDisplay();
      setStatus(els.acceptStatus, `Barcode erkannt: ${decodedText}`);
    },
    () => {}
  );

  scannerRunning = true;
}

async function stopBarcodeScan() {
  if (!html5Qr || !scannerRunning) {
    els.scannerWrap.classList.add("hidden");
    return;
  }

  await html5Qr.stop();
  await html5Qr.clear();
  scannerRunning = false;
  els.scannerWrap.classList.add("hidden");
}

/* ================================
   ZPL / OVERLAY
================================ */

function sanitizeZplText(value) {
  return String(value ?? "")
    .replace(/[\^~\\]/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function buildZPL(pkg) {
  const storage = sanitizeZplText(pkg.storageNumber || "");
  const house = sanitizeZplText(pkg.houseNumber || "");
  const name = sanitizeZplText([pkg.firstName || "", pkg.lastName || ""].join(" ").trim());

  return [
    "^XA",
    "^PW800",
    "^LL600",
    "^CF0,120",
    `^FO60,40^FD${storage}^FS`,
    "^CF0,70",
    `^FO60,220^FD${house}^FS`,
    "^CF0,60",
    `^FO60,320^FD${name}^FS`,
    "^XZ"
  ].join("\n");
}

function showStorageOverlay(storageNumber, meta = "") {
  els.overlayStorageNumber.textContent = storageNumber || "-";
  els.overlayStorageMeta.textContent = meta || "";
  els.storageOverlay.classList.remove("hidden");
}

function hideStorageOverlay() {
  els.storageOverlay.classList.add("hidden");
}

/* ================================
   SAVE / PRINT
================================ */

function saveCurrentPackage() {
  const storage = ensureStorageNumber();
  const data = getFormData();

  const pkg = {
    id: generateId(),
    ...data,
    storageNumber: storage,
    status: "stored",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    collectedAt: null
  };

  packages.push(pkg);
  savePackages();
  renderAll();
  els.zplOutput.value = buildZPL(pkg);

  return pkg;
}

function saveAndPrepare(showOverlayAfter = true) {
  if (!hasMeaningfulData()) {
    throw new Error("Keine Daten zum Speichern vorhanden.");
  }

  const pkg = saveCurrentPackage();
  successSound();

  if (showOverlayAfter) {
    const meta = [pkg.firstName, pkg.lastName].filter(Boolean).join(" ").trim() || "Paket gespeichert";
    showStorageOverlay(String(pkg.storageNumber), meta);
  }

  prepareNextPackageForm();
  setStatus(els.acceptStatus, `Paket gespeichert. Lagernummer ${pkg.storageNumber}.`);

  return pkg;
}

function saveAndGenerateZpl() {
  const pkg = saveAndPrepare(true);
  els.zplOutput.value = buildZPL(pkg);
  switchTab("einstellungen");
  setStatus(els.acceptStatus, `Paket gespeichert + ZPL erzeugt. Lagernummer ${pkg.storageNumber}.`);
}

/* ================================
   RENDER
================================ */

function renderStats() {
  const used = getActivePackages().length;
  els.statUsed.textContent = String(used);
  els.statFree.textContent = String(MAX_STORAGE_NUMBER - used);
}

function renderPackages(list) {
  if (!list.length) {
    els.results.innerHTML = `<div class="status">Keine Pakete gefunden.</div>`;
    return;
  }

  els.results.innerHTML = list
    .map(pkg => {
      const fullName = [pkg.firstName, pkg.lastName].filter(Boolean).join(" ").trim() || "-";
      const address1 = [pkg.street, pkg.houseNumber].filter(Boolean).join(" ").trim() || "-";
      const address2 = [pkg.postalCode, pkg.city].filter(Boolean).join(" ").trim() || "-";
      const statusText = pkg.status === "collected" ? "Abgeholt" : "Eingelagert";

      return `
        <div class="package">
          <h3>Lagernummer ${escapeHtml(pkg.storageNumber || "-")}</h3>
          <div class="package-meta">
            ${escapeHtml(statusText)} · Eingang: ${escapeHtml(formatDateTime(pkg.createdAt))}
          </div>
          <div><strong>Name:</strong> ${escapeHtml(fullName)}</div>
          <div><strong>Adresse:</strong> ${escapeHtml(address1)}</div>
          <div><strong>PLZ / Ort:</strong> ${escapeHtml(address2)}</div>
          <div><strong>Paketnummer:</strong> ${escapeHtml(pkg.trackingNumber || "-")}</div>
          <div><strong>Notiz:</strong> ${escapeHtml(pkg.notes || "-")}</div>

          <div class="package-actions">
            <button onclick="fillFormById('${pkg.id}')">In Formular laden</button>
            <button onclick="printPackageById('${pkg.id}')">ZPL</button>
            <button onclick="showStorageNumberById('${pkg.id}')">Lagernummer groß</button>
            ${pkg.status !== "collected"
              ? `<button onclick="markCollectedById('${pkg.id}')">Abgeholt</button>`
              : ""}
            <button onclick="removePackageById('${pkg.id}')">Löschen</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAll() {
  renderStats();
  const all = [...packages].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  renderPackages(all);
  setStatus(els.searchStatus, `${all.length} Paket(e) geladen.`);
}

/* ================================
   SEARCH / BACKUP
================================ */

function searchPackages() {
  const queryText = els.searchInput.value.trim().toLowerCase();

  const filtered = packages.filter(pkg => {
    if (!queryText) return true;

    const fullName = [pkg.firstName, pkg.lastName].filter(Boolean).join(" ").toLowerCase();
    const fullAddress = [pkg.street, pkg.houseNumber, pkg.postalCode, pkg.city]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return [
      pkg.firstName,
      pkg.lastName,
      fullName,
      pkg.street,
      pkg.houseNumber,
      pkg.postalCode,
      pkg.city,
      fullAddress,
      String(pkg.storageNumber || ""),
      pkg.notes,
      pkg.trackingNumber,
      pkg.status
    ].some(v => String(v || "").toLowerCase().includes(queryText));
  });

  renderPackages(filtered);
  setStatus(els.searchStatus, `${filtered.length} Paket(e) gefunden.`);
}

function exportBackup() {
  const payload = {
    exportedAt: nowIso(),
    packages
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `paketlager_backup_${new Date().toISOString().replaceAll(":", "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  const reader = new FileReader();

  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      packages = Array.isArray(parsed?.packages) ? parsed.packages : [];
      savePackages();
      renderAll();
      prepareNextPackageForm();
      setStatus(els.searchStatus, `${packages.length} Paket(e) importiert.`);
    } catch {
      errorSound();
      setStatus(els.searchStatus, "Import fehlgeschlagen.");
    }
  };

  reader.readAsText(file);
}

function clearCollectedPackages() {
  packages = packages.filter(pkg => pkg.status !== "collected");
  savePackages();
  renderAll();
  prepareNextPackageForm();
  setStatus(els.searchStatus, "Abgeholte Pakete gelöscht.");
}

/* ================================
   PACKAGE ACTIONS
================================ */

function fillFormById(id) {
  const pkg = packages.find(x => x.id === id);
  if (!pkg) return;

  els.trackingNumber.value = pkg.trackingNumber || "";
  els.ocrText.value = pkg.ocrText || "";
  els.firstName.value = pkg.firstName || "";
  els.lastName.value = pkg.lastName || "";
  els.street.value = pkg.street || "";
  els.houseNumber.value = pkg.houseNumber || "";
  els.postalCode.value = pkg.postalCode || "";
  els.city.value = pkg.city || "";
  els.storageNumber.value = String(pkg.storageNumber || "");
  els.notes.value = pkg.notes || "";
  els.zplOutput.value = buildZPL(pkg);

  updateCompletionStatus();
  updateCurrentStorageDisplay();
  switchTab("annahme");
}

function printPackageById(id) {
  const pkg = packages.find(x => x.id === id);
  if (!pkg) return;

  els.zplOutput.value = buildZPL(pkg);
  switchTab("einstellungen");
}

function showStorageNumberById(id) {
  const pkg = packages.find(x => x.id === id);
  if (!pkg) return;

  const meta = [pkg.firstName, pkg.lastName].filter(Boolean).join(" ").trim() || "";
  showStorageOverlay(String(pkg.storageNumber || "-"), meta);
}

function markCollectedById(id) {
  const pkg = packages.find(x => x.id === id);
  if (!pkg) return;

  pkg.status = "collected";
  pkg.collectedAt = nowIso();
  pkg.updatedAt = nowIso();

  savePackages();
  renderAll();
  prepareNextPackageForm();
  setStatus(els.searchStatus, `Paket abgeholt. Lagernummer ${pkg.storageNumber} ist wieder frei.`);
}

function removePackageById(id) {
  packages = packages.filter(x => x.id !== id);
  savePackages();
  renderAll();
  prepareNextPackageForm();
  setStatus(els.searchStatus, "Paket gelöscht.");
}

window.fillFormById = fillFormById;
window.printPackageById = printPackageById;
window.showStorageNumberById = showStorageNumberById;
window.markCollectedById = markCollectedById;
window.removePackageById = removePackageById;

/* ================================
   EVENTS
================================ */

function bindCompletionInputs() {
  [
    els.trackingNumber,
    els.firstName,
    els.lastName,
    els.street,
    els.houseNumber,
    els.postalCode,
    els.city,
    els.storageNumber,
    els.notes,
    els.ocrText
  ].forEach(el => {
    el.addEventListener("input", () => {
      updateCompletionStatus();
      updateCurrentStorageDisplay();
    });
    el.addEventListener("change", () => {
      updateCompletionStatus();
      updateCurrentStorageDisplay();
    });
  });
}

function bindEvents() {
  els.loginBtn.addEventListener("click", login);
  els.password.addEventListener("keydown", event => {
    if (event.key === "Enter") login();
  });

  els.logoutBtn.addEventListener("click", () => logout("Abgemeldet."));

  els.tabs.forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  els.scanAddressBtn.addEventListener("click", () => els.packageImageInput.click());

  els.packageImageInput.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await processAddressImage(file);
    } catch (error) {
      errorSound();
      setStatus(els.acceptStatus, `OCR-Fehler: ${error.message || error}`);
    } finally {
      event.target.value = "";
    }
  });

  els.startBarcodeBtn.addEventListener("click", async () => {
    try {
      await startBarcodeScan();
      setStatus(els.acceptStatus, "Barcode-Scanner gestartet.");
    } catch (error) {
      errorSound();
      setStatus(els.acceptStatus, `Scanner-Fehler: ${error.message || error}`);
    }
  });

  els.stopBarcodeBtn.addEventListener("click", async () => {
    try {
      await stopBarcodeScan();
      setStatus(els.acceptStatus, "Barcode-Scanner gestoppt.");
    } catch (error) {
      errorSound();
      setStatus(els.acceptStatus, `Scanner-Fehler: ${error.message || error}`);
    }
  });

  els.saveBtn.addEventListener("click", () => {
    try {
      const pkg = saveAndPrepare(true);
      setStatus(els.acceptStatus, `Paket gespeichert. Lagernummer ${pkg.storageNumber}.`);
    } catch (error) {
      errorSound();
      setStatus(els.acceptStatus, `Speicher-Fehler: ${error.message || error}`);
    }
  });

  els.saveAndZplBtn.addEventListener("click", () => {
    try {
      saveAndGenerateZpl();
    } catch (error) {
      errorSound();
      setStatus(els.acceptStatus, `ZPL-Fehler: ${error.message || error}`);
    }
  });

  els.clearBtn.addEventListener("click", clearForm);

  els.showStorageOverlayBtn.addEventListener("click", () => {
    showStorageOverlay(
      els.storageNumber.value || "-",
      [els.firstName.value, els.lastName.value].filter(Boolean).join(" ").trim()
    );
  });

  els.closeStorageOverlayBtn.addEventListener("click", hideStorageOverlay);
  els.storageOverlay.addEventListener("click", event => {
    if (event.target === els.storageOverlay) {
      hideStorageOverlay();
    }
  });

  els.searchBtn.addEventListener("click", searchPackages);
  els.showAllBtn.addEventListener("click", renderAll);

  els.exportBtn.addEventListener("click", exportBackup);
  els.importBtn.addEventListener("click", () => els.importFile.click());

  els.importFile.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (!file) return;
    importBackup(file);
    event.target.value = "";
  });

  els.clearCollectedBtn.addEventListener("click", clearCollectedPackages);

  bindCompletionInputs();
}

/* ================================
   INIT
================================ */

function init() {
  bindEvents();
  bindActivityReset();
  loadPackages();

  els.username.value = FIXED_USERNAME;

  if (isSessionAuthenticated()) {
    showApp();
    resetLogoutTimer();
  } else {
    showLogin();
  }

  renderAll();
  prepareNextPackageForm();
  setStatus(els.acceptStatus, "App bereit.");
  updateCompletionStatus();
  updateCurrentStorageDisplay();
}

init();
