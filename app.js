
// ====== 設定 ======
const Junkai = (()=>{

  const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
  const TIRE_APP_URL = "https://rkworks2025-coder.github.io/r.k.w-/";
  const CITIES = ["大和市","海老名市","調布市"];
  const PREFIX = { "大和市":"Y", "海老名市":"E", "調布市":"C" };
  const LS_KEY = (c) => `junkai:city:${c}`;
  const TIMEOUT_MS = 15000;
  const DEBUG_ERRORS = true;

  const USE_LOG_KEY = 'junkai:useLog';
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
    
  /**
   * Sync records from the InspectionLog sheet. This fetches records from the
   * InspectionLog tab (via GAS pull) and maps them back into the app's local
   * data format. It is used after the initial sync from 全体管理.  If any error
   * occurs, existing data is preserved.
   */
  async function syncFromInspectionLog() {
    try {
      status('ログ取得中…');
      showProgress(true, 35);
      const url = `${GAS_URL}?action=pull&sheet=InspectionLog&_=${Date.now()}`;
      const json = await fetchJSONWithRetry(url, 2);
      // accept json.data or json.values
      let arr = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.values) ? json.values : []);
      if (!Array.isArray(arr)) arr = [];
      // fallback: if arr is empty and json itself is an array of arrays
      if (arr.length === 0 && Array.isArray(json) && Array.isArray(json[0])) {
        arr = json;
      }
      // skip header row if it contains 'city' and 'station'
      if (arr.length > 0 && Array.isArray(arr[0])) {
        const first = arr[0].map(x => typeof x === 'string' ? x.toLowerCase() : '');
        if (first.includes('city') && first.includes('station')) {
          arr = arr.slice(1);
        }
      }
      const buckets = { "大和市": [], "海老名市": [], "調布市": [] };
      // helper to convert checked_at (either yyyy/MM/dd-HH:mm or yyyy/MM/dd) to ISO
      function toISO(s) {
        if (!s) return '';
        // Trim whitespace and ensure string
        const str = String(s).trim();
        // Split on '-' to see if there is a time part
        const parts = str.split('-');
        let datePart = '';
        let timePart = '';
        if (parts.length >= 2) {
          // Format like yyyy/MM/dd-HH:mm
          datePart = parts[0].replace(/\//g, '-');
          // Use only the first time component (HH:mm) and ignore others
          timePart = parts[1].split(' ')[0];
          // Build local date string; default seconds to 00
          const dt = new Date(`${datePart}T${timePart}:00`);
          if (!Number.isFinite(dt.getTime())) return '';
          return dt.toISOString();
        } else {
          // Format like yyyy/MM/dd (date only)
          datePart = str.replace(/\//g, '-');
          const dt = new Date(`${datePart}T00:00:00`);
          if (!Number.isFinite(dt.getTime())) return '';
          return dt.toISOString();
        }
      }
      for (const row of arr) {
        if (!Array.isArray(row) || row.length < 7) continue;
        const city = (row[0] || '').toString();
        const station = (row[1] || '').toString();
        const model = (row[2] || '').toString();
        const number = (row[3] || '').toString();
        const idxStr = (row[4] || '').toString();
        const statusEng = (row[5] || '').toString();
        const checkedAt = (row[6] || '').toString();
        const rec = {
          city,
          station,
          model,
          number,
          status: 'normal',
          checked: false,
          index: '',
          last_inspected_at: '',
          ui_index: idxStr || '',
          ui_index_num: 0
        };
        // derive ui_index_num from idxStr (e.g. Y1 -> 1)
        if (idxStr) {
          const m = idxStr.match(/^(?:[A-Za-z]|[^0-9]*)(\d+)/);
          if (m) {
            const num = parseInt(m[1], 10);
            if (Number.isFinite(num)) rec.ui_index_num = num;
          }
        }
        // map statusEng back to internal fields
        switch (statusEng) {
          case 'Checked':
            rec.checked = true;
            rec.status = 'normal';
            rec.last_inspected_at = toISO(checkedAt);
            break;
          case 'stopped':
            rec.status = 'stop';
            rec.last_inspected_at = '';
            break;
          case 'Unnecessary':
            rec.status = 'skip';
            rec.last_inspected_at = '';
            break;
          case '7days_rule':
          case '7 day rule':
            // mark as pending due to 7日ルール: treat as its own status
            rec.status = '7days_rule';
            rec.checked = false;
            rec.last_inspected_at = toISO(checkedAt);
            break;
          default:
            // standby or unknown
            rec.status = 'normal';
            rec.checked = false;
            rec.last_inspected_at = '';
        }
        if (buckets[city]) buckets[city].push(rec);
      }
      // save to localStorage
      let wrote = 0;
      for (const city of CITIES) {
        if (buckets[city] && buckets[city].length > 0) {
          saveCity(city, buckets[city]);
          wrote++;
        }
      }
      if (wrote === 0) {
        status('同期失敗：データが空でした（既存データは保持）');
        return;
      }
      
        localStorage.setItem(USE_LOG_KEY, '1');
repaintCounters();
      showProgress(true, 100);
      status(`同期完了：大和${buckets['大和市'].length || 0} / 海老名${buckets['海老名市'].length || 0} / 調布${buckets['調布市'].length || 0}`);
    } catch (err) {
      console.error('log sync error', err);
      status('同期失敗：通信または解析エラー（既存データは保持）');
    } finally {
      setTimeout(() => showProgress(false), 350);
    }
  }

  /**
   * Pull records from the specified sheet and save them into local storage.
   * This helper consolidates the common logic for pulling data from either
   * the 全体管理 sheet or the InspectionLog sheet.  It updates counters
   * and shows progress/status messages.  When pulling InspectionLog, it
   * maps the English status values back into the app's internal fields so
   * that 7days_rule and other statuses are reflected correctly in the UI.
   *
   * @param {string} sheet - The sheet name to pull from (e.g. '全体管理' or 'InspectionLog').
   * @param {string} label - A label used in status messages (e.g. '初期同期' or '同期').
   */
  async function pullAndSave(sheet, label) {
    try {
      const actionLabel = label || '同期';
      status(`${actionLabel}中…`);
      showProgress(true, 5);
      // Build URL with sheet parameter and cache-busting timestamp
      const u = `${GAS_URL}?action=pull&sheet=${encodeURIComponent(sheet)}&_=${Date.now()}`;
      showProgress(true, 15);
      // Fetch JSON with retry
      const json = await fetchJSONWithRetry(u, 2);
      showProgress(true, 35);
      // The GAS endpoint returns data either under 'data' or 'values'.  If both
      // are missing but the response is an array of arrays, treat that as the
      // data.  Otherwise bail out early.
      let arr = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.values) ? json.values : []);
      if (!Array.isArray(arr)) arr = [];
      if (arr.length === 0 && Array.isArray(json) && Array.isArray(json[0])) {
        arr = json;
      }
      // Prepare buckets for each city
      const buckets = { "大和市": [], "海老名市": [], "調布市": [] };
      // If pulling the InspectionLog sheet, skip a header row that contains
      // english column names like 'city' and 'station'.  This matches the
      // behaviour in syncFromInspectionLog().
      if (sheet === 'InspectionLog' && arr.length > 0 && Array.isArray(arr[0])) {
        const firstRow = arr[0].map(x => typeof x === 'string' ? x.toLowerCase() : '');
        if (firstRow.includes('city') && firstRow.includes('station')) {
          arr = arr.slice(1);
        }
      }
      // Helper to convert a checked_at value (yyyy/MM/dd-HH:mm or yyyy/MM/dd)
      // into an ISO string suitable for local storage.  InspectionLog only
      // stores dates (yyyy/MM/dd) but we support both for completeness.
      function toISOChecked(s) {
        if (!s) return '';
        const str = String(s).trim();
        const parts = str.split('-');
        let datePart = '';
        let timePart = '';
        if (parts.length >= 2) {
          // yyyy/MM/dd-HH:mm
          datePart = parts[0].replace(/\//g, '-');
          timePart = parts[1].split(' ')[0];
          const dt = new Date(`${datePart}T${timePart}:00`);
          if (!Number.isFinite(dt.getTime())) return '';
          return dt.toISOString();
        } else {
          // yyyy/MM/dd
          datePart = str.replace(/\//g, '-');
          const dt = new Date(`${datePart}T00:00:00`);
          if (!Number.isFinite(dt.getTime())) return '';
          return dt.toISOString();
        }
      }
      // Process each row of the returned array.  Rows from InspectionLog
      // follow a strict format: [city, station, model, number, index, status, checked_at].
      // Rows from 全体管理 can vary; use heuristics similar to the original
      // initIndex() implementation to extract city, station, model, number,
      // and status.  For InspectionLog, map English status values to the
      // app's internal fields (checked/status/last_inspected_at).
      if (sheet === 'InspectionLog') {
        for (const row of arr) {
          if (!Array.isArray(row) || row.length < 7) continue;
          const city = (row[0] || '').toString();
          const station = (row[1] || '').toString();
          const model = (row[2] || '').toString();
          const number = (row[3] || '').toString();
          const idxStr = (row[4] || '').toString();
          const statusEng = (row[5] || '').toString();
          const checkedAt = (row[6] || '').toString();
          // Build a new record with default values
          const rec = {
            city,
            station,
            model,
            number,
            status: 'normal',
            checked: false,
            index: '',
            last_inspected_at: '',
            ui_index: idxStr || '',
            ui_index_num: 0
          };
          // Derive ui_index_num from idxStr (e.g. Y1 -> 1)
          if (idxStr) {
            const m = idxStr.match(/^(?:[A-Za-z]|[^0-9]*)(\d+)/);
            if (m) {
              const num = parseInt(m[1], 10);
              if (Number.isFinite(num)) rec.ui_index_num = num;
            }
          }
          // Map English status back to internal fields
          switch (statusEng) {
            case 'Checked':
              rec.checked = true;
              rec.status = 'normal';
              rec.last_inspected_at = toISOChecked(checkedAt);
              break;
            case 'stopped':
              rec.status = 'stop';
              rec.last_inspected_at = '';
              break;
            case 'Unnecessary':
              rec.status = 'skip';
              rec.last_inspected_at = '';
              break;
            case '7days_rule':
            case '7 day rule':
              rec.status = '7days_rule';
              rec.checked = false;
              rec.last_inspected_at = toISOChecked(checkedAt);
              break;
            default:
              // standby or unknown
              rec.status = 'normal';
              rec.checked = false;
              rec.last_inspected_at = '';
          }
          if (buckets[city]) buckets[city].push(rec);
        }
      } else {
        // Heuristics for 全体管理 or other sheets: infer columns if header row present
        // Detect header row with english column names like 'city' and 'station'
        let headerMap = null;
        if (arr.length > 0 && Array.isArray(arr[0])) {
          const firstRow = arr[0];
          const lower = firstRow.map(x => (typeof x === 'string' ? x.trim().toLowerCase() : ''));
          if (lower.some(x => x.includes('city')) && lower.some(x => x.includes('station'))) {
            headerMap = {};
            for (let i = 0; i < firstRow.length; i++) {
              const col = lower[i];
              if (col.includes('city')) headerMap.city = i;
              else if (col.includes('station')) headerMap.station = i;
              else if (col.includes('model')) headerMap.model = i;
              else if (col.includes('plate') || col.includes('number')) headerMap.number = i;
              else if (col.includes('status')) headerMap.status = i;
            }
            arr = arr.slice(1);
          }
        }
        // Iterate rows and build records
        for (const r of arr) {
          let rowObj;
          if (Array.isArray(r)) {
            if (headerMap) {
              // Use header mapping to extract fields
              const city = r[headerMap.city ?? 0] || '';
              const station = r[headerMap.station ?? 1] || '';
              const model = r[headerMap.model ?? 2] || '';
              const number = r[headerMap.number ?? 3] || '';
              const statusVal = (headerMap.status !== undefined ? (r[headerMap.status] || '') : 'normal');
              rowObj = { city, station, model, number, status: statusVal || 'normal', checked: false, index: '', last_inspected_at: '' };
            } else {
              // Skip rows with 'city' in the second column (header rows)
              if (r.length >= 2 && typeof r[1] === 'string' && r[1].trim().toLowerCase() === 'city') {
                continue;
              }
              // Detect TS-prefixed rows: treat as TSV export from 全体管理
              if (r.length >= 6 && typeof r[0] === 'string' && r[0].trim().startsWith('TS')) {
                const city = r[1] || '';
                const station = r[3] || '';
                const model = r[4] || '';
                const number = r[5] || '';
                const statusVal = r[6] || 'normal';
                rowObj = { city, station, model, number, status: statusVal, checked: false, index: '', last_inspected_at: '' };
              } else {
                // Fallback heuristics for minimal sheets
                if (r.length >= 6) {
                  // assume r[1]=city, r[3]=station, r[4]=model, r[5]=plate
                  const city = r[1] || r[0] || '';
                  const station = r[3] || r[1] || '';
                  const model = r[4] || r[2] || '';
                  const number = r[5] || r[3] || '';
                  const statusVal = r[6] || 'normal';
                  rowObj = { city, station, model, number, status: statusVal, checked: false, index: '', last_inspected_at: '' };
                } else {
                  // simple case: 0=city,1=station,2=model,3=number,4=status
                  const city = r[0] || '';
                  const station = r[1] || '';
                  const model = r[2] || '';
                  const number = r[3] || '';
                  const statusVal = r[4] || 'normal';
                  rowObj = { city, station, model, number, status: statusVal, checked: false, index: '', last_inspected_at: '' };
                }
              }
            }
          } else if (r && typeof r === 'object') {
            rowObj = r;
          } else {
            continue;
          }
          const cityName = (rowObj.city || '').trim();
          if (!buckets[cityName]) continue;
          // Normalize fields: trim strings and set defaults
          const rec = normalize(rowObj);
          // For initial sync, never mark as checked and clear last_inspected_at
          rec.checked = false;
          rec.last_inspected_at = '';
          // Save into corresponding bucket
          buckets[cityName].push(rec);
        }
      }
      // Save buckets into local storage, applying UI indices for each city
      let wrote = 0;
      for (const city of CITIES) {
        if (buckets[city].length > 0) {
          applyUIIndex(city, buckets[city]);
          saveCity(city, buckets[city]);
          wrote++;
        }
      }
      if (wrote === 0) {
        status(`${actionLabel}失敗：データが空でした（既存データは保持）`);
        showProgress(false);
        return;
      }
      // After pulling, update counters and set appropriate flags
      repaintCounters();
      showProgress(true, 100);
      status(`${actionLabel}完了：大和${buckets['大和市'].length || 0} / 海老名${buckets['海老名市'].length || 0} / 調布${buckets['調布市'].length || 0}`);
    } catch (e) {
      console.error(`${label || '同期'} error`, e);
      status(`${label || '同期'}失敗：通信または解析エラー（既存データは保持）`);
    } finally {
      setTimeout(() => showProgress(false), 350);
    }
  }
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
      // update metrics for the city
      for(const k of ['done','stop','skip','total']){
        const el = document.querySelector(m[k]); if(el) el.textContent = cnt[k];
      }
      // update remaining count: total - done - skip
      const remCount = cnt.total - cnt.done - cnt.skip;
      const remEl = document.querySelector(m.rem);
      if(remEl) remEl.textContent = remCount;
    }
    // update aggregated counts across all areas
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
    // update overall hint
    const hint = document.getElementById('overallHint');
    if(hint) hint.textContent = overallTotal>0 ? `総件数：${overallTotal}` : 'まだ同期されていません';
  }

  // ====== public init for index ======
  async function initIndex(){
    // Repaint counters on load
    repaintCounters();
    // Set up initial sync button (全体管理) with confirmation dialog
    const initBtn = document.getElementById('initSyncBtn');
    if (initBtn) {
      initBtn.addEventListener('click', async () => {
        // Always confirm before overwriting local data
        if (!confirm('よろしいですか？')) {
          return;
        }
        await pullAndSave('全体管理', '初期同期');
      });
    }
    // Set up regular sync button (InspectionLog) – pull only, no push
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        await pullAndSave('InspectionLog', '同期');
      });
    }
    // Set up data send button – push local changes to InspectionLog only
    const pushBtn = document.getElementById('pushLogBtn');
    if (pushBtn) {
      pushBtn.addEventListener('click', async () => {
        try {
          // Collect all records from all cities
          const all = [];
          for (const c of CITIES) {
            const arrCity = readCity(c);
            if (Array.isArray(arrCity)) all.push(...arrCity);
          }
          status('データ送信中…');
          showProgress(true, 15);
          const jsonPayload = JSON.stringify(all);
          const params = new URLSearchParams();
          params.append('action', 'push');
          params.append('data', jsonPayload);
          const url = `${GAS_URL}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
          });
          let result = null;
          try {
            result = await res.json();
          } catch(_) { result = null; }
          if (result && result.ok) {
            status('データ送信完了！');
          } else {
            status('更新に失敗しました');
          }
        } catch(err) {
          console.error('push error', err);
          status('更新エラー');
        } finally {
          setTimeout(() => showProgress(false), 350);
        }
      });
    }
  }

  // ===== City page =====
  function within7d(last){
    if(!last) return false;
    const t = Date.parse(last);
    if(!Number.isFinite(t)) return false;
    return (Date.now() - t) < (7*24*60*60*1000);
  }
  function rowBg(rec){
    // Checked items get pink regardless of other status
    if (rec.checked) return 'bg-pink';
    // Explicit status mappings
    if (rec.status === 'stop') return 'bg-gray';
    if (rec.status === 'skip') return 'bg-yellow';
    // 7日ルール対象は水色
    if (rec.status === '7days_rule' || rec.status === '7 day rule') return 'bg-blue';
    // Fallback: highlight items whose last inspection is within 7 days
    if (within7d(rec.last_inspected_at)) return 'bg-blue';
    // Default standby (normal) color
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

      // left column: top row with index + checkbox; bottom row for date/time
      const left = document.createElement('div');
      left.className = 'leftcol';
      // index element
      const idxDiv = document.createElement('div');
      idxDiv.className = 'idx';
      idxDiv.textContent = rec.ui_index || '';
      // checkbox
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!rec.checked;
      chk.className = 'chk';
      // top container for index and checkbox
      const topLeft = document.createElement('div');
      topLeft.className = 'left-top';
      topLeft.appendChild(idxDiv);
      topLeft.appendChild(chk);
      // date/time element (hidden when no date)
      const dtDiv = document.createElement('div');
      dtDiv.className = 'datetime';
      // helper to update the date/time display
      function updateDateTime(){
        if (rec.last_inspected_at) {
          const d = new Date(rec.last_inspected_at);
          if (Number.isFinite(d.getTime())) {
            // Show year on first line and month/day on second line
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            dtDiv.innerHTML = `${yyyy}<br>${mm}/${dd}`;
            dtDiv.style.display = '';
            return;
          }
        }
        // Hide if no valid date
        dtDiv.innerHTML = '';
        dtDiv.style.display = 'none';
      }
      // initialize date/time display
      updateDateTime();

      // enable editing the date on tap
      dtDiv.addEventListener('click', () => {
        // create a temporary date picker
        const input = document.createElement('input');
        input.type = 'date';
        // set initial value if available
        if (rec.last_inspected_at) {
          const d0 = new Date(rec.last_inspected_at);
          if (Number.isFinite(d0.getTime())) {
            input.value = d0.toISOString().slice(0, 10);
          }
        }
        dtDiv.appendChild(input);
        // show the date picker
        if (typeof input.showPicker === 'function') {
          input.showPicker();
        } else {
          input.focus();
        }
        input.addEventListener('change', () => {
          const sel = input.value; // yyyy-mm-dd
          dtDiv.removeChild(input);
          if (!sel) return;
          if (!confirm('よろしいですか？')) return;
          const iso = new Date(sel).toISOString();
          rec.last_inspected_at = iso;
          persistCityRec(city, rec);
          updateDateTime();
          row.className = `row ${rowBg(rec)}`;
        }, { once: true });
      });

      // assemble left column
      left.appendChild(topLeft);
      left.appendChild(dtDiv);
      // checkbox change handler with confirmation
      chk.addEventListener('change', () => {
        const message = chk.checked ? 'チェックを付けます。よろしいですか？' : 'チェックを外します。よろしいですか？';
        if (!confirm(message)) {
          chk.checked = !chk.checked;
          return;
        }
        const nowISO = new Date().toISOString();
        rec.checked = chk.checked;
        if(chk.checked){
          rec.last_inspected_at = nowISO;
        } else {
          rec.last_inspected_at = '';
        }
        updateDateTime();
        persistCityRec(city, rec);
        row.className = `row ${rowBg(rec)}`;
      });

      // middle column: station title and sub-line (date/time is rendered in the right column)
      const mid = document.createElement('div');
      mid.className = 'mid';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = rec.station || '';
      const sub = document.createElement('div');
      sub.className = 'sub';
      // display model and plate on separate lines to prevent overlap with right column
      // Use innerHTML with a <br> so the two values wrap naturally
      sub.innerHTML = `${rec.model || ''}<br>${rec.number || ''}`;
      // append title and sub into mid (stacked)
      mid.appendChild(title);
      mid.appendChild(sub);

      // date/time handled inside the left column; no separate date column

      // right column: holds status select and the inspection button
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
        // Build query parameters for the tire app.  The tire app expects
        // `station`, `model` and `plate_full` as query keys.  See the
        // tire-app's index.html: it reads `plate_full` for the full plate number.
        const q = new URLSearchParams({
          station: rec.station || '',
          model: rec.model || '',
          plate_full: rec.number || '',
        });
        location.href = `${TIRE_APP_URL}?${q.toString()}`;
      });
      // append controls to right column
      right.appendChild(sel);
      right.appendChild(btn);

      // append columns: left column, mid column, right column
      row.appendChild(left);
      row.appendChild(mid);
      row.appendChild(right);
      list.appendChild(row);
    }
  }

  function persistCityRec(city, rec){
    // Update the record in localStorage by matching on the UI index when available.
    // Using ui_index ensures we update the exact row instead of matching solely on number,
    // which can be blank or duplicated across entries. Fallback to number for older records.
    const arr = readCity(city);
    // find by ui_index if defined
    let i = -1;
    if(rec.ui_index){
      i = arr.findIndex(x => (x.ui_index || '') === (rec.ui_index || ''));
    }
    // fallback to matching by number if no ui_index match
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

  return {
    initIndex: initIndex,
    initCity: mountCity,
  };
})();
