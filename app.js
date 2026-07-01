const observationStorageKey = "land-use-observations-v2";
const lensStorageKey = "land-use-lenses-v2";
const authorStorageKey = "land-use-current-author-v1";
const defaultCenter = [35.7479, 139.5419];

const defaultLenses = [
  { id: "station", label: "駅前・交通", prompt: "人の流れ、店、バス停、駐輪場の集まり方を見る" },
  { id: "housing", label: "住宅", prompt: "戸建て、集合住宅、団地で周囲の使われ方を比べる" },
  { id: "green", label: "公園・水辺", prompt: "緑や水が生活空間とどうつながるかを見る" },
  { id: "slope", label: "地形・高低差", prompt: "坂、谷、道の曲がり方が土地利用に効いているかを見る" },
  { id: "public", label: "公共施設", prompt: "学校、役所、集会所、広場の位置と役割を見る" },
  { id: "change", label: "変化の跡", prompt: "建て替え、空き地、古い地名や施設の名残を見る" }
];

let map;
let currentLocation = null;
let userMarker = null;
let accuracyCircle = null;
let draftLatLng = null;
let observations = loadArray(observationStorageKey, []);
let lenses = loadArray(lensStorageKey, defaultLenses);
let currentAuthor = localStorage.getItem(authorStorageKey) || "";
const observationMarkers = new Map();

function loadArray(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(saved) && saved.length ? saved : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function saveObservations() {
  localStorage.setItem(observationStorageKey, JSON.stringify(observations));
}

function saveLenses() {
  localStorage.setItem(lensStorageKey, JSON.stringify(lenses));
}

function initMap() {
  if (!window.L) {
    document.getElementById("mapLoading").textContent = "地図を読み込めませんでした";
    return;
  }
  map = L.map("map", { zoomControl: false, attributionControl: true }).setView(defaultCenter, 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);
  L.control.zoom({ position: "topright" }).addTo(map);
  map.on("click", event => openObservationForm(event.latlng));
  renderObservationMarkers();
  document.getElementById("mapLoading").style.display = "none";
}

function renderObservationMarkers() {
  if (!map || !window.L) return;
  observationMarkers.forEach(marker => map.removeLayer(marker));
  observationMarkers.clear();
  observations.forEach(item => {
    const icon = L.divIcon({
      className: "observation-marker",
      html: "●",
      iconSize: [32, 32]
    });
    const marker = L.marker([item.lat, item.lng], { icon })
      .addTo(map)
      .on("click", () => openObservationDetail(item.id));
    observationMarkers.set(item.id, marker);
  });
}

function render() {
  document.getElementById("pinCount").textContent = `${observations.length}件`;
  document.getElementById("summaryText").textContent =
    observations.length ? `${observations.length}件の気づきが保存されています。` : "地図を見て、気になった場所にピンとコメントを残せます。";
  renderLensGrid();
  renderPortfolio();
  renderSharedBoard();
  renderAuthorFilter();
  renderAdminLensList();
  renderObservationMarkers();
}

function renderLensGrid() {
  const grid = document.getElementById("lensGrid");
  grid.innerHTML = lenses.map(lens => `
    <button class="lens-chip" type="button" onclick="startObservationWithLens('${escapeForAttribute(lens.id)}')">
      <strong>${escapeHtml(lens.label)}</strong>
      <small>${escapeHtml(lens.prompt)}</small>
    </button>
  `).join("");
}

function renderPortfolio() {
  const list = document.getElementById("portfolioList");
  if (!observations.length) {
    list.innerHTML = `<div class="empty-state">まだ記録はありません。地図をタップして、最初の気づきを残してください。</div>`;
    return;
  }
  list.innerHTML = sortedObservations().map(item => noteCard(item, { editable: true })).join("");
}

function renderSharedBoard() {
  const board = document.getElementById("sharedBoard");
  const filter = document.getElementById("authorFilter")?.value || "all";
  const items = sortedObservations().filter(item => filter === "all" || item.author === filter);
  if (!items.length) {
    board.innerHTML = `<div class="empty-state">まだ共有できる気づきはありません。地図から記録を追加すると、ここに表示されます。</div>`;
    return;
  }
  board.innerHTML = items.map(item => noteCard(item, { editable: false })).join("");
}

function renderAuthorFilter() {
  const select = document.getElementById("authorFilter");
  if (!select) return;
  const previous = select.value || "all";
  const authors = [...new Set(observations.map(item => item.author || "名前なし"))].sort((a, b) => a.localeCompare(b, "ja"));
  select.innerHTML = `<option value="all">全員</option>${authors.map(author => `<option value="${escapeForAttribute(author)}">${escapeHtml(author)}</option>`).join("")}`;
  select.value = authors.includes(previous) ? previous : "all";
}

function noteCard(item, { editable }) {
  return `
    <article class="note-card">
      <button class="note-map-button" type="button" onclick="focusObservation('${item.id}')">地図で見る</button>
      <span>${escapeHtml(item.category)}</span>
      <strong>${escapeHtml(item.title || "無題の気づき")}</strong>
      <p>${escapeHtml(item.comment)}</p>
      <small>${escapeHtml(item.author || "名前なし")} / ${formatDate(item.createdAt)} / ${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}</small>
      ${editable ? `
        <div class="note-actions">
          <button type="button" onclick="editObservation('${item.id}')">編集</button>
          <button type="button" class="delete" onclick="deleteObservation('${item.id}')">削除</button>
        </div>
      ` : ""}
    </article>
  `;
}

function sortedObservations() {
  return observations.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function openObservationForm(latlng, existing = null, lensId = "") {
  draftLatLng = latlng;
  const selectedLens = existing?.lensId || lensId || lenses[0]?.id || "";
  const author = existing?.author || currentAuthor;
  document.getElementById("sheetContent").innerHTML = `
    <span class="sheet-number">OBSERVATION</span>
    <h2 class="sheet-title" id="sheetTitle">${existing ? "気づきを編集" : "気づきを追加"}</h2>
    <p class="sheet-meta">${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</p>
    <form id="observationForm" class="observation-form">
      <label>名前
        <input id="observationAuthor" required maxlength="24" placeholder="例: 佐藤" value="${escapeForAttribute(author)}" />
      </label>
      <label>視点
        <select id="observationLens">
          ${lenses.map(lens => `<option value="${escapeForAttribute(lens.id)}" ${lens.id === selectedLens ? "selected" : ""}>${escapeHtml(lens.label)}</option>`).join("")}
        </select>
      </label>
      <label>見出し
        <input id="observationTitle" maxlength="40" placeholder="例: 駅前から住宅地への切り替わり" value="${escapeForAttribute(existing?.title || "")}" />
      </label>
      <label>気づいたこと
        <textarea id="observationComment" required placeholder="見えたこと、気づいた違い、なぜそうなっていると思うかを書いてください">${escapeHtml(existing?.comment || "")}</textarea>
      </label>
      <button class="primary-button" type="submit">${existing ? "更新する" : "保存して共有する"}</button>
    </form>
  `;
  document.getElementById("observationForm").onsubmit = event => {
    event.preventDefault();
    saveObservation(existing?.id || null);
  };
  showSheet();
}

function saveObservation(id = null) {
  const author = document.getElementById("observationAuthor").value.trim();
  const lensId = document.getElementById("observationLens").value;
  const lens = lenses.find(item => item.id === lensId);
  const title = document.getElementById("observationTitle").value.trim();
  const comment = document.getElementById("observationComment").value.trim();
  if (!author) {
    toast("名前を入力してください");
    return;
  }
  if (!comment) {
    toast("気づいたことを入力してください");
    return;
  }
  currentAuthor = author;
  localStorage.setItem(authorStorageKey, currentAuthor);
  if (id) {
    observations = observations.map(item => item.id === id ? {
      ...item,
      author,
      lensId,
      category: lens?.label || "未分類",
      title,
      comment,
      updatedAt: new Date().toISOString()
    } : item);
  } else {
    observations.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      author,
      lensId,
      category: lens?.label || "未分類",
      title,
      comment,
      lat: draftLatLng.lat,
      lng: draftLatLng.lng,
      createdAt: new Date().toISOString()
    });
  }
  saveObservations();
  closeSheet();
  render();
  toast(id ? "気づきを更新しました" : "気づきを保存して共有しました");
}

function openObservationDetail(id) {
  const item = observations.find(entry => entry.id === id);
  if (!item) return;
  document.getElementById("sheetContent").innerHTML = `
    <span class="sheet-number">${escapeHtml(item.category)}</span>
    <h2 class="sheet-title" id="sheetTitle">${escapeHtml(item.title || "無題の気づき")}</h2>
    <p class="sheet-meta">${escapeHtml(item.author || "名前なし")} / ${formatDate(item.createdAt)} / ${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}</p>
    <div class="hint-box">
      <small>気づいたこと</small>
      <p>${escapeHtml(item.comment)}</p>
    </div>
    <button class="primary-button" type="button" onclick="editObservation('${item.id}')">編集する</button>
    <button class="demo-button" type="button" onclick="deleteObservation('${item.id}')">削除する</button>
  `;
  showSheet();
}

function editObservation(id) {
  const item = observations.find(entry => entry.id === id);
  if (!item) return;
  openObservationForm({ lat: item.lat, lng: item.lng }, item);
}

function deleteObservation(id) {
  const item = observations.find(entry => entry.id === id);
  if (!item || !confirm(`「${item.title || "無題の気づき"}」を削除しますか？`)) return;
  observations = observations.filter(entry => entry.id !== id);
  saveObservations();
  closeSheet();
  render();
  toast("気づきを削除しました");
}

function focusObservation(id) {
  const item = observations.find(entry => entry.id === id);
  if (!item || !map) return;
  switchScreen("mapScreen");
  map.setView([item.lat, item.lng], 17);
  openObservationDetail(id);
}

function startObservationWithLens(lensId) {
  const center = currentLocation || map.getCenter();
  openObservationForm({ lat: center.lat, lng: center.lng }, null, lensId);
}

function requestLocation({ addPin = false } = {}) {
  if (!navigator.geolocation) {
    toast("この端末では現在地を取得できません");
    return;
  }
  const status = document.getElementById("locationStatus");
  status.innerHTML = "<span></span> 現在地: 取得中...";
  navigator.geolocation.getCurrentPosition(position => {
    currentLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy
    };
    if (userMarker) map.removeLayer(userMarker);
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    accuracyCircle = L.circle([currentLocation.lat, currentLocation.lng], {
      radius: currentLocation.accuracy,
      color: "#1e6ad2",
      weight: 1,
      fillOpacity: 0.06
    }).addTo(map);
    userMarker = L.circleMarker([currentLocation.lat, currentLocation.lng], {
      radius: 8,
      color: "white",
      weight: 3,
      fillColor: "#1e6ad2",
      fillOpacity: 1
    }).addTo(map);
    map.setView([currentLocation.lat, currentLocation.lng], 16);
    status.classList.add("active");
    status.innerHTML = `<span></span> 現在地: 取得済み 誤差約${Math.round(currentLocation.accuracy)}m`;
    if (addPin) openObservationForm({ lat: currentLocation.lat, lng: currentLocation.lng });
  }, () => {
    status.classList.remove("active");
    status.innerHTML = "<span></span> 現在地: 取得できません";
    toast("現在地を取得できませんでした");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
}

function renderAdminLensList() {
  const list = document.getElementById("adminLensList");
  if (!list) return;
  list.innerHTML = lenses.map(lens => `
    <article class="admin-lens-row">
      <div>
        <strong>${escapeHtml(lens.label)}</strong>
        <p>${escapeHtml(lens.prompt)}</p>
      </div>
      <div class="admin-row-actions">
        <button type="button" onclick="editLens('${escapeForAttribute(lens.id)}')">編集</button>
        <button type="button" class="delete" onclick="deleteLens('${escapeForAttribute(lens.id)}')">削除</button>
      </div>
    </article>
  `).join("");
}

function saveLens(event) {
  event.preventDefault();
  const id = document.getElementById("lensId").value || createId("lens");
  const label = document.getElementById("lensLabel").value.trim();
  const prompt = document.getElementById("lensPrompt").value.trim();
  if (!label || !prompt) {
    toast("視点名と問いを入力してください");
    return;
  }
  const exists = lenses.some(lens => lens.id === id);
  if (exists) {
    lenses = lenses.map(lens => lens.id === id ? { ...lens, label, prompt } : lens);
    observations = observations.map(item => item.lensId === id ? { ...item, category: label } : item);
    saveObservations();
  } else {
    lenses.push({ id, label, prompt });
  }
  saveLenses();
  clearLensForm();
  render();
  toast(exists ? "視点を更新しました" : "視点を追加しました");
}

function editLens(id) {
  const lens = lenses.find(item => item.id === id);
  if (!lens) return;
  document.getElementById("lensId").value = lens.id;
  document.getElementById("lensLabel").value = lens.label;
  document.getElementById("lensPrompt").value = lens.prompt;
  document.getElementById("lensLabel").focus();
}

function deleteLens(id) {
  if (lenses.length <= 1) {
    toast("視点は最低1つ必要です");
    return;
  }
  const lens = lenses.find(item => item.id === id);
  if (!lens || !confirm(`視点「${lens.label}」を削除しますか？`)) return;
  lenses = lenses.filter(item => item.id !== id);
  saveLenses();
  clearLensForm();
  render();
  toast("視点を削除しました");
}

function clearLensForm() {
  document.getElementById("lensId").value = "";
  document.getElementById("lensLabel").value = "";
  document.getElementById("lensPrompt").value = "";
}

function showAllOnMap() {
  switchScreen("mapScreen");
  if (!map || !window.L || !observations.length) return;
  const bounds = L.latLngBounds(observations.map(item => [item.lat, item.lng]));
  map.fitBounds(bounds, { padding: [42, 42], maxZoom: 16 });
}

function resetObservations() {
  if (!observations.length) {
    toast("削除する記録はありません");
    return;
  }
  if (!confirm("この端末に保存された記録をすべて削除しますか？")) return;
  observations = [];
  saveObservations();
  render();
  toast("記録をリセットしました");
}

function switchScreen(screenId) {
  document.querySelectorAll(".bottom-nav button, .screen").forEach(element => element.classList.remove("active"));
  document.querySelector(`[data-screen="${screenId}"]`)?.classList.add("active");
  document.getElementById(screenId)?.classList.add("active");
  if (screenId === "mapScreen" && map) setTimeout(() => map.invalidateSize(), 50);
}

function showSheet() {
  document.getElementById("sheetBackdrop").classList.add("show");
  document.getElementById("observationSheet").classList.add("show");
}

function closeSheet() {
  document.getElementById("sheetBackdrop").classList.remove("show");
  document.getElementById("observationSheet").classList.remove("show");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function escapeForAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

document.querySelectorAll(".bottom-nav button").forEach(button => {
  button.addEventListener("click", () => switchScreen(button.dataset.screen));
});

document.getElementById("locationButton").onclick = () => requestLocation();
document.getElementById("addHereButton").onclick = () => requestLocation({ addPin: true });
document.getElementById("authorFilter").onchange = renderSharedBoard;
document.getElementById("showAllOnMapButton").onclick = showAllOnMap;
document.getElementById("lensForm").onsubmit = saveLens;
document.getElementById("cancelLensEditButton").onclick = clearLensForm;
document.getElementById("resetButton").onclick = resetObservations;
document.getElementById("sheetClose").onclick = closeSheet;
document.getElementById("sheetBackdrop").onclick = closeSheet;

const modal = document.getElementById("modalBackdrop");
const closeModal = () => modal.classList.remove("show");
document.getElementById("helpButton").onclick = () => modal.classList.add("show");
document.getElementById("modalClose").onclick = closeModal;
document.getElementById("modalOk").onclick = closeModal;

window.startObservationWithLens = startObservationWithLens;
window.editObservation = editObservation;
window.deleteObservation = deleteObservation;
window.focusObservation = focusObservation;
window.editLens = editLens;
window.deleteLens = deleteLens;

initMap();
render();
setTimeout(() => modal.classList.add("show"), 450);
