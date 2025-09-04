
(function(){
  'use strict';
  const GAS_URL = "https://script.google.com/macros/s/AKfycby9RpFiUbYu6YX6JW9XfwbDx36_4AIlGEQMOxR3SnxgNdoRUJKfyxvF3b1SEYwuHb3X/exec";
  const CITIES = ["大和市","海老名市","調布市"];
  const LS_CITY    = (city)=>`junkai:city:${city}`;
  const LS_INDEXMAP= (city)=>`junkai:indexmap:${city}`;
  const $=(s,r=document)=>r.querySelector(s);

  function showModal(title){ const m=$('#progressModal'); if(!m) return;
    $('#progressTitle').textContent=title||'同期中…'; m.classList.add('show');
    const bar=$('#progressBar'); let t=0; m._timer=setInterval(()=>{t=(t+7)%100; bar.style.width=t+'%';},80); }
  function hideModal(final){ const m=$('#progressModal'); if(!m) return;
    if(final) $('#progressTitle').textContent=final; if(m._timer) clearInterval(m._timer);
    setTimeout(()=>{m.classList.remove('show'); $('#progressBar').style.width='0%';},260); }
  function setStatus(msg){ const s=$('#statusText'); if(s) s.textContent=msg; }

  function extractRows(p){
    if(Array.isArray(p)) return p;
    if(p && Array.isArray(p.data)) return p.data;
    if(p && Array.isArray(p.values)) return p.values;
    if(p && Array.isArray(p.items)) return p.items;
    if(p && Array.isArray(p.records)) return p.records;
    if(p && typeof p==='object'){ let cat=[]; for(const k of Object.keys(p)){const v=p[k]; if(Array.isArray(v)) cat=cat.concat(v);} if(cat.length) return cat; }
    return null;
  }

  function normalizeRows(rows){
    const KNOWN={city:['city','cityname','市区町村','city(市区町村)','City'],
      station:['station','stationname','ステーション','Station','拠点','営業所'],
      model:['model','車種','車種名','Model'],
      number:['number','plate','plate_full','登録番号','ﾅﾝﾊﾞｰ','フルナンバー','Plate'],
      status:['status','状態','ステータス'],
      checked:['checked','巡回チェック','check'],
      last:['last_inspected_at','last_at','最終点検','最終点検日時','date','日時']};
    const nk=s=>String(s||'').toLowerCase().replace(/\s+/g,'').replace(/[\-_]/g,'');
    let hIdx=-1,hMap=null;
    for(let i=0;i<Math.min(rows.length,10);i++){const r=rows[i]; const cells=Array.isArray(r)?r:(r&&typeof r==='object'?Object.keys(r):[]);
      const keys=cells.map(nk); const hit=['city','station','model','number'].filter(f=>keys.some(k=>KNOWN[f].includes(k))).length;
      if(hit>=2){hIdx=i;break;}} // ヘッダー検出（3行目でも拾える）
    if(hIdx>=0 && Array.isArray(rows[hIdx])){const hdr=rows[hIdx].map(nk); hMap={}; for(const f of Object.keys(KNOWN)){const pos=hdr.findIndex(h=>KNOWN[f].includes(h)); if(pos>=0) hMap[f]=pos;}}
    const out=[];
    for(let i=0;i<rows.length;i++){ if(i===hIdx) continue; const r=rows[i];
      if(Array.isArray(r)){ if(hMap){ const g=f=>{const idx=hMap[f]; return (idx!=null && idx<r.length)? String(r[idx]||'').trim():'';};
          out.push(fmt(g('city'),g('station'),g('model'),g('number'),g('status')||'normal',boolish(g('checked')),g('last')));
        } else { const city=String(r[0]||'').trim(), station=String(r[1]||'').trim(), model=String(r[2]||'').trim(), number=String(r[3]||'').trim();
          const status=String((r[4]||'normal')).trim()||'normal'; const checked=!!r[5]; const last=String(r[7]||'').trim();
          out.push(fmt(city,station,model,number,status,checked,last)); }
      } else if(r && typeof r==='object'){ const city=(r.city||r.cityName||r['市区町村']||r['City']||'').toString().trim();
        const station=(r.station||r.stationName||r['ステーション']||r['Station']||'').toString().trim();
        const model=(r.model||r['車種名']||r['Model']||'').toString().trim();
        const number=(r.number||r.plate_full||r.plate||r['登録番号']||r['Plate']||'').toString().trim();
        const status=(r.status||'normal').toString().trim(); const checked=!!r.checked; const last=(r.last_inspected_at||'').toString().trim();
        out.push(fmt(city,station,model,number,status,checked,last)); }
    }
    return out;
  }
  const boolish=v=>['true','1','yes','y','済','checked'].includes(String(v||'').toLowerCase());
  const fmt=(city,station,model,number,status,checked,last)=>({city,station,model,number,status:status||'normal',checked:!!checked,last_inspected_at:last||''});

  function readCity(city){ try{const s=localStorage.getItem(LS_CITY(city)); if(!s) return []; const a=JSON.parse(s); return Array.isArray(a)?a:[];}catch(_){return[];} }
  function saveCity(city,arr){ localStorage.setItem(LS_CITY(city), JSON.stringify(arr||[])); }
  function areaPrefix(city){ return city==='海老名市'?'E': city==='大和市'?'Y': city==='調布市'?'C':'X'; }

  function computeIndexMap(city, arr){
    const key=LS_INDEXMAP(city);
    try{ const m=JSON.parse(localStorage.getItem(key)||'null'); if(m&&typeof m==='object') return m; }catch(_){}
    const cp = arr.slice().sort((a,b)=> (a.station||'').localeCompare(b.station||'','ja') || (a.number||'').localeCompare(b.number||'','ja'));
    const prefix=areaPrefix(city);
    const map={}; let n=1;
    for(const rec of cp){ if(!rec.number) continue; map[rec.number]=prefix+(n++); }
    localStorage.setItem(key, JSON.stringify(map));
    return map;
  }

  function recalcIndexCards(){
    const totals={"大和市":{done:0,stop:0,skip:0,total:0},"海老名市":{done:0,stop:0,skip:0,total:0},"調布市":{done:0,stop:0,skip:0,total:0}};
    let overall=0;
    for(const city of CITIES){ const arr=readCity(city); totals[city].total=arr.length; overall+=arr.length;
      for(const it of arr){ if(it.status==='stop') totals[city].stop++; else if(it.status==='skip') totals[city].skip++; if(it.checked || it.status==='done') totals[city].done++; } }
    function put(id,v){ const n=document.getElementById(id); if(n) n.textContent=String(v); }
    put('yamato-total',totals["大和市"].total); put('yamato-stop',totals["大和市"].stop); put('yamato-skip',totals["大和市"].skip); put('yamato-done',totals["大和市"].done);
    put('ebina-total',totals["海老名市"].total); put('ebina-stop',totals["海老名市"].stop); put('ebina-skip',totals["海老名市"].skip); put('ebina-done',totals["海老名市"].done);
    put('chofu-total',totals["調布市"].total); put('chofu-stop',totals["調布市"].stop); put('chofu-skip',totals["調布市"].skip); put('chofu-done',totals["調布市"].done);
    const hint=document.getElementById('overallHint'); if(hint) hint.textContent = overall>0 ? '' : 'まだ同期されていません';
  }

  async function syncFromGAS(){
    try{ showModal('同期中…'); setStatus('GASへ問い合わせ中…');
      const res=await fetch(GAS_URL+'?action=pull&ts='+Date.now(),{cache:'no-store'});
      let payload=null; try{payload=await res.json();}catch(_){const t=await res.text(); try{payload=JSON.parse(t)}catch(__){payload=null;}}
      if(!payload) throw new Error('payloadなし');
      const rows=extractRows(payload); if(!Array.isArray(rows)) throw new Error('data配列が見当たりません');
      const norm=normalizeRows(rows);
      const buckets={"大和市":[],"海老名市":[],"調布市":[]};
      for(const r of norm) if(r.city && buckets[r.city]) buckets[r.city].push(r);
      for(const c of CITIES){ saveCity(c,buckets[c]); localStorage.removeItem(LS_INDEXMAP(c)); }
      recalcIndexCards(); hideModal('同期完了！'); setStatus('同期完了：'+new Date().toLocaleString('ja-JP',{hour12:false}));
    }catch(e){ console.error(e); setStatus('同期失敗：通信または解析エラー'); hideModal('同期失敗'); }
  }

  function rowClass(rec){ if(rec.checked) return 'bg-pink'; if(rec.status==='stop') return 'bg-gray-strong'; if(rec.status==='skip') return 'bg-yellow'; return 'bg-green'; }
  function renderArea(city){
    const wrap=document.getElementById('list'); const hint=document.getElementById('hint'); wrap.innerHTML='';
    const data=readCity(city); if(!data.length){ hint.textContent='まだ同期されていません（インデックスの同期を押してください）'; return; }
    hint.textContent='件数：'+data.length;
    const indexMap=computeIndexMap(city, data);
    data.sort((a,b)=> (a.station||'').localeCompare(b.station||'','ja') || (a.number||'').localeCompare(b.number||'','ja'));
    for(const rec of data){ const div=document.createElement('div'); div.className='row '+rowClass(rec);
      const idx=document.createElement('div'); idx.className='idx'; idx.textContent=indexMap[rec.number]||'--';
      const fields=document.createElement('div'); fields.className='fields';
      const l1=document.createElement('div'); l1.className='line1'; l1.textContent=rec.station||'(無名)';
      const l2=document.createElement('div'); l2.className='line2'; l2.textContent=(rec.model||'')+'　'+(rec.number||'');
      fields.appendChild(l1); fields.appendChild(l2);
      const when=document.createElement('div'); when.className='when'; const md=document.createElement('div'); md.className='md'; const hm=document.createElement('div'); hm.className='hm';
      if(rec.checked && rec.last_inspected_at){ const d=new Date(rec.last_inspected_at); md.textContent=String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0'); hm.textContent=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
      when.appendChild(md); when.appendChild(hm);
      const right=document.createElement('div'); right.className='rightcol';
      const sel=document.createElement('select'); sel.className='state-select';
      for(const [val,label] of [['normal','通常'],['stop','停止'],['skip','不要']]){ const op=document.createElement('option'); op.value=val; op.textContent=label; if((rec.status||'normal')===val) op.selected=true; sel.appendChild(op);}
      sel.addEventListener('change',()=>{ rec.status=sel.value; div.className='row '+rowClass(rec); saveRec(city,rec); });
      const btn=document.createElement('a'); btn.className='btn-mini'; btn.textContent='点検';
      const q=new URLSearchParams({st:rec.station||'', model:rec.model||'', num:rec.number||''}); btn.href='https://rkworks2025-coder.github.io/r.k.w-/?'+q.toString(); btn.target='_blank'; btn.rel='noopener';
      right.appendChild(sel); right.appendChild(btn);
      div.appendChild(idx); div.appendChild(fields); div.appendChild(when); div.appendChild(right);
      wrap.appendChild(div);
    }
  }
  function saveRec(city,rec){ const arr=readCity(city); const i=arr.findIndex(x=>(x.number||'')===(rec.number||'')); if(i>=0) arr[i]=rec; else arr.push(rec); saveCity(city,arr); }

  window.renderArea=renderArea;
  window.addEventListener('DOMContentLoaded',()=>{ const syncBtn=document.getElementById('syncBtn'); if(syncBtn && !syncBtn._bound){ syncBtn.addEventListener('click',()=>syncFromGAS()); syncBtn._bound=true; } recalcIndexCards(); });
})();
