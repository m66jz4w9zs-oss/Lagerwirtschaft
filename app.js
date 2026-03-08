/* app.js - Komplettversion für Lagerwirtschaft Web-App
   Enthält:
   - IndexedDB statt SQLite
   - Kamera
   - OCR via Tesseract.js
   - Bluetooth via Web Bluetooth (wenn unterstützt)
   - Drucken via window.print() als AirPrint-Ersatz
*/

const STORAGE_KEYS = {
  settings: "paketlager_settings"
};

const DB_NAME = "paketlager_db";
const DB_VERSION = 1;
const STORE_PACKAGES = "packages";
const STORE_PENDING_PRINTS = "pending_prints";

const defaultSettings = {
  printerMode: "label", // label | airPrint | bluetooth
  printerIP: "",
  printerPort: 9100,
  bluetoothDeviceIdentifier: "",
  bluetoothDeviceName: "",
  labelSize: "100x100",
  paperSize: "A4",
  orientation: "portrait",
  fontScale: 1
};

const state = {
  db: null,
  packages: [],
  settings: { ...defaultSettings },
  searchQuery: "",
  sortBy: "arrival",
  sortAscending: false,
  cameraStream: null,
  currentImageDataUrl: "",
  ocrRawText: "",
  bluetoothDevice: null,
  bluetoothCharacteristic: null
};

/* =========================
   Utilities
========================= */

function $(id) {
  return document.getElementById(id);
}

function padSlot(slot) {
  return String(slot).padStart(3, "0");
}

function formatDateDE(date) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatDateTimeDE(date) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function fullName(pkg) {
  return `${pkg.firstName || ""} ${pkg.lastName || ""}`.trim();
}

function addressLine(pkg) {
  return [pkg.street, pkg.houseNo].filter(Boolean).join(" ").trim();
}

function setStatus(id, text, isError = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("error", !!isError);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}") };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function readReceiveForm() {
  return {
    firstName: $("firstName")?.value || "",
    lastName: $("lastName")?.value || "",
    street: $("street")?.value || "",
    houseNo: $("houseNo")?.value || "",
    postalCode: $("postalCode")?.value || "",
    city: $("city")?.value || ""
  };
}

function fillReceiveForm(fields) {
  if ($("firstName")) $("firstName").value = fields.firstName || "";
  if ($("lastName")) $("lastName").value = fields.lastName || "";
  if ($("street")) $("street").value = fields.street || "";
  if ($("houseNo")) $("houseNo").value = fields.houseNo || "";
  if ($("postalCode")) $("postalCode").value = fields.postalCode || "";
  if ($("city")) $("city").value = fields.city || "";
}

function clearReceiveForm() {
  fillReceiveForm({
    firstName: "",
    lastName: "",
    street: "",
    houseNo: "",
    postalCode: "",
    city: ""
  });
  state.currentImageDataUrl = "";
  state.ocrRawText = "";
  if ($("capturedImage")) $("capturedImage").src = "";
  if ($("ocrRawText")) $("ocrRawText").textContent = "";
}

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
}

/* =========================
   IndexedDB (SQLite-Ersatz)
========================= */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE_PACKAGES)) {
        const store = db.createObjectStore(STORE_PACKAGES, { keyPath: "id" });
        store.createIndex("slot", "slot", { unique: true });
        store.createIndex("lastName", "lastName", { unique: false });
        store.createIndex("arrivalAt", "arrivalAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_PENDING_PRINTS)) {
        db.createObjectStore(STORE_PENDING_PRINTS, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode = "readonly") {
  const transaction = state.db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, "readwrite").put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, "readwrite").delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function loadPackagesFromDB() {
  state.packages = await idbGetAll(STORE_PACKAGES);
}

function allocateSlot(items) {
  const used = items
    .map(x => Number(x.slot))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  let candidate = 1;
  for (const s of used) {
    if (s === candidate) candidate++;
    else if (s > candidate) break;
  }

  if (candidate > 500) {
    throw new Error("Lager voll (500/500).");
  }

  return candidate;
}

async function createPackage(fields) {
  const slot = allocateSlot(state.packages);

  const pkg = {
    id: crypto.randomUUID(),
    slot,
    firstName: (fields.firstName || "").trim(),
    lastName: (fields.lastName || "").trim(),
    street: (fields.street || "").trim(),
    houseNo: (fields.houseNo || "").trim(),
    postalCode: (fields.postalCode || "").trim(),
    city: (fields.city || "").trim(),
    arrivalAt: new Date().toISOString()
  };

  await idbPut(STORE_PACKAGES, pkg);
  state.packages.push(pkg);
  return pkg;
}

async function deletePackage(id) {
  await idbDelete(STORE_PACKAGES, id);
  state.packages = state.packages.filter(x => x.id !== id);
}

async function enqueuePendingPrint(payload) {
  const item = {
    id: crypto.randomUUID(),
    payload,
    createdAt: new Date().toISOString()
  };
  await idbPut(STORE_PENDING_PRINTS, item);
}

async function pendingPrintCount() {
  const items = await idbGetAll(STORE_PENDING_PRINTS);
  return items.length;
}

/* =========================
   Search + Render
========================= */

function matchesQuery(pkg, q) {
  if (!q) return true;

  const haystack = [
    pkg.firstName,
    pkg.lastName,
    pkg.street,
    pkg.houseNo,
    pkg.postalCode,
    pkg.city
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function getFilteredAndSortedPackages() {
  const q = state.searchQuery.trim().toLowerCase();

  const filtered = state.packages.filter(pkg => matchesQuery(pkg, q));

  filtered.sort((a, b) => {
    if (state.sortBy === "number") {
      return state.sortAscending ? a.slot - b.slot : b.slot - a.slot;
    }

    const da = new Date(a.arrivalAt).getTime();
    const db = new Date(b.arrivalAt).getTime();
    return state.sortAscending ? da - db : db - da;
  });

  return filtered;
}

function renderResults() {
  const container = $("results");
  if (!container) return;

  container.innerHTML = "";
  const items = getFilteredAndSortedPackages();

  if (items.length === 0) {
    container.innerHTML = `<div class="empty">Keine Pakete gefunden.</div>`;
    return;
  }

  for (const pkg of items) {
    const node = document.createElement("article");
    node.className = "result-item";
    node.innerHTML = `
      <div class="result-number">${padSlot(pkg.slot)}</div>
      <div class="result-body">
        <div class="result-name">${escapeHtml(fullName(pkg))}</div>
        <div class="result-address">${escapeHtml(addressLine(pkg))}, ${escapeHtml(pkg.postalCode)} ${escapeHtml(pkg.city)}</div>
        <div class="result-date">${escapeHtml(formatDateTimeDE(new Date(pkg.arrivalAt)))}</div>
      </div>
      <div class="result-actions">
        <button class="print-btn">Drucken</button>
        <button class="danger delete-btn">Löschen</button>
      </div>
    `;

    node.querySelector(".delete-btn").addEventListener("click", async () => {
      const ok = confirm(`Paket ${padSlot(pkg.slot)} wirklich löschen?`);
      if (!ok) return;

      try {
        await deletePackage(pkg.id);
        renderResults();
      } catch (err) {
        alert(err.message || "Löschen fehlgeschlagen.");
      }
    });

    node.querySelector(".print-btn").addEventListener("click", async () => {
      try {
        await printLabelForPackage(pkg);
      } catch (err) {
        alert(err.message || "Druck fehlgeschlagen.");
      }
    });

    container.appendChild(node);
  }
}

/* =========================
   Parser
========================= */

function parseOCRText(raw) {
  const lines = raw
    .replaceAll("\t", " ")
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  const fields = {
    firstName: "",
    lastName: "",
    street: "",
    houseNo: "",
    postalCode: "",
    city: ""
  };

  const postalRegex = /\b(\d{5})\b\s+(.+)$/;
  let postalIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(postalRegex);
    if (m) {
      fields.postalCode = m[1].trim();
      fields.city = m[2].trim();
      postalIndex = i;
      break;
    }
  }

  if (postalIndex > 0) {
    const addrLine = lines[postalIndex - 1];
    const parts = addrLine.split(" ").filter(Boolean);
    if (parts.length >= 2) {
      fields.houseNo = parts[parts.length - 1];
      fields.street = parts.slice(0, -1).join(" ");
    } else {
      fields.street = addrLine;
    }
  }

  for (const line of lines.slice(0, 6)) {
    if (looksLikeNoise(line)) continue;
    const words = line.split(" ").filter(Boolean);
    if (words.length >= 2) {
      fields.firstName = words[0];
      fields.lastName = words.slice(1).join(" ");
      break;
    }
  }

  return fields;
}

function looksLikeNoise(line) {
  const l = line.toLowerCase();
  if (l.includes("tracking") || l.includes("sendung") || l.includes("paket")) return true;
  if (l.includes("tel") || l.includes("phone")) return true;
  if (/\b\d{10,}\b/.test(l)) return true;
  return false;
}

/* =========================
   OCR
========================= */

async function ensureTesseractLoaded() {
  if (window.Tesseract) return;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Tesseract.js konnte nicht geladen werden."));
    document.head.appendChild(script);
  });
}

async function runOCRFromCurrentImage() {
  if (!state.currentImageDataUrl) {
    throw new Error("Kein Bild vorhanden.");
  }

  setStatus("receiveStatus", "OCR läuft…");

  await ensureTesseractLoaded();

  const result = await window.Tesseract.recognize(state.currentImageDataUrl, ["deu", "eng"]);
  const text = result?.data?.text || "";

  state.ocrRawText = text;
  if ($("ocrRawText")) $("ocrRawText").textContent = text;

  const fields = parseOCRText(text);
  fillReceiveForm(fields);

  setStatus("receiveStatus", "OCR fertig. Bitte Daten prüfen.");
}

/* =========================
   Camera
========================= */

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Kamera wird von diesem Browser nicht unterstützt.");
  }

  const video = $("cameraVideo");
  if (!video) {
    throw new Error("cameraVideo Element fehlt in index.html.");
  }

  stopCamera();

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });

  state.cameraStream = stream;
  video.srcObject = stream;
  await video.play();

  setStatus("receiveStatus", "Kamera aktiv.");
}

function stopCamera() {
  if (state.cameraStream) {
    for (const track of state.cameraStream.getTracks()) {
      track.stop();
    }
    state.cameraStream = null;
  }

  const video = $("cameraVideo");
  if (video) {
    video.srcObject = null;
  }
}

function capturePhoto() {
  const video = $("cameraVideo");
  const canvas = $("cameraCanvas");
  const img = $("capturedImage");

  if (!video || !canvas || !img) {
    throw new Error("Kamera-Elemente fehlen in index.html.");
  }

  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) {
    throw new Error("Noch kein Kamerabild verfügbar.");
  }

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
  state.currentImageDataUrl = dataUrl;
  img.src = dataUrl;

  setStatus("receiveStatus", "Foto aufgenommen.");
}

/* =========================
   ZPL + Print
========================= */

function buildZPLLabel(pkg) {
  const slot3 = padSlot(pkg.slot);
  const name = sanitizeZPL(fullName(pkg));
  const date = sanitizeZPL(formatDateDE(new Date(pkg.arrivalAt)));

  return `^XA
^CI28
^PW800
^LL800
^FO40,70
^A0N,420,420
^FB720,1,0,C,0
^FD${slot3}^FS
^FO40,400
^A0N,70,70
^FB720,1,0,C,0
^FD${name}^FS
^FO40,660
^A0N,55,55
^FB720,1,0,C,0
^FD${date}^FS
^XZ`;
}

function sanitizeZPL(text) {
  return String(text || "")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ")
    .trim();
}

async function printLabelForPackage(pkg) {
  const mode = state.settings.printerMode;

  if (mode === "label") {
    const zpl = buildZPLLabel(pkg);
    await sendLabelZPL(zpl);
    return;
  }

  if (mode === "bluetooth") {
    const zpl = buildZPLLabel(pkg);
    await sendBluetooth(zpl);
    return;
  }

  await printHTMLLabel(pkg);
}

async function sendLabelZPL(zpl) {
  try {
    if (state.settings.printerIP) {
      throw new Error("Direkter TCP-Druck aus GitHub Pages geht nicht zuverlässig im Browser.");
    }

    await enqueuePendingPrint(zpl);
    setStatus("receiveStatus", "ZPL erzeugt und in Warteschlange gespeichert.");
  } catch (err) {
    await enqueuePendingPrint(zpl);
    throw new Error(err.message || "ZPL-Druck fehlgeschlagen. In Warteschlange gespeichert.");
  }
}

async function printHTMLLabel(pkg) {
  const slot3 = padSlot(pkg.slot);
  const popup = window.open("", "_blank", "width=800,height=600");

  if (!popup) {
    throw new Error("Druckfenster konnte nicht geöffnet werden.");
  }

  popup.document.write(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8" />
      <title>Druck ${slot3}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 40px;
          text-align: center;
        }
        .slot {
          font-size: 160px;
          font-weight: bold;
          margin-top: 40px;
        }
        .name {
          font-size: 32px;
          margin-top: 30px;
        }
        .date {
          font-size: 20px;
          color: #666;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="slot">${escapeHtml(slot3)}</div>
      <div class="name">${escapeHtml(fullName(pkg))}</div>
      <div class="date">${escapeHtml(formatDateDE(new Date(pkg.arrivalAt)))}</div>
      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `);

  popup.document.close();
}

/* =========================
   Bluetooth (Web Bluetooth)
========================= */

async function connectBluetoothPrinter() {
  if (!navigator.bluetooth) {
    throw new Error("Web Bluetooth wird von diesem Browser nicht unterstützt.");
  }

  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      "battery_service",
      "device_information",
      "0000ffe0-0000-1000-8000-00805f9b34fb",
      "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
    ]
  });

  const server = await device.gatt.connect();

  const candidateServices = [
    "0000ffe0-0000-1000-8000-00805f9b34fb",
    "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
  ];

  const candidateCharacteristics = [
    "0000ffe1-0000-1000-8000-00805f9b34fb",
    "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
  ];

  let characteristic = null;

  for (const serviceUuid of candidateServices) {
    try {
      const service = await server.getPrimaryService(serviceUuid);
      for (const chUuid of candidateCharacteristics) {
        try {
          characteristic = await service.getCharacteristic(chUuid);
          if (characteristic) break;
        } catch {}
      }
      if (characteristic) break;
    } catch {}
  }

  if (!characteristic) {
    throw new Error("Keine passende Bluetooth-Write-Characteristic gefunden.");
  }

  state.bluetoothDevice = device;
  state.bluetoothCharacteristic = characteristic;

  state.settings.bluetoothDeviceName = device.name || "";
  state.settings.bluetoothDeviceIdentifier = device.id || "";
  saveSettings(state.settings);

  setStatus("settingsStatus", `Bluetooth verbunden: ${device.name || "Unbekannt"}`);
}

async function sendBluetooth(payload) {
  if (!navigator.bluetooth) {
    throw new Error("Web Bluetooth nicht verfügbar.");
  }

  if (!state.bluetoothCharacteristic) {
    throw new Error("Kein Bluetooth-Drucker verbunden.");
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(payload);

  const chunkSize = 180;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    await state.bluetoothCharacteristic.writeValue(chunk);
  }

  setStatus("receiveStatus", "Bluetooth-Druck gesendet.");
}

/* =========================
   Settings
========================= */

function loadSettingsIntoForm() {
  if ($("printerMode")) $("printerMode").value = state.settings.printerMode;
  if ($("printerIP")) $("printerIP").value = state.settings.printerIP;
  if ($("printerPort")) $("printerPort").value = state.settings.printerPort;
  if ($("bluetoothDeviceIdentifier")) $("bluetoothDeviceIdentifier").value = state.settings.bluetoothDeviceIdentifier;
  if ($("bluetoothDeviceName")) $("bluetoothDeviceName").value = state.settings.bluetoothDeviceName;
}

function saveSettingsFromForm() {
  state.settings = {
    ...state.settings,
    printerMode: $("printerMode")?.value || "label",
    printerIP: $("printerIP")?.value.trim() || "",
    printerPort: Number($("printerPort")?.value || 9100),
    bluetoothDeviceIdentifier: $("bluetoothDeviceIdentifier")?.value.trim() || "",
    bluetoothDeviceName: $("bluetoothDeviceName")?.value.trim() || state.settings.bluetoothDeviceName || ""
  };

  saveSettings(state.settings);
  setStatus("settingsStatus", "Einstellungen gespeichert.");
}

async function runTestPrint() {
  const fakePkg = {
    id: crypto.randomUUID(),
    slot: 123,
    firstName: "Test",
    lastName: "Mustermann",
    street: "Musterstraße",
    houseNo: "1",
    postalCode: "12345",
    city: "Berlin",
    arrivalAt: new Date().toISOString()
  };

  await printLabelForPackage(fakePkg);
}

/* =========================
   Event Binding
========================= */

function bindEvents() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("saveBtn")?.addEventListener("click", async () => {
    try {
      const fields = readReceiveForm();
      const pkg = await createPackage(fields);
      setStatus("receiveStatus", `Gespeichert: Paket #${padSlot(pkg.slot)}`);
      clearReceiveForm();
      renderResults();
    } catch (err) {
      setStatus("receiveStatus", err.message || "Fehler beim Speichern.", true);
    }
  });

  $("clearBtn")?.addEventListener("click", () => {
    clearReceiveForm();
    setStatus("receiveStatus", "");
  });

  $("searchQuery")?.addEventListener("input", e => {
    state.searchQuery = e.target.value;
    renderResults();
  });

  $("sortBy")?.addEventListener("change", e => {
    state.sortBy = e.target.value;
    renderResults();
  });

  $("sortAscending")?.addEventListener("change", e => {
    state.sortAscending = e.target.checked;
    renderResults();
  });

  $("saveSettingsBtn")?.addEventListener("click", saveSettingsFromForm);

  $("testPrintBtn")?.addEventListener("click", async () => {
    try {
      await runTestPrint();
      setStatus("settingsStatus", "Testdruck gestartet.");
    } catch (err) {
      setStatus("settingsStatus", err.message || "Testdruck fehlgeschlagen.", true);
    }
  });

  $("connectBluetoothBtn")?.addEventListener("click", async () => {
    try {
      await connectBluetoothPrinter();
    } catch (err) {
      setStatus("settingsStatus", err.message || "Bluetooth-Verbindung fehlgeschlagen.", true);
    }
  });

  $("startCameraBtn")?.addEventListener("click", async () => {
    try {
      await startCamera();
    } catch (err) {
      setStatus("receiveStatus", err.message || "Kamera konnte nicht gestartet werden.", true);
    }
  });

  $("stopCameraBtn")?.addEventListener("click", () => {
    stopCamera();
    setStatus("receiveStatus", "Kamera gestoppt.");
  });

  $("capturePhotoBtn")?.addEventListener("click", () => {
    try {
      capturePhoto();
    } catch (err) {
      setStatus("receiveStatus", err.message || "Foto fehlgeschlagen.", true);
    }
  });

  $("runOCRBtn")?.addEventListener("click", async () => {
    try {
      await runOCRFromCurrentImage();
    } catch (err) {
      setStatus("receiveStatus", err.message || "OCR fehlgeschlagen.", true);
    }
  });

  window.addEventListener("beforeunload", stopCamera);
}

/* =========================
   Init
========================= */

async function init() {
  state.settings = loadSettings();
  state.db = await openDB();
  await loadPackagesFromDB();

  loadSettingsIntoForm();
  bindEvents();
  renderResults();

  try {
    const count = await pendingPrintCount();
    if (count > 0) {
      setStatus("settingsStatus", `${count} Druckauftrag/-aufträge in Warteschlange.`);
    }
  } catch {}
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch(err => {
    console.error(err);
    alert("Initialisierung fehlgeschlagen: " + (err.message || err));
  });
});
