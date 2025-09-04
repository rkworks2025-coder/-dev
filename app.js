/* v5e per-city index fix */
const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
const CITIES = ["大和市","海老名市","調布市"];
const CITY_PREFIX = {"大和市":"Y","海老名市":"E","調布市":"C"};
const LS_KEY = (city)=>`junkai:city:${city}`;
const LS_IDX = (city)=>`junkai:indexmap:${city}`;

function normalizeRecord(r){
  const city = (r.city||"").trim();
  return {
    city,
    station:(r.station||"").trim(),
    model:(r.model||"").trim(),
    number:(r.number||"").trim(),
    status:(r.status||"normal").trim(),
    checked:!!r.checked,
    index: Number.isFinite(+r.index) ? parseInt(r.index,10) : 0,
    last_inspected_at:(r.last_inspected_at||"").trim(),
  };
}
function readCity(city){
  try{const s=localStorage.getItem(LS_KEY(city));if(!s)return[];const a=JSON.parse(s);return Array.isArray(a)?a:[]}catch(_){return[]}
}
function saveCity(city, arr){ localStorage.setItem(LS_KEY(city), JSON.stringify(arr)); }
function readIdxMap(city){
  try{const s=localStorage.getItem(LS_IDX(city)); if(!s) return {}; const m=JSON.parse(s); return (m&&typeof m==="object")?m:{};}catch(_){return{}}
}
function saveIdxMap(city, m){ localStorage.setItem(LS_IDX(city), JSON.stringify(m||{})); }

async function doSync(updateTotalsCb){
  const statusEl = document.getElementById("statusText");
  const modal = document.getElementById("progressModal");
  const bar = document.getElementById("progressBar");
  const setBar = (p)=>{ if(bar) bar.style.width = Math.max(0,Math.min(100,p))+"%"; };
  const show = (on)=>{ if(modal) modal.classList.toggle("show", !!on); };
  try{
    statusEl && (statusEl.textContent="GASへ問い合わせ中…");
    show(true); setBar(10);
    const res = await fetch(`${GAS_URL}?action=pull`, {method:"GET"});
    setBar(40);
    const json = await res.json().catch(()=>null);
    if(!json || !json.ok || !Array.isArray(json.data)){
      statusEl && (statusEl.textContent="同期失敗：通信または解析エラー");
      show(false);
      return false;
    }
    // bucket by city
    const buckets = {"大和市":[], "海老名市":[], "調布市":[]};
    for(const raw of json.data){
      const rec = normalizeRecord(raw);
      if(buckets[rec.city]) buckets[rec.city].push(rec);
    }
    setBar(70);
    // Save arrays
    for(const c of CITIES){ saveCity(c, buckets[c]); }
    // Rebuild per-city index maps starting from 1
    for(const c of CITIES){
      const arr = [...buckets[c]];
      // order: as-is; if needed, stable by station then number
      arr.sort((a,b)=> (a.station||"").localeCompare(b.station||"", "ja") || (a.number||"").localeCompare(b.number||"", "ja"));
      const map = {};
      let n = 1;
      for(const r of arr){
        if(!r.number) continue;
        if(map[r.number] == null){ map[r.number] = n++; }
      }
      saveIdxMap(c, map);
    }
    setBar(90);
    updateTotalsCb && updateTotalsCb();
    setBar(100);
    statusEl && (statusEl.textContent="同期完了：件数を更新しました");
    setTimeout(()=>show(false), 400);
    return true;
  }catch(e){
    statusEl && (statusEl.textContent="同期失敗：通信または解析エラー");
    setTimeout(()=>show(false), 400);
    return false;
  }
}

// --- helpers used by city pages ---
function cityDisplayIndex(city, number){
  const map = readIdxMap(city);
  if(map && number in map) return map[number];
  // fallback generate from current city order
  const arr = readCity(city);
  let n=1;
  for(const r of arr){
    const no=(r.number||"");
    if(!(no in map)){ map[no]=n++; }
    if(no===number) break;
  }
  saveIdxMap(city,map);
  return map[number]||0;
}

function displayIndexLabel(city, number){
  const n = cityDisplayIndex(city, number);
  const p = CITY_PREFIX[city] || "";
  return p + (n>0? String(n) : "-");
}

// Used by index to compute counters
function countByCity(city){
  const arr = readCity(city);
  const cnt = {done:0, stop:0, skip:0, total:arr.length};
  for(const it of arr){
    if(it.status==="stop") cnt.stop++;
    else if(it.status==="skip") cnt.skip++;
    if(it.checked || it.status==="done") cnt.done++;
  }
  return cnt;
}

window.Junkai = {
  doSync, readCity, countByCity, displayIndexLabel, CITY_PREFIX, CITIES, GAS_URL, LS_KEY, LS_IDX,
};
