// Minimal frontend-only period tracker using localStorage
(async function(){
  const LS_KEY = 'period_tracker_data_v1'
  const QUOTES_KEY = 'period_tracker_quotes'
  const FEEDBACK_KEY = 'period_tracker_feedback'
  const PIN_HASH_KEY = 'period_tracker_pin_hash'
  const PIN_SALT_KEY = 'period_tracker_pin_salt'
  const ENC_KEY = 'period_tracker_enc'

  let state = {}
  let sessionCryptoKey = null

  // helper: SHA-256 hex
  async function sha256hex(msg){
    const enc = new TextEncoder().encode(msg)
    const buf = await crypto.subtle.digest('SHA-256', enc)
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')
  }

  // crypto helpers
  function b64Encode(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))) }
  function b64Decode(s){ return Uint8Array.from(atob(s), c=>c.charCodeAt(0)) }

  async function deriveKeyFromPin(pin, saltB64){
    const salt = saltB64 ? b64Decode(saltB64) : crypto.getRandomValues(new Uint8Array(16))
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), {name:'PBKDF2'}, false, ['deriveKey'])
    const key = await crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, baseKey, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt'])
    return { key, salt: b64Encode(salt) }
  }

  async function encryptObject(obj, cryptoKey){
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plain = new TextEncoder().encode(JSON.stringify(obj))
    const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, cryptoKey, plain)
    return { iv: b64Encode(iv), data: b64Encode(cipher) }
  }

  async function decryptObject(enc, cryptoKey){
    const iv = b64Decode(enc.iv)
    const data = b64Decode(enc.data)
    const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, cryptoKey, data)
    return JSON.parse(new TextDecoder().decode(plain))
  }

  // init theme
  document.documentElement.dataset.theme = localStorage.getItem('theme')||'light'
  document.getElementById('toggle-theme').addEventListener('click', ()=>{
    const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = cur
    localStorage.setItem('theme', cur)
  })

  // calendar
  let view = new Date()
  const cal = document.getElementById('calendar')
  const monthLabel = document.getElementById('month-label')
  document.getElementById('prev-month').onclick = ()=>{ view.setMonth(view.getMonth()-1); renderCalendar() }
  document.getElementById('next-month').onclick = ()=>{ view.setMonth(view.getMonth()+1); renderCalendar() }

  function renderCalendar(){
    cal.innerHTML = ''
    const y = view.getFullYear(), m = view.getMonth()
    monthLabel.textContent = view.toLocaleString(undefined,{month:'long',year:'numeric'})
    const first = new Date(y,m,1).getDay()
    const days = new Date(y,m+1,0).getDate()
    // fill blanks
    for(let i=0;i<first;i++) cal.appendChild(document.createElement('div'))
    for(let d=1; d<=days; d++){
      const el = document.createElement('div')
      el.className = 'day'
      el.textContent = d
      const iso = dateToISO(new Date(y,m,d))
      if(state.periodDays && state.periodDays.includes(iso)) el.classList.add('period')
      if(isToday(new Date(y,m,d))) el.classList.add('today')
      el.onclick = ()=>selectDay(iso)
      cal.appendChild(el)
    }
  }

  function selectDay(iso){
    const details = document.getElementById('day-details')
    details.innerHTML = ''
    const h = document.createElement('h4'); h.textContent = iso; details.appendChild(h)

    const isPeriod = state.periodDays && state.periodDays.includes(iso)
    const toggle = document.createElement('button')
    toggle.textContent = isPeriod ? 'Unmark Period' : 'Mark Period Day'
    toggle.onclick = ()=>{
      state.periodDays = state.periodDays||[]
      if(state.periodDays.includes(iso)) state.periodDays = state.periodDays.filter(x=>x!==iso)
      else state.periodDays.push(iso)
      saveState(); renderCalendar(); selectDay(iso)
    }
    details.appendChild(toggle)

    // mood/symptoms
    const mood = document.createElement('select')
    ['','happy','sad','irritable','anxious','neutral'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v||'Select mood'; mood.appendChild(o) })
    const symptomsAvailable = ['cramps','headache','fatigue','bloating','acne','nausea','back pain']
    const sympWrap = document.createElement('div')
    symptomsAvailable.forEach(s=>{
      const lbl = document.createElement('label')
      const cb = document.createElement('input'); cb.type='checkbox'; cb.value=s
      lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' '+s))
      sympWrap.appendChild(lbl)
    })
    const save = document.createElement('button'); save.textContent='Save Log'
    save.onclick = ()=>{
      state.logs = state.logs||{}
      const chosen = Array.from(sympWrap.querySelectorAll('input[type="checkbox"]')).filter(i=>i.checked).map(i=>i.value)
      state.logs[iso] = {mood:mood.value, symptoms: chosen, updated:Date.now()}
      saveState(); renderCalendar(); selectDay(iso)
      updateSuggestionsForDay(iso)
    }
    details.appendChild(mood); details.appendChild(sympWrap); details.appendChild(save)

    // prediction display
    const pred = document.createElement('div'); pred.id='prediction'
    pred.textContent = 'Predicted next period: ' + predictNextPeriod()
    details.appendChild(pred)

    // diary load
    const diary = document.getElementById('diary-text')
    diary.value = (state.diary && state.diary[iso]) || ''

    // show existing
    if(state.logs && state.logs[iso]){
      const pre = document.createElement('pre')
      const obj = state.logs[iso]
      const masked = localStorage.getItem('privacy_mask') ? {mood: maskIfNeeded(obj.mood||''), symptoms: (obj.symptoms||[]).map(s=>maskIfNeeded(s))} : obj
      pre.textContent = JSON.stringify(masked,null,2)
      details.appendChild(pre)
    }
  }

  // export
  document.getElementById('export-json').onclick = ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download='period-data.json'; a.click(); URL.revokeObjectURL(url)
  }
  document.getElementById('export-pdf').onclick = async ()=>{
    const { jsPDF } = window.jspdf
    const doc = new jsPDF()
    doc.setFontSize(14)
    doc.text('Period Tracker Export',10,12)
    doc.setFontSize(10)
    let y = 20
    if(state.periodDays) doc.text(`Period days: ${state.periodDays.join(', ')}`,10,y), y+=6
    if(state.logs) doc.text('Logs:',10,y), y+=6
    Object.entries(state.logs||{}).forEach(([k,v])=>{
      doc.text(`${k}: mood=${v.mood||''} symptoms=${(v.symptoms||[]).join(',')}`,10,y)
      y+=6
      if(y>270){ doc.addPage(); y=20 }
    })
    doc.save('period-data.pdf')
  }

  // import JSON
  document.getElementById('import-file').addEventListener('change', async (e)=>{
    const f = e.target.files[0]; if(!f) return
    const txt = await f.text()
    try{ const obj = JSON.parse(txt); localStorage.setItem(LS_KEY, JSON.stringify(obj)); alert('Imported data to this browser') }
    catch(err){ alert('Invalid JSON') }
  })

  // feedback
  document.getElementById('send-feedback').onclick = ()=>{
    const txt = document.getElementById('feedback-text').value.trim()
    if(!txt) return alert('Please write feedback')
    const fb = JSON.parse(localStorage.getItem(FEEDBACK_KEY)||'[]')
    fb.push({text:txt, created:Date.now()})
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(fb))
    document.getElementById('feedback-text').value=''
    alert('Thanks — feedback saved locally.')
  }

  // tips / quotes (fetch local storage or public file)
  async function loadTips(){
    const tipsEl = document.getElementById('tips')
    let quotes = JSON.parse(localStorage.getItem(QUOTES_KEY)||'null')
    if(!quotes){
      // attempt fetch public-quotes.json relative to site — if hosted publicly, this enables global quotes
      try{
        const resp = await fetch('public-quotes.json')
        if(resp.ok) quotes = await resp.json()
      }catch(e){}
    }
    if(!quotes) quotes = ['Tip: Track your period to learn your cycle.']
    tipsEl.innerHTML = quotes.map(q=>`<div class="tip">${escapeHtml(q)}</div>`).join('')
  }

  // PIN set/remove and encryption management
  // modal helper for PIN input
  function askPin(promptTitle){
    return new Promise(resolve=>{
      const modal = document.getElementById('pin-modal')
      const title = document.getElementById('pin-modal-title')
      const input = document.getElementById('pin-input')
      const ok = document.getElementById('pin-ok')
      const cancel = document.getElementById('pin-cancel')
      title.textContent = promptTitle
      input.value = ''
      modal.style.display = 'flex'
      input.focus()
      function cleanup(){ modal.style.display='none'; ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel) }
      function onOk(){ const v=input.value; cleanup(); resolve(v) }
      function onCancel(){ cleanup(); resolve(null) }
      ok.addEventListener('click', onOk)
      cancel.addEventListener('click', onCancel)
    })
  }

  document.getElementById('lock-btn').addEventListener('click', async ()=>{
    const cur = await askPin('Enter a PIN (4-8 digits) to set, or leave empty to remove:')
    if(cur){
      // warn to backup
      if(!confirm('It is recommended to export your data as JSON before setting a PIN for recovery. Export now?')){
        // proceed without export
      } else {
        const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'})
        const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='period-data-backup.json'; a.click(); URL.revokeObjectURL(url)
      }
      // set new PIN: derive key and encrypt current state+settings
      const {key, salt} = await deriveKeyFromPin(cur)
      const payload = { state, settings: state.settings||{} }
      const enc = await encryptObject(payload, key)
      localStorage.setItem(ENC_KEY, JSON.stringify(enc))
      const hash = await sha256hex(cur)
      localStorage.setItem(PIN_HASH_KEY, hash)
      localStorage.setItem(PIN_SALT_KEY, salt)
      // remove plaintext LS_KEY and settings item
      localStorage.removeItem(LS_KEY)
      localStorage.removeItem('period_tracker_settings')
      sessionCryptoKey = key
      alert('PIN set and data encrypted locally')
    } else {
      // remove PIN: require current PIN to decrypt and migrate to plaintext
      const curPin = await askPin('Enter current PIN to remove:')
      if(!curPin) return
      const hash = await sha256hex(curPin)
      const storedHash = localStorage.getItem(PIN_HASH_KEY)
      if(hash!==storedHash) return alert('Wrong PIN')
      const salt = localStorage.getItem(PIN_SALT_KEY)
      const {key} = await deriveKeyFromPin(curPin, salt)
      const enc = JSON.parse(localStorage.getItem(ENC_KEY)||'null')
      if(enc){
        const obj = await decryptObject(enc, key)
        state = obj.state || {}
        state.settings = obj.settings || {}
        localStorage.setItem(LS_KEY, JSON.stringify(state))
        if(state.settings) localStorage.setItem('period_tracker_settings', JSON.stringify(state.settings))
        localStorage.removeItem(ENC_KEY); localStorage.removeItem(PIN_HASH_KEY); localStorage.removeItem(PIN_SALT_KEY)
        sessionCryptoKey = null
        alert('PIN removed and data migrated to local storage')
      } else {
        alert('No encrypted data found')
      }
    }
  })

  // privacy toggle
  const priv = document.getElementById('privacy-toggle')
  priv.checked = !!localStorage.getItem('privacy_mask')
  priv.addEventListener('change', ()=>{
    if(priv.checked) localStorage.setItem('privacy_mask','1')
    else localStorage.removeItem('privacy_mask')
  })

  // helpers (encrypted-aware)
  async function saveState(){
    const payload = { state, settings: state.settings||{} }
    if(sessionCryptoKey){
      try{
        const enc = await encryptObject(payload, sessionCryptoKey)
        localStorage.setItem(ENC_KEY, JSON.stringify(enc))
      }catch(e){ console.error('encrypt failed', e) }
    } else {
      localStorage.setItem(LS_KEY, JSON.stringify(state))
    }
  }

  async function loadState(){
    // if encrypted, prompt user to unlock and decrypt
    const pinHash = localStorage.getItem(PIN_HASH_KEY)
    if(pinHash){
      for(let i=0;i<3;i++){
        const attempt = await askPin('Enter PIN to unlock:')
        if(attempt===null) break
        const h = await sha256hex(attempt)
        if(h===pinHash){
          const salt = localStorage.getItem(PIN_SALT_KEY)
          const {key} = await deriveKeyFromPin(attempt, salt)
          const enc = JSON.parse(localStorage.getItem(ENC_KEY)||'null')
          if(enc){
            try{ const obj = await decryptObject(enc, key); state = obj.state||{}; state.settings = obj.settings||{}; sessionCryptoKey = key; return }
            catch(e){ console.warn('decrypt failed', e); alert('Decryption failed') }
          }
        }
      }
      document.body.innerHTML = '<h2>Locked - reload to try again</h2>'
      throw new Error('locked')
    }
    // else load plaintext
    try{ state = JSON.parse(localStorage.getItem(LS_KEY))||{} }catch(e){ state = {} }
  }
  function dateToISO(d){ return d.toISOString().slice(0,10) }
  function isToday(d){ const t=new Date(); return d.getFullYear()===t.getFullYear()&&d.getMonth()===t.getMonth()&&d.getDate()===t.getDate() }
  function escapeHtml(s){ return (s||'').replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]) }
  function maskIfNeeded(text){ return localStorage.getItem('privacy_mask') ? String(text||'').replace(/./g,'•') : text }

  // reminders: store and schedule while page open
  const REM_KEY = 'period_tracker_reminders'
  function loadReminders(){
    const r = JSON.parse(localStorage.getItem(REM_KEY)||'[]')
    const list = document.getElementById('reminders-list')
    list.innerHTML = r.map((it,idx)=>`<div>${new Date(it.when).toLocaleString()} - ${escapeHtml(it.text)} <button data-idx="${idx}" class="rm">Remove</button></div>`).join('')
    list.querySelectorAll('.rm').forEach(b=>b.addEventListener('click', ()=>{ const i=+b.dataset.idx; r.splice(i,1); localStorage.setItem(REM_KEY, JSON.stringify(r)); loadReminders() }))
  }
  function scheduleReminders(){
    const r = JSON.parse(localStorage.getItem(REM_KEY)||'[]')
    const now = Date.now()
    r.forEach(it=>{
      const when = new Date(it.when).getTime()
      const diff = when - now
      if(diff>0 && diff < 1000*60*60*24*30){ // schedule within 30 days
        setTimeout(()=>{
          if(Notification.permission==='granted') new Notification('Reminder', {body: it.text})
          else alert('Reminder: '+it.text)
        }, diff)
      }
    })
  }
  document.getElementById('add-reminder').addEventListener('click', async ()=>{
    const txt = document.getElementById('reminder-text').value.trim(); const when = document.getElementById('reminder-time').value
    if(!txt || !when) return alert('Fill both')
    const arr = JSON.parse(localStorage.getItem(REM_KEY)||'[]')
    arr.push({text:txt, when})
    localStorage.setItem(REM_KEY, JSON.stringify(arr))
    loadReminders(); scheduleReminders();
  })
  if('Notification' in window && Notification.permission==='default') Notification.requestPermission()
  loadReminders(); scheduleReminders()

  // load state (may prompt for PIN) then initial render
  await loadState()
  renderCalendar(); loadTips();

  // diary save
  document.getElementById('save-diary').addEventListener('click', ()=>{
    const iso = document.querySelector('#day-details h4')?.textContent
    if(!iso) return alert('Select a day')
    state.diary = state.diary||{}
    state.diary[iso] = document.getElementById('diary-text').value
    saveState(); alert('Saved note')
  })

  // packing list
  document.getElementById('save-packing').addEventListener('click', ()=>{
    const boxes = Array.from(document.querySelectorAll('#packing-list input[type=checkbox]'))
    const selected = boxes.filter(b=>b.checked).map(b=>b.value)
    state.packing = selected; saveState(); alert('Packing list saved')
  })
  // load packing
  (function(){ const p = state.packing||[]; document.querySelectorAll('#packing-list input').forEach(i=>i.checked = p.includes(i.value) ) })()

  // simple prediction: average cycle length from periodDays
  function predictNextPeriod(){
    const pd = (state.periodDays||[]).slice().sort()
    if(pd.length<2) return 'Not enough data'
    const lens = []
    for(let i=1;i<pd.length;i++){ const d1=new Date(pd[i-1]), d2=new Date(pd[i]); lens.push(Math.round((d2-d1)/(1000*60*60*24))) }
    const avg = Math.round(lens.reduce((a,b)=>a+b,0)/lens.length)
    const last = new Date(pd[pd.length-1])
    const next = new Date(last); next.setDate(next.getDate()+avg)
    return next.toISOString().slice(0,10) + ` (avg ${avg}d)`
  }

  // suggestions: rule-based local 'AI' using logs
  function updateSuggestionsForDay(iso){
    const log = (state.logs||{})[iso]
    const out = []
    if(!log) return
    if(log.symptoms && log.symptoms.includes('cramps')) out.push('Try heat pad and gentle exercise')
    if(log.symptoms && log.symptoms.includes('headache')) out.push('Stay hydrated and rest in a dark room')
    if(log.mood==='anxious') out.push('Try breathing exercises or a short walk')
    // show suggestions
    let s = document.getElementById('suggestions')
    if(!s){ s = document.createElement('div'); s.id='suggestions'; document.getElementById('day-details').appendChild(s) }
    s.innerHTML = out.map(o=>`<div class="suggest">${escapeHtml(o)}</div>`).join('')
  }

  // announcements: fetch published if available, else local admin announcements
  async function loadAnnouncements(){
    const el = document.getElementById('announcements')
    let anns = []
    try{ const r = await fetch('public-announcements.json'); if(r.ok) anns = await r.json() }catch(e){}
    const local = JSON.parse(localStorage.getItem('period_tracker_announcements')||'[]')
    anns = (anns||[]).concat(local||[])
    el.innerHTML = anns.map(a=>`<div class="ann">${escapeHtml(a.title||a.text)} <small>${new Date(a.when||Date.now()).toLocaleString()}</small></div>`).join('')
  }
  loadAnnouncements()

  // PWA install handling
  let deferredPrompt
  const installBtn = document.getElementById('install-btn')
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault(); deferredPrompt = e; installBtn.style.display='inline-block'
  })
  installBtn.addEventListener('click', async ()=>{
    if(!deferredPrompt) return
    deferredPrompt.prompt()
    const res = await deferredPrompt.userChoice
    deferredPrompt = null; installBtn.style.display='none'
  })

  // settings load/save
  function loadSettings(){
  const s = (state && state.settings) || JSON.parse(localStorage.getItem('period_tracker_settings')||'{}')
  if(s.lastPeriod) document.getElementById('setting-last').value = s.lastPeriod
  if(s.cycle) document.getElementById('setting-cycle').value = s.cycle
  if(s.periodLength) document.getElementById('setting-period-length').value = s.periodLength
  if(s.weight) document.getElementById('setting-weight').value = s.weight
  if(s.height) document.getElementById('setting-height').value = s.height
  if(s.bmi) document.getElementById('bmi-result').textContent = s.bmi
  }
  function saveSettings(){
  const s = { lastPeriod: document.getElementById('setting-last').value, cycle: Number(document.getElementById('setting-cycle').value)||28, periodLength: Number(document.getElementById('setting-period-length').value)||5, weight: Number(document.getElementById('setting-weight').value)||null, height: Number(document.getElementById('setting-height').value)||null }
  if(s.weight && s.height) s.bmi = calcBMI(s.weight, s.height)
  state.settings = s
  saveState()
  alert('Settings saved')
  renderCalendar()
  }
  document.getElementById('calc-bmi').addEventListener('click', ()=>{ const w=Number(document.getElementById('setting-weight').value); const h=Number(document.getElementById('setting-height').value); if(!w||!h) return alert('Enter weight and height'); const bmi=calcBMI(w,h); document.getElementById('bmi-result').textContent=bmi; saveSettings() })
  document.getElementById('setting-last').addEventListener('change', saveSettings)
  document.getElementById('setting-cycle').addEventListener('change', saveSettings)
  document.getElementById('setting-period-length').addEventListener('change', saveSettings)
  loadSettings()

  function calcBMI(weightKg, heightCm){ const m = heightCm/100; return Math.round((weightKg/(m*m))*10)/10 }

  // prediction utilities using settings (fertile window approx by ovulation = cycle-14)
  function predictNextFromSettings(){
    const s = (state && state.settings) || JSON.parse(localStorage.getItem('period_tracker_settings')||'{}')
    if(!s.lastPeriod) return null
    const cycle = s.cycle||28
    const periodLen = s.periodLength||5
    const last = new Date(s.lastPeriod)
    const next = new Date(last); next.setDate(next.getDate()+cycle)
    // fertile window roughly day (cycle-19) to (cycle-11) after last period start
    const ovulationDay = cycle - 14
    const fertileStart = new Date(last); fertileStart.setDate(fertileStart.getDate()+ovulationDay-5)
    const fertileEnd = new Date(last); fertileEnd.setDate(fertileEnd.getDate()+ovulationDay+1)
    // safe days: approximate days outside fertile window and period
    const periodStart = new Date(next); const periodEnd = new Date(next); periodEnd.setDate(periodEnd.getDate()+periodLen-1)
    return { next: next.toISOString().slice(0,10), fertileStart: fertileStart.toISOString().slice(0,10), fertileEnd: fertileEnd.toISOString().slice(0,10), periodStart: periodStart.toISOString().slice(0,10), periodEnd: periodEnd.toISOString().slice(0,10) }
  }

  // expose prediction used in day details
  function predictNextPeriod(){
    const p = predictNextFromSettings()
    if(p) return `${p.next} (fertile ${p.fertileStart}..${p.fertileEnd})`
    // fallback to average from history
    const pd = (state.periodDays||[]).slice().sort()
    if(pd.length<2) return 'Not enough data'
    const lens = []
    for(let i=1;i<pd.length;i++){ const d1=new Date(pd[i-1]), d2=new Date(pd[i]); lens.push(Math.round((d2-d1)/(1000*60*60*24))) }
    const avg = Math.round(lens.reduce((a,b)=>a+b,0)/lens.length)
    const last = new Date(pd[pd.length-1])
    const next = new Date(last); next.setDate(next.getDate()+avg)
    return next.toISOString().slice(0,10) + ` (avg ${avg}d)`
  }


  // expose for admin page usage
  window.__PT__ = { state, saveState, LS_KEY, FEEDBACK_KEY, QUOTES_KEY, REM_KEY }
})();
