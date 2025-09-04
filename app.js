
// shared app logic v5i
const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
const CITIES = ["大和市","海老名市","調布市"];
const LS_CITY = (city)=>`junkai:city:${city}`;
const LS_INDEXMAP = (city)=>`junkai:indexmap:${city}`;

// ---------- modal progress ----------
function showModal(title){ 
  const m=document.getElementById('progressModal');
  if(!m) return; 
  document.getElementById('progressTitle').textContent = title||'同期中…';
  m.classList.add('show');
  const bar=document.getElementById('progressBar');
  let p=0;
  m._timer = setInterval(()=>{ p=(p+7)%100; bar.style.width=p+'%'; },80);
}
function hideModal(finalTitle){ 
  const m=document.getElementById('progressModal');
  if(!m) return;
  if(finalTitle) document.getElementById('progressTitle').textContent = finalTitle;
  if(m._timer) clearInterval(m._timer);
  setTimeout(()=>{ m.classList.remove('show'); const bar=document.getElementById('progressBar'); if(bar) bar.style.width='0%'; }, 250);
}

// ---------- fetch + store ----------
async function syncFromGAS(){ 
  try {
    showModal('同期中…');
    const res = await fetch(GAS_URL + '?action=pull', { cache:'no-store' });
    const data = await res.json().catch(()=>null);
    if(!data || !data.ok || !Array.isArray(data.data)) throw new Error('bad response');

    const buckets = { "大和市":[], "海老名市":[], "調布市":[] };
    for(const raw of data.data) {
      let rec = normalizeRecord(raw);
      if(!rec.city || !buckets[rec.city]) continue;
      buckets[rec.city].push(rec);
    }

    // save
    for(const city of CITIES) {
      localStorage.setItem(LS_CITY(city), JSON.stringify(buckets[city]));
      // reset index map so it will be rebuilt next open
      localStorage.removeItem(LS_INDEXMAP(city));
    }
    hideModal('同期完了！');
    if (typeof recalcIndexCards === 'function') recalcIndexCards();
    return true;
  } catch(e) {
    console.error(e);
    hideModal('同期失敗');
    const s=document.getElementById('statusText'); if(s) s.textContent='同期失敗：通信または解析エラー';
    return false;
  }
}

// Robust to object or array rows
function normalizeRecord(r) {
  if (Array.isArray(r)) {
    const city = (r[0]||'').toString().trim();
    const station = (r[1]||'').toString().trim();
    const model = (r[2]||'').toString().trim();
    const number = (r[3]||'').toString().trim();
    const status = (r[4]||'normal').toString().trim();
    const checked = !!r[5];
    const last_at = (r[7]||'').toString().trim();
    return { city, station, model, number, status, checked, last_inspected_at:last_at };
  }
  return {
    city: (r.city||'').trim(),
    station: (r.station||'').trim(),
    model: (r.model||'').trim(),
    number: (r.number||'').trim(),
    status: (r.status||'normal').trim(), // normal/stop/skip/done
    checked: !!r.checked,
    last_inspected_at: (r.last_inspected_at||'').trim()
  };
}

function readCity(city) {
  try { 
    const s = localStorage.getItem(LS_CITY(city));
    if(!s) return [];
    const a = JSON.parse(s);
    return Array.isArray(a)?a:[];
  } catch(_) { return []; }
}

// ---------- index counters ----------
function recalcIndexCards(){ 
  const totals = {
    "大和市": { done:0, stop:0, skip:0, total:0 },
    "海老名市": { done:0, stop:0, skip:0, total:0 },
    "調布市":   { done:0, stop:0, skip:0, total:0 }
  };
  let overall = 0;
  for(const city of CITIES) {
    const arr = readCity(city);
    totals[city].total = arr.length;
    overall += arr.length;
    for(const it of arr) {
      if(it.status==='stop') totals[city].stop++;
      else if(it.status==='skip') totals[city].skip++;
      if(it.checked || it.status==='done') totals[city].done++;
    }
  }
  function setTxt(id,val){ const n=document.getElementById(id); if(n) n.textContent=String(val); }
  setTxt('yamato-total', totals["大和市"].total);
  setTxt('yamato-stop',  totals["大和市"].stop);
  setTxt('yamato-skip',  totals["大和市"].skip);
  setTxt('yamato-done',  totals["大和市"].done);
  setTxt('ebina-total',  totals["海老名市"].total);
  setTxt('ebina-stop',   totals["海老名市"].stop);
  setTxt('ebina-skip',   totals["海老名市"].skip);
  setTxt('ebina-done',   totals["海老名市"].done);
  setTxt('chofu-total',  totals["調布市"].total);
  setTxt('chofu-stop',   totals["調布市"].stop);
  setTxt('chofu-skip',   totals["調布市"].skip);
  setTxt('chofu-done',   totals["調布市"].done);
  const hint = document.getElementById('overallHint');
  if(hint) hint.textContent = overall>0 ? '' : 'まだ同期されていません';
}

// ---------- area helpers ----------
function areaPrefix(city){
  if(city==='海老名市') return 'E';
  if(city==='大和市') return 'Y';
  if(city==='調布市') return 'C';
  return 'X';
}

function computeIndexMap(city, arr){
  const key = LS_INDEXMAP(city);
  try {
    const m = JSON.parse(localStorage.getItem(key)||'null');
    if(m && typeof m==='object') return m;
  } catch(_) {}
  // deterministic label per city, based on station then number
  const cp = arr.slice().sort((a,b)=> (a.station||'').localeCompare(b.station||'ja') || (a.number||'').localeCompare(b.number||'ja'));
  const prefix = areaPrefix(city);
  const map = {};
  let n=1;
  for(const rec of cp){
    if(!rec.number) continue;
    const label = prefix + n++;
    map[rec.number] = label;
  }
  localStorage.setItem(key, JSON.stringify(map));
  return map;
}

function rowClass(rec){
  if(rec.checked) return 'bg-pink';      // checked has priority
  if(rec.status==='stop') return 'bg-gray-strong';
  if(rec.status==='skip') return 'bg-yellow';
  return 'bg-green';
}

function persistCity(city, arr){ localStorage.setItem(LS_CITY(city), JSON.stringify(arr)); }
function updateRecord(city, rec){
  const arr = readCity(city);
  const i = arr.findIndex(x => (x.number||'')===(rec.number||''));
  if(i>=0) arr[i]=rec; else arr.push(rec);
  persistCity(city, arr);
}

window.Junkai = { syncFromGAS, recalcIndexCards, readCity, computeIndexMap, rowClass, updateRecord, areaPrefix };
