// Admin frontend (hardcoded credentials). Reads localStorage to build stats.
(function(){
  const ADMIN_USER = 'tjjune'
  const ADMIN_PASS = '0110506968' // hardcoded local credentials

  const loginSection = document.getElementById('login-section')
  const dashboard = document.getElementById('dashboard')
  const msg = document.getElementById('login-msg')

  document.getElementById('admin-login').addEventListener('click', ()=>{
    const u = document.getElementById('admin-username').value
    const p = document.getElementById('admin-password').value
    if(u===ADMIN_USER && p===ADMIN_PASS){
      loginSection.style.display='none'
      dashboard.style.display='block'
      loadDashboard()
    } else msg.textContent='Invalid'
  })

  function loadDashboard(){
    // gather data: find all localStorage keys that look like period tracker
    const users = []
    for(let i=0;i<localStorage.length;i++){
      const key = localStorage.key(i)
      if(key && key.startsWith('period_tracker_data')){
        try{ users.push({key, data: JSON.parse(localStorage.getItem(key))}) }catch(e){}
      }
    }
    const ul = document.getElementById('users-list')
    ul.innerHTML = users.map(u=>`<div class="user">${u.key} — <pre>${JSON.stringify(u.data,null,2)}</pre></div>`).join('')

    // feedback
    const fb = JSON.parse(localStorage.getItem('period_tracker_feedback')||'[]')
    document.getElementById('feedback-list').innerHTML = fb.map(f=>`<div class="fb">${new Date(f.created).toLocaleString()} - ${escapeHtml(f.text)}</div>`).join('')

    // aggregate across all users
    const allCycleLens = []
    const symptomCounts = {}
    const moodCounts = {}
    users.forEach(u=>{
      const pd = u.data.periodDays||[]
      computeCycleLengths(pd).forEach(len=>allCycleLens.push(len))
      const logs = u.data.logs||{}
      Object.values(logs).forEach(l=>{
        const mood = l.mood||'unknown'; moodCounts[mood]=(moodCounts[mood]||0)+1
        (l.symptoms||[]).forEach(s=>{ symptomCounts[s]=(symptomCounts[s]||0)+1 })
      })
    })

    // cycles chart
    const ctx = document.getElementById('chart-cycles').getContext('2d')
    new Chart(ctx,{type:'bar',data:{labels:allCycleLens.map((_,i)=>i+1),datasets:[{label:'Cycle length (days)',data:allCycleLens,backgroundColor:'#c44'}]}})

    // moods chart
    const ctx2 = document.getElementById('chart-moods').getContext('2d')
    new Chart(ctx2,{type:'pie',data:{labels:Object.keys(moodCounts),datasets:[{data:Object.values(moodCounts),backgroundColor:['#f88','#8af','#ffa','#cfc','#ccc']}]}})

    // show top symptoms
    const topSymptoms = Object.entries(symptomCounts).sort((a,b)=>b[1]-a[1]).slice(0,10)
    const statsDiv = document.createElement('div')
    statsDiv.innerHTML = `<h4>Top symptoms</h4>${topSymptoms.map(s=>`<div>${escapeHtml(s[0])} (${s[1]})</div>`).join('')}`
    ul.prepend(statsDiv)

    // load admin quotes
    document.getElementById('admin-quotes').value = localStorage.getItem('period_tracker_quotes')||''
    document.getElementById('save-quotes').addEventListener('click', ()=>{
      localStorage.setItem('period_tracker_quotes', document.getElementById('admin-quotes').value)
      alert('Saved locally. To publish globally, upload public-quotes.json to your hosting root with the same content.')
    })

    // localization
    document.getElementById('default-lang').value = localStorage.getItem('period_tracker_default_lang')||'en'
    document.getElementById('translations').value = localStorage.getItem('period_tracker_translations')||''
    document.getElementById('save-translations').addEventListener('click', ()=>{
      localStorage.setItem('period_tracker_default_lang', document.getElementById('default-lang').value)
      localStorage.setItem('period_tracker_translations', document.getElementById('translations').value)
      alert('Translations saved locally')
    })

    // announcements
    document.getElementById('post-ann').addEventListener('click', ()=>{
      const title = document.getElementById('ann-title').value
      const text = document.getElementById('ann-text').value
      if(!text) return alert('Enter text')
      const arr = JSON.parse(localStorage.getItem('period_tracker_announcements')||'[]')
      arr.push({title,text,when:Date.now()})
      localStorage.setItem('period_tracker_announcements', JSON.stringify(arr))
      alert('Announcement saved locally; users will see it on load')
    })
    document.getElementById('export-ann').addEventListener('click', ()=>{
      const arr = JSON.parse(localStorage.getItem('period_tracker_announcements')||'[]')
      const blob = new Blob([JSON.stringify(arr,null,2)],{type:'application/json'})
      const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='public-announcements.json'; a.click(); URL.revokeObjectURL(url)
    })

    // analytics
    document.getElementById('run-analytics').addEventListener('click', ()=>{
      const users = []
      for(let i=0;i<localStorage.length;i++){ const key=localStorage.key(i); if(key && key.startsWith('period_tracker_data')){ try{ users.push(JSON.parse(localStorage.getItem(key))) }catch(e){} } }
      const totalUsers = users.length
      let symptomCounts = {}
      let usersLoggingSymptoms = 0
      users.forEach(u=>{ const logs = u.logs||{}; const hasSym = Object.values(logs).some(l=> (l.symptoms||[]).length>0); if(hasSym) usersLoggingSymptoms++ ; Object.values(logs).forEach(l=> (l.symptoms||[]).forEach(s=> symptomCounts[s]=(symptomCounts[s]||0)+1)) })
      const topSym = Object.entries(symptomCounts).sort((a,b)=>b[1]-a[1]).slice(0,10)
      // missed periods: for each user, compute expected next periods from settings or history and compare to logs
      let totalMissed = 0
      users.forEach(u=>{
        const settings = JSON.parse(localStorage.getItem('period_tracker_settings')||'{}')
        const pd = u.periodDays||[]
        if(settings.lastPeriod){
          const cycle = settings.cycle||28
          const start = new Date(settings.lastPeriod)
          // simulate next 6 cycles
          for(let i=1;i<=6;i++){
            const expect = new Date(start); expect.setDate(expect.getDate()+cycle*i)
            const iso = expect.toISOString().slice(0,10)
            const found = (pd||[]).some(d=>d===iso)
            if(!found) totalMissed++
          }
        } else if(pd.length>1){
          // infer average cycle
          const lens = []
          for(let i=1;i<pd.length;i++){ const d1=new Date(pd[i-1]), d2=new Date(pd[i]); lens.push(Math.round((d2-d1)/(1000*60*60*24))) }
          const avg = Math.round(lens.reduce((a,b)=>a+b,0)/lens.length)
          const last = new Date(pd[pd.length-1])
          const expect = new Date(last); expect.setDate(expect.getDate()+avg)
          const iso = expect.toISOString().slice(0,10)
          if(!pd.includes(iso)) totalMissed++
        }
      })

      document.getElementById('analytics-output').innerHTML = `<div>Total users (local devices): ${totalUsers}</div><div>Users logging symptoms: ${usersLoggingSymptoms}</div><div>Top symptoms:${topSym.map(s=>'<div>'+s[0]+' ('+s[1]+')</div>').join('')}</div><div>Total missed periods (est): ${totalMissed}</div>`
    })
  }

  function computeCycleLengths(periodDays){
    if(!periodDays || periodDays.length<2) return []
    const days = periodDays.slice().sort()
    const lens = []
    for(let i=1;i<days.length;i++){
      const d1=new Date(days[i-1]), d2=new Date(days[i])
      const diff = Math.round((d2-d1)/(1000*60*60*24))
      lens.push(diff)
    }
    return lens
  }
  function aggregateMoods(logs){
    const c = {}
    Object.values(logs||{}).forEach(l=>{ const m=l.mood||'unknown'; c[m]=(c[m]||0)+1 })
    return c
  }
  function escapeHtml(s){ return (s||'').replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]) }
})();
