const DB_NAME = "lagerwirtschaft_db";
const DB_VERSION = 2;
const STORE_PACKAGES = "packages";
const STORE_BACKUPS = "backups";

const FIXED_USERNAME = "meandme";
const FIXED_PASSWORD = "nubKos-viwtan-1xyjte";

const AUTH_SESSION_KEY = "lager_auth_session_v2";
const DRAFT_STORAGE_KEY = "lagerwirtschaft_draft_v2";
const AUTO_LOCK_MS = 15 * 60 * 1000;
const MAX_STORAGE_NUMBER = 500;

let db = null;
let currentImageDataUrl = "";
let inactivityTimer = null;

const els = {
  tabs: document.querySelectorAll(".tab-btn"),
  panels: document.querySelectorAll(".tab-panel"),

  packageImageInput: document.getElementById("packageImageInput"),
  newPackageBtn: document.getElementById("newPackageBtn"),

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
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
  searchStatus: document.getElementById("searchStatus"),
  results: document.getElementById("results"),

  forceBackupBtn: document.getElementById("forceBackupBtn"),
  restoreBackupBtn: document.getElementById("restoreBackupBtn"),
  deleteAllBtn: document.getElementById("deleteAllBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  zplOutput: document.getElementById("zplOutput"),

  printLabel: document.getElementById("printLabel"),

  authScreen: document.getElementById("authScreen"),
  authUsername: document.getElementById("authUsername"),
  authPassword: document.getElementById("authPassword"),
  authLoginBtn: document.getElementById("authLoginBtn"),
  authStatus: document.getElementById("authStatus")
};

function setStatus(el, message) {
  if (el) el.textContent = message;
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

function sanitizeZplText(value) {
  return String(value ?? "")
    .replace(/[\^~\\]/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function switchTab(tabName) {
  els.tabs.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  els.panels.forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== `tab-${tabName}`);
  });
}

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_PACKAGES)) {
        const store = database.createObjectStore(STORE_PACKAGES, { keyPath: "id" });
        store.createIndex("storageNumber", "storageNumber", { unique: false });
        store.createIndex("lastName", "lastName", { unique: false });
        store.createIndex("postalCode", "postalCode", { unique: false });
        store.createIndex("city", "city", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (!database.objectStoreNames.contains(STORE_BACKUPS)) {
        database.createObjectStore(STORE_BACKUPS, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

async function addPackage(pkg) {
  return new Promise((resolve, reject) => {
    const request = tx(STORE_PACKAGES, "readwrite").add(pkg);
    request.onsuccess = () => resolve(pkg);
    request.onerror = () => reject(request.error);
  });
}

async function putPackage(pkg) {
  return new Promise((resolve, reject) => {
    const request = tx(STORE_PACKAGES, "readwrite").put(pkg);
    request.onsuccess = () => resolve(pkg);
    request.onerror = () => reject(request.error);
  });
}

async function getAllPackages() {
  return new Promise((resolve, reject) => {
    const request = tx(STORE_PACKAGES).getAll();
    request.onsuccess = () => {
      const items = Array.isArray(request.result) ? request.result : [];
      items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getActivePackages() {
  const all = await getAllPackages();
  return all.filter(pkg => pkg.status !== "collected");
}

async function deletePackage(id) {
  return new Promise((resolve, reject) => {
    const request = tx(STORE_PACKAGES, "readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function clearPackages() {
  return new Promise((resolve, reject) => {
    const request = tx(STORE_PACKAGES, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getAllBackups() {
  return new Promise((resolve, reject) => {
    const request = tx(STORE_BACKUPS).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deleteBackup(id) {
  return new Promise((resolve, reject) => {
    const request = tx(STORE_BACKUPS, "readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function saveInternalBackup(reason = "auto") {
  const packages = await getAllPackages();
  const backup = {
    id: `backup_${Date.now()}`,
    createdAt: nowIso(),
    reason,
    packages
  };

  await new Promise((resolve, reject) => {
    const request = tx(STORE_BACKUPS, "readwrite").put(backup);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  localStorage.setItem("lagerwirtschaft_latest_backup_v2", JSON.stringify(backup));

  const allBackups = await getAllBackups();
  const sorted = allBackups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const keep = 24;

  for (let i = keep; i < sorted.length; i++) {
    await deleteBackup(sorted[i].id);
  }

  return backup;
}

async function getLatestInternalBackup() {
  const backups = await getAllBackups();
  backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (backups.length > 0) {
    return backups[0];
  }

  const local = localStorage.getItem("lagerwirtschaft_latest_backup_v2");
  if (!local) return null;

  try {
    return JSON.parse(local);
  } catch {
    return null;
  }
}

async function restoreBackupData(backup) {
  if (!backup || !Array.isArray(backup.packages)) {
    throw new Error("Ungültiges Backup.");
  }

  await clearPackages();

  for (const pkg of backup.packages) {
    await putPackage(pkg);
  }

  await saveInternalBackup("restore");
}

function setSessionAuthenticated() {
  sessionStorage.setItem(
    AUTH_SESSION_KEY,
    JSON.stringify({
      username: FIXED_USERNAME,
      loginAt: Date.now()
    })
  );
}

function clearSessionAuthenticated() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

function isSessionAuthenticated() {
  const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) return false;

  try {
    const session = JSON.parse(raw);
    return session?.username === FIXED_USERNAME;
  } catch {
    return false;
  }
}

function showAuthScreen() {
  document.body.classList.add("locked");
  els.authScreen.classList.remove("hidden");
}

function hideAuthScreen() {
  document.body.classList.remove("locked");
  els.authScreen.classList.add("hidden");
}

async function loginAuth() {
  const username = els.authUsername.value.trim();
  const password = els.authPassword.value;

  if (username !== FIXED_USERNAME || password !== FIXED_PASSWORD) {
    throw new Error("Benutzername oder Passwort ist falsch.");
  }

  setSessionAuthenticated();
  hideAuthScreen();
  els.authPassword.value = "";
  resetInactivityTimer();
}

function forceLock(reason = "Sitzung gesperrt.") {
  clearSessionAuthenticated();

  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  showAuthScreen();
  setStatus(els.authStatus, reason);
}

function logoutAuth() {
  forceLock("Abgemeldet.");
}

function resetInactivityTimer() {
  if (!isSessionAuthenticated()) return;

  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }

  inactivityTimer = setTimeout(() => {
    forceLock("Sitzung wegen Inaktivität gesperrt.");
  }, AUTO_LOCK_MS);
}

function bindActivityEvents() {
  ["click", "keydown", "touchstart", "mousemove", "scroll"].forEach(eventName => {
    document.addEventListener(
      eventName,
      () => {
        resetInactivityTimer();
      },
      { passive: true }
    );
  });
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseAddressFromOCR(text) {
  const cleanText = String(text || "");
  const lines = cleanText
    .split(/\r?\n/)
    .map(line => normalizeSpaces(line))
    .filter(Boolean);

  let firstName = "";
  let lastName = "";
  let street = "";
  let houseNumber = "";
  let postalCode = "";
  let city = "";

  const postalLine = lines.find(line => /\b\d{5}\b/.test(line));
  if (postalLine) {
    const plzOrtMatch = postalLine.match(/\b(\d{5})\s+(.+)$/);
    if (plzOrtMatch) {
      postalCode = normalizeSpaces(plzOrtMatch[1]);
      city = normalizeSpaces(plzOrtMatch[2]);
    }
  }

  const streetLine = lines.find(line =>
    /\b\d+[a-zA-Z\-\/]?\b/.test(line) &&
    /(straße|strasse|weg|allee|gasse|platz|ring|ufer|chaussee|damm|stieg|pfad)\b/i.test(line)
  );

  if (streetLine) {
    const streetMatch = streetLine.match(/^(.+?)\s+(\d+[a-zA-Z\-\/]*)$/);
    if (streetMatch) {
      street = normalizeSpaces(streetMatch[1]);
      houseNumber = normalizeSpaces(streetMatch[2]);
    } else {
      street = streetLine;
    }
  }

  const skipPatterns = /(dhl|dpd|gls|hermes|ups|fedex|paket|sendung|tracking|label|retoure|deutschland)/i;
  const possibleNameLine = lines.find(line =>
    !skipPatterns.test(line) &&
    !/\b\d{5}\b/.test(line) &&
    !/(straße|strasse|weg|allee|gasse|platz|ring|ufer|chaussee|damm|stieg|pfad)\b/i.test(line) &&
    /^[A-Za-zÄÖÜäöüß\- ]{3,}$/.test(line)
  );

  if (possibleNameLine) {
    const parts = possibleNameLine.split(" ").filter(Boolean);
    if (parts.length >= 2) {
      firstName = parts.slice(0, -1).join(" ");
      lastName = parts.slice(-1).join(" ");
    } else {
      lastName = possibleNameLine;
    }
  }

  return {
    firstName,
    lastName,
    street,
    houseNumber,
    postalCode,
    city
  };
}

async function getNextFreeStorageNumber() {
  const activePackages = await getActivePackages();
  const usedNumbers = new Set(
    activePackages
      .map(pkg => Number(pkg.storageNumber))
      .filter(num => Number.isInteger(num) && num >= 1 && num <= MAX_STORAGE_NUMBER)
  );

  for (let i = 1; i <= MAX_STORAGE_NUMBER; i++) {
    if (!usedNumbers.has(i)) {
      return i;
    }
  }

  throw new Error("Keine freie Lagernummer mehr verfügbar (1-500 belegt).");
}

async function processNewPackageImage(file) {
  if (!file) {
    throw new Error("Kein Bild ausgewählt.");
  }

  if (typeof Tesseract === "undefined") {
    throw new Error("Tesseract wurde nicht geladen.");
  }

  setStatus(els.acceptStatus, "Bild wird verarbeitet ...");
  currentImageDataUrl = await fileToDataUrl(file);

  setStatus(els.acceptStatus, "OCR läuft ... bitte warten.");
  const result = await Tesseract.recognize(currentImageDataUrl, "deu+eng");
  const text = normalizeSpaces(result?.data?.text || "");
  els.ocrText.value = result?.data?.text || "";

  const parsed = parseAddressFromOCR(result?.data?.text || "");

  if (!els.firstName.value) els.firstName.value = parsed.firstName;
  if (!els.lastName.value) els.lastName.value = parsed.lastName;
  if (!els.street.value) els.street.value = parsed.street;
  if (!els.houseNumber.value) els.houseNumber.value = parsed.houseNumber;
  if (!els.postalCode.value) els.postalCode.value = parsed.postalCode;
  if (!els.city.value) els.city.value = parsed.city;

  const freeStorageNumber = await getNextFreeStorageNumber();
  els.storageNumber.value = String(freeStorageNumber);

  saveDraft();
  setStatus(els.acceptStatus, "Bild eingelesen. Daten und freie Lagernummer übernommen.");
}

function getFormData() {
  return {
    firstName: els.firstName.value.trim(),
    lastName: els.lastName.value.trim(),
    street: els.street.value.trim(),
    houseNumber: els.houseNumber.value.trim(),
    postalCode: els.postalCode.value.trim(),
    city: els.city.value.trim(),
    storageNumber: els.storageNumber.value.trim(),
    notes: els.notes.value.trim(),
    ocrText: els.ocrText.value.trim(),
    imageDataUrl: currentImageDataUrl || ""
  };
}

function clearForm() {
  els.firstName.value = "";
  els.lastName.value = "";
  els.street.value = "";
  els.houseNumber.value = "";
  els.postalCode.value = "";
  els.city.value = "";
  els.storageNumber.value = "";
  els.notes.value = "";
  els.ocrText.value = "";
  currentImageDataUrl = "";
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  setStatus(els.acceptStatus, "Formular geleert.");
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(getFormData()));
  } catch {}
}

async function restoreDraft() {
  const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!raw) return;

  try {
    const draft = JSON.parse(raw);
    els.firstName.value = draft.firstName || "";
    els.lastName.value = draft.lastName || "";
    els.street.value = draft.street || "";
    els.houseNumber.value = draft.houseNumber || "";
    els.postalCode.value = draft.postalCode || "";
    els.city.value = draft.city || "";
    els.storageNumber.value = draft.storageNumber || "";
    els.notes.value = draft.notes || "";
    els.ocrText.value = draft.ocrText || "";
    currentImageDataUrl = draft.imageDataUrl || "";
  } catch {}
}

async function savePackageFromForm() {
  const data = getFormData();

  if (!data.lastName) {
    throw new Error("Bitte mindestens den Nachnamen erfassen.");
  }

  if (!data.houseNumber) {
    throw new Error("Bitte Hausnummer prüfen.");
  }

  if (!data.storageNumber) {
    data.storageNumber = String(await getNextFreeStorageNumber());
    els.storageNumber.value = data.storageNumber;
  }

  const pkg = {
    id: generateId(),
    ...data,
    status: "stored",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    collectedAt: null
  };

  await addPackage(pkg);
  await saveInternalBackup("save");
  localStorage.removeItem(DRAFT_STORAGE_KEY);

  els.zplOutput.value = buildZPL(pkg);
  setStatus(
    els.acceptStatus,
    `Paket gespeichert. Lagernummer: ${pkg.storageNumber}`
  );

  return pkg;
}

function buildZPL(pkg) {
  const lager = sanitizeZplText(pkg.storageNumber || "");
  const hausnummer = sanitizeZplText(pkg.houseNumber || "");
  const name = sanitizeZplText(
    [pkg.firstName || "", pkg.lastName || ""].join(" ").trim()
  );

  return [
    "^XA",
    "^PW800",
    "^LL600",
    "^CF0,120",
    `^FO60,40^FD${lager}^FS`,
    "^CF0,70",
    `^FO60,200^FD${hausnummer}^FS`,
    "^CF0,60",
    `^FO60,300^FD${name}^FS`,
    "^XZ"
  ].join("\n");
}

function buildPrintHtml(pkg) {
  return `
    <div style="padding:20px;">
      <div style="font-size:120px;font-weight:800;line-height:1;margin-bottom:20px;">
        ${escapeHtml(pkg.storageNumber || "-")}
      </div>
      <div style="font-size:52px;font-weight:700;margin-bottom:18px;">
        ${escapeHtml(pkg.houseNumber || "-")}
      </div>
      <div style="font-size:42px;font-weight:700;">
        ${escapeHtml(([pkg.firstName || "", pkg.lastName || ""].join(" ").trim()) || "-")}
      </div>
    </div>
  `;
}

function renderPackages(items) {
  if (!items.length) {
    els.results.innerHTML = `<div class="placeholder">Keine Pakete gefunden</div>`;
    return;
  }

  els.results.innerHTML = items.map(pkg => {
    const statusText = pkg.status === "collected" ? "Abgeholt" : "Eingelagert";
    const address = [
      [pkg.street, pkg.houseNumber].filter(Boolean).join(" "),
      [pkg.postalCode, pkg.city].filter(Boolean).join(" ")
    ].filter(Boolean).join(", ");

    return `
      <div class="package-item">
        <h3>Lagernummer ${escapeHtml(pkg.storageNumber || "-")}</h3>
        <div class="package-meta">
          Status: ${escapeHtml(statusText)} · Eingang: ${escapeHtml(formatDateTime(pkg.createdAt))}
        </div>
        <div><strong>Name:</strong> ${escapeHtml(([pkg.firstName || "", pkg.lastName || ""].join(" ").trim()) || "-")}</div>
        <div><strong>Adresse:</strong> ${escapeHtml(address || "-")}</div>
        <div><strong>Hausnummer:</strong> ${escapeHtml(pkg.houseNumber || "-")}</div>
        <div><strong>Notiz:</strong> ${escapeHtml(pkg.notes || "-")}</div>
        <div class="package-actions">
          <button onclick="printPackageById('${pkg.id}')">Drucken</button>
          <button onclick="fillFormById('${pkg.id}')">In Formular laden</button>
          ${pkg.status !== "collected"
            ? `<button onclick="markCollectedById('${pkg.id}')">Abgeholt</button>`
            : ""}
          <button onclick="removePackageById('${pkg.id}')">Löschen</button>
        </div>
      </div>
    `;
  }).join("");
}

async function searchPackages() {
  const query = els.searchInput.value.trim().toLowerCase();
  const all = await getAllPackages();

  const filtered = all.filter(pkg => {
    if (!query) return true;

    return [
      pkg.firstName,
      pkg.lastName,
      pkg.street,
      pkg.houseNumber,
      pkg.postalCode,
      pkg.city,
      pkg.storageNumber,
      pkg.notes,
      pkg.status
    ].some(v => String(v || "").toLowerCase().includes(query));
  });

  renderPackages(filtered);
  setStatus(els.searchStatus, `${filtered.length} Paket(e) gefunden.`);
}

async function showAllPackages() {
  const all = await getAllPackages();
  renderPackages(all);
  setStatus(els.searchStatus, `${all.length} Paket(e) geladen.`);
}

async function getPackageById(id) {
  const items = await getAllPackages();
  return items.find(x => x.id === id) || null;
}

function loadPackageIntoForm(pkg) {
  els.firstName.value = pkg.firstName || "";
  els.lastName.value = pkg.lastName || "";
  els.street.value = pkg.street || "";
  els.houseNumber.value = pkg.houseNumber || "";
  els.postalCode.value = pkg.postalCode || "";
  els.city.value = pkg.city || "";
  els.storageNumber.value = pkg.storageNumber || "";
  els.notes.value = pkg.notes || "";
  els.ocrText.value = pkg.ocrText || "";
  currentImageDataUrl = pkg.imageDataUrl || "";
  els.zplOutput.value = buildZPL(pkg);

  switchTab("annahme");
  setStatus(els.acceptStatus, `Paket in Formular geladen. Lagernummer: ${pkg.storageNumber}`);
}

async function markCollected(pkg) {
  pkg.status = "collected";
  pkg.collectedAt = nowIso();
  pkg.updatedAt = nowIso();

  await putPackage(pkg);
  await saveInternalBackup("collected");
}

async function printPackage(pkg) {
  els.printLabel.innerHTML = buildPrintHtml(pkg);
  els.printLabel.classList.remove("hidden");
  els.zplOutput.value = buildZPL(pkg);

  window.print();

  setTimeout(() => {
    els.printLabel.classList.add("hidden");
  }, 500);
}

async function exportBackupFile() {
  const packages = await getAllPackages();
  const payload = {
    app: "lagerwirtschaft",
    version: 2,
    exportedAt: nowIso(),
    packages
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lager_backup_${new Date().toISOString().replaceAll(":", "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setStatus(els.searchStatus, "Backup exportiert.");
}

async function importBackupFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);

  if (!data || !Array.isArray(data.packages)) {
    throw new Error("Ungültige Backup-Datei.");
  }

  await restoreBackupData({ packages: data.packages });
  await showAllPackages();
  setStatus(els.searchStatus, `${data.packages.length} Paket(e) importiert.`);
}

async function restoreLatestInternalBackup() {
  const backup = await getLatestInternalBackup();

  if (!backup) {
    throw new Error("Kein internes Backup gefunden.");
  }

  await restoreBackupData(backup);
  await showAllPackages();
  setStatus(
    els.searchStatus,
    `Backup wiederhergestellt vom ${formatDateTime(backup.createdAt)}.`
  );
}

function startHourlyBackup() {
  setInterval(async () => {
    try {
      await saveInternalBackup("hourly");
      console.log("Stündliches Backup erstellt.");
    } catch (error) {
      console.error("Backup-Fehler:", error);
    }
  }, 60 * 60 * 1000);
}

async function startupRestoreIfNeeded() {
  const packages = await getAllPackages();
  if (packages.length > 0) return;

  const backup = await getLatestInternalBackup();
  if (backup && Array.isArray(backup.packages) && backup.packages.length > 0) {
    await restoreBackupData(backup);
  }
}

window.printPackageById = async function printPackageById(id) {
  try {
    const pkg = await getPackageById(id);
    if (!pkg) throw new Error("Paket nicht gefunden.");
    await printPackage(pkg);
  } catch (error) {
    alert(error.message || String(error));
  }
};

window.fillFormById = async function fillFormById(id) {
  try {
    const pkg = await getPackageById(id);
    if (!pkg) throw new Error("Paket nicht gefunden.");
    loadPackageIntoForm(pkg);
  } catch (error) {
    alert(error.message || String(error));
  }
};

window.markCollectedById = async function markCollectedById(id) {
  try {
    const pkg = await getPackageById(id);
    if (!pkg) throw new Error("Paket nicht gefunden.");

    if (pkg.status === "collected") {
      throw new Error("Paket ist bereits abgeholt.");
    }

    const ok = confirm(
      `Paket mit Lagernummer ${pkg.storageNumber} wirklich als abgeholt markieren?`
    );
    if (!ok) return;

    await markCollected(pkg);
    await showAllPackages();
    setStatus(
      els.searchStatus,
      `Paket abgeholt. Lagernummer ${pkg.storageNumber} ist wieder frei.`
    );
  } catch (error) {
    alert(error.message || String(error));
  }
};

window.removePackageById = async function removePackageById(id) {
  try {
    const pkg = await getPackageById(id);
    if (!pkg) throw new Error("Paket nicht gefunden.");

    const ok = confirm(`Paket mit Lagernummer ${pkg.storageNumber} wirklich löschen?`);
    if (!ok) return;

    await deletePackage(id);
    await saveInternalBackup("delete");
    await showAllPackages();
    setStatus(els.searchStatus, `Paket gelöscht.`);
  } catch (error) {
    alert(error.message || String(error));
  }
};

function bindEvents() {
  els.tabs.forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  els.authLoginBtn.addEventListener("click", async () => {
    try {
      await loginAuth();
      setStatus(els.authStatus, "Anmeldung erfolgreich.");
    } catch (error) {
      setStatus(els.authStatus, `Fehler: ${error.message || error}`);
    }
  });

  els.authPassword.addEventListener("keydown", async event => {
    if (event.key !== "Enter") return;

    try {
      await loginAuth();
      setStatus(els.authStatus, "Anmeldung erfolgreich.");
    } catch (error) {
      setStatus(els.authStatus, `Fehler: ${error.message || error}`);
    }
  });

  els.newPackageBtn.addEventListener("click", () => {
    els.packageImageInput.click();
  });

  els.packageImageInput.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await processNewPackageImage(file);
    } catch (error) {
      setStatus(els.acceptStatus, `OCR-Fehler: ${error.message || error}`);
    } finally {
      event.target.value = "";
    }
  });

  els.saveBtn.addEventListener("click", async () => {
    try {
      const pkg = await savePackageFromForm();
      await showAllPackages();
      els.zplOutput.value = buildZPL(pkg);
    } catch (error) {
      setStatus(els.acceptStatus, `Speicher-Fehler: ${error.message || error}`);
    }
  });

  els.printBtn.addEventListener("click", async () => {
    try {
      const data = getFormData();

      if (!data.storageNumber) {
        throw new Error("Bitte zuerst Paketdaten erfassen.");
      }

      const pkg = {
        ...data,
        createdAt: nowIso()
      };

      els.zplOutput.value = buildZPL(pkg);
      await printPackage(pkg);
      setStatus(els.acceptStatus, "Druckdialog geöffnet.");
    } catch (error) {
      setStatus(els.acceptStatus, `Druck-Fehler: ${error.message || error}`);
    }
  });

  els.clearBtn.addEventListener("click", clearForm);

  els.searchBtn.addEventListener("click", async () => {
    try {
      await searchPackages();
    } catch (error) {
      setStatus(els.searchStatus, `Suche-Fehler: ${error.message || error}`);
    }
  });

  els.showAllBtn.addEventListener("click", async () => {
    try {
      await showAllPackages();
    } catch (error) {
      setStatus(els.searchStatus, `Fehler: ${error.message || error}`);
    }
  });

  els.exportBtn.addEventListener("click", async () => {
    try {
      await exportBackupFile();
    } catch (error) {
      setStatus(els.searchStatus, `Export-Fehler: ${error.message || error}`);
    }
  });

  els.importBtn.addEventListener("click", () => {
    els.importFile.click();
  });

  els.importFile.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await importBackupFile(file);
    } catch (error) {
      setStatus(els.searchStatus, `Import-Fehler: ${error.message || error}`);
    } finally {
      event.target.value = "";
    }
  });

  els.forceBackupBtn.addEventListener("click", async () => {
    try {
      const backup = await saveInternalBackup("manual");
      setStatus(
        els.searchStatus,
        `Backup erstellt: ${formatDateTime(backup.createdAt)}`
      );
    } catch (error) {
      setStatus(els.searchStatus, `Backup-Fehler: ${error.message || error}`);
    }
  });

  els.restoreBackupBtn.addEventListener("click", async () => {
    try {
      await restoreLatestInternalBackup();
    } catch (error) {
      setStatus(els.searchStatus, `Restore-Fehler: ${error.message || error}`);
    }
  });

  els.logoutBtn.addEventListener("click", () => {
    logoutAuth();
  });

  els.deleteAllBtn.addEventListener("click", async () => {
    const ok = confirm("Wirklich alle Pakete löschen?");
    if (!ok) return;

    try {
      await clearPackages();
      await saveInternalBackup("clear_all");
      await showAllPackages();
      setStatus(els.searchStatus, "Alle Pakete gelöscht.");
    } catch (error) {
      setStatus(els.searchStatus, `Lösch-Fehler: ${error.message || error}`);
    }
  });

  [
    els.firstName,
    els.lastName,
    els.street,
    els.houseNumber,
    els.postalCode,
    els.city,
    els.storageNumber,
    els.notes,
    els.ocrText
  ].forEach(input => {
    input.addEventListener("input", saveDraft);
    input.addEventListener("change", saveDraft);
  });

  window.addEventListener("beforeunload", () => {
    try {
      saveDraft();
    } catch {}
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
      try {
        saveDraft();
        await saveInternalBackup("background");
      } catch {}
    }
  });
}

async function init() {
  try {
    await openDatabase();
    bindEvents();
    bindActivityEvents();

    if (isSessionAuthenticated()) {
      hideAuthScreen();
      resetInactivityTimer();
    } else {
      showAuthScreen();
      els.authUsername.value = FIXED_USERNAME;
      setStatus(els.authStatus, "Bitte anmelden.");
    }

    await startupRestoreIfNeeded();
    await restoreDraft();
    await showAllPackages();
    await saveInternalBackup("startup");
    startHourlyBackup();

    setStatus(els.acceptStatus, "App bereit.");
  } catch (error) {
    setStatus(els.acceptStatus, `Startfehler: ${error.message || error}`);
  }
}

init();
