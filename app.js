// ====== 設定 ======
const Junkai = (()=>{

  const GAS_URL = "https://script.google.com/macros/s/AKfycby9Rp...u6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
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
    if(bar && typeof pct==='number'){
      bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }
  }

  function fmtDateTimeJST(d){
    const pad = n => String(n).padStart(2,'0');
    const y = d.getFullYear();
    const m = pad(d.getMonth()+1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${y}/${m}/${dd} ${hh}:${mi}:${ss}`;
  }

  function parseDateMaybe(s){
    if(!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function fetchJsonWithTimeout(url, opt={}){
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), TIMEOUT_MS);
    return fetch(url, {...opt, signal: ctrl.signal})
      .then(r=>r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .finally(()=>clearTimeout(id));
  }

  function saveCity(city, arr){
    localStorage.setItem(LS_KEY(city), JSON.stringify(arr||[]));
  }
  function loadCity(city){
    try{
      const s = localStorage.getItem(LS_KEY(city));
      return s ? JSON.parse(s) : [];
    }catch(e){
      return [];
    }
  }
  function rowBg(rec){
    switch(rec.status_color){
      case 'pink': return 'bg-pink';
      case 'gray': return 'bg-gray';
      case 'yellow': return 'bg-yellow';
      case 'blue': return 'bg-blue';
      case 'green': return 'bg-green';
      default: return '';
    }
  }

  // ===== index =====
  async function initIndex(){
    const list = document.getElementById('cards');
    if(!list) return;
    list.innerHTML = '';
    for(const c of CITIES){
      const a = loadCity(c);
      const cnt = a.length|0;
      const url = c === '大和市' ? 'yamato.html'
                : c === '海老名市' ? 'ebina.html'
                : 'chofu.html';
      const el = document.createElement('a');
      el.href = url;
      el.className = 'cardlink';
      el.innerHTML = `
        <div class="cardtitle">${c}</div>
        <div class="carddesc">登録車両：${cnt} 台</div>
      `;
      list.appendChild(el);
    }
  }

  // ===== city =====
  function mountCity(city){
    const list = document.getElementById('list');
    const hint = document.getElementById('hint');
    if(!list) return;

    function render(){
      list.innerHTML = '';
      const arr = loadCity(city) || [];
      for(const rec of arr){
        // row
        const row = document.createElement('div');
        row.className = `row ${rowBg(rec)}`;

        // left
        const left = document.createElement('div');
        left.className = 'leftcol';
        const station = document.createElement('div');
        station.className = 'station';
        station.textContent = rec.station || '';
        const model = document.createElement('div');
        model.className = 'model';
        model.textContent = rec.model || '';
        const num = document.createElement('div');
        num.className = 'num';
        num.textContent = rec.number || '';
        left.appendChild(station);
        left.appendChild(model);
        left.appendChild(num);

        // mid
        const mid = document.createElement('div');
        mid.className = 'mid';
        const dt = document.createElement('div');
        dt.className = 'datetime';
        let checkedAt = '';
        const d = parseDateMaybe(rec.checked_at);
        if(d){
          const y = d.getFullYear();
          const m = String(d.getMonth()+1).padStart(2,'0');
          const da = String(d.getDate()).padStart(2,'0');
          const hh = String(d.getHours()).padStart(2,'0');
          const mi = String(d.getMinutes()).padStart(2,'0');
          const ss = String(d.getSeconds()).padStart(2,'0');
          checkedAt = `${y}/${m}/${da} ${hh}:${mi}:${ss}`;
        }
        dt.textContent = checkedAt || '-';
        mid.appendChild(dt);

        // right
        const right = document.createElement('div');
        right.className = 'rightcol';

        // select (通常/停止/不要)
        const sel = document.createElement('select');
        sel.className = 'state';
        [
          ['normal','通常'],
          ['stop','停止'],
          ['skip','不要'],
        ].forEach(([v,lab])=>{
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

        // 点検ボタン
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

        // DOM組み立て
        right.appendChild(sel);
        right.appendChild(btn);

        // ▼ 追加：Lostボタン（UIのみ、機能未実装）
        const lostBtn = document.createElement('button');
        lostBtn.className = 'btn tiny';
        lostBtn.textContent = 'Lost';
        // クリック処理は未実装（UI確認用）
        right.appendChild(lostBtn);

        row.appendChild(left);
        row.appendChild(mid);
        row.appendChild(right);
        list.appendChild(row);
      }
      if(hint){
        hint.style.display = (loadCity(city)||[]).length ? 'none' : '';
      }
    }

    render();

    // （必要に応じて）再描画フックを用意
    window.addEventListener('storage', (e)=>{
      if(e.key === LS_KEY(city)) render();
    });

    // 手動同期ボタン等があればここでハンドラ設定
    const syncBtn = document.getElementById('sync');
    if(syncBtn){
      syncBtn.addEventListener('click', async ()=>{
        await pullCityFromGAS(city);
        render();
      });
    }
  }

  // ===== GAS連携（既存仕様に合わせて適宜修正） =====
  async function pullCityFromGAS(city){
    try{
      const res = await fetchJsonWithTimeout(`${GAS_URL}?city=${encodeURIComponent(city)}&op=pull`);
      const arr = Array.isArray(res && res.items) ? res.items : [];
      // 期待するフィールド名へ正規化
      const norm = arr.map(x=>({
        station: x.station || x.Station || '',
        model: x.model || x.Model || '',
        number: x.number || x.Plate || x.plate_full || '',
        checked_at: x.checked_at || x.latest_checked_at || '',
        status: x.status || 'normal',
        status_color: x.status_color || '', // 'pink'|'gray'|'yellow'|'blue'|'green'
      }));
      saveCity(city, norm);
    }catch(e){
      if(DEBUG_ERRORS) console.error(e);
    }
  }

  function persistCityRec(city, rec){
    const arr = loadCity(city) || [];
    const num = rec.number || '';
    let i = arr.findIndex(r => (r.number||'') === num);
    if(i >= 0){
      arr[i] = rec;
    }else{
      arr.push(rec);
    }
    saveCity(city, arr);
  }

  // ===== まとめ =====
  return {
    initIndex,
    initCity: mountCity,
  };
})();
