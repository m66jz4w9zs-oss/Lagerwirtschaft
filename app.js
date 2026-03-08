const STORAGE_KEYS = {
  packages: "paketlager_packages",
  settings: "paketlager_settings"
};

const defaultSettings = {
  printerMode: "label",
  printerIP: "",
  printerPort: 9100,
  bluetoothDeviceIdentifier: ""
};

const state = {
  packages: [],
  settings: { ...defaultSettings },
  searchQuery: "",
  sortBy: "arrival",
  sortAscending: false
};

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

function loadPackages() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.packages) || "[]");
  } catch {
    return [];
  }
}

function savePackages(items) {
  localStorage.setItem(STORAGE_KEYS.packages, JSON.stringify(items));
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

function allocateSlot(items) {
  const used = items.map(x => Number(x.slot)).filter(Number.isFinite).sort((a, b) => a - b);
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

function createPackage(fields) {
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

  state.packages.push(pkg);
  savePackages(state.packages);
  return pkg;
}

function deletePackage(id) {
  state.packages = state.packages.filter(x => x.id !== id);
  savePackages(state.packages);
}

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

function setStatus(id, text, isError = false) {
  const el = document.getElementById(id);
  el.textContent = text || "";
  el.classList.toggle("error", !!isError);
}

function clearReceiveForm() {
  document.getElementById("firstName").value = "";
  document.getElementById("lastName").value = "";
  document.getElementById("street").value = "";
  document.getElementById("houseNo").value = "";
  document.getElementById("postalCode").value = "";
  document.getElementById("city").value = "";
}

function readReceiveForm() {
  return {
    firstName: document.getElementById("firstName").value,
    lastName: document.getElementById("lastName").value,
    street: document.getElementById("street").value,
    houseNo: document.getElementById("houseNo").value,
    postalCode: document.getElementById("postalCode").value,
    city: document.getElementById("city").value
  };
}

function renderResults() {
  const container = document.getElementById("results");
  container.innerHTML = "";

  const items = getFilteredAndSortedPackages();

  if (items.length === 0) {
    container.innerHTML = `<div class="empty">Keine Pakete gefunden.</div>`;
    return;
  }

  const tpl = document.getElementById("resultItemTemplate");

  for (const pkg of items) {
    const node = tpl.content.firstElementChild.cloneNode(true);

    node.querySelector(".result-number").textContent = padSlot(pkg.slot);
    node.querySelector(".result-name").textContent = fullName(pkg);
    node.querySelector(".result-address").textContent =
      `${addressLine(pkg)}, ${pkg.postalCode} ${pkg.city}`.trim();
    node.querySelector(".result-date").textContent =
      formatDateTimeDE(new Date(pkg.arrivalAt));

    node.querySelector(".delete-btn").addEventListener("click", () => {
      const ok = confirm(`Paket ${padSlot(pkg.slot)} wirklich löschen?`);
      if (!ok) return;
      deletePackage(pkg.id);
      renderResults();
    });

    container.appendChild(node);
  }
}

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
}

function loadSettingsIntoForm() {
  document.getElementById("printerMode").value = state.settings.printerMode;
  document.getElementById("printerIP").value = state.settings.printerIP;
  document.getElementById("printerPort").value = state.settings.printerPort;
  document.getElementById("bluetoothDeviceIdentifier").value = state.settings.bluetoothDeviceIdentifier;
}

function saveSettingsFromForm() {
  state.settings = {
    printerMode: document.getElementById("printerMode").value,
    printerIP: document.getElementById("printerIP").value.trim(),
    printerPort: Number(document.getElementById("printerPort").value || 9100),
    bluetoothDeviceIdentifier: document.getElementById("bluetoothDeviceIdentifier").value.trim()
  };

  saveSettings(state.settings);
  setStatus("settingsStatus", "Einstellungen gespeichert.");
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    try {
      const fields = readReceiveForm();
      const pkg = createPackage(fields);
      setStatus(
        "receiveStatus",
        `Gespeichert: Paket #${padSlot(pkg.slot)} am ${formatDateDE(new Date(pkg.arrivalAt))}`
      );
      clearReceiveForm();
      renderResults();
    } catch (err) {
      setStatus("receiveStatus", err.message || "Fehler beim Speichern.", true);
    }
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    clearReceiveForm();
    setStatus("receiveStatus", "");
  });

  document.getElementById("searchQuery").addEventListener("input", e => {
    state.searchQuery = e.target.value;
    renderResults();
  });

  document.getElementById("sortBy").addEventListener("change", e => {
    state.sortBy = e.target.value;
    renderResults();
  });

  document.getElementById("sortAscending").addEventListener("change", e => {
    state.sortAscending = e.target.checked;
    renderResults();
  });

  document.getElementById("saveSettingsBtn").addEventListener("click", saveSettingsFromForm);
}

function init() {
  state.packages = loadPackages();
  state.settings = loadSettings();

  loadSettingsIntoForm();
  bindEvents();
  renderResults();
}

document.addEventListener("DOMContentLoaded", init);
