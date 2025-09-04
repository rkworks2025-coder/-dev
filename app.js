
/* ==================================================
   巡回アプリ v5a 共通JS
   - index: 同期/集計
   - city pages: 描画/チェック確認/状態変更/点検リンク
   ================================================== */
(function(){
  if (window.Junkai && window.Junkai._mounted) return;
  const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
  const CITIES = ["大和市","海老名市","調布市"];
  const LS_KEY = (city)=>`junkai:city:${city}`;
  window.Junkai = { _mounted:true };

  // ---------- helpers ----------
  const $ = (s,root=document)=>root.querySelector(s);
  const fmt2 = (n)=>String(n).padStart(2,"0");
  const nowJST = ()=>{
    const d = new Date();
    const mm = fmt2(d.getMonth()+1), dd = fmt2(d.getDate());
    const hh = fmt2(d.getHours()), mi = fmt2(d.getMinutes());
    return {iso:d.toISOString(), md:`${mm}/${dd}`, hm:`${hh}:${mi}`};
  };
  const within7d = (iso)=>{
    if (!iso) return false;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return false;
    return (Date.now() - t) < 7*24*60*60*1000;
  };

  const rowColor = (rec)=>{
    if (rec.checked) return "bg-pink"; // チェックが最優先
    if (within7d(rec.last_inspected_at)) return "bg-blue";
    if (rec.status==="stop") return "bg-gray";
    if (rec.status==="skip") return "bg-yellow";
    return "bg-green";
  };

  const normalize = (r, i0)=>{
    if (Array.isArray(r)){ // [city, station, model, number, status, checked, index, last_at]
      const obj = {
        city: String(r[0]||"").trim(),
        station: String(r[1]||"").trim(),
        model: String(r[2]||"").trim(),
        number: String(r[3]||"").trim(),
        status: String(r[4]||"normal").trim(),
        checked: !!r[5],
        index: (r[6] && +r[6]>0) ? parseInt(r[6],10) : 0,
        last_inspected_at: String(r[7]||"").trim(),
      };
      if (!obj.index) obj.index = i0+1;
      return obj;
    } else { // object
      const obj = {
        city: String(r.city||"").trim(),
        station: String(r.station||r.stationName||"").trim(),
        model: String(r.model||"").trim(),
        number: String(r.number||r.plate||r.plate_full||"").trim(),
        status: String(r.status||"normal").trim(),
        checked: !!r.checked,
        index: (r.index && +r.index>0) ? parseInt(r.index,10) : 0,
        last_inspected_at: String(r.last_inspected_at||"").trim(),
      };
      return obj;
    }
  };

  const saveCity = (city, arr)=> localStorage.setItem(LS_KEY(city), JSON.stringify(arr));
  const readCity = (city)=>{
    try{
      const s = localStorage.getItem(LS_KEY(city));
      if (!s) return [];
      const a = JSON.parse(s);
      return Array.isArray(a) ? a : [];
    }catch(_){ return []; }
  };

  // ---------- index page ----------
  function mountIndex(){
    const syncBtn = $("#syncBtn");
    const recalcBtn = $("#recalcBtn");
    const statusText = $("#statusText");
    const modal = $("#progressModal");
    const bar = $("#progressBar");

    function showModal(msg){
      $("#progressTitle").textContent = msg || "同期中…";
      modal.classList.add("show");
      bar.style.width = "0%";
      let t = 0;
      modal._timer = setInterval(()=>{ t=(t+6)%100; bar.style.width = t+"%"; }, 80);
    }
    function hideModal(msg){
      if (msg) $("#progressTitle").textContent = msg;
      if (modal._timer) clearInterval(modal._timer);
      setTimeout(()=>{ modal.classList.remove("show"); bar.style.width="0%"; }, 250);
    }

    async function doSync(){
      try{
        showModal("同期中…");
        statusText.textContent = "GASから取得しています…";
        const res = await fetch(`${GAS_URL}?action=pull`, {cache:"no-store"});
        const json = await res.json().catch(()=>null);
        if (!json || (json.ok!==true && !Array.isArray(json))) throw new Error("応答形式エラー");

        // 取り出し
        const rows = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
        // バケツ
        const buckets = {"大和市":[],"海老名市":[],"調布市":[]};
        rows.forEach((r,i)=>{
          const obj = normalize(r,i);
          if (buckets[obj.city]) buckets[obj.city].push(obj);
        });
        // 保存
        CITIES.forEach(city=> saveCity(city, buckets[city]));

        // 集計して表示
        recalcCounts();
        statusText.textContent = "同期完了！";
        hideModal("同期完了！");
      }catch(e){
        console.error(e);
        statusText.textContent = "同期失敗：通信または解析エラー";
        hideModal("同期失敗");
      }
    }

    function recalcCounts(){
      const maps = {
        "大和市": { done:"#yamato-done", stop:"#yamato-stop", skip:"#yamato-skip", total:"#yamato-total" },
        "海老名市": { done:"#ebina-done", stop:"#ebina-stop", skip:"#ebina-skip", total:"#ebina-total" },
        "調布市": { done:"#chofu-done", stop:"#chofu-stop", skip:"#chofu-skip", total:"#chofu-total" },
      };
      let overall = 0;
      CITIES.forEach(city=>{
        const arr = readCity(city);
        overall += arr.length;
        const cnt = {done:0,stop:0,skip:0,total:arr.length};
        arr.forEach(it=>{
          if (it.status==="stop") cnt.stop++;
          else if (it.status==="skip") cnt.skip++;
          if (it.checked || it.status==="done") cnt.done++;
        });
        const m = maps[city];
        document.querySelector(m.done).textContent = cnt.done;
        document.querySelector(m.stop).textContent = cnt.stop;
        document.querySelector(m.skip).textContent = cnt.skip;
        document.querySelector(m.total).textContent = cnt.total;
      });
      const hint = $("#overallHint");
      hint.textContent = overall>0 ? `総件数：${overall}` : "まだ同期されていません";
    }

    if (syncBtn && !syncBtn._wired){ syncBtn.addEventListener("click", doSync); syncBtn._wired = true; }
    if (recalcBtn && !recalcBtn._wired){ recalcBtn.addEventListener("click", recalcCounts); recalcBtn._wired = true; }
    recalcCounts();
  }

  // ---------- city page ----------
  function mountCity(){
    const cityEl = $("#__CITY__");
    if (!cityEl) return; // not a city page
    const CITY = cityEl.dataset.city;
    const list = $("#list");
    const countEl = $("#count");

    const data = readCity(CITY);
    countEl.textContent = String(data.length);
    list.innerHTML = "";
    if (data.length===0){
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "まだ同期されていません（インデックスで同期してください）";
      list.appendChild(p);
      return;
    }

    // sort by index then station
    data.sort((a,b)=>{
      const ai = (a.index>0?a.index:1e9), bi=(b.index>0?b.index:1e9);
      return ai-bi || (a.station||"").localeCompare(b.station||"", "ja");
    });

    data.forEach((rec, i)=>{
      const row = document.createElement("div");
      row.className = `row ${rowColor(rec)}`;

      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = String(rec.index>0 ? rec.index : i+1);

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "chk";
      chk.checked = !!rec.checked;
      chk.addEventListener("change", ()=>{
        const ok = confirm(chk.checked ? "巡回済みにします。よろしいですか？" : "巡回済みを外します。よろしいですか？");
        if (!ok){ chk.checked = !chk.checked; return; }
        if (chk.checked){
          rec.checked = true;
          const t = nowJST();
          rec.last_inspected_at = t.iso;
          lmd.textContent = t.md;
          lhm.textContent = t.hm;
        }else{
          rec.checked = false;
          // 直近時刻は保持（要件では保持でOK）
        }
        savePatch(rec);
        row.className = `row ${rowColor(rec)}`;
      });

      const fields = document.createElement("div");
      fields.className = "fields";
      const l1 = document.createElement("div");
      l1.className = "line1";
      l1.textContent = rec.station || "(無名)";
      const l2 = document.createElement("div");
      l2.className = "line2";
      const l2model = document.createElement("span"); l2model.textContent = rec.model||"";
      const l2num = document.createElement("span"); l2num.textContent = rec.number||"";
      const when = document.createElement("div"); when.className="when";
      const lmd = document.createElement("div"); lmd.className="md";
      const lhm = document.createElement("div"); lhm.className="hm";
      if (rec.last_inspected_at){
        const d = new Date(rec.last_inspected_at);
        if (!isNaN(d)){
          lmd.textContent = fmt2(d.getMonth()+1)+"/"+fmt2(d.getDate());
          lhm.textContent = fmt2(d.getHours())+":"+fmt2(d.getMinutes());
        }
      }
      when.appendChild(lmd); when.appendChild(lhm);
      l2.appendChild(l2model); l2.appendChild(l2num); l2.appendChild(when);
      fields.appendChild(l1); fields.appendChild(l2);

      const right = document.createElement("div");
      right.className = "rightcol";

      const sel = document.createElement("select");
      sel.className = "state-select";
      [["normal","通常"],["stop","停止"],["skip","不要"]].forEach(([v,lb])=>{
        const op=document.createElement("option"); op.value=v; op.textContent=lb; if(rec.status===v) op.selected=true; sel.appendChild(op);
      });
      sel.addEventListener("change", ()=>{
        rec.status = sel.value;
        savePatch(rec);
        row.className = `row ${rowColor(rec)}`;
      });

      const btn = document.createElement("button");
      btn.className = "btn-mini";
      btn.textContent = "点検";
      btn.addEventListener("click", ()=>{
        const base = "https://rkworks2025-coder.github.io/r.k.w-/";
        const q = new URLSearchParams({station:rec.station||"", model:rec.model||"", number:rec.number||""});
        window.location.href = `${base}?${q.toString()}`;
      });

      right.appendChild(sel);
      right.appendChild(btn);

      row.appendChild(idx);
      row.appendChild(chk);
      row.appendChild(fields);
      row.appendChild(right);
      list.appendChild(row);
    });

    function savePatch(rec){
      const arr = readCity(CITY);
      const i = arr.findIndex(x => (x.number||"") === (rec.number||""));
      if (i>=0) arr[i] = rec; else arr.push(rec);
      saveCity(CITY, arr);
    }
  }

  // ---------- mount ----------
  document.addEventListener("DOMContentLoaded", ()=>{
    // index or city?
    if (document.body.dataset.page === "index") mountIndex();
    else mountCity();
  }, {once:true});
})();
