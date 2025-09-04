
/* =========================
   巡回アプリ 共通JS v5
   - GASと同期（index）
   - 都市ページ描画（大和/海老名/調布）
   - 点検アプリ連携（GETクエリ）
   - チェック確認/ピンク最優先/二行日時
   ========================= */
(function(){
  const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
  const TIRE_APP_URL = "https://rkworks2025-coder.github.io/r.k.w-/";
  const CITIES = ["大和市","海老名市","調布市"];
  const LS_KEY = (city)=>`junkai:city:${{city}}`;

  function $(s,root=document){return root.querySelector(s)}

  function normalizeRecord(r, i){
    // supports object or array forms
    if(Array.isArray(r)){
      // 射影: city, station, model, number, status, checked, index, last_inspected_at
      const [city,station,model,number,status,checked,index,last] = r;
      return { city:(city||"" ).trim(), station:(station||"" ).trim(), model:(model||"" ).trim(),
        number:(number||"" ).trim(), status:(status||"normal").trim(), checked:!!checked,
        index:Number.isFinite(+index)?parseInt(index,10):(i+1), last_inspected_at:(last||"" ).trim() };
    }else{
      const city = (r.city || r['市区町村'] || r.City || "").trim();
      const station = (r.station || r['ステーション'] || r.Station || "").trim();
      const model = (r.model || r['車種'] || r['車種名'] || r.Model || "").trim();
      const number = (r.number || r['登録番号'] || r['Plate'] || r.plate || "").trim();
      const status = (r.status || "normal").trim();
      const checked = !!r.checked;
      let index = Number.isFinite(+r.index) ? parseInt(r.index,10) : 0;
      if(index<1) index = i+1;
      const lastAt = (r.last_inspected_at || r.lastAt || r.last || "").trim();
      return {{city, station, model, number, status, checked, index, last_inspected_at:lastAt}};
    }
  }

  function readCity(city){
    try{
      const s = localStorage.getItem(LS_KEY(city));
      if(!s) return [];
      const a = JSON.parse(s);
      return Array.isArray(a)?a:[];
    }catch(_){return []}
  }
  function writeCity(city, arr){
    localStorage.setItem(LS_KEY(city), JSON.stringify(arr));
  }

  function computeCounts(arr){
    const c = {{done:0, stop:0, skip:0, total:arr.length}};
    for(const it of arr){
      if(it.status==="stop") c.stop++;
      else if(it.status==="skip") c.skip++;
      if(it.checked) c.done++;
    }
    return c;
  }

  /* ---------- INDEX ---------- */
  async function doSync(){
    const modal = $("#progressModal");
    const bar = $("#progressBar");
    const status = $("#statusText");
    const setBar = (p)=>{{ if(bar) bar.style.width = Math.max(0,Math.min(100,p))+"%"; }};
    try{
      modal && modal.classList.add("show"); setBar(8);
      status && (status.textContent = "GASへ問い合わせ中…");

      const res = await fetch(`${{GAS_URL}}?action=pull`, {{cache:"no-store"}});
      setBar(35);

      let json;
      try{{ json = await res.json(); }}catch(_ ){{ json = null; }}
      setBar(55);

      let rows = [];
      if(Array.isArray(json)) rows = json;
      else if(json && Array.isArray(json.data)) rows = json.data;
      else if(json && Array.isArray(json.rows)) rows = json.rows;
      else rows = [];

      const buckets = {{"大和市":[],"海老名市":[],"調布市":[]}};
      rows.forEach((raw,i)=>{{ const n = normalizeRecord(raw,i); if(buckets[n.city]) buckets[n.city].push(n); }});

      CITIES.forEach(city=> writeCity(city, buckets[city] || []));
      setBar(85);

      recalcAll();
      setBar(100);
      status && (status.textContent = "同期完了！");
    }catch(e){
      status && (status.textContent = "同期失敗：通信または解析エラー");
    }finally{
      setTimeout(()=>{{ const m=$("#progressModal"); m && m.classList.remove("show"); if(bar) bar.style.width="0%"; }}, 400);
    }
  }

  function recalcAll(){
    const totalsMap = {{
      "大和市": {{done:"#yamato-done", stop:"#yamato-stop", skip:"#yamato-skip", total:"#yamato-total"}},
      "海老名市": {{done:"#ebina-done", stop:"#ebina-stop", skip:"#ebina-skip", total:"#ebina-total"}},
      "調布市": {{done:"#chofu-done", stop:"#chofu-stop", skip:"#chofu-skip", total:"#chofu-total"}},
    }};
    let overall = 0;
    for(const city of CITIES){
      const arr = readCity(city);
      overall += arr.length;
      const cnt = computeCounts(arr);
      const map = totalsMap[city];
      if(map){{
        for(const k of ["done","stop","skip","total"]){{
          const node = document.querySelector(map[k]);
          if(node) node.textContent = String(cnt[k]);
        }}
      }}
    }
    const hint = $("#overallHint");
    hint && (hint.textContent = overall>0 ? "" : "まだ同期されていません");
  }

  function mountIndex(){
    const syncBtn = $("#syncBtn");
    const recalcBtn = $("#recalcBtn");
    syncBtn && syncBtn.addEventListener("click", doSync, {{passive:true}});
    recalcBtn && recalcBtn.addEventListener("click", recalcAll, {{passive:true}});
    recalcAll();
  }

  /* ---------- CITY ---------- */
  function rowClass(rec){
    if(rec.checked) return "bg-pink"; // ピンク最優先
    if(rec.status==="stop") return "bg-gray";
    if(rec.status==="skip") return "bg-yellow";
    return "bg-green";
  }

  function fmtWhen(iso){
    if(!iso) return {{md:"",hm:""}};
    const d = new Date(iso);
    if(isNaN(d)) return {{md:"",hm:""}};
    const md = ("0"+(d.getMonth()+1)).slice(-2)+"/"+("0"+d.getDate()).slice(-2);
    const hm = ("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2);
    return {{md,hm}};
  }

  function mountCity(city){
    const list = $("#list");
    const hint = $("#hint");
    if(!list) return;

    let arr = readCity(city);
    list.innerHTML = "";
    if(arr.length===0){
      hint && (hint.textContent = "まだ同期されていません（インデックスで同期してください）");
      return;
    }
    hint && (hint.textContent = `件数：${{arr.length}}`);

    arr.sort((a,b)=>{{ const ai=a.index>0?a.index:1e9, bi=b.index>0?b.index:1e9; return ai-bi || (a.station||"").localeCompare((b.station||"),"ja"); }});

    for(const rec of arr){
      const row = document.createElement("div"); row.className = `row ${{rowClass(rec)}}`;

      const idx = document.createElement("div"); idx.className="idx"; idx.textContent = String(rec.index || "-");

      const chk = document.createElement("input"); chk.type="checkbox"; chk.className="chk"; chk.checked=!!rec.checked;
      chk.addEventListener("change", ()=>{{ 
        const ok = confirm(chk.checked ? "巡回済みにします。よろしいですか？" : "巡回済みを解除します。よろしいですか？");
        if(!ok){{ chk.checked = !chk.checked; return; }}
        rec.checked = chk.checked;
        if(rec.checked){{ rec.last_inspected_at = new Date().toISOString(); }}
        row.className = `row ${{rowClass(rec)}}`;
        const w = $(".when", row); if(w){{ const t=fmtWhen(rec.last_inspected_at); $(".md",w).textContent=t.md; $(".hm",w).textContent=t.hm; }}
        const cur = readCity(city); const i = cur.findIndex(x=>(x.number||"")=== (rec.number||"")); if(i>=0) cur[i]=rec; else cur.push(rec); writeCity(city, cur);
      }});

      const fields = document.createElement("div"); fields.className="fields";
      const l1 = document.createElement("div"); l1.className="line1"; l1.textContent = rec.station || "(無名)";
      const l2 = document.createElement("div"); l2.className="line2"; l2.textContent = `${{rec.model||""}}　${{rec.number||""}}`;
      const when = document.createElement("div"); when.className="when";
      const t = fmtWhen(rec.last_inspected_at); const md = document.createElement("div"); md.className="md"; md.textContent=t.md; const hm=document.createElement("div"); hm.className="hm"; hm.textContent=t.hm; when.appendChild(md); when.appendChild(hm);
      fields.appendChild(l1); fields.appendChild(l2); fields.appendChild(when);

      const right = document.createElement("div"); right.className="rightcol";

      const sel = document.createElement("select"); sel.className="state";
      [["normal","通常"],["stop","停止"],["skip","不要"]].forEach(([v,lab])=>{{ const op=document.createElement("option"); op.value=v; op.textContent=lab; if((rec.status||"normal")===(v)) op.selected=true; sel.appendChild(op); }});
      sel.addEventListener("change", ()=>{{ rec.status = sel.value; row.className = `row ${{rowClass(rec)}}`; const cur=readCity(city); const i=cur.findIndex(x=>(x.number||"")===(rec.number||"")); if(i>=0) cur[i]=rec; else cur.push(rec); writeCity(city, cur); }});

      const btn = document.createElement("button"); btn.className="btn-mini"; btn.textContent="点検";
      btn.addEventListener("click", ()=>{{ const q=new URLSearchParams({{station:rec.station||"", model:rec.model||"", number:rec.number||""}}); window.open(`${{TIRE_APP_URL}}?${{q.toString()}}`, "_blank"); }});

      right.appendChild(sel); right.appendChild(btn);

      row.appendChild(idx); row.appendChild(chk); row.appendChild(fields); row.appendChild(right);

      list.appendChild(row);
    }
  }

  window.JunkaiApp = window.JunkaiApp || {};
  window.JunkaiApp.mountIndex = mountIndex;
  window.JunkaiApp.mountCity = mountCity;
})();
