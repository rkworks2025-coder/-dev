
// ====== Junkai shared/app logic (v5m) ======
const Junkai = (()=>{
  const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
  const CITIES = ["大和市","海老名市","調布市"];
  const LS_KEY = (city)=> `junkai:city:${city}`;
  const LATEST_AT = "junkai:lastSyncedAt";

  function saveCity(city, arr){ localStorage.setItem(LS_KEY(city), JSON.stringify(arr||[])); }
  function readCity(city){
    try{
      const s = localStorage.getItem(LS_KEY(city));
      if(!s) return [];
      const a = JSON.parse(s);
      return Array.isArray(a)? a: [];
    }catch(_){ return []; }
  }

  function normalizeRecord(r, i0=0){
    const city = (r.city||"").trim();
    const station = (r.station||"").trim();
    const model = (r.model||"").trim();
    const number = (r.number||"").trim();
    const status = (r.status||"normal").trim(); // normal/stop/skip/done
    const checked = !!r.checked;
    let index = Number.isFinite(+r.index) ? parseInt(r.index,10) : 0;
    if(index<1) index = i0;
    const last_inspected_at = (r.last_inspected_at||"").trim();
    return {city,station,model,number,status,checked,index,last_inspected_at};
  }

  // robust fetch with timeout, retries, cache-bust, tolerant JSON parsing
  async function fetchJSONWithRetry(url,{retries=2, timeoutMs=12000}={}){
    let err;
    for(let attempt=0; attempt<=retries; attempt++){
      const ctrl = new AbortController();
      const tid = setTimeout(()=> ctrl.abort(), timeoutMs);
      try{
        const res = await fetch(url, {method:"GET", cache:"no-store",
          headers:{"Cache-Control":"no-cache"}, redirect:"follow", signal:ctrl.signal});
        clearTimeout(tid);
        const text = await res.text();
        // Try JSON parse even if content-type is off
        let json; try { json = JSON.parse(text); } catch(_) { json = null; }
        if(!json){
          // try to strip BOM
          const t2 = text.replace(/^\uFEFF/,"");
          try { json = JSON.parse(t2); } catch(_){}
        }
        if(json) return json;
        err = new Error("invalid json");
      }catch(e){
        err = e;
      }
      await new Promise(r=> setTimeout(r, 600*(attempt+1)));
    }
    throw err || new Error("fetch failed");
  }

  async function syncAll(setProgress){
    const ts = Date.now();
    const url = `${GAS_URL}?action=pull&_=${ts}`;

    setProgress && setProgress(10, "GASへ問い合わせ中…");
    let json;
    try{
      json = await fetchJSONWithRetry(url,{retries:2, timeoutMs:15000});
    }catch(e){
      throw new Error("通信エラー");
    }

    // accept {ok:true,data:[...]}, or direct array, or {records:[...]}
    const arr = Array.isArray(json) ? json
              : Array.isArray(json.data) ? json.data
              : Array.isArray(json.records) ? json.records
              : [];

    if(!arr.length){
      throw new Error("データ空（GAS応答に配列が見つかりません）");
    }

    const buckets = {"大和市":[], "海老名市":[], "調布市":[]};
    let i = 1;
    for(const r of arr){
      const city = (r.city||"").trim();
      if(!buckets[city]) continue;
      const rec = normalizeRecord(r, i++);
      buckets[city].push(rec);
    }

    // Only overwrite localStorage when bucket has items -> atomic update
    for(const city of CITIES){
      if(buckets[city].length>0){
        saveCity(city, buckets[city]);
      }
    }
    localStorage.setItem(LATEST_AT, String(new Date().toISOString()));
    setProgress && setProgress(95, "件数集計…");
    updateIndexTotals();
    setProgress && setProgress(100, "同期完了");
    return buckets;
  }

  function countFrom(arr){
    const cnt = {done:0, stop:0, skip:0, total:arr.length};
    for(const it of arr){
      if(it.status === "stop") cnt.stop++;
      else if(it.status === "skip") cnt.skip++;
      if(it.checked || it.status === "done") cnt.done++;
    }
    return cnt;
  }

  function updateIndexTotals(){
    const cities = [
      ["yamato","大和市"],
      ["ebina","海老名市"],
      ["chofu","調布市"]
    ];
    for(const [key,city] of cities){
      const a = readCity(city);
      const c = countFrom(a);
      const qs = (id)=>document.getElementById(`${key}-${id}`);
      const map = {done:qs("done"), stop:qs("stop"), skip:qs("skip"), total:qs("total")};
      if(map.done){ map.done.textContent = c.done; }
      if(map.stop){ map.stop.textContent = c.stop; }
      if(map.skip){ map.skip.textContent = c.skip; }
      if(map.total){ map.total.textContent = c.total; }
    }
  }

  // ===== index page =====
  function initIndex(){
    const modal = document.getElementById("progressModal");
    const bar = document.getElementById("progressBar");
    const status = document.getElementById("statusText");
    const syncBtn = document.getElementById("syncBtn");

    const setProgress = (pct, text)=>{
      if(modal) modal.classList.add("show");
      if(bar) bar.style.width = `${Math.max(0,Math.min(100,pct))}%`;
      if(status && text) status.textContent = text;
    };

    updateIndexTotals();
    if(syncBtn){
      syncBtn.addEventListener("click", async ()=>{
        try{
          setProgress(5, "開始…");
          await syncAll(setProgress);
          status.textContent = "同期完了！";
        }catch(e){
          status.textContent = `同期失敗：${e && e.message ? e.message : "通信または解析エラー"}`;
        }finally{
          setTimeout(()=> modal && modal.classList.remove("show"), 600);
        }
      });
    }
  }

  // ===== city page render =====
  const SEVEN = 7*24*60*60*1000;
  const within7 = (ts)=>{
    if(!ts) return false;
    const t = Date.parse(ts); if(!Number.isFinite(t)) return false;
    return (Date.now()-t) < SEVEN;
  };
  const rowClass = (rec)=> rec.checked ? "bg-pink" :
                     rec.status==="stop" ? "bg-gray" :
                     rec.status==="skip" ? "bg-yellow" :
                     within7(rec.last_inspected_at) ? "bg-blue" : "bg-green";

  function renderCity(city){
    const list = document.getElementById("list");
    const hint = document.getElementById("hint");
    const data = readCity(city);
    list.innerHTML="";
    if(!data.length){ hint.textContent="まだ同期されていません（インデックスで同期）"; return; }
    hint.textContent = `件数：${data.length}`;

    // 再割当：ページ側の通し番号を E/Y/C + 1..N で振る（numberに紐付け）
    const prefix = city==="海老名市" ? "E" : city==="大和市" ? "Y" : "C";
    const reindexed = data.map((rec, i)=> ({...rec, ui_index:`${prefix}${i+1}`}));

    for(const rec of reindexed){
      const card = document.createElement("div");
      card.className = `rowcard ${rowClass(rec)}`;

      const idx = document.createElement("div");
      idx.className="idx"; idx.textContent = rec.ui_index || "-";

      const content = document.createElement("div");
      content.className="content";
      const l1 = document.createElement("div"); l1.className="title-line"; l1.textContent = rec.station || "(無名)";
      const l2 = document.createElement("div"); l2.className="meta-line"; l2.textContent = `${rec.model || ""}　${rec.number || ""}`;
      content.appendChild(l1); content.appendChild(l2);

      const actions = document.createElement("div");
      actions.className="actions";

      const sel = document.createElement("select");
      sel.className="state-select";
      [["normal","通常"],["stop","停止"],["skip","不要"]].forEach(([v,lab])=>{
        const o = document.createElement("option"); o.value=v; o.textContent=lab; if(rec.status===v) o.selected=true; sel.appendChild(o);
      });
      sel.addEventListener("change", ()=>{
        rec.status = sel.value;
        persist(city, rec);
        card.className = `rowcard ${rowClass(rec)}`;
      });

      const btn = document.createElement("button");
      btn.className="btn-mini"; btn.textContent="点検";
      btn.addEventListener("click", ()=>{
        const q = new URLSearchParams({station:rec.station||"", model:rec.model||"", number:rec.number||""});
        const target = "https://rkworks2025-coder.github.io/r.k.w-/index.html?" + q.toString();
        window.location.href = target;
      });

      actions.appendChild(sel); actions.appendChild(btn);

      card.appendChild(idx);
      card.appendChild(content);
      card.appendChild(actions);

      list.appendChild(card);
    }
  }

  function persist(city, rec){
    const arr = readCity(city);
    const i = arr.findIndex(x=> (x.number||"") === (rec.number||""));
    if(i>=0) arr[i]=rec; else arr.push(rec);
    saveCity(city, arr);
  }

  return { initIndex, renderCity, readCity };
})();
