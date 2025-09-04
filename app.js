// v5b sync/runtime
const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
const TARGETS = ["大和市","海老名市","調布市"];
const LS_KEY = (city)=>`junkai:city:${city}`;
const SEVEN_MS = 7*24*60*60*1000;

function $(s,root=document){return root.querySelector(s)}
function el(tag,cls){const n=document.createElement(tag); if(cls) n.className=cls; return n;}

// ---------- progress ----------
function setProgress(on, pct=0, title="同期中…"){
  const modal = $("#progressModal");
  const bar = $("#progressBar");
  const ttl = $("#progressTitle");
  if(!modal) return;
  if(on){ modal.classList.add("show"); ttl && (ttl.textContent=title); if(bar) bar.style.width=(pct|0)+"%"; }
  else { modal.classList.remove("show"); if(bar) bar.style.width="0%"; }
}

// ---------- city normalize ----------
function normalizeCity(s){
  const t = String(s||"").replace(/\s/g,"");
  if(/大和/.test(t)) return "大和市";
  if(/海老名|海老/.test(t)) return "海老名市";
  if(/調布/.test(t)) return "調布市";
  return "";
}

// ---------- parsing helpers ----------
const HEADMAP = {
  city: ["city","City","都市","市区町村","エリア","市"],
  station: ["station","ステーション","ステーション名","駐車場","駐車場名","拠点名","場所"],
  model: ["model","車種","車名","車両","車両名","型式"],
  number: ["number","ナンバー","登録番号","車番","車両番号","登録No","フルナンバー","full_number"],
  status: ["status","ステータス","状態"],
  checked: ["checked","チェック","巡回済","checked_flag"],
  index: ["index","インデックス","No","通し番号","番号"],
  last: ["last_inspected_at","last","最終","最終点検","lastAt"]
};
function findKey(obj, list){
  for(const k of list){ if(Object.prototype.hasOwnProperty.call(obj,k)) return obj[k]; }
  return undefined;
}
function arrayToObjects(rows){
  // try to detect header row within first 6 rows
  let headerIdx = -1, header = null;
  for(let i=0;i<Math.min(rows.length,6);i++){
    const r = rows[i]; if(!Array.isArray(r)) continue;
    const joined = r.join(" ").toLowerCase();
    if(/city|都市|市区町村|ナンバー|登録/.test(joined)){ headerIdx=i; header=r; break; }
  }
  if(headerIdx===-1){ // fall back: assume 3rd row header (index 2)
    headerIdx = 2; header = rows[2] || [];
  }
  const colIndex = (names)=>{
    for(const name of names){
      const idx = header.findIndex(h=> String(h||"").toLowerCase().includes(String(name).toLowerCase()));
      if(idx>=0) return idx;
    }
    return -1;
  };
  const idxCity = colIndex(HEADMAP.city);
  const idxStation = colIndex(HEADMAP.station);
  const idxModel = colIndex(HEADMAP.model);
  const idxNumber = colIndex(HEADMAP.number);
  const idxStatus = colIndex(HEADMAP.status);
  const idxChecked = colIndex(HEADMAP.checked);
  const idxIndex = colIndex(HEADMAP.index);
  const idxLast = colIndex(HEADMAP.last);

  const out=[];
  for(let i=headerIdx+1;i<rows.length;i++){
    const r=rows[i]; if(!Array.isArray(r)) continue;
    const cityRaw = idxCity>=0 ? r[idxCity] : "";
    const city = normalizeCity(cityRaw);
    if(!city) continue;
    out.push({
      city,
      station: String(idxStation>=0? r[idxStation]:"").trim(),
      model: String(idxModel>=0? r[idxModel]:"").trim(),
      number: String(idxNumber>=0? r[idxNumber]:"").trim(),
      status: String(idxStatus>=0? r[idxStatus]:"normal").trim() || "normal",
      checked: !!(idxChecked>=0? r[idxChecked]:false),
      index: (idxIndex>=0 && Number.isFinite(+r[idxIndex]))? parseInt(r[idxIndex],10):0,
      last_inspected_at: String(idxLast>=0? r[idxLast]:"").trim()
    });
  }
  return out;
}
function objectsToObjects(arr){
  const out=[];
  for(const o of arr){
    const city = normalizeCity(findKey(o, HEADMAP.city));
    if(!city) continue;
    out.push({
      city,
      station: String(findKey(o, HEADMAP.station) || "").trim(),
      model: String(findKey(o, HEADMAP.model) || "").trim(),
      number: String(findKey(o, HEADMAP.number) || "").trim(),
      status: String(findKey(o, HEADMAP.status) || "normal").trim() || "normal",
      checked: !!findKey(o, HEADMAP.checked),
      index: Number.isFinite(+findKey(o, HEADMAP.index)) ? parseInt(findKey(o, HEADMAP.index),10) : 0,
      last_inspected_at: String(findKey(o, HEADMAP.last) || "").trim()
    });
  }
  return out;
}
function normalizeRecords(data){
  if(!Array.isArray(data)) return [];
  if(data.length===0) return [];
  const first = data[0];
  let records = [];
  if(Array.isArray(first)) records = arrayToObjects(data);
  else if(typeof first === "object") records = objectsToObjects(data);
  else records = []; // unknown
  // attach fallback index
  records.forEach((r,i)=>{ if(!(Number.isFinite(+r.index) && +r.index>0)) r.index=i+1; });
  return records;
}

// ---------- sync ----------
async function syncAll(){
  try{
    setProgress(true, 8, "GASへ問い合わせ中…");
    const res = await fetch(`${GAS_URL}?action=pull`, {cache:"no-store"});
    setProgress(true, 35, "データ解析中…");
    const json = await res.json().catch(()=>null);
    if(!json || !json.ok || !Array.isArray(json.data)){
      throw new Error("応答形式エラー");
    }
    const recs = normalizeRecords(json.data);
    // bucket by city
    const buckets = {"大和市":[],"海老名市":[],"調布市":[]};
    for(const r of recs){ if(buckets[r.city]) buckets[r.city].push(r); }
    // save
    for(const c of TARGETS){ localStorage.setItem(LS_KEY(c), JSON.stringify(buckets[c])); }
    // update counters
    updateTotals();
    setProgress(true, 100, "同期完了！");
    setTimeout(()=>setProgress(false), 400);
  }catch(err){
    console.error(err);
    const st = $("#statusText"); if(st) st.textContent = "同期失敗：通信または解析エラー";
    setProgress(false);
  }
}

function readCity(city){
  try{
    const s = localStorage.getItem(LS_KEY(city)); if(!s) return [];
    const arr = JSON.parse(s); return Array.isArray(arr)? arr:[];
  }catch(_){return []}
}

function updateTotals(){
  const totals={};
  let overall=0;
  for(const city of TARGETS){
    const arr = readCity(city);
    totals[city]={done:0,stop:0,skip:0,total:arr.length};
    overall += arr.length;
    for(const r of arr){
      if(r.status==="stop") totals[city].stop++;
      else if(r.status==="skip") totals[city].skip++;
      if(r.checked || r.status==="done") totals[city].done++;
    }
    const map = {
      "大和市": {done:"#yamato-done", stop:"#yamato-stop", skip:"#yamato-skip", total:"#yamato-total"},
      "海老名市": {done:"#ebina-done", stop:"#ebina-stop", skip:"#ebina-skip", total:"#ebina-total"},
      "調布市": {done:"#chofu-done", stop:"#chofu-stop", skip:"#chofu-skip", total:"#chofu-total"}
    }[city];
    if(map){
      document.querySelector(map.done).textContent = totals[city].done;
      document.querySelector(map.stop).textContent = totals[city].stop;
      document.querySelector(map.skip).textContent = totals[city].skip;
      document.querySelector(map.total).textContent = totals[city].total;
    }
  }
  const hint=$("#overallHint"); if(hint) hint.textContent = overall>0 ? "" : "まだ同期されていません";
}

// ---------- city page runtime ----------
function within7d(iso){ if(!iso) return false; const t=Date.parse(iso); if(!Number.isFinite(t)) return False; return (Date.now()-t) < SEVEN_MS; }
function rowBg(rec){
  if(rec.checked) return "bg-pink";
  if(within7d(rec.last_inspected_at)) return "bg-blue";
  if(rec.status==="stop") return "bg-gray-deep";
  if(rec.status==="skip") return "bg-yellow";
  return "bg-green";
}
function saveCityRec(city, rec){
  const arr = readCity(city);
  const i = arr.findIndex(x=> (x.number||"") === (rec.number||""));
  if(i>=0) arr[i]=rec; else arr.push(rec);
  localStorage.setItem(LS_KEY(city), JSON.stringify(arr));
}

function renderCityPage(CITY){
  const wrap = $("#list"); const hint=$("#hint");
  const data = readCity(CITY);
  wrap.innerHTML="";
  if(data.length===0){ hint.textContent="まだ同期されていません（インデックスで同期してください）"; return; }
  hint.textContent = `件数：${data.length}`;
  data.sort((a,b)=> (a.index||1e9)-(b.index||1e9) || String(a.station).localeCompare(String(b.station),'ja'));
  for(const rec of data){
    const row = el("div", `row ${rowBg(rec)}`);
    // index
    const idx = el("div","idx"); idx.textContent = String(rec.index||"-");
    // checkbox
    const chk = el("input","chk"); chk.type="checkbox"; chk.checked=!!rec.checked;
    chk.addEventListener("change",()=>{
      const ok = confirm(chk.checked ? "この車両を巡回済みにしますか？" : "巡回済みを解除しますか？");
      if(!ok){ chk.checked = !chk.checked; return; }
      rec.checked = chk.checked;
      if(rec.checked){ const d=new Date(); const MM=String(d.getMonth()+1).padStart(2,"0"); const DD=String(d.getDate()).padStart(2,"0"); const HH=String(d.getHours()).padStart(2,"0"); const mm=String(d.getMinutes()).padStart(2,"0"); rec.last_inspected_at = new Date().toISOString(); whenMd.textContent = `${MM}/${DD}`; whenHm.textContent = `${HH}:${mm}`; }
      saveCityRec(CITY, rec);
      row.className = `row ${rowBg(rec)}`;
    });
    // fields
    const fields = el("div","fields");
    const st = el("div","station"); st.textContent = rec.station || "(無名)";
    const sub = el("div","sub");
    const model = el("span",null); model.textContent = rec.model || "";
    const number = el("span",null); number.textContent = rec.number || "";
    sub.append(model, number);
    fields.append(st, sub);

    // when col (2 lines)
    const when = el("div","when");
    const whenMd = el("div","md");
    const whenHm = el("div","hm");
    if(rec.last_inspected_at){
      const d = new Date(rec.last_inspected_at);
      if(!isNaN(d.getTime())){
        whenMd.textContent = String(d.getMonth()+1).padStart(2,"0") + "/" + String(d.getDate()).padStart(2,"0");
        whenHm.textContent = String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
      }
    }
    when.append(whenMd, whenHm);

    // right col
    const right = el("div","right");
    const sel = el("select","state");
    [["normal","通常"],["stop","停止"],["skip","不要"]].forEach(([v,l])=>{
      const op = el("option"); op.value=v; op.textContent=l; if(rec.status===v) op.selected=true; sel.appendChild(op);
    });
    sel.addEventListener("change",()=>{ rec.status = sel.value; saveCityRec(CITY, rec); row.className=`row ${rowBg(rec)}`; });
    const btn = el("button","action"); btn.textContent="点検"; btn.addEventListener("click",(ev)=>{
      ev.preventDefault();
      const u = new URL(location.origin + location.pathname); // placeholder
      const base = "https://rkworks2025-coder.github.io/r.k.w-/";
      const q = new URLSearchParams({station:rec.station||"", model:rec.model||"", number:rec.number||""});
      window.location.href = base + "?" + q.toString();
    });
    right.append(sel, btn);

    row.append(idx, chk, fields, right);
    // insert when inline in sub (to right side)
    fields.appendChild(when);
    wrap.appendChild(row);
  }
}

// expose
window.__junkai__ = {syncAll, updateTotals, renderCityPage};
