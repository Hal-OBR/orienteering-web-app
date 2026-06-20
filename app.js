const defaultCheckpoints = [
  { id: 1, name: "ひばりヶ丘駅の表と裏", lat: 35.7515231, lng: 139.5455333, points: 20, distance: "スタート地点", category: "交通・都市", hint: "駅の北口と南口を見比べられる場所から、道幅や建物の並びを観察します。", mission: "北口と南口で、駅前の風景が最も違うと感じた点を1つ記録してください。", explain: "鉄道駅は同じ駅でも出口ごとに道路、商業、住宅の配置が異なります。駅を境にした街の成り立ちを読む入口です。" },
  { id: 2, name: "ひばりヶ丘公園と駅前の余白", lat: 35.7520648, lng: 139.5432675, points: 25, distance: "約250m", category: "土地利用", hint: "駅や線路に近い公園です。周囲の住宅・店舗・線路との位置関係を見てみよう。", mission: "この場所が公園であることで、駅前の街にどんな役割を果たしていると思いますか？", explain: "地図上の緑地は、休憩場所だけでなく、周辺の建物密度や人の流れを観察する手がかりにもなります。" },
  { id: 3, name: "『谷戸』の地名を読む", lat: 35.7476968, lng: 139.5421435, points: 30, distance: "約650m", category: "地名・地形", hint: "谷戸イチョウ公園の周辺。駅から歩いてきた道の傾きも思い出してみよう。", mission: "『谷戸』という地名から想像する地形と、実際に歩いた感覚が一致するか記録してください。", explain: "地名は過去の地形や土地利用を考える手がかりです。ただし由来は一つとは限らないため、現地の起伏や古地図と合わせて確かめます。" },
  { id: 4, name: "ひばりが丘団地の配置", lat: 35.7452253, lng: 139.5365957, points: 40, distance: "約1.3km", category: "団地・都市計画", hint: "建物の向き、棟と棟の間隔、歩行者の道、緑の置かれ方に注目。", mission: "一般的な駅前の住宅地と違うと感じた『団地ならではの配置』を1つ見つけてください。", explain: "大規模団地では、住棟だけでなく道路、緑地、生活施設をまとめて計画した空間構成を観察できます。建替えによる変化も現地で確認したい点です。" },
  { id: 5, name: "谷戸せせらぎ公園の水と低地", lat: 35.7431216, lng: 139.5444632, points: 35, distance: "約1.2km", category: "水・微地形", hint: "公園の水辺と周囲の高さ、道路の傾きを見比べてみよう。", mission: "水がこの場所にある理由を、周囲の高低差から仮説として書いてください。", explain: "水辺の位置と地形には関係があることがあります。今回は現地観察から仮説を立て、資料で確かめる題材にします。" }
];

const storageKey = "orienteering-prototype-hibarigaoka-v1";
const checkpointStorageKey = "orienteering-checkpoints-hibarigaoka-v1";
const courseStorageKey = "orienteering-course-hibarigaoka-v1";
let checkpoints = JSON.parse(localStorage.getItem(checkpointStorageKey) || "null") || structuredClone(defaultCheckpoints);
let course = JSON.parse(localStorage.getItem(courseStorageKey) || "null") || { title: "ひばりヶ丘・地形とまちの変化を歩く", duration: "約75分", distance: "約3.0km" };
let state = JSON.parse(localStorage.getItem(storageKey) || '{"visited":{},"answers":{}}');
let selected = null;
let map;
const markers = new Map();
let userMarker = null;
let accuracyCircle = null;
let currentLocation = null;
let adminAuthenticated = false;
let temporaryAdminPassword = "";
const supabaseConfig = window.ORIENTEERING_CONFIG;
const supabaseClient = window.supabase && supabaseConfig?.supabaseUrl && supabaseConfig?.supabaseAnonKey
  ? window.supabase.createClient(supabaseConfig.supabaseUrl, supabaseConfig.supabaseAnonKey)
  : null;

function save() { localStorage.setItem(storageKey, JSON.stringify(state)); }
function score() { return checkpoints.filter(c => state.visited[c.id]).reduce((sum,c) => sum + c.points, 0); }

async function apiRequest(url, options = {}) {
  if (supabaseClient) return supabaseRequest(url, options);
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "通信に失敗しました");
  return data;
}

async function supabaseSharedData() {
  const { data: courseRows, error: courseError } = await supabaseClient
    .from("orienteering_courses").select("id,title,duration,distance,updated_at")
    .eq("is_active", true).order("id").limit(1);
  if (courseError) throw courseError;
  const activeCourse = courseRows?.[0];
  if (!activeCourse) throw new Error("公開中のコースがありません");
  const { data: pointRows, error: pointError } = await supabaseClient
    .from("orienteering_checkpoints")
    .select("id,course_id,name,lat,lng,points,distance,category,hint,mission,explain,sort_order")
    .eq("course_id", activeCourse.id).order("sort_order").order("id");
  if (pointError) throw pointError;
  return { course: activeCourse, checkpoints: pointRows || [] };
}

async function supabaseRequest(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  if (url === "/api/course" && method === "GET") return supabaseSharedData();
  if (url === "/api/admin/session" && method === "GET") {
    return { authenticated: Boolean(temporaryAdminPassword) };
  }
  if (url === "/api/admin/login" && method === "POST") {
    const { data, error } = await supabaseClient.rpc("orienteering_admin_verify", { p_password: body.password });
    if (error || !data) throw new Error("パスワードが違います");
    temporaryAdminPassword = body.password;
    return { authenticated: true };
  }
  if (url === "/api/admin/logout" && method === "POST") {
    temporaryAdminPassword = "";
    return { authenticated: false };
  }
  if (url === "/api/admin/course" && method === "PUT") {
    const { error } = await supabaseClient.rpc("orienteering_admin_update_course", {
      p_password: temporaryAdminPassword, p_course_id: course.id,
      p_title: body.title, p_duration: body.duration, p_distance: body.distance
    });
    if (error) throw error;
    return supabaseSharedData();
  }
  const match = url.match(/^\/api\/admin\/checkpoints(?:\/(\d+))?$/);
  if (match) {
    const id = match[1] ? Number(match[1]) : null;
    if (method === "DELETE" && id) {
      const { error } = await supabaseClient.rpc("orienteering_admin_delete_checkpoint", {
        p_password: temporaryAdminPassword, p_id: id, p_course_id: course.id
      });
      if (error) throw error;
      return supabaseSharedData();
    }
    const payload = {
      p_password: temporaryAdminPassword, p_id: id, p_course_id: course.id,
      p_name: body.name, p_lat: body.lat, p_lng: body.lng, p_points: body.points,
      p_distance: body.distance, p_category: body.category, p_hint: body.hint,
      p_mission: body.mission, p_explain: body.explain
    };
    if (method === "POST") {
      const { error } = await supabaseClient.rpc("orienteering_admin_save_checkpoint", payload);
      if (error) throw error;
      return supabaseSharedData();
    }
    if (method === "PUT" && id) {
      const { error } = await supabaseClient.rpc("orienteering_admin_save_checkpoint", payload);
      if (error) throw error;
      return supabaseSharedData();
    }
  }
  throw new Error("未対応の操作です");
}

function applySharedData(data) {
  if (!data?.course || !Array.isArray(data?.checkpoints)) return;
  course = data.course;
  checkpoints = data.checkpoints;
  localStorage.setItem(courseStorageKey, JSON.stringify(course));
  localStorage.setItem(checkpointStorageKey, JSON.stringify(checkpoints));
  renderMarkers(); render();
}

async function loadSharedData() {
  try { applySharedData(await apiRequest("/api/course")); }
  catch { toast("共有データを取得できないため、端末内データを表示しています"); }
}

function showAdminState(authenticated) {
  adminAuthenticated = authenticated;
  document.getElementById("adminLoginForm").hidden = authenticated;
  document.getElementById("adminContent").hidden = !authenticated;
}

async function checkAdminSession() {
  try { const data = await apiRequest("/api/admin/session"); showAdminState(data.authenticated); }
  catch { showAdminState(false); }
}

function initMap() {
  if (!window.L) { document.getElementById("mapLoading").textContent = "地図を読み込めませんでした"; return; }
  map = L.map("map", { zoomControl: false, attributionControl: true }).setView([35.7476, 139.5410], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  L.control.zoom({ position: "topright" }).addTo(map);
  renderMarkers();
  document.getElementById("mapLoading").style.display = "none";
}

function renderMarkers() {
  if (!map || !window.L) return;
  markers.forEach(marker => map.removeLayer(marker));
  markers.clear();
  checkpoints.forEach(cp => {
    const icon = L.divIcon({ className: `checkpoint-marker ${state.visited[cp.id] ? "visited" : ""}`, html: state.visited[cp.id] ? "✓" : cp.id, iconSize: [34,34] });
    const marker = L.marker([cp.lat, cp.lng], { icon }).addTo(map).on("click", () => openSheet(cp.id));
    markers.set(cp.id, marker);
  });
}

function render() {
  const visited = checkpoints.filter(c => state.visited[c.id]);
  const total = score();
  document.getElementById("courseTitle").textContent = course.title;
  document.getElementById("courseMeta").textContent = `全${checkpoints.length}地点・${course.duration}・${course.distance}（候補）`;
  document.getElementById("guideDuration").textContent = course.duration;
  document.getElementById("guideDistance").textContent = course.distance;
  document.getElementById("guidePoints").textContent = `全${checkpoints.length}地点`;
  document.getElementById("guideScore").textContent = `${checkpoints.reduce((sum, cp) => sum + cp.points, 0)} pt`;
  document.getElementById("headerScore").textContent = total;
  document.getElementById("visitedCount").textContent = `${visited.length} / ${checkpoints.length}`;
  document.getElementById("progressScore").textContent = `${total} pt`;
  document.getElementById("progressVisited").textContent = visited.length;
  const percent = Math.round(visited.length / checkpoints.length * 100);
  document.getElementById("progressPercent").textContent = `${percent}%`;
  document.getElementById("progressRing").style.setProperty("--progress", `${percent * 3.6}deg`);
  document.getElementById("halfBadge").classList.toggle("locked", visited.length < 3);
  document.getElementById("checkpointList").innerHTML = checkpoints.map(cp => `
    <button class="checkpoint-row ${state.visited[cp.id] ? "visited" : ""}" onclick="openSheet(${cp.id})">
      <span class="num">${state.visited[cp.id] ? "✓" : cp.id}</span>
      <span><strong>${cp.name}</strong><small>${cp.category} ・ ${distanceLabel(cp)}</small></span>
      <span class="points">${cp.points} pt</span>
    </button>`).join("");
  document.getElementById("visitLog").className = visited.length ? "" : "empty-state";
  document.getElementById("visitLog").innerHTML = visited.length ? visited.map(cp => `<article class="log-card"><strong>✓ ${cp.name}　+${cp.points} pt</strong><p>${escapeHtml(state.answers[cp.id] || "回答なし")}</p></article>`).join("") : "まだ訪問した地点はありません。<br />地図から最初の場所を探してみましょう。";
  markers.forEach((marker,id) => marker.setIcon(L.divIcon({ className:`checkpoint-marker ${state.visited[id] ? "visited" : ""}`, html:state.visited[id] ? "✓" : id, iconSize:[34,34] })));
  renderAdmin();
}

function distanceLabel(cp) {
  if (!currentLocation) return cp.distance || "距離未計測";
  const meters = distance(currentLocation.lat, currentLocation.lng, cp.lat, cp.lng);
  return meters < 1000 ? `現在地から約${Math.round(meters / 10) * 10}m` : `現在地から約${(meters / 1000).toFixed(1)}km`;
}

function openSheet(id) {
  selected = checkpoints.find(c => c.id === id);
  const done = state.visited[id];
  document.getElementById("sheetContent").innerHTML = done ? `
    <span class="sheet-number">CHECKPOINT ${selected.id} ・ ${selected.category}</span><h2 class="sheet-title" id="sheetTitle">${selected.name}</h2><p class="sheet-meta">${selected.points} pt 獲得済み</p>
    <div class="complete-banner">✓ チェックイン完了</div><div class="explain"><strong>この場所の解説</strong><br>${selected.explain}</div>
    <div class="hint-box"><small>あなたの発見</small><p>${escapeHtml(state.answers[id] || "回答なし")}</p></div>` : `
    <span class="sheet-number">CHECKPOINT ${selected.id} ・ ${selected.category}</span><h2 class="sheet-title" id="sheetTitle">${selected.name}</h2><p class="sheet-meta">${distanceLabel(selected)} ・ ${selected.points} pt</p>
    <div class="hint-box"><small>場所のヒント</small><p>${selected.hint}</p></div>
    <div class="mission-box"><small>現地ミッション</small><p>${selected.mission}</p></div>
    <button class="primary-button" onclick="tryCheckin()">現在地でチェックイン</button><button class="demo-button" onclick="showAnswer()">デモでチェックインする</button>`;
  document.getElementById("sheetBackdrop").classList.add("show"); document.getElementById("checkpointSheet").classList.add("show");
}
function closeSheet(){ document.getElementById("sheetBackdrop").classList.remove("show"); document.getElementById("checkpointSheet").classList.remove("show"); }
function showAnswer(){ document.getElementById("sheetContent").innerHTML = `<span class="sheet-number">CHECKPOINT ${selected.id}</span><h2 class="sheet-title" id="sheetTitle">現地で発見したこと</h2><p class="sheet-meta">正解を当てるより、観察したことを残してみましょう。</p><div class="mission-box"><small>ミッション</small><p>${selected.mission}</p></div><textarea class="answer-area" id="answerInput" placeholder="例：坂の下側に建物の入口がもう一つあり、高低差を利用していた。"></textarea><button class="primary-button" onclick="completeCheckin()">回答して ${selected.points} pt を獲得</button>`; }
function completeCheckin(){ const input=document.getElementById("answerInput"); state.visited[selected.id]=true; state.answers[selected.id]=input.value.trim() || "現地で確認しました"; save(); render(); openSheet(selected.id); toast(`${selected.points} pt 獲得しました！`); }
function tryCheckin(){
  if(!navigator.geolocation){ toast("位置情報が利用できません。デモ操作をお試しください"); return; }
  toast("現在地を確認しています…");
  navigator.geolocation.getCurrentPosition(pos => { const d=distance(pos.coords.latitude,pos.coords.longitude,selected.lat,selected.lng); if(d<120) showAnswer(); else toast(`地点まで約${Math.round(d)}mです（120m以内でチェックイン）`); }, () => toast("位置情報を取得できません。デモ操作をお試しください"), {enableHighAccuracy:true,timeout:8000});
}
function distance(a,b,c,d){const r=6371000,p=Math.PI/180,x=(c-a)*p,y=(d-b)*p*Math.cos((a+c)*p/2);return Math.sqrt(x*x+y*y)*r}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}
function toast(message){const el=document.getElementById("toast");el.textContent=message;el.classList.add("show");clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.remove("show"),2600)}

document.querySelectorAll(".bottom-nav button").forEach(btn => btn.addEventListener("click", () => { document.querySelectorAll(".bottom-nav button,.screen").forEach(x=>x.classList.remove("active"));btn.classList.add("active");document.getElementById(btn.dataset.screen).classList.add("active");if(btn.dataset.screen==="mapScreen"&&map)setTimeout(()=>map.invalidateSize(),50);if(btn.dataset.screen==="adminScreen")checkAdminSession(); }));
document.getElementById("sheetClose").onclick=closeSheet; document.getElementById("sheetBackdrop").onclick=closeSheet;
const modal=document.getElementById("modalBackdrop"); const closeModal=()=>modal.classList.remove("show"); document.getElementById("helpButton").onclick=()=>modal.classList.add("show"); document.getElementById("modalClose").onclick=closeModal; document.getElementById("modalOk").onclick=closeModal;
function requestLocation({ center = true, fillForm = false } = {}) {
  if (!navigator.geolocation) { toast("この端末では位置情報を利用できません"); return; }
  const status = document.getElementById("locationStatus");
  status.innerHTML = "<span></span> 現在地：取得中…";
  navigator.geolocation.getCurrentPosition(p => {
    currentLocation = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
    if (userMarker) map.removeLayer(userMarker);
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    accuracyCircle = L.circle([currentLocation.lat, currentLocation.lng], { radius: currentLocation.accuracy, color: "#2876d1", weight: 1, fillOpacity: .07 }).addTo(map);
    userMarker = L.circleMarker([currentLocation.lat, currentLocation.lng], { radius: 8, color: "white", weight: 3, fillColor: "#2876d1", fillOpacity: 1 }).addTo(map).bindTooltip("現在地");
    if (center) map.setView([currentLocation.lat, currentLocation.lng], 16);
    status.classList.add("active"); status.innerHTML = `<span></span> 現在地：取得済み（誤差 約${Math.round(currentLocation.accuracy)}m）`;
    if (fillForm) { document.getElementById("checkpointLat").value = currentLocation.lat.toFixed(7); document.getElementById("checkpointLng").value = currentLocation.lng.toFixed(7); }
    render(); toast("現在地と各地点までの距離を更新しました");
  }, () => { status.classList.remove("active"); status.innerHTML = "<span></span> 現在地：取得できません"; toast("位置情報を取得できませんでした"); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
}

function renderAdmin() {
  document.getElementById("adminCourseTitle").value = course.title;
  document.getElementById("adminDuration").value = course.duration;
  document.getElementById("adminDistance").value = course.distance;
  document.getElementById("adminCheckpointList").innerHTML = checkpoints.length ? checkpoints.map((cp, index) => `<div class="admin-point-row"><span class="admin-num">${index + 1}</span><span><strong>${escapeHtml(cp.name)}</strong><small>${escapeHtml(cp.category)} ・ ${cp.points} pt　${cp.lat.toFixed(5)}, ${cp.lng.toFixed(5)}</small></span><span class="admin-actions"><button type="button" onclick="openAdminForm(${cp.id})">編集</button><button type="button" class="delete" onclick="deleteCheckpoint(${cp.id})">削除</button></span></div>`).join("") : '<div class="empty-state">チェックポイントがありません。</div>';
}

function openAdminForm(id = null) {
  const cp = checkpoints.find(item => item.id === id);
  document.getElementById("adminModalTitle").textContent = cp ? "チェックポイントを編集" : "チェックポイントを追加";
  document.getElementById("checkpointId").value = cp?.id || "";
  document.getElementById("checkpointName").value = cp?.name || "";
  document.getElementById("checkpointCategory").value = cp?.category || "";
  document.getElementById("checkpointPoints").value = cp?.points ?? 20;
  document.getElementById("checkpointLat").value = cp?.lat ?? currentLocation?.lat ?? "";
  document.getElementById("checkpointLng").value = cp?.lng ?? currentLocation?.lng ?? "";
  document.getElementById("checkpointHint").value = cp?.hint || "";
  document.getElementById("checkpointMission").value = cp?.mission || "";
  document.getElementById("checkpointExplain").value = cp?.explain || "";
  document.getElementById("adminModalBackdrop").classList.add("show");
}

function closeAdminForm() { document.getElementById("adminModalBackdrop").classList.remove("show"); }
async function deleteCheckpoint(id) {
  const cp = checkpoints.find(item => item.id === id);
  if (!cp || !confirm(`「${cp.name}」を削除しますか？`)) return;
  try {
    const data = await apiRequest(`/api/admin/checkpoints/${id}`, { method: "DELETE" });
    delete state.visited[id]; delete state.answers[id]; save(); applySharedData(data); toast("チェックポイントを削除しました");
  } catch (error) { toast(error.message); if (error.message.includes("ログイン")) showAdminState(false); }
}

document.getElementById("locationButton").onclick=()=>requestLocation();
document.getElementById("courseForm").onsubmit=async e=>{e.preventDefault();const update={title:document.getElementById("adminCourseTitle").value.trim(),duration:document.getElementById("adminDuration").value.trim(),distance:document.getElementById("adminDistance").value.trim()};try{applySharedData(await apiRequest("/api/admin/course",{method:"PUT",body:JSON.stringify(update)}));toast("コース設定を共有データベースへ保存しました")}catch(error){toast(error.message)}};
document.getElementById("addCheckpointButton").onclick=()=>openAdminForm();
document.getElementById("adminModalClose").onclick=closeAdminForm;
document.getElementById("adminModalBackdrop").addEventListener("click",e=>{if(e.target.id==="adminModalBackdrop")closeAdminForm()});
document.getElementById("useLocationButton").onclick=()=>requestLocation({center:false,fillForm:true});
document.getElementById("checkpointForm").onsubmit=async e=>{e.preventDefault();const id=Number(document.getElementById("checkpointId").value)||null;const previous=checkpoints.find(cp=>cp.id===id);const cp={name:document.getElementById("checkpointName").value.trim(),category:document.getElementById("checkpointCategory").value.trim(),points:Number(document.getElementById("checkpointPoints").value),lat:Number(document.getElementById("checkpointLat").value),lng:Number(document.getElementById("checkpointLng").value),distance:previous?.distance||"距離未計測",hint:document.getElementById("checkpointHint").value.trim(),mission:document.getElementById("checkpointMission").value.trim(),explain:document.getElementById("checkpointExplain").value.trim()};try{const url=id?`/api/admin/checkpoints/${id}`:"/api/admin/checkpoints";applySharedData(await apiRequest(url,{method:id?"PUT":"POST",body:JSON.stringify(cp)}));closeAdminForm();toast(id?"変更を共有しました":"チェックポイントを追加・共有しました")}catch(error){toast(error.message)}};
document.getElementById("adminLoginForm").onsubmit=async e=>{e.preventDefault();const error=document.getElementById("loginError");error.textContent="";try{await apiRequest("/api/admin/login",{method:"POST",body:JSON.stringify({password:document.getElementById("adminPassword").value})});document.getElementById("adminPassword").value="";showAdminState(true);await loadSharedData();toast("管理者としてログインしました")}catch(err){error.textContent=err.message}};
document.getElementById("logoutButton").onclick=async()=>{try{await apiRequest("/api/admin/logout",{method:"POST",body:"{}"})}finally{showAdminState(false);toast("ログアウトしました")}};
document.getElementById("resetButton").onclick=()=>{state={visited:{},answers:{}};save();render();toast("記録をリセットしました")};
window.openSheet=openSheet;window.tryCheckin=tryCheckin;window.showAnswer=showAnswer;window.completeCheckin=completeCheckin;
window.openAdminForm=openAdminForm;window.deleteCheckpoint=deleteCheckpoint;
initMap();render();loadSharedData();checkAdminSession();
window.addEventListener("focus", loadSharedData);
setInterval(loadSharedData, 30000);
setTimeout(()=>modal.classList.add("show"),450);
