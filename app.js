// ====== 設定 ======
const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
const CITIES = ["大和市","海老名市","調布市"];
const PREFIX = {"大和市":"Y","海老名市":"E","調布市":"C"};

const LS_KEY = (city)=>`junkai:city:${city}`;
const MAP_KEY = (city)=>`junkai:indexmap:${city}`;

const els = {
  progressModal: null, progressBar: null, statusText: null,
};

function $(s){ return document.querySelector(s); }
function setText(elSel, v){ const n = typeof elSel==="string" ? $(elSel) : elSel; if(n) n.textContent = String(v); }

function showProgress(on){
  if(!els.progressModal) return;
  els.progressModal.classList.toggle("show", !!on);
}
function setBar(pct){ if(els.progressBar) els.progressBar.style.width = `${Math.max(0,Math.min(100,pct))}%`; }

// ====== 共通ストレージ ======
function readCity(city){
  try{
    const s = localStorage.getItem(LS_KEY(city)); if(!s) return [];
    const arr = JSON.parse(s); return Array.isArray(arr)?arr:[];
  }catch(_){ return []; }
}
function writeCity(city, arr){
  localStorage.setItem(LS_KEY(city), JSON.stringify(arr));
}
function readMap(city){
  try{ const s = localStorage.getItem(MAP_KEY(city)); if(!s) return {}; return JSON.parse(s)||{}; }
  catch(_){ return {}; }
}
function writeMap(city, map){
  localStorage.setItem(MAP_KEY(city), JSON.stringify(map||{}));
}

// ====== 正規化（配列/オブジェクト両対応の簡易版） ======
function normalizeRecord(rec){
  if(Array.isArray(rec)){
    // 想定カラム: [city, station, model, number, status, checked, index, last_inspected_at]
    const [city, station, model, number, status, checked, idx, lastAt] = rec;
    return {
      city: String(city||"").trim(),
      station: String(station||"").trim(),
      model: String(model||"").trim(),
      number: String(number||"").trim(),
      status: String(status||"normal").trim(),
      checked: !!checked,
      index: Number.isFinite(+idx)?parseInt(idx,10):0,
      last_inspected_at: String(lastAt||"").trim(),
    };
  }else{
    return {
      city: String(rec.city||"").trim(),
      station: String(rec.station||"").trim(),
      model: String(rec.model||"").trim(),
      number: String(rec.number||"").trim(),
      status: String(rec.status||"normal").trim(),
      checked: !!rec.checked,
      index: Number.isFinite(+rec.index)?parseInt(rec.index,10):0,
      last_inspected_at: String(rec.last_inspected_at||"").trim(),
    };
  }
}

// ====== インデックス採番（都市ごと、既存割当を尊重） ======
function assignCityIndexes(city, list){
  const map = readMap(city); // number -> n
  const prefix = PREFIX[city]||"";
  let next = 1;
  // 既存割当の最大＋1から始める
  Object.values(map).forEach(n=>{ if(Number.isFinite(+n) && +n>=next) next = +n + 1; });
  // 都市内の現行順（受信順）で走査
  for(const item of list){
    const key = item.number || item.station + "|" + item.model; // number優先
    if(map[key]){
      item.index = map[key];
    }else{
      item.index = next++;
      map[key] = item.index;
    }
    item.index_prefix = prefix;
    item.index_label = `${prefix}${item.index}`;
  }
  writeMap(city, map);
}

// ====== 件数再計算（index.html） ======
function recalcAll(){
  let overall = 0;
  const sel = {
    "大和市": { done:"#yamato-done", stop:"#yamato-stop", skip:"#yamato-skip", total:"#yamato-total" },
    "海老名市": { done:"#ebina-done", stop:"#ebina-stop", skip:"#ebina-skip", total:"#ebina-total" },
    "調布市": { done:"#chofu-done", stop:"#chofu-stop", skip:"#chofu-skip", total:"#chofu-total" }
  };
  for(const city of CITIES){
    const arr = readCity(city);
    overall += arr.length;
    const cnt = {done:0, stop:0, skip:0, total:arr.length};
    for(const it of arr){
      if(it.status==="stop") cnt.stop++;
      else if(it.status==="skip") cnt.skip++;
      if(it.checked) cnt.done++;
    }
    setText(sel[city].done, cnt.done);
    setText(sel[city].stop, cnt.stop);
    setText(sel[city].skip, cnt.skip);
    setText(sel[city].total, cnt.total);
  }
  const hint = $("#overallHint");
  setText(hint, overall>0 ? `総件数：${overall}` : "まだ同期されていません");
}

// ====== 同期 ======
async function doSync(){
  try{
    showProgress(true); setBar(8);
    setText(els.statusText, "GASへ問い合わせ中…");

    const res = await fetch(`${GAS_URL}?action=pull&ts=${Date.now()}`, {cache:"no-store"});
    setBar(35);
    const json = await res.json().catch(()=> ({}));
    setBar(45);
    if(!json || !json.ok || !Array.isArray(json.data)){
      setText(els.statusText, "取得失敗：応答形式エラー"); showProgress(false); return;
    }

    const buckets = {"大和市":[],"海老名市":[],"調布市":[]};
    for(const raw of json.data){
      const r = normalizeRecord(raw);
      if(buckets[r.city]) buckets[r.city].push(r);
    }
    // 都市ごとに採番
    for(const city of CITIES){
      assignCityIndexes(city, buckets[city]);
    }
    // 保存
    setBar(75);
    for(const city of CITIES){
      writeCity(city, buckets[city]);
    }
    // 件数更新
    recalcAll();
    setBar(100);
    setText(els.statusText, `同期完了：大和${buckets["大和市"].length} / 海老名${buckets["海老名市"].length} / 調布${buckets["調布市"].length}`);
  }catch(e){
    console.error(e);
    setText(els.statusText, "同期失敗：通信または解析エラー");
  }finally{
    setTimeout(()=> showProgress(false), 500);
  }
}

// ====== 7日ルール ======
const SEVEN = 7*24*60*60*1000;
function within7d(lastAt){
  if(!lastAt) return false;
  const t = Date.parse(lastAt); if(!Number.isFinite(t)) return false;
  return (Date.now() - t) < SEVEN;
}
function rowBg(rec){
  if(rec.checked) return "bg-pink";
  if(rec.status==="stop") return "bg-gray-dark";
  if(rec.status==="skip") return "bg-yellow";
  if(within7d(rec.last_inspected_at)) return "bg-blue";
  return "bg-green";
}

// ====== 市ページ描画 ======
function renderCityPage(city){
  const list = readCity(city);
  const wrap = $("#list");
  const hint = $("#hint");
  wrap.innerHTML = "";
  if(list.length===0){ setText(hint, "まだ同期されていません（インデックスの同期を押してください）"); return; }
  setText(hint, `件数：${list.length}`);

  // 表示順：index昇順→station
  list.sort((a,b)=> (a.index||1e9)-(b.index||1e9) || a.station.localeCompare(b.station,"ja"));

  for(const rec of list){
    const row = document.createElement("div"); row.className = `row ${rowBg(rec)}`;

    const idx = document.createElement("div"); idx.className="idx"; idx.textContent = (rec.index_label || (rec.index? ( (PREFIX[city]||"") + rec.index ) : "-"));
    const chk = document.createElement("input"); chk.type="checkbox"; chk.className="chk"; chk.checked=!!rec.checked;

    const fields = document.createElement("div"); fields.className="fields";
    const l1 = document.createElement("div"); l1.className="line1"; l1.textContent = rec.station || "(無名)";
    const l2 = document.createElement("div"); l2.className="line2"; l2.textContent = `${rec.model||""}　${rec.number||""}`;
    const when = document.createElement("div"); when.className="when";
    function updateWhen(){
      if(rec.checked && rec.last_inspected_at){
        const d = new Date(rec.last_inspected_at);
        const md = `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
        const hm = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
        when.innerHTML = `<div class="md">${md}</div><div class="hm">${hm}</div>`;
      }else{ when.innerHTML = ""; }
    }
    updateWhen();
    fields.appendChild(l1); fields.appendChild(l2); fields.appendChild(when);

    const right = document.createElement("div"); right.className="rightStack";

    const sel = document.createElement("select"); sel.className="state-select";
    [["normal","通常"],["stop","停止"],["skip","不要"]].forEach(([v,lab])=>{
      const op=document.createElement("option"); op.value=v; op.textContent=lab; if(rec.status===v) op.selected=true; sel.appendChild(op);
    });
    sel.addEventListener("change", ()=>{
      rec.status = sel.value;
      writeBack(city, rec); // 保存
      row.className = `row ${rowBg(rec)}`;
    });

    const btn = document.createElement("button"); btn.type="button"; btn.className="btn-mini inspect-btn"; btn.textContent="点検";
    btn.addEventListener("click", ()=>{
      const base = "https://rkworks2025-coder.github.io/r.k.w-/";
      const q = new URLSearchParams({
        station: rec.station||"", model: rec.model||"", number: rec.number||"",
        num: rec.number||"", reg: rec.number||""
      });
      location.href = `${base}?${q.toString()}`;
    });

    chk.addEventListener("change", ()=>{
      rec.checked = chk.checked;
      if(rec.checked){
        rec.last_inspected_at = new Date().toISOString();
      }else{
        rec.last_inspected_at = ""; // 解除時に青へ戻らないようクリア
      }
      updateWhen();
      writeBack(city, rec);
      row.className = `row ${rowBg(rec)}`;
    });

    right.appendChild(sel);
    right.appendChild(btn);

    row.appendChild(idx);
    row.appendChild(chk);
    row.appendChild(fields);
    row.appendChild(right);

    wrap.appendChild(row);
  }
}
function writeBack(city, rec){
  const arr = readCity(city);
  const i = arr.findIndex(x => (x.number||"") === (rec.number||""));
  if(i>=0) arr[i] = rec; else arr.push(rec);
  writeCity(city, arr);
}

// ====== 起動 ======
window.addEventListener("DOMContentLoaded", ()=>{
  els.progressModal = $("#progressModal");
  els.progressBar   = $("#progressBar");
  els.statusText    = $("#statusText");

  const page = document.body.getAttribute("data-page");
  if(page === "index"){
    $("#recalcBtn")?.addEventListener("click", recalcAll);
    $("#syncBtn")?.addEventListener("click", doSync);
    recalcAll();
  }else if(page === "city"){
    const city = document.body.getAttribute("data-city");
    renderCityPage(city);
  }
});
