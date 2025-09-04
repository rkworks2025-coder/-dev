
// === 設定 ===
const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
const TIRE_APP_URL = "https://rkworks2025-coder.github.io/r.k.w-/";
const CITIES = ["大和市","海老名市","調布市"];
const CITY_PREFIX = {"大和市":"Y","海老名市":"E","調布市":"C"};
const LS_KEY = (city)=>`junkai:city:${city}`;

// === 汎用DOM ===
const $ = (s)=>document.querySelector(s);

// 進捗
const progress = {
  modal: $("#progressModal"),
  bar: $("#progressBar"),
  show(){ this.modal && this.modal.classList.add("show"); },
  hide(){ this.modal && this.modal.classList.remove("show"); this.set(0); },
  set(p){ if(this.bar) this.bar.style.width = Math.max(0,Math.min(100,p)) + "%"; }
};

// === ヘッダー正規化（和英・別名対応） ===
const HEADMAP = {
  city:["city","都市","市区町村","エリア"],
  station:["station","ステーション","拠点","店舗","名称","ステーション名"],
  model:["model","車種","型式","車名"],
  number:["number","登録番号","フルナンバー","ナンバー","車両番号","登録No"],
  status:["status","状態"],
  checked:["checked","チェック","巡回済み"],
  index:["index","通し番号","順番","No","NO","no"],
  last_inspected_at:["last_inspected_at","lastAt","last","最終点検日時","点検日時"]
};

// === ヘッダー行検出（配列の配列用） ===
function detectHeaderRow(rows){
  const maxScan = Math.min(rows.length, 6);
  let best = -1, score = -1;
  for(let i=0;i<maxScan;i++){
    const cols = rows[i].map(x=>String(x||"").trim());
    let s=0;
    for(const key in HEADMAP){
      for(const alias of HEADMAP[key]){
        if(cols.some(c=>c.includes(alias))){ s++; break; }
      }
    }
    if(s>score){ score=s; best=i; }
  }
  return best>=0?best:2; // 3行目を既定
}

// === 行→オブジェクト化 ===
function rowToObj(header, row){
  const obj = {};
  for(let c=0;c<row.length;c++){
    const h = String(header[c]||"").trim();
    const v = (row[c]==null?"":String(row[c]).trim());
    let mapped = null;
    for(const key in HEADMAP){
      if(HEADMAP[key].some(alias=>h.includes(alias))){ mapped = key; break; }
    }
    if(mapped) obj[mapped] = v;
  }
  return obj;
}

// === 正規化 ===
function normalizeRecord(r){
  const city = (r.city||"").trim();
  const station = (r.station||"").trim();
  const model = (r.model||"").trim();
  const number = (r.number||"").trim();
  const status = (r.status||"normal").trim();
  const checked = !!(r.checked===true || r.checked==="true" || r.checked===1 || r.checked==="1");
  let index = Number.isFinite(+r.index)?parseInt(r.index,10):0;
  const last = (r.last_inspected_at||"").trim();
  return {city,station,model,number,status,checked,index,last_inspected_at:last};
}

// === 都市正規化 ===
function normCity(s){
  if(!s) return "";
  if(s.includes("大和")) return "大和市";
  if(s.includes("海老名")) return "海老名市";
  if(s.includes("調布")) return "調布市";
  return s;
}

// === 同期 ===
async function doSync(){
  const status = $("#statusText");
  try{
    progress.show(); progress.set(10);
    if(status) status.textContent = "GASへ問い合わせ中…";

    const res = await fetch(`${GAS_URL}?action=pull`, {cache:"no-store"});
    progress.set(35);
    const json = await res.json().catch(()=>null);
    progress.set(50);
    if(!json || !json.ok || !Array.isArray(json.data)) throw new Error("応答形式エラー");

    // バケツ
    const buckets = {"大和市":[],"海老名市":[],"調布市":[]};

    if(json.data.length && Array.isArray(json.data[0])){
      // 配列の配列
      const rows = json.data;
      const hi = detectHeaderRow(rows);
      const header = rows[hi].map(x=>String(x||"").trim());
      for(let i=hi+1;i<rows.length;i++){
        const obj = rowToObj(header, rows[i]);
        obj.city = normCity(obj.city||"");
        if(!buckets[obj.city]) continue;
        const rec = normalizeRecord(obj);
        buckets[rec.city].push(rec);
      }
    } else {
      // オブジェクト配列
      for(const raw of json.data){
        raw.city = normCity(raw.city||"");
        if(!buckets[raw.city]) continue;
        const rec = normalizeRecord(raw);
        buckets[rec.city].push(rec);
      }
    }

    // エリアごとの通し番号を再採番（Y/E/C）
    progress.set(70);
    for(const city of CITIES){
      const prefix = CITY_PREFIX[city]||"";
      buckets[city].forEach((rec,i)=>{ rec.index = i+1; rec.areaPrefix = prefix; });
      localStorage.setItem(LS_KEY(city), JSON.stringify(buckets[city]));
    }

    // 件数再計算
    recalcAll();
    progress.set(100);
    if(status) status.textContent = "同期完了";
  }catch(e){
    if(status) status.textContent = "同期失敗：通信または解析エラー";
  }finally{
    setTimeout(()=>progress.hide(), 400);
  }
}

// === ローカル読込 ===
function readCity(city){
  try{ const s = localStorage.getItem(LS_KEY(city)); if(!s) return []; const a = JSON.parse(s); return Array.isArray(a)?a:[]; }
  catch{ return []; }
}

// === インデックス画面：件数再計算 ===
function recalcAll(){
  const totals = {"大和市":{done:0,stop:0,skip:0,total:0},"海老名市":{done:0,stop:0,skip:0,total:0},"調布市":{done:0,stop:0,skip:0,total:0}};
  for(const city of CITIES){
    const arr = readCity(city);
    totals[city].total = arr.length;
    for(const it of arr){
      if(it.status==="stop") totals[city].stop++;
      else if(it.status==="skip") totals[city].skip++;
      if(it.checked || it.status==="done") totals[city].done++;
      if(!it.areaPrefix) it.areaPrefix = CITY_PREFIX[city]; // 念のため
    }
  }
  // 反映
  const map = {
    "大和市":{done:"#yamato-done",stop:"#yamato-stop",skip:"#yamato-skip",total:"#yamato-total"},
    "海老名市":{done:"#ebina-done",stop:"#ebina-stop",skip:"#ebina-skip",total:"#ebina-total"},
    "調布市":{done:"#chofu-done",stop:"#chofu-stop",skip:"#chofu-skip",total:"#chofu-total"}
  };
  for(const city of CITIES){
    const m = map[city];
    if($(m.done)) $(m.done).textContent = totals[city].done;
    if($(m.stop)) $(m.stop).textContent = totals[city].stop;
    if($(m.skip)) $(m.skip).textContent = totals[city].skip;
    if($(m.total)) $(m.total).textContent = totals[city].total;
  }
  const hint = $("#overallHint");
  if(hint){
    const overall = totals["大和市"].total + totals["海老名市"].total + totals["調布市"].total;
    hint.textContent = overall>0 ? "" : "まだ同期されていません";
  }
}

// === 日時フォーマット ===
function fmtMD(t){ const d=new Date(t); const mm=String(d.getMonth()+1).padStart(2,"0"); const dd=String(d.getDate()).padStart(2,"0"); return `${mm}/${dd}`; }
function fmtHM(t){ const d=new Date(t); const HH=String(d.getHours()).padStart(2,"0"); const MM=String(d.getMinutes()).padStart(2,"0"); return `${HH}:${MM}`; }

// === 色決定 ===
const SEVEN = 7*24*60*60*1000;
function within7d(lastAt){ if(!lastAt) return false; const t=Date.parse(lastAt); if(!Number.isFinite(t)) return false; return (Date.now()-t)<SEVEN; }
function rowClass(rec){
  if(rec.checked || rec.status==="done") return "bg-pink";
  if(rec.status==="stop") return "bg-gray-deep";
  if(rec.status==="skip") return "bg-yellow";
  if(within7d(rec.last_inspected_at)) return "bg-blue";
  return "bg-green";
}

// === 市ページ描画 ===
function renderCity(city){
  const list = $("#list"); const hint = $("#hint");
  list.innerHTML="";
  const data = readCity(city);
  if(!data.length){ hint.textContent="まだ同期されていません（インデックスの同期を押してください）"; return; }
  hint.textContent = `件数：${data.length}`;

  // index昇順（0は後方）
  data.sort((a,b)=> ( (a.index||1e9) - (b.index||1e9) ) || (a.station||"").localeCompare(b.station||"","ja"));

  const prefix = CITY_PREFIX[city]||"";

  for(const rec of data){
    if(!rec.areaPrefix) rec.areaPrefix = prefix;
    const row = document.createElement("div"); row.className = "row " + rowClass(rec);

    const idx = document.createElement("div"); idx.className="idx"; idx.textContent = (rec.index? `${rec.areaPrefix}${rec.index}` : "-");

    const chk = document.createElement("input"); chk.type="checkbox"; chk.className="chk"; chk.checked=!!rec.checked;
    chk.addEventListener("change", ()=>{
      if(chk.checked){
        if(!confirm("この車両を巡回済みにします。よろしいですか？")){ chk.checked=false; return; }
        rec.checked = true;
        rec.last_inspected_at = new Date().toISOString();
      }else{
        if(!confirm("巡回済みを解除します。よろしいですか？")){ chk.checked=true; return; }
        rec.checked = false;
        // ユーザー解除時は青にならないよう、最終点検日時をクリア
        rec.last_inspected_at = "";
      }
      saveLocal(city, rec);
      row.className = "row " + rowClass(rec);
      // 日時表示更新
      when.innerHTML = rec.checked ? `<div class="md">${fmtMD(rec.last_inspected_at)}</div><div class="hm">${fmtHM(rec.last_inspected_at)}</div>` : "";
      recalcAll();
    });

    const fields = document.createElement("div"); fields.className="fields";
    const l1=document.createElement("div"); l1.className="line1"; l1.textContent = rec.station || "(無名)";
    const l2=document.createElement("div"); l2.className="line2"; l2.textContent = `${rec.model||""}　${rec.number||""}`;
    fields.appendChild(l1); fields.appendChild(l2);

    const when=document.createElement("div"); when.className="when";
    if(rec.checked && rec.last_inspected_at){
      when.innerHTML = `<div class="md">${fmtMD(rec.last_inspected_at)}</div><div class="hm">${fmtHM(rec.last_inspected_at)}</div>`;
    }

    const right=document.createElement("div"); right.className="rightcol";

    // 状態
    const sel=document.createElement("select"); sel.className="state-select";
    [["normal","通常"],["stop","停止"],["skip","不要"]].forEach(([val,label])=>{ 
      const op=document.createElement("option"); op.value=val; op.textContent=label; if(rec.status===val) op.selected=true; sel.appendChild(op);
    });
    sel.addEventListener("change",()=>{ rec.status=sel.value; saveLocal(city,rec); row.className = "row " + rowClass(rec); recalcAll(); });

    // 点検ボタン（複数パラメータ名で送る：互換確保）
    const btn=document.createElement("button"); btn.className="btn-mini"; btn.textContent="点検";
    btn.addEventListener("click", ()=>{
      const p = new URLSearchParams({
        station: rec.station||"",
        model: rec.model||"",
        number: rec.number||""
      });
      // 互換のため同値を別名で重ねて付与
      p.set("num", rec.number||"");
      p.set("reg", rec.number||"");
      const url = TIRE_APP_URL + (TIRE_APP_URL.includes("?")?"&":"?") + p.toString();
      window.location.href = url;
    });

    right.appendChild(sel);
    right.appendChild(btn);

    row.appendChild(idx);
    row.appendChild(chk);
    row.appendChild(fields);
    row.appendChild(when);
    row.appendChild(right);

    list.appendChild(row);
  }
}

function saveLocal(city, rec){
  const arr = readCity(city);
  const i = arr.findIndex(x=>(x.number||"") === (rec.number||""));
  if(i>=0) arr[i]=rec; else arr.push(rec);
  localStorage.setItem(LS_KEY(city), JSON.stringify(arr));
}

// === ページ判定 ===
(function init(){
  const page = document.body.getAttribute("data-page");
  if(page==="index"){
    $("#syncBtn")?.addEventListener("click", doSync);
    $("#recalcBtn")?.addEventListener("click", recalcAll);
    recalcAll();
  } else if(page==="city"){
    const city = document.body.getAttribute("data-city");
    renderCity(city);
  }
})();
