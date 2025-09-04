
(() => {
  const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
  const TIRE_APP_URL = "https://rkworks2025-coder.github.io/r.k.w-/";
  const CITIES = ["大和市","海老名市","調布市"];
  const LS_KEY = city => `junkai:city:${city}`;

  // ---------- helpers ----------
  function showProgress(on){ const m=document.getElementById("progressModal"); if(!m) return; m.classList.toggle("show", !!on); }
  function setBar(p){ const b=document.getElementById("progressBar"); if(b) b.style.width = `${Math.max(0,Math.min(100,p))}%`; }

  function normalize(r){
    const city=(r.city||"").trim();
    const station=(r.station||"").trim();
    const model=(r.model||"").trim();
    const number=(r.number||"").trim();
    const status=(r.status||"normal").trim();
    const checked=!!r.checked;
    let index = Number.isFinite(+r.index) ? parseInt(r.index,10) : 0;
    if(index<1) index=0;
    const last=(r.last_inspected_at||"").trim();
    return {city,station,model,number,status,checked,index,last_inspected_at:last};
  }

  function saveCity(city, arr){ localStorage.setItem(LS_KEY(city), JSON.stringify(arr||[])); }
  function readCity(city){ try{ const s=localStorage.getItem(LS_KEY(city)); return s? (JSON.parse(s)||[]) : [] }catch(_){ return [] } }

  // ---------- index page ----------
  async function doSync(){
    const sText = document.getElementById("statusText");
    try{
      showProgress(true); setBar(10);
      sText && (sText.textContent="GASへ問い合わせ中…");
      const res = await fetch(`${GAS_URL}?action=pull`, {method:"GET"});
      setBar(40);
      const json = await res.json().catch(()=> ({}));
      if(!json || !json.ok || !Array.isArray(json.data)){
        sText && (sText.textContent="同期失敗: 通信または解析エラー");
        showProgress(false); return;
      }
      const buckets = {"大和市":[],"海老名市":[],"調布市":[]};
      json.data.forEach(raw=>{
        const rec = normalize(raw);
        if(buckets[rec.city]) buckets[rec.city].push(rec);
      });
      // save
      setBar(70);
      for(const c of CITIES) saveCity(c, buckets[c]);
      // recount
      recountTotals();
      sText && (sText.textContent = `同期完了: 大和${readCity("大和市").length}/海老名${readCity("海老名市").length}/調布${readCity("調布市").length}`);
      setBar(100);
    }catch(e){
      sText && (sText.textContent="同期失敗: 通信または解析エラー");
    }finally{
      setTimeout(()=> showProgress(false), 400);
    }
  }

  function recountTotals(){
    const map = {
      "大和市": {done:"#yamato-done", stop:"#yamato-stop", skip:"#yamato-skip", total:"#yamato-total"},
      "海老名市": {done:"#ebina-done", stop:"#ebina-stop", skip:"#ebina-skip", total:"#ebina-total"},
      "調布市": {done:"#chofu-done", stop:"#chofu-stop", skip:"#chofu-skip", total:"#chofu-total"}
    };
    let overall=0;
    for(const c of CITIES){
      const arr = readCity(c) || [];
      overall += arr.length;
      const cnt = {done:0, stop:0, skip:0, total:arr.length};
      arr.forEach(it=>{
        if(it.status==="stop") cnt.stop++;
        else if(it.status==="skip") cnt.skip++;
        if(it.checked || it.status==="done") cnt.done++;
      });
      const m = map[c];
      for(const k of ["done","stop","skip","total"]){
        const el = document.querySelector(m[k]);
        if(el) el.textContent = String(cnt[k]);
      }
    }
    const hint = document.getElementById("overallHint");
    if(hint) hint.textContent = overall>0 ? `総件数：${overall}` : "まだ同期されていません";
  }

  // bind index
  const syncBtn = document.getElementById("syncBtn");
  if(syncBtn){
    syncBtn.addEventListener("click", doSync);
    recountTotals();
  }

  // ---------- city page renderer ----------
  function rowClass(rec){
    if(rec.checked) return "bg-pink";
    if(rec.status==="stop") return "bg-gray";
    if(rec.status==="skip") return "bg-yellow";
    return "bg-green";
  }

  function formatIndex(prefix, n){ return `${prefix}${n}`; }

  function renderCity(city, prefix){
    const list = document.getElementById("list");
    const count = document.getElementById("count");
    if(!list) return;
    const data = (readCity(city) || []).slice();
    list.innerHTML = "";
    count && (count.textContent = `件数：${data.length}`);
    if(data.length===0){
      const p = document.createElement("p");
      p.className="hint"; p.textContent="まだ同期されていません（インデックスの同期を押してください）";
      list.appendChild(p); return;
    }

    // stable order: by existing index if any, then station name
    data.sort((a,b)=>{
      const ai = (a.index>0?a.index:1e9), bi=(b.index>0?b.index:1e9);
      return ai-b || a.station.localeCompare(b.station,'ja');
    });

    // assign per-city running index
    data.forEach((rec,i)=>{ rec._seq = i+1; });

    for(const rec of data){
      const card = document.createElement("div");
      card.className = `vehicle-card ${rowClass(rec)}`;

      const grid = document.createElement("div");
      grid.className = "grid";

      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = formatIndex(prefix, rec._seq);

      const content = document.createElement("div");
      content.className = "content";

      const title = document.createElement("div");
      title.className = "title-line";
      title.textContent = rec.station || "(無名)";

      const meta = document.createElement("div");
      meta.className = "meta-line";
      const m1 = document.createElement("span"); m1.textContent = rec.model || "";
      const m2 = document.createElement("span"); m2.textContent = rec.number || "";
      meta.appendChild(m1); meta.appendChild(m2);

      content.appendChild(title); content.appendChild(meta);

      const ctrls = document.createElement("div");
      ctrls.className = "ctrls";

      // state select
      const sel = document.createElement("select");
      sel.className = "state-select";
      [["normal","通常"],["stop","停止"],["skip","不要"]].forEach(([v,l])=>{
        const op=document.createElement("option");
        op.value=v; op.textContent=l; if(rec.status===v) op.selected=true; sel.appendChild(op);
      });
      sel.addEventListener("change", ()=>{
        rec.status = sel.value;
        saveBack(city, rec);
        card.className = `vehicle-card ${rowClass(rec)}`;
      });

      // inspect button
      const btn = document.createElement("button");
      btn.type="button"; btn.className="inspect-btn"; btn.textContent="点検";
      btn.addEventListener("click", ()=>{
        const q = new URLSearchParams({
          st: rec.station || "",
          model: rec.model || "",
          num: rec.number || ""
        });
        window.open(`${TIRE_APP_URL}?${q.toString()}`, "_blank");
      });

      ctrls.appendChild(sel);
      ctrls.appendChild(btn);

      grid.appendChild(idx);
      grid.appendChild(content);
      grid.appendChild(ctrls);

      card.appendChild(grid);

      list.appendChild(card);
    }
  }

  function saveBack(city, rec){
    const arr = readCity(city);
    const i = arr.findIndex(x=> (x.number||"") === (rec.number||""));
    if(i>=0) arr[i]=rec; else arr.push(rec);
    saveCity(city, arr);
  }

  // expose
  window.renderCity = renderCity;
})();
