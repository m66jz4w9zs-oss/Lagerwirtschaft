const DB_NAME = "lagerwirtschaft_db";
const DB_VERSION = 1;
const STORE_PACKAGES = "packages";
const STORE_BACKUPS = "backups";

let db = null;
let cameraStream = null;
let currentPhotoDataUrl = "";

const els = {
  tabs: document.querySelectorAll(".tab-btn"),
  panels: document.querySelectorAll(".tab-panel"),

  camera: document.getElementById("camera"),
  cameraPlaceholder: document.getElementById("cameraPlaceholder"),
  photo: document.getElementById("photo"),
  photoPlaceholder: document.getElementById("photoPlaceholder"),

  startCameraBtn: document.getElementById("startCameraBtn"),
  stopCameraBtn: document.getElementById("stopCameraBtn"),
  takePhotoBtn: document.getElementById("takePhotoBtn"),
  ocrBtn: document.getElementById("ocrBtn"),

  ocrText: document.getElementById("ocrText"),
  trackingNumber: document.getElementById("trackingNumber"),
  carrier: document.getElementById("carrier"),
  recipient: document.getElementById("recipient"),
  storageLocation: document.getElementById("storageLocation"),
  notes: document.getElementById("notes"),

  saveBtn: document.getElementById("saveBtn"),
  printBtn: document.getElementById("printBtn"),
  clearBtn: document.getElementById("clearBtn"),

  acceptStatus: document.getElementById("acceptStatus"),

  searchInput: document.getElementById("searchInput"),
  searchCarrier: document.getElementById("searchCarrier"),
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
  checkBluetoothBtn: document.getElementById("checkBluetoothBtn"),
  bluetoothStatus: document.getElementById("bluetoothStatus"),
  zplOutput: document.getElementById("zplOutput"),

  printLabel: document.getElementById("printLabel")
};

function setStatus(el, message) {
  el.textContent = message;
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
    return iso;
  }
}

function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sanitizeZplText(value) {
  return String(value ?? "")
    .replace(/[\^~\\]/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function buildZPL(pkg) {
  const tracking = sanitizeZplText(pkg.trackingNumber);
  const recipient = sanitizeZplText(pkg.recipient);
  const carrier = sanitizeZplText(pkg.carrier);
  const location = sanitizeZplText(pkg.storageLocation);

  return [
    "^XA",
    "^PW800",
    "^LL600",
    "^CF0,40",
    "^FO40,40^FDPaketlabel^FS",
    "^CF0,30",
    `^FO40,110^FDNummer: ${tracking}^FS`,
    `^FO40,160^FDEmpfaenger: ${recipient}^FS`,
    `^FO40,210^FDVersand: ${carrier}^FS`,
    `^FO40,260^FDLagerplatz: ${location}^FS`,
    "^FO40,330^BY2",
    `^BCN,120,Y,N,N^FD${tracking || "UNBEKANNT"}^FS`,
    "^XZ"
  ].join("\n");
}

function buildPrintHtml(pkg) {
  return `
    <h1 style="margin:0 0 12px;font-size:28px;">Paketlabel</h1>
    <div style="font-size:18px;line-height:1.6;">
      <div><strong>Paketnummer:</strong> ${escapeHtml(pkg.trackingNumber || "-")}</div>
      <div><strong>Empfänger:</strong> ${escapeHtml(pkg.recipient || "-")}</div>
      <div><strong>Versanddienst:</strong> ${escapeHtml(pkg.carrier || "-")}</div>
      <div><strong>Lagerplatz:</strong> ${escapeHtml(pkg.storageLocation || "-")}</div>
      <div><strong>Eingang:</strong> ${escapeHtml(formatDateTime(pkg.createdAt))}</div>
      ${pkg.notes ? `<div><strong>Notiz:</strong> ${escapeHtml(pkg.notes)}</div>` : ""}
      <hr style="margin:16px 0;">
      <div style="font-size:16px;">Barcode-Inhalt:</div>
      <div style="font-size:22px;font-weight:700;letter-spacing:1px;">${escapeHtml(pkg.trackingNumber || "-")}</div>
    </div>
  `;
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
        store.createIndex("trackingNumber", "trackingNumber", { unique: false });
        store.createIndex("recipient", "recipient", { unique: false });
        store.createIndex("carrier", "carrier", { unique: false });
        store.createIndex("storageLocation", "storageLocation", { unique: false });
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
      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
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

  localStorage.setItem("lagerwirtschaft_latest_backup", JSON.stringify(backup));
  localStorage.setItem("lagerwirtschaft_last_backup_time", backup.createdAt);

  const allBackups = await getAllBackups();
  const sorted = allBackups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const keep = 24;

  for (let i = keep; i < sorted.length; i++) {
    await deleteBackup(sorted[i].id);
  }

  return backup;
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

async function getLatestInternalBackup() {
  const backups = await getAllBackups();
  backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (backups.length > 0) {
    return backups[0];
  }

  const local = localStorage.getItem("lagerwirtschaft_latest_backup");
  if (local) {
    try {
      return JSON.parse(local);
    } catch {
      return null;
    }
  }

  return null;
}

async function restoreBackupData(backup) {
  if (!backup || !Array.isArray(backup.packages)) {
    throw new Error("Ungültiges Backup");
  }

  await clearPackages();

  for (const pkg of backup.packages) {
    await putPackage(pkg);
  }

  await saveInternalBackup("restore");
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Dieses Gerät oder dieser Browser unterstützt keine Kamera-API.");
  }

  if (cameraStream) {
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" }
    },
    audio: false
  });

  cameraStream = stream;
  els.camera.srcObject = stream;
  els.camera.classList.remove("hidden");
  els.cameraPlaceholder.classList.add("hidden");
  await els.camera.play();
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  els.camera.srcObject = null;
  els.camera.classList.add("hidden");
  els.cameraPlaceholder.classList.remove("hidden");
}

function takePhoto() {
  if (!cameraStream || !els.camera.videoWidth || !els.camera.videoHeight) {
    throw new Error("Kamera ist nicht aktiv.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = els.camera.videoWidth;
  canvas.height = els.camera.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(els.camera, 0, 0, canvas.width, canvas.height);

  currentPhotoDataUrl = canvas.toDataURL("image/jpeg", 0.92);
  els.photo.src = currentPhotoDataUrl;
  els.photo.classList.remove("hidden");
  els.photoPlaceholder.classList.add("hidden");
}

async function runOCR() {
  if (!currentPhotoDataUrl) {
    throw new Error("Bitte zuerst ein Foto aufnehmen.");
  }

  setStatus(els.acceptStatus, "OCR läuft ... bitte warten.");

  const result = await Tesseract.recognize(currentPhotoDataUrl, "deu+eng");
  const text = (result?.data?.text || "").trim();
  els.ocrText.value = text;

  autoFillFromOCR(text);

  setStatus(els.acceptStatus, "OCR abgeschlossen.");
}

function autoFillFromOCR(text) {
  const clean = String(text || "");

  if (!els.trackingNumber.value) {
    const trackingMatch =
      clean.match(/\b\d{10,30}\b/) ||
      clean.match(/\b[A-Z]{2}\d{9}[A-Z]{2}\b/) ||
      clean.match(/\b[A-Z0-9]{12,30}\b/);

    if (trackingMatch) {
      els.trackingNumber.value = trackingMatch[0];
    }
  }

  if (!els.carrier.value) {
    const map = ["DHL", "DPD", "GLS", "Hermes", "UPS", "FedEx"];
    const found = map.find(name => clean.toLowerCase().includes(name.toLowerCase()));
    if (found) {
      els.carrier.value = found;
    }
  }

  if (!els.recipient.value) {
    const lines = clean
      .split(/\r?\n/)
      .map(v => v.trim())
      .filter(Boolean);

    const recipientLine = lines.find(line =>
      !/\d{5}/.test(line) &&
      !/(dhl|dpd|gls|hermes|ups|fedex|paket|sendung|tracking|label)/i.test(line) &&
      line.length >= 4 &&
      line.length <= 50
    );

    if (recipientLine) {
      els.recipient.value = recipientLine;
    }
  }
}

function getFormData() {
  return {
    trackingNumber: els.trackingNumber.value.trim(),
    carrier: els.carrier.value.trim(),
    recipient: els.recipient.value.trim(),
    storageLocation: els.storageLocation.value.trim(),
    notes: els.notes.value.trim(),
    ocrText: els.ocrText.value.trim(),
    imageDataUrl: currentPhotoDataUrl || "",
  };
}

function clearForm() {
  els.trackingNumber.value = "";
  els.carrier.value = "";
  els.recipient.value = "";
  els.storageLocation.value = "";
  els.notes.value = "";
  els.ocrText.value = "";
  currentPhotoDataUrl = "";
  els.photo.src = "";
  els.photo.classList.add("hidden");
  els.photoPlaceholder.classList.remove("hidden");
  els.zplOutput.value = "";
  setStatus(els.acceptStatus, "Formular geleert.");
}

async function savePackageFromForm() {
  const data = getFormData();

  if (!data.trackingNumber) {
    throw new Error("Bitte eine Paketnummer eingeben oder per OCR erfassen.");
  }

  const pkg = {
    id: generateId(),
    ...data,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  await addPackage(pkg);
  await saveInternalBackup("save");

  els.zplOutput.value = buildZPL(pkg);
  setStatus(els.acceptStatus, `Paket gespeichert: ${pkg.trackingNumber}`);
  return pkg;
}

function renderPackages(items) {
  if (!items.length) {
    els.results.innerHTML = `<div class="placeholder">Keine Pakete gefunden</div>`;
    return;
  }

  els.results.innerHTML = items.map(pkg => {
    const thumb = pkg.imageDataUrl
      ? `<img src="${pkg.imageDataUrl}" alt="Paketbild" style="max-width:160px;border-radius:12px;border:1px solid #ddd;margin-top:8px;">`
      : "";

    return `
      <div class="package-item">
        <h3>${escapeHtml(pkg.trackingNumber || "-")}</h3>
        <div class="package-meta">
          Eingang: ${escapeHtml(formatDateTime(pkg.createdAt))}
        </div>
        <div><strong>Empfänger:</strong> ${escapeHtml(pkg.recipient || "-")}</div>
        <div><strong>Versanddienst:</strong> ${escapeHtml(pkg.carrier || "-")}</div>
        <div><strong>Lagerplatz:</strong> ${escapeHtml(pkg.storageLocation || "-")}</div>
        <div><strong>Notiz:</strong> ${escapeHtml(pkg.notes || "-")}</div>
        ${thumb}
        <div class="package-actions">
          <button onclick="printPackageById('${pkg.id}')">Drucken</button>
          <button onclick="fillFormById('${pkg.id}')">In Formular laden</button>
          <button class="danger" onclick="removePackageById('${pkg.id}')">Löschen</button>
        </div>
      </div>
    `;
  }).join("");
}

async function searchPackages() {
  const query = els.searchInput.value.trim().toLowerCase();
  const carrier = els.searchCarrier.value.trim().toLowerCase();

  const all = await getAllPackages();

  const filtered = all.filter(pkg => {
    const matchesQuery =
      !query ||
      [
        pkg.trackingNumber,
        pkg.recipient,
        pkg.carrier,
        pkg.storageLocation,
        pkg.notes,
        pkg.ocrText
      ].some(v => String(v || "").toLowerCase().includes(query));

    const matchesCarrier =
      !carrier || String(pkg.carrier || "").toLowerCase() === carrier;

    return matchesQuery && matchesCarrier;
  });

  renderPackages(filtered);
  setStatus(els.searchStatus, `${filtered.length} Paket(e) gefunden.`);
}

async function showAllPackages() {
  const all = await getAllPackages();
  renderPackages(all);
  setStatus(els.searchStatus, `${all.length} Paket(e) geladen.`);
}

function loadPackageIntoForm(pkg) {
  els.trackingNumber.value = pkg.trackingNumber || "";
  els.carrier.value = pkg.carrier || "";
  els.recipient.value = pkg.recipient || "";
  els.storageLocation.value = pkg.storageLocation || "";
  els.notes.value = pkg.notes || "";
  els.ocrText.value = pkg.ocrText || "";
  currentPhotoDataUrl = pkg.imageDataUrl || "";

  if (currentPhotoDataUrl) {
    els.photo.src = currentPhotoDataUrl;
    els.photo.classList.remove("hidden");
    els.photoPlaceholder.classList.add("hidden");
  } else {
    els.photo.src = "";
    els.photo.classList.add("hidden");
    els.photoPlaceholder.classList.remove("hidden");
  }

  els.zplOutput.value = buildZPL(pkg);
  switchTab("annahme");
  setStatus(els.acceptStatus, `Paket ${pkg.trackingNumber} in Formular geladen.`);
}

async function getPackageById(id) {
  const items = await getAllPackages();
  return items.find(x => x.id === id) || null;
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
    version: 1,
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

async function checkBluetoothSupport() {
  const available = "bluetooth" in navigator;

  if (!available) {
    els.bluetoothStatus.textContent =
      "Web Bluetooth wird in diesem Browser nicht unterstützt.";
    return;
  }

  try {
    await navigator.bluetooth.getAvailability();
    els.bluetoothStatus.textContent =
      "Web Bluetooth ist grundsätzlich vorhanden. Direkter Druck hängt aber vom Browser und vom Druckerprofil ab.";
  } catch {
    els.bluetoothStatus.textContent =
      "Bluetooth-API vorhanden, Verfügbarkeit konnte aber nicht sicher geprüft werden.";
  }
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

  if (packages.length > 0) {
    return;
  }

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

window.removePackageById = async function removePackageById(id) {
  try {
    const pkg = await getPackageById(id);
    if (!pkg) throw new Error("Paket nicht gefunden.");

    const ok = confirm(`Paket ${pkg.trackingNumber} wirklich löschen?`);
    if (!ok) return;

    await deletePackage(id);
    await saveInternalBackup("delete");
    await showAllPackages();
    setStatus(els.searchStatus, `Paket ${pkg.trackingNumber} gelöscht.`);
  } catch (error) {
    alert(error.message || String(error));
  }
};

function bindEvents() {
  els.tabs.forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  els.startCameraBtn.addEventListener("click", async () => {
    try {
      await startCamera();
      setStatus(els.acceptStatus, "Kamera gestartet.");
    } catch (error) {
      setStatus(els.acceptStatus, `Kamera-Fehler: ${error.message || error}`);
    }
  });

  els.stopCameraBtn.addEventListener("click", () => {
    stopCamera();
    setStatus(els.acceptStatus, "Kamera gestoppt.");
  });

  els.takePhotoBtn.addEventListener("click", () => {
    try {
      takePhoto();
      setStatus(els.acceptStatus, "Foto aufgenommen.");
    } catch (error) {
      setStatus(els.acceptStatus, `Foto-Fehler: ${error.message || error}`);
    }
  });

  els.ocrBtn.addEventListener("click", async () => {
    try {
      await runOCR();
    } catch (error) {
      setStatus(els.acceptStatus, `OCR-Fehler: ${error.message || error}`);
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

      if (!data.trackingNumber) {
        throw new Error("Bitte zuerst Paketdaten eingeben.");
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
      els.bluetoothStatus.textContent = `Letztes Backup: ${formatDateTime(backup.createdAt)}`;
    } catch (error) {
      els.bluetoothStatus.textContent = `Backup-Fehler: ${error.message || error}`;
    }
  });

  els.restoreBackupBtn.addEventListener("click", async () => {
    try {
      await restoreLatestInternalBackup();
    } catch (error) {
      els.bluetoothStatus.textContent = `Restore-Fehler: ${error.message || error}`;
    }
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

  els.checkBluetoothBtn.addEventListener("click", async () => {
    await checkBluetoothSupport();
  });

  window.addEventListener("beforeunload", () => {
    try {
      const draft = {
        trackingNumber: els.trackingNumber.value,
        carrier: els.carrier.value,
        recipient: els.recipient.value,
        storageLocation: els.storageLocation.value,
        notes: els.notes.value,
        ocrText: els.ocrText.value,
        imageDataUrl: currentPhotoDataUrl
      };
      localStorage.setItem("lagerwirtschaft_draft", JSON.stringify(draft));
    } catch {}
  });
}

async function restoreDraft() {
  const raw = localStorage.getItem("lagerwirtschaft_draft");
  if (!raw) return;

  try {
    const draft = JSON.parse(raw);

    els.trackingNumber.value = draft.trackingNumber || "";
    els.carrier.value = draft.carrier || "";
    els.recipient.value = draft.recipient || "";
    els.storageLocation.value = draft.storageLocation || "";
    els.notes.value = draft.notes || "";
    els.ocrText.value = draft.ocrText || "";
    currentPhotoDataUrl = draft.imageDataUrl || "";

    if (currentPhotoDataUrl) {
      els.photo.src = currentPhotoDataUrl;
      els.photo.classList.remove("hidden");
      els.photoPlaceholder.classList.add("hidden");
    }
  } catch {}
}

async function init() {
  try {
    await openDatabase();
    bindEvents();
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
