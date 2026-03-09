const FIXED_USERNAME = "meandme";
const FIXED_PASSWORD = "nubKos-viwtan-1xyjte";
const AUTO_LOGOUT_MS = 15 * 60 * 1000;
const MAX_STORAGE_NUMBER = 500;
const SESSION_KEY = "paketlager_session_v5";
const STORAGE_KEY = "paketlager_packages_v5";

const els = {
  loginScreen: document.getElementById("loginScreen"),
  appScreen: document.getElementById("appScreen"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  loginBtn: document.getElementById("loginBtn"),
  loginMsg: document.getElementById("loginMsg"),
  logoutBtn: document.getElementById("logoutBtn"),

  statUsed: document.getElementById("statUsed"),
  statFree: document.getElementById("statFree"),

  tabs: document.querySelectorAll(".tab-btn"),
  panels: document.querySelectorAll(".tab-panel"),

  scanAddressBtn: document.getElementById("scanAddressBtn"),
  startBarcodeBtn: document.getElementById("startBarcodeBtn"),
  stopBarcodeBtn: document.getElementById("stopBarcodeBtn"),
  packageImageInput: document.getElementById("packageImageInput"),
  scannerWrap: document.getElementById("scannerWrap"),

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
  printBtn: document.getElementById("printBtn"),
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

let packages = [];
let logoutTimer = null;
let scannerRunning = false;
let html5Qr = null;

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

function setSessionAuthenticated() {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ user: FIXED_USERNAME, loginAt: Date.now() })
  );
}

function isSessionAuthenticated() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    return parsed?.user === FIXED_USERNAME;
  } catch {
    return false;
  }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function showLogin() {
  els.loginScreen.classList.remove("hidden");
  els.appScreen.classList.add("hidden");
}

function showApp() {
  els.loginScreen.classList.add("hidden");
  els.appScreen.classList.remove("hidden");
}

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

  setStatus(els.loginMsg, "Login falsch.");
}

function logout(message = "Abgemeldet.") {
  clearSession();
  stopBarcodeScan().catch(() => {});
  showLogin();
  setStatus(els.loginMsg, message);
}

function switchTab(name) {
  els.tabs.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });

  els.panels.forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== `tab-${name}`);
  });
}

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

function prepareNextPackageForm() {
  els.trackingNumber.value = "";
  els.ocrText.value = "";
  els.firstName.value = "";
  els.lastName.value = "";
  els.street.value = "";
  els.houseNumber.value = "";
  els.postalCode.value = "";
  els.city.value = "";
  els.notes.value = "";

  const next = getNextFreeStorageNumber();
  els.storageNumber.value = next ? String(next) : "";
}

function clearForm() {
  prepareNextPackageForm();
  els.zplOutput.value = "";
  setStatus(els.acceptStatus, "Formular geleert.");
}

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
      city = match[2].replace(/[^A-Za-zÄÖÜäöüß\- ]/g, " ").replace(/\s{2,}/g, " ").trim();
    }
  }

  const streetIndex = lines.findIndex(line => looksLikeStreet(line) && !ignoreLine(line));
  if (streetIndex >= 0) {
    const cleanStreetLine = lines[streetIndex].replace(/,\s*/g, " ").replace(/\s{2,}/g, " ").trim();
    const streetMatch = cleanStreetLine.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)$/);
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
  els.firstName.value = parsed.firstName || els.firstName.value;
  els.lastName.value = parsed.lastName || els.lastName.value;
  els.street.value = parsed.street || els.street.value;
  els.houseNumber.value = parsed.houseNumber || els.houseNumber.value;
  els.postalCode.value = parsed.postalCode || els.postalCode.value;
  els.city.value = parsed.city || els.city.value;

  const free = getNextFreeStorageNumber();
  els.storageNumber.value = free ? String(free) : "";

  setStatus(
    els.acceptStatus,
    `OCR abgeschlossen. Lagernummer ${els.storageNumber.value || "-"} gesetzt.`
  );
}

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
      setStatus(els.acceptStatus, `Barcode erkannt: ${decodedText}`);
      stopBarcodeScan().catch(() => {});
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
  setStatus(els.acceptStatus, `Paket gespeichert. Lagernummer ${storage}.`);

  prepareNextPackageForm();
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

  switchTab("annahme");
}

function printPackageById(id) {
  const pkg = packages.find(x => x.id === id);
  if (!pkg) return;

  els.zplOutput.value = buildZPL(pkg);
  switchTab("einstellungen");
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
window.markCollectedById = markCollectedById;
window.removePackageById = removePackageById;

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
      setStatus(els.acceptStatus, `Scanner-Fehler: ${error.message || error}`);
    }
  });

  els.stopBarcodeBtn.addEventListener("click", async () => {
    try {
      await stopBarcodeScan();
      setStatus(els.acceptStatus, "Barcode-Scanner gestoppt.");
    } catch (error) {
      setStatus(els.acceptStatus, `Scanner-Fehler: ${error.message || error}`);
    }
  });

  els.saveBtn.addEventListener("click", () => {
    try {
      saveCurrentPackage();
    } catch (error) {
      setStatus(els.acceptStatus, `Speicher-Fehler: ${error.message || error}`);
    }
  });

  els.printBtn.addEventListener("click", () => {
    try {
      const storage = ensureStorageNumber();
      const data = getFormData();
      els.zplOutput.value = buildZPL({ ...data, storageNumber: storage });
      switchTab("einstellungen");
      setStatus(els.acceptStatus, `ZPL für Lagernummer ${storage} erzeugt.`);
      prepareNextPackageForm();
    } catch (error) {
      setStatus(els.acceptStatus, `ZPL-Fehler: ${error.message || error}`);
    }
  });

  els.clearBtn.addEventListener("click", clearForm);
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
}

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
}

init();
