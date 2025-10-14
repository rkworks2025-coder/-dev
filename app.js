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

  /**
   * Show or hide the progress modal and optionally update its bar width.
   * @param {boolean} on Whether to show the modal.
   * @param {number} pct Percentage (0–100) of the progress bar width.
   */
  function showProgress(on, pct){
    const m = document.getElementById('progressModal');
    const bar = document.getElementById('progressBar');
    if(!m) return;
    if(on) m.classList.add('show'); else m.classList.remove('show');
    if(bar && typeof pct==='number') bar.style.width = Math.max(0,Math.min(100,pct)) + '%';
  }
  /**
   * Update the status text displayed on the index page.
   * @param {string} txt The text to display.
   */
  function status(txt){
    const el = document.getElementById('statusText'); if(el) el.textContent = txt;
  }

  /**
   * Normalize a raw record object into a consistent shape.
   * Trims strings and sets sensible defaults for optional fields.
   * @param {Object} r Raw record object.
   */
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

  /**
   * Helper to fetch JSON from a URL with retries.
   * Aborts requests after TIMEOUT_MS and retries up to `retry` times.
   * @param {string} url The URL to fetch.
   * @param {number} retry Number of retries.
   */
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

  /**
   * Save an array of records to local storage for a given city.
   * @param {string} city City name.
   * @param {Array<Object>} arr Array of record objects.
   */
  function saveCity(city, arr){
    localStorage.setItem(LS_KEY(city), JSON.stringify(arr));
  }
  /**
   * Read an array of records from local storage for a given city.
   * @param {string} city City name.
   * @returns {Array<Object>} Array of records or empty array.
   */
  function readCity(city){
    try{ const s = localStorage.getItem(LS_KEY(city)); if(!s) return []; const a = JSON.parse(s); return Array.isArray(a)? a:[]; }catch(_){ return []; }
  }

  /**
   * Assign sequential UI indices (e.g. Y1, E2) to records within a city.
   * @param {string} city City name.
   * @param {Array<Object>} arr Array of records.
   */
  function applyUIIndex(city, arr){
    const p = PREFIX[city] || '';
    for(let i=0;i<arr.length;i++){
      arr[i].ui_index_num = i+1;
      arr[i].ui_index = p + (i+1);
    }
  }

  /**
   * Count summary values for a city's records (done, stop, skip, total).
   * @param {Array<Object>} arr Array of records.
   */
  function countCity(arr){
    const c = {done:0, stop:0, skip:0, total:arr.length};
    for(const it of arr){
      if(it.status==='stop') c.stop++;
      else if(it.status==='skip') c.skip++;
      if(it.checked || it.status==='done') c.done++;
    }
    return c;
  }

  /**
   * Repaint all counters on the index page and aggregated totals.
   */
  function repaintCounters(){
    const map = {
      "大和市":    {done:'#yamato-done', stop:'#yamato-stop', skip:'#yamato-skip', total:'#yamato-total', rem:'#yamato-rem'},
      "海老名市":  {done:'#ebina-done',  stop:'#ebina-stop',  skip:'#ebina-skip',  total:'#ebina-total', rem:'#ebina-rem'},
      "調布市":    {done:'#chofu-done',  stop:'#chofu-stop',  skip:'#chofu-skip',  total:'#chofu-total', rem:'#chofu-rem'},
    };
    let overallTotal = 0, overallDone = 0, overallStop = 0, overallSkip = 0;
    for(const city of CITIES){
      const arr = readCity(city);
      const cnt = countCity(arr);
      overallTotal += cnt.total;
      overallDone += cnt.done;
      overallStop += cnt.stop;
      overallSkip += cnt.skip;
      const m = map[city];
      for(const k of ['done','stop','skip','total']){
        const el = document.querySelector(m[k]); if(el) el.textContent = cnt[k];
      }
      const remCount = cnt.total - cnt.done - cnt.skip;
      const remEl = document.querySelector(m.rem);
      if(remEl) remEl.textContent = remCount;
    }
    const allDoneEl  = document.querySelector('#all-done');
    const allStopEl  = document.querySelector('#all-stop');
    const allSkipEl  = document.querySelector('#all-skip');
    const allTotalEl = document.querySelector('#all-total');
    const allRemEl   = document.querySelector('#all-rem');
    if(allDoneEl)  allDoneEl.textContent  = overallDone;
    if(allStopEl)  allStopEl.textContent  = overallStop;
    if(allSkipEl)  allSkipEl.textContent  = overallSkip;
    if(allTotalEl) allTotalEl.textContent = overallTotal;
    if(allRemEl)   allRemEl.textContent   = (overallTotal - overallDone - overallSkip);
    const hint = document.getElementById('overallHint');
    if(hint) hint.textContent = overallTotal>0 ? `総件数：${overallTotal}` : 'まだ同期されていません';
  }

  /**
   * Pull records from the specified sheet (全体管理 or InspectionLog) and save them into local storage.
   * Displays progress and status messages throughout the operation.
   * @param {string} sheet Sheet name to pull from.
   * @param {string} actionLabel Label used in status messages (e.g. '初期同期' or '同期').
   */
  async function pullAndSave(sheet, actionLabel){
    // Start progress
    status(`${actionLabel}開始…`);
    showProgress(true, 5);
    try{
      // Build URL with sheet parameter and cache-busting timestamp
      const url = `${GAS_URL}?action=pull&sheet=${encodeURIComponent(sheet)}&_=${Date.now()}`;
      // Fetch JSON with retry
      status(`${actionLabel}取得中…`);
      showProgress(true, 25);
      const json = await fetchJSONWithRetry(url, 2);
      // Determine data array
      let arr = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.values) ? json.values : []);
      if(!Array.isArray(arr)) arr = [];
      if(arr.length === 0 && Array.isArray(json) && Array.isArray(json[0])) arr = json;
      // Skip header row for InspectionLog if present
      if(sheet === 'InspectionLog' && arr.length > 0 && Array.isArray(arr[0])){
        const firstRow = arr[0].map(x => typeof x === 'string' ? x.toLowerCase() : '');
        if(firstRow.includes('city') && firstRow.includes('station')) arr = arr.slice(1);
      }
      // Helper to convert yyyy/MM/dd or yyyy/MM/dd-HH:mm to ISO string
      function toISOChecked(s){
        if(!s) return '';
        const str = String(s).trim();
        const parts = str.split('-');
        let datePart='', timePart='';
        if(parts.length >= 2){
          datePart = parts[0].replace(/\//g,'-');
          timePart = parts[1].split(' ')[0];
          const dt = new Date(`${datePart}T${timePart}:00`);
          return Number.isFinite(dt.getTime())? dt.toISOString() : '';
        } else {
          datePart = str.replace(/\//g,'-');
          const dt = new Date(`${datePart}T00:00:00`);
          return Number.isFinite(dt.getTime())? dt.toISOString() : '';
        }
      }
      // Prepare buckets per city
      const buckets = { "大和市":[], "海老名市":[], "調布市":[] };
      // Process rows based on sheet type
      if(sheet === 'InspectionLog'){
        for(const row of arr){
          if(!Array.isArray(row) || row.length < 7) continue;
          const city    = (row[0]||'').toString();
          const station = (row[1]||'').toString();
          const model   = (row[2]||'').toString();
          const number  = (row[3]||'').toString();
          const idxStr  = (row[4]||'').toString();
          const statusEng= (row[5]||'').toString();
          const checkedAt=(row[6]||'').toString();
          const rec = {
            city, station, model, number,
            status:'normal', checked:false, index:'', last_inspected_at:'',
            ui_index: idxStr || '', ui_index_num:0
          };
          if(idxStr){
            const m = idxStr.match(/^(?:[A-Za-z]|[^0-9]*)(\d+)/);
            if(m){ const num = parseInt(m[1],10); if(Number.isFinite(num)) rec.ui_index_num = num; }
          }
          // Map English status to internal fields
          switch(statusEng){
            case 'Checked':
              rec.checked = true;
              rec.status = 'normal';
              rec.last_inspected_at = toISOChecked(checkedAt);
              break;
            case 'stopped':
              rec.status = 'stop';
              break;
            case 'Unnecessary':
              rec.status = 'skip';
              break;
            case '7days_rule':
            case '7 day rule':
              rec.status = '7days_rule';
              rec.checked = false;
              rec.last_inspected_at = toISOChecked(checkedAt);
              break;
            default:
              rec.status = 'normal';
          }
          if(buckets[city]) buckets[city].push(rec);
        }
      } else {
        // Heuristics for 全体管理 or similar sheets
        let headerMap = null;
        if(arr.length > 0 && Array.isArray(arr[0])){
          const firstRow = arr[0];
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
            arr = arr.slice(1);
          }
        }
        for(const r of arr){
          let rowObj;
          if(Array.isArray(r)){
            if(headerMap){
              const city    = r[headerMap.city ?? 0] || '';
              const station = r[headerMap.station ?? 1] || '';
              const model   = r[headerMap.model ?? 2] || '';
              const number  = r[headerMap.number ?? 3] || '';
              const statusVal = (headerMap.status !== undefined ? (r[headerMap.status] || '') : 'normal');
              rowObj = { city, station, model, number, status: statusVal || 'normal', checked:false, index:'', last_inspected_at:'' };
            } else {
              if(r.length >= 2 && typeof r[1] === 'string' && r[1].trim().toLowerCase() === 'city') continue;
              if(r.length >= 6 && typeof r[0] === 'string' && r[0].trim().startsWith('TS')){
                const city    = r[1] || '';
                const station = r[3] || '';
                const model   = r[4] || '';
                const number  = r[5] || '';
                const statusVal = r[6] || 'normal';
                rowObj = { city, station, model, number, status: statusVal, checked:false, index:'', last_inspected_at:'' };
              } else {
                if(r.length >= 6){
                  const city    = r[1] || r[0] || '';
                  const station = r[3] || r[1] || '';
                  const model   = r[4] || r[2] || '';
                  const number  = r[5] || r[3] || '';
                  const statusVal = r[6] || 'normal';
                  rowObj = { city, station, model, number, status: statusVal, checked:false, index:'', last_inspected_at:'' };
                } else {
                  const city    = r[0] || '';
                  const station = r[1] || '';
                  const model   = r[2] || '';
                  const number  = r[3] || '';
                  const statusVal = r[4] || 'normal';
                  rowObj = { city, station, model, number, status: statusVal, checked:false, index:'', last_inspected_at:'' };
                }
              }
            }
          } else if(r && typeof r === 'object'){
            rowObj = r;
          } else {
            continue;
          }
          const cityName = (rowObj.city||'').trim();
          if(!buckets[cityName]) continue;
          const rec = normalize(rowObj);
          // For initial sync, clear check state and last inspected date
          rec.checked = false;
          rec.last_inspected_at = '';
          buckets[cityName].push(rec);
        }
      }
      // Assign UI indices and save
      let wrote = 0;
      for(const city of CITIES){
        if(buckets[city].length > 0){
          applyUIIndex(city, buckets[city]);
          saveCity(city, buckets[city]);
          wrote++;
        }
      }
      if(wrote === 0){
        status(`${actionLabel}失敗：データが空でした（既存データは保持）`);
        showProgress(false);
        return;
      }
      // Update counters and finish progress
      repaintCounters();
      status(`${actionLabel}完了：大和${buckets['大和市'].length || 0} / 海老名${buckets['海老名市'].length || 0} / 調布${buckets['調布市'].length || 0}`);
      showProgress(true, 100);
    } catch(e){
      console.error(`${actionLabel} error`, e);
      status(`${actionLabel}失敗：通信または解析エラー（既存データは保持）`);
    } finally {
      setTimeout(()=>showProgress(false), 350);
    }
  }

  /**
   * Initialize the index page: attaches event handlers to buttons and repaints counters.
   */
  async function initIndex(){
    repaintCounters();
    // Initial sync button: confirm then pull 全体管理
    const initBtn = document.getElementById('initSyncBtn');
    if(initBtn){
      initBtn.addEventListener('click', async ()=>{
        if(!confirm('よろしいですか？')) return;
        await pullAndSave('全体管理', '初期同期');
      });
    }
    // Sync button: pull InspectionLog
    const syncBtn = document.getElementById('syncBtn');
    if(syncBtn){
      syncBtn.addEventListener('click', async ()=>{
        await pullAndSave('InspectionLog', '同期');
      });
    }
    // Data send button: push local changes to InspectionLog
    const pushBtn = document.getElementById('pushLogBtn');
    if(pushBtn){
      pushBtn.addEventListener('click', async ()=>{
        // Show initial status and progress
        status('データ送信中…');
        showProgress(true, 15);
        try{
          const all = [];
          for(const c of CITIES){
            const arrCity = readCity(c);
            if(Array.isArray(arrCity)) all.push(...arrCity);
          }
          const params = new URLSearchParams();
          params.append('action','push');
          params.append('data', JSON.stringify(all));
          const res = await fetch(GAS_URL, {
            method:'POST',
            headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
            body: params.toString()
          });
          let result = null;
          try{ result = await res.json(); }catch(_){ result = null; }
          if(result && result.ok){
            status('データ送信完了！');
          } else {
            status('更新に失敗しました');
          }
        } catch(err){
          console.error('push error', err);
          status('更新エラー');
        } finally {
          setTimeout(()=>showProgress(false), 350);
        }
      });
    }
  }

  // ===== City page =====
  /**
   * Check if a date is within the last 7 days.
   * @param {string} last ISO date string.
   */
  function within7d(last){
    if(!last) return false;
    const t = Date.parse(last);
    if(!Number.isFinite(t)) return false;
    return (Date.now() - t) < (7*24*60*60*1000);
  }
  /**
   * Determine the CSS class to apply to a record's row based on its status.
   * @param {Object} rec Record object.
   */
  function rowBg(rec){
    if(rec.checked) return 'bg-pink';
    if(rec.status === 'stop') return 'bg-gray';
    if(rec.status === 'skip') return 'bg-yellow';
    if(rec.status === '7days_rule' || rec.status === '7 day rule') return 'bg-blue';
    if(within7d(rec.last_inspected_at)) return 'bg-blue';
    return 'bg-green';
  }

  /**
   * Mount a city's list page: populate the list and attach event handlers.
   * @param {string} city City name.
   */
  function mountCity(city){
    const list = document.getElementById('list');
    const hint = document.getElementById('hint');
    list.innerHTML = '';
    const arr = readCity(city);
    if(arr.length===0){ hint.textContent='まだ同期されていません（インデックスの同期を押してください）'; return; }
    hint.textContent = `件数：${arr.length}`;
    for(const rec of arr){
      const row = document.createElement('div');
      row.className = `row ${rowBg(rec)}`;
      const left = document.createElement('div');
      left.className = 'leftcol';
      const idxDiv = document.createElement('div');
      idxDiv.className = 'idx';
      idxDiv.textContent = rec.ui_index || '';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!rec.checked;
      chk.className = 'chk';
      const topLeft = document.createElement('div');
      topLeft.className = 'left-top';
      topLeft.appendChild(idxDiv);
      topLeft.appendChild(chk);
      const dtDiv = document.createElement('div');
      dtDiv.className = 'datetime';
      function updateDateTime(){
        if(rec.last_inspected_at){
          const d = new Date(rec.last_inspected_at);
          if(Number.isFinite(d.getTime())){
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth()+1).padStart(2,'0');
            const dd = String(d.getDate()).padStart(2,'0');
            dtDiv.innerHTML = `${yyyy}<br>${mm}/${dd}`;
            dtDiv.style.display = '';
            return;
          }
        }
        dtDiv.innerHTML = '';
        dtDiv.style.display = 'none';
      }
      updateDateTime();
      dtDiv.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'date';
        if(rec.last_inspected_at){
          const d0 = new Date(rec.last_inspected_at);
          if(Number.isFinite(d0.getTime())){
            input.value = d0.toISOString().slice(0,10);
          }
        }
        dtDiv.appendChild(input);
        if(typeof input.showPicker === 'function'){ input.showPicker(); } else { input.focus(); }
        input.addEventListener('change', () => {
          const sel = input.value;
          dtDiv.removeChild(input);
          if(!sel) return;
          if(!confirm('よろしいですか？')) return;
          const iso = new Date(sel).toISOString();
          rec.last_inspected_at = iso;
          persistCityRec(city, rec);
          updateDateTime();
          row.className = `row ${rowBg(rec)}`;
        }, { once: true });
      });
      left.appendChild(topLeft);
      left.appendChild(dtDiv);
      chk.addEventListener('change', () => {
        const message = chk.checked ? 'チェックを付けます。よろしいですか？' : 'チェックを外します。よろしいですか？';
        if(!confirm(message)){
          chk.checked = !chk.checked;
          return;
        }
        const nowISO = new Date().toISOString();
        rec.checked = chk.checked;
        if(chk.checked){ rec.last_inspected_at = nowISO; } else { rec.last_inspected_at = ''; }
        updateDateTime();
        persistCityRec(city, rec);
        row.className = `row ${rowBg(rec)}`;
      });
      const mid = document.createElement('div');
      mid.className = 'mid';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = rec.station || '';
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.innerHTML = `${rec.model || ''}<br>${rec.number || ''}`;
      mid.appendChild(title);
      mid.appendChild(sub);
      const right = document.createElement('div');
      right.className = 'rightcol';
      const sel = document.createElement('select');
      sel.className = 'state';
      [['normal','通常'], ['stop','停止'], ['skip','不要']].forEach(([v,lab])=>{
        const o = document.createElement('option');
        o.value = v;
        o.textContent = lab;
        if(rec.status === v) o.selected = true;
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
        const q = new URLSearchParams({
          station: rec.station || '',
          model: rec.model || '',
          plate_full: rec.number || '',
        });
        location.href = `${TIRE_APP_URL}?${q.toString()}`;
      });
      right.appendChild(sel);
      right.appendChild(btn);
      row.appendChild(left);
      row.appendChild(mid);
      row.appendChild(right);
      list.appendChild(row);
    }
  }

  /**
   * Persist a record update to local storage by matching on ui_index or plate number.
   * @param {string} city City name.
   * @param {Object} rec Record to persist.
   */
  function persistCityRec(city, rec){
    const arr = readCity(city);
    let i = -1;
    if(rec.ui_index){
      i = arr.findIndex(x => (x.ui_index || '') === (rec.ui_index || ''));
    }
    if(i < 0){
      i = arr.findIndex(x => (x.number || '') === (rec.number || ''));
    }
    if(i >= 0){
      arr[i] = rec;
    } else {
      arr.push(rec);
    }
    saveCity(city, arr);
  }

  // Expose public API
  return {
    initIndex,
    initCity: mountCity,
  };
})();