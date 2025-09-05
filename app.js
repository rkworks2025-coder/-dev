
// ====== 設定 ======
const Junkai = (()=>{

  const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
  const TIRE_APP_URL = "https://rkworks2025-coder.github.io/r.k.w-/";
  const CITIES = ["大和市","海老名市","調布市"];
  const PREFIX = { "大和市":"Y", "海老名市":"E", "調布市":"C" };
  const LS_KEY = (c) => `junkai:city:${c}`;
  const TIMEOUT_MS = 15000;
  const DEBUG_ERRORS = true;

  // ===== utils =====
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

  function showProgress(on, pct){
    const m = document.getElementById('progressModal');
    const bar = document.getElementById('progressBar');
    if(!m) return;
    if(on) m.classList.add('show'); else m.classList.remove('show');
    if(bar && typeof pct==='number') bar.style.width = Math.max(0,Math.min(100,pct)) + '%';
  }
  function status(txt){
    const el = document.getElementById('statusText'); if(el) el.textContent = txt;
  }

  function normalize(r){
    return {
      city: (r.city||'').trim(),
      station: (r.station||'').trim(),
      model: (r.model||'').trim(),
      number: (r.number||'').trim(),
      status: (r.status||'normal').trim(),
      checked: !!r.checked,
      index: (Number.isFinite(+r.index) && +r.index>0)? parseInt(r.index,10) : 0,
      last_inspected_at: (r.last_inspected_at||'').trim(),
      ui_index: r.ui_index || '',
      ui_index_num: r.ui_index_num || 0
    };
  }

  async function fetchJSONWithRetry(url, retry=2){
    let lastErr = null;
    for(let i=0;i<=retry;i++){ 
      try{
        const ctl = new AbortController();
        const t = setTimeout(()=>ctl.abort(), TIMEOUT_MS);
        const res = await fetch(url, { method:'GET', cache:'no-store', redirect:'follow', signal: ctl.signal });
        clearTimeout(t);
        const raw = await res.text();
        // try parse JSON (strip BOM)
        const text = raw.replace(/^\ufeff/, '');
        let json = null;
        try{ json = JSON.parse(text); }
        catch(e){ 
          if(DEBUG_ERRORS) console.warn('JSON parse fail, first 200 chars:', text.slice(0,200));
          throw new Error('parse-fail');
        }
        return json;
      }catch(e){
        lastErr = e;
        await sleep(400*(i+1));
      }
    }
    throw lastErr || new Error('fetch-fail');
  }

  function saveCity(city, arr){
    localStorage.setItem(LS_KEY(city), JSON.stringify(arr));
  }
  function readCity(city){
    try{ const s = localStorage.getItem(LS_KEY(city)); if(!s) return []; const a = JSON.parse(s); return Array.isArray(a)? a:[]; }catch(_){ return []; }
  }

  function applyUIIndex(city, arr){
    // cityごとに 1..N 採番して UI表示用に保存
    const p = PREFIX[city] || '';
    for(let i=0;i<arr.length;i++){
      arr[i].ui_index_num = i+1;
      arr[i].ui_index = p + (i+1);
    }
  }

  function countCity(arr){
    const c = {done:0, stop:0, skip:0, total:arr.length};
    for(const it of arr){
      if(it.status==='stop') c.stop++;
      else if(it.status==='skip') c.skip++;
      if(it.checked || it.status==='done') c.done++;
    }
    return c;
  }

  function repaintCounters(){
    const map = {
      "大和市":    {done:'#yamato-done', stop:'#yamato-stop', skip:'#yamato-skip', total:'#yamato-total'},
      "海老名市":  {done:'#ebina-done',  stop:'#ebina-stop',  skip:'#ebina-skip',  total:'#ebina-total'},
      "調布市":    {done:'#chofu-done',  stop:'#chofu-stop',  skip:'#chofu-skip',  total:'#chofu-total'},
    };
    let overall = 0;
    for(const city of CITIES){
      const arr = readCity(city);
      const cnt = countCity(arr);
      overall += cnt.total;
      const m = map[city];
      for(const k of ['done','stop','skip','total']){
        const el = document.querySelector(m[k]); if(el) el.textContent = cnt[k];
      }
    }
    const hint = document.getElementById('overallHint');
    if(hint) hint.textContent = overall>0 ? `総件数：${overall}` : 'まだ同期されていません';
  }

  // ====== public init for index ======
  async function initIndex(){
    repaintCounters();
    const btn = document.getElementById('syncBtn');
    if(!btn) return;
    btn.addEventListener('click', async()=>{
      try{
        showProgress(true, 5);
        status('開始…');
        const u = `${GAS_URL}?action=pull&_=${Date.now()}`;
        status('GASへ問い合わせ中…');
        showProgress(true, 35);
        const json = await fetchJSONWithRetry(u, 2);
        showProgress(true, 55);
        // accept json.data or json.values as array; do not require json.ok===true to support more GAS deployments
        if(!json || (!Array.isArray(json.data) && !Array.isArray(json.values))) throw new Error('bad-shape');

        // prepare buckets for each supported city
        const buckets = { "大和市":[], "海老名市":[], "調布市":[] };
        // some GAS deployments return data under 'data', others under 'values'
        let arr = Array.isArray(json.data) ? json.data : (Array.isArray(json.values) ? json.values : []);
        // if there is no array, bail out
        if(!Array.isArray(arr)) arr = [];
        // fallback: if arr is empty and json itself is an array of arrays (root-level list)
        if(arr.length === 0 && Array.isArray(json) && Array.isArray(json[0])){
          arr = json;
        }

        // detect header row dynamically (e.g. ['TSエリア','city','所在地','station','model','plate',...])
        let headerMap = null;
        if(arr.length > 0 && Array.isArray(arr[0])){
          const firstRow = arr[0];
          // check if the first row contains english column names like 'city' or 'station'
          const lower = firstRow.map(x => (typeof x === 'string' ? x.trim().toLowerCase() : ''));
          if(lower.some(x => x.includes('city')) && lower.some(x => x.includes('station'))){
            headerMap = {};
            for(let i=0;i<firstRow.length;i++){
              const col = lower[i];
              if(col.includes('city')) headerMap.city = i;
              else if(col.includes('station')) headerMap.station = i;
              else if(col.includes('model')) headerMap.model = i;
              else if(col.includes('plate') || col.includes('number')) headerMap.number = i;
              else if(col.includes('status')) headerMap.status = i;
            }
            // remove header row from array
            arr = arr.slice(1);
          }
        }

        for(const r of arr){
          let rowObj;
          if(Array.isArray(r)){
            if(headerMap){
              // when headerMap is detected, use it to map columns
              const city = r[headerMap.city ?? 0] || '';
              const station = r[headerMap.station ?? 1] || '';
              const model = r[headerMap.model ?? 2] || '';
              const number = r[headerMap.number ?? 3] || '';
              const status = (headerMap.status !== undefined ? (r[headerMap.status] || '') : 'normal');
              rowObj = { city, station, model, number, status: status || 'normal', checked:false, index:'', last_inspected_at:'' };
            }else{
              // skip header rows that explicitly contain 'city' in the second column
              if(r.length >= 2 && typeof r[1] === 'string' && r[1].trim().toLowerCase() === 'city'){
                continue;
              }
              // detect TS-prefixed rows: r[0] starts with 'TS' and r has at least 6 columns
              if(r.length >= 6 && typeof r[0] === 'string' && r[0].trim().startsWith('TS')){
                const city = r[1] || '';
                const station = r[3] || '';
                const model = r[4] || '';
                const number = r[5] || '';
                const status = r[6] || 'normal';
                rowObj = { city, station, model, number, status, checked:false, index:'', last_inspected_at:'' };
              }else{
                // fallback heuristics
                if(r.length >= 6){
                  // assume r[1]=city, r[3]=station, r[4]=model, r[5]=plate
                  const city = r[1] || r[0] || '';
                  const station = r[3] || r[1] || '';
                  const model = r[4] || r[2] || '';
                  const number = r[5] || r[3] || '';
                  const status = r[6] || 'normal';
                  rowObj = { city, station, model, number, status, checked:false, index:'', last_inspected_at:'' };
                }else{
                  // simple case: 0=city,1=station,2=model,3=number,4=status
                  const city = r[0] || '';
                  const station = r[1] || '';
                  const model = r[2] || '';
                  const number = r[3] || '';
                  const status = r[4] || 'normal';
                  rowObj = { city, station, model, number, status, checked:false, index:'', last_inspected_at:'' };
                }
              }
            }
          }else if(r && typeof r === 'object'){
            rowObj = r;
          }else{
            continue;
          }
          const cityName = (rowObj.city || '').trim();
          if(!buckets[cityName]) continue;
          const rec = normalize(rowObj);
          buckets[cityName].push(rec);
        }

        // 成功時のみ保存（空配列なら上書きしない）
        let wrote = 0;
        for(const city of CITIES){
          if(buckets[city].length>0){
            applyUIIndex(city, buckets[city]);
            saveCity(city, buckets[city]);
            wrote++;
          }
        }

        if(wrote===0){ status('同期失敗：データが空でした（既存データは保持）'); showProgress(false); return; }

        repaintCounters();
        showProgress(true, 100);
        status(`同期完了：大和${buckets['大和市'].length||0} / 海老名${buckets['海老名市'].length||0} / 調布${buckets['調布市'].length||0}`);
      }catch(e){
        console.error('sync error', e);
        status('同期失敗：通信または解析エラー（既存データは保持）');
      }finally{ setTimeout(()=>showProgress(false), 350); }
    });
  }

  // ===== City page =====
  function within7d(last){
    if(!last) return false;
    const t = Date.parse(last);
    if(!Number.isFinite(t)) return false;
    return (Date.now() - t) < (7*24*60*60*1000);
  }
  function rowBg(rec){
    if(rec.checked) return 'bg-pink';
    if(rec.status==='stop') return 'bg-gray';
    if(rec.status==='skip') return 'bg-yellow';
    if(within7d(rec.last_inspected_at)) return 'bg-blue';
    return 'bg-green';
  }

  function mountCity(city){
    const list = document.getElementById('list');
    const hint = document.getElementById('hint');
    list.innerHTML = '';
    const arr = readCity(city);
    if(arr.length===0){ hint.textContent='まだ同期されていません（インデックスの同期を押してください）'; return; }
    hint.textContent = `件数：${arr.length}`;

    // city内採番を信頼
    for(const rec of arr){
      const row = document.createElement('div');
      row.className = `row ${rowBg(rec)}`;

      // left column: index number and checkbox side by side
      const left = document.createElement('div');
      left.className = 'leftcol';
      // index element
      const idxDiv = document.createElement('div');
      idxDiv.className = 'idx';
      idxDiv.textContent = rec.ui_index || '';
      left.appendChild(idxDiv);
      // checkbox
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!rec.checked;
      chk.addEventListener('change', () => {
        // confirm before toggling
        const message = chk.checked ? 'チェックを付けます。よろしいですか？' : 'チェックを外します。よろしいですか？';
        if (!confirm(message)) {
          // revert state if user cancels
          chk.checked = !chk.checked;
          return;
        }
        // update record
        rec.checked = chk.checked;
        if (rec.checked) {
          // when checked, record the inspection time
          rec.last_inspected_at = new Date().toISOString();
        } else {
          // when unchecked, clear the last inspection time to avoid the 7-day rule
          rec.last_inspected_at = '';
        }
        persistCityRec(city, rec);
        // update row background color
        row.className = `row ${rowBg(rec)}`;
      });
      left.appendChild(chk);

      // middle column: station title and sub-line
      const mid = document.createElement('div');
      mid.className = 'mid';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = rec.station || '';
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `${rec.model || ''}　${rec.number || ''}`;
      mid.appendChild(title);
      mid.appendChild(sub);

      // right column: status select and button
      const right = document.createElement('div');
      right.className = 'rightcol';
      const sel = document.createElement('select');
      sel.className = 'state';
      [['normal', '通常'], ['stop', '停止'], ['skip', '不要']].forEach(([v, lab]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = lab;
        if (rec.status === v) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        rec.status = sel.value;
        persistCityRec(city, rec);
        row.className = `row ${rowBg(rec)}`;
      });
      const btn = document.createElement('button');
      btn.className = 'btn tiny';
      btn.textContent = '点検';
      btn.addEventListener('click', () => {
        const q = new URLSearchParams({ station: rec.station || '', model: rec.model || '', number: rec.number || '' });
        location.href = `${TIRE_APP_URL}?${q.toString()}`;
      });
      right.appendChild(sel);
      right.appendChild(btn);

      // append columns
      row.appendChild(left);
      row.appendChild(mid);
      row.appendChild(right);
      list.appendChild(row);
    }
  }

  function persistCityRec(city, rec){
    const arr = readCity(city);
    const i = arr.findIndex(x=> (x.number||'')===(rec.number||''));
    if(i>=0) arr[i]=rec; else arr.push(rec);
    saveCity(city, arr);
  }

  return {
    initIndex: initIndex,
    initCity: mountCity,
  };
})();
