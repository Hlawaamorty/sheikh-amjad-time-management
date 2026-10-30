(() => {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const DAYS = ['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];
  const DAY_SHORT = ['سبت','أحد','اثن','ثلا','أرب','خمي','جمع'];
  const PERIODS = {1:'الصباح', 2:'منتصف اليوم', 3:'المساء'};
  const STATUS = {COMPLETED:'تم الإنجاز', PARTIAL:'إنجاز جزئي / عذر', LAZY:'لم تُنجز بسبب الكسل'};
  let supabase = null, currentUser = null, currentProfile = null, currentRole = 'USER';
  let weeks = [], selectedWeek = null, selectedDay = 0, currentTasks = [];
  let mediaRecorder = null, audioStream = null, audioChunks = [], audioBlob = null, audioInterval = null, audioSeconds = 0;

  const msg = (selector, text, error = false) => {
    const el = $(selector); if (!el) return;
    el.textContent = text || ''; el.classList.toggle('error', !!error);
  };
  function toast(text) {
    const el = $('#toast'); el.textContent = text; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2800);
  }
  function showPanel(panelId) {
    $$('.nav-button').forEach(b => b.classList.toggle('active', b.dataset.panel === panelId));
    $$('.panel').forEach(p => { p.hidden = p.id !== panelId; p.classList.toggle('active-panel', p.id === panelId); });
    if (panelId === 'daily-panel') loadDay();
    if (panelId === 'review-panel') loadReview();
    if (panelId === 'tickets-panel') loadTickets();
    if (panelId === 'admin-panel' && currentRole === 'ADMIN') loadAdmin();
  }
  function mapJsDay(date = new Date()) { return (date.getDay() + 1) % 7; }
  function isoDate(d) { return d.toISOString().slice(0,10); }
  function weekStartISO(date = new Date()) {
    const d = new Date(date); d.setHours(0,0,0,0); d.setDate(d.getDate() - mapJsDay(d)); return isoDate(d);
  }
  function friendlyDate(date = new Date()) { return new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long'}).format(date); }
  function setTheme(mode) {
    const root = document.documentElement;
    const actual = mode === 'SYSTEM' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : mode.toLowerCase();
    root.dataset.theme = actual;
  }
  function applyPreferences(profile) {
    if (!profile) return;
    document.documentElement.dataset.fontLevel = String(profile.font_size_level || 3);
    setTheme(profile.theme_mode || 'DARK');
    $('#setting-language').value = profile.preferred_language || 'ar_FA';
    $('#setting-theme').value = profile.theme_mode || 'DARK';
    $('#setting-font').value = profile.font_size_level || 3;
    $('#font-output').value = `${profile.font_size_level || 3} / 6`;
    const lang = profile.preferred_language || 'ar_FA';
    document.documentElement.dir = lang === 'en_US' ? 'ltr' : 'rtl';
    document.documentElement.lang = lang === 'en_US' ? 'en' : 'ar';
  }
  function niceTime(time) {
    if (!time) return '';
    const [h,m] = time.slice(0,5).split(':').map(Number);
    const period = h >= 12 ? 'م' : 'ص'; const hh = ((h + 11) % 12) + 1;
    return `${hh}:${String(m).padStart(2,'0')} ${period}`;
  }
  function dayButtons() {
    const strip = $('#day-strip'); strip.innerHTML = '';
    DAYS.forEach((name, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'day-button' + (i === selectedDay ? ' active' : '');
      b.innerHTML = `<strong>${DAY_SHORT[i]}</strong><small>${i === mapJsDay() && selectedWeek && selectedWeek.start_date === weekStartISO() ? 'اليوم' : `يوم ${i+1}`}</small>`;
      b.addEventListener('click', () => { selectedDay = i; dayButtons(); loadDay(); }); strip.appendChild(b);
    });
  }
  async function requireConfig() {
    if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) {
      $('#login-error').hidden = false;
      $('#login-error').textContent = 'أكمل إعداد assets/js/config.js بوضع رابط مشروع Supabase ومفتاح anon/publishable قبل تسجيل الدخول.';
      $('#login-form button[type="submit"]').disabled = true;
      return false;
    }
    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    return true;
  }
  async function boot() {
    const ok = await requireConfig();
    if (!ok) return;
    $('#login-form').addEventListener('submit', login);
    $('#toggle-password').addEventListener('click', () => {
      const input = $('#login-password'); input.type = input.type === 'password' ? 'text' : 'password';
    });
    $('#logout-button').addEventListener('click', logout);
    $$('.nav-button').forEach(b => b.addEventListener('click', () => showPanel(b.dataset.panel)));
    $('#review-form').addEventListener('submit', saveReview);
    $('#ticket-form').addEventListener('submit', createTicket);
    $('#refresh-tickets').addEventListener('click', loadTickets);
    $('#settings-form').addEventListener('submit', saveSettings);
    $('#setting-font').addEventListener('input', e => { $('#font-output').value = `${e.target.value} / 6`; document.documentElement.dataset.fontLevel = e.target.value; });
    $('#setting-theme').addEventListener('change', e => setTheme(e.target.value));
    $('#week-form').addEventListener('submit', createWeek);
    $('#task-form').addEventListener('submit', createTask);
    $('#refresh-admin').addEventListener('click', loadAdmin);
    $('#audio-start').addEventListener('click', startAudio);
    $('#audio-stop').addEventListener('click', stopAudio);
    $('#audio-upload').addEventListener('click', uploadAudio);
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await activateSession(session.user);
    supabase.auth.onAuthStateChange((_event, sessionNow) => {
      if (sessionNow?.user && !currentUser) activateSession(sessionNow.user);
      if (!sessionNow && currentUser) resetSession();
    });
  }
  async function login(e) {
    e.preventDefault(); msg('#login-error',''); $('#login-error').hidden = true;
    const email = $('#login-email').value.trim(), password = $('#login-password').value;
    const btn = $('#login-form button[type="submit"]'); btn.disabled = true; btn.textContent = 'جارٍ تسجيل الدخول…';
    const { data, error } = await supabase.auth.signInWithPassword({email,password});
    btn.disabled = false; btn.textContent = 'تسجيل الدخول';
    if (error) { $('#login-error').hidden = false; msg('#login-error', friendlyAuthError(error), true); return; }
    await activateSession(data.user);
  }
  function friendlyAuthError(error) {
    if (/Invalid login credentials/i.test(error.message)) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
    if (/Email not confirmed/i.test(error.message)) return 'الحساب يحتاج إلى تأكيد البريد الإلكتروني من إعدادات Supabase.';
    return `تعذر تسجيل الدخول: ${error.message}`;
  }
  async function activateSession(user) {
    currentUser = user;
    let { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error || !profile) {
      $('#login-error').hidden = false; msg('#login-error','لم يتم العثور على ملف المستخدم. تأكد من تشغيل SQL وإنشاء الحساب بعد تثبيت المشغّل.',true); return;
    }
    currentProfile = profile; currentRole = profile.role;
    $('#current-user').textContent = user.email || profile.username;
    $('#role-label').textContent = currentRole === 'ADMIN' ? 'المسؤول' : 'المستفيد';
    $$('.admin-only').forEach(el => el.hidden = currentRole !== 'ADMIN');
    $('#login-view').hidden = true; $('#app-view').hidden = false;
    applyPreferences(profile);
    await loadWeeks();
    $('#today-label').textContent = friendlyDate();
    if (currentRole === 'ADMIN') await loadAdmin();
    showPanel('daily-panel');
  }
  async function logout() { await supabase.auth.signOut(); resetSession(); }
  function resetSession() {
    currentUser = null; currentProfile = null; currentRole = 'USER';
    $('#app-view').hidden = true; $('#login-view').hidden = false;
  }
  async function loadWeeks() {
    const {data,error} = await supabase.from('weeks').select('*').order('start_date',{ascending:false});
    if (error) { toast(`تعذر تحميل الأسابيع: ${error.message}`); weeks=[]; selectedWeek=null; return; }
    weeks = data || [];
    const target = weekStartISO();
    selectedWeek = weeks.find(w => w.start_date <= target && w.end_date >= target) || weeks.find(w => w.is_active) || weeks[0] || null;
    if (currentRole === 'ADMIN') {
      const sel = $('#task-week'); sel.innerHTML='';
      weeks.forEach(w => { const op=document.createElement('option'); op.value=w.week_id; op.textContent=`${w.start_date} — ${w.end_date}`; sel.appendChild(op); });
      if (selectedWeek) sel.value=selectedWeek.week_id;
    }
    $('#week-label').textContent = selectedWeek ? `الأسبوع: ${selectedWeek.start_date} إلى ${selectedWeek.end_date}` : 'لم يُنشأ أسبوع بعد؛ اطلب من المسؤول إنشاءه.';
    $('#friday-message').textContent = selectedWeek?.friday_leisure_message || 'خصص وقتًا للراحة والأسرة والعبادات.';
  }
  async function loadDay() {
    if (!currentUser) return;
    dayButtons();
    $('#friday-card').hidden = selectedDay !== 6;
    $('#friday-message').textContent = selectedWeek?.friday_leisure_message || 'خصص وقتًا للراحة والأسرة والعبادات.';
    if (!selectedWeek) { $('#task-list').innerHTML='<div class="empty-state">لا يوجد أسبوع متاح. اطلب من المسؤول إنشاء أسبوع.</div>'; renderSummary([]); return; }
    const {data: tasks, error} = await supabase.from('tasks').select('task_id,week_id,user_id,day_of_week,period_id,title,admin_instructions,start_time,end_time,is_time_editable,display_order').eq('week_id',selectedWeek.week_id).eq('day_of_week',selectedDay).eq('user_id',currentUser.id).order('period_id').order('display_order').order('start_time');
    if (error) { $('#task-list').innerHTML=`<div class="empty-state">تعذر تحميل المهام: ${escapeHTML(error.message)}</div>`; return; }
    currentTasks = tasks || [];
    if (!currentTasks.length) { $('#task-list').innerHTML='<div class="empty-state">لا توجد مهام مسجلة لهذا اليوم حتى الآن.</div>'; renderSummary([]); return; }
    const ids = currentTasks.map(t=>t.task_id);
    const [progressResp, notesResp] = await Promise.all([
      supabase.from('task_progress').select('task_id,status').in('task_id',ids),
      supabase.from('private_task_notes').select('task_id,note_text').in('task_id',ids).eq('user_id',currentUser.id)
    ]);
    if (progressResp.error) toast('تعذر قراءة حالات المهام: '+progressResp.error.message);
    if (notesResp.error) toast('تعذر قراءة الملاحظات الخاصة: '+notesResp.error.message);
    const progress = Object.fromEntries((progressResp.data||[]).map(x=>[x.task_id,x.status]));
    const notes = Object.fromEntries((notesResp.data||[]).map(x=>[x.task_id,x.note_text]));
    $('#task-list').innerHTML = currentTasks.map(t => taskCard(t, progress[t.task_id] || '', notes[t.task_id] || '')).join('');
    $$('.status-option', $('#task-list')).forEach(btn => btn.addEventListener('click', () => updateStatus(btn.dataset.task,btn.dataset.status)));
    $$('.save-note', $('#task-list')).forEach(btn => btn.addEventListener('click', () => savePrivateNote(btn.dataset.task)));
    renderSummary(currentTasks.map(t=>({task_id:t.task_id,status:progress[t.task_id]})));
  }
  function taskCard(t,status,note) {
    return `<article class="task-card" data-task-card="${t.task_id}"><div class="task-main"><div><h3 class="task-title">${escapeHTML(t.title)}</h3><div class="task-instructions">${escapeHTML(PERIODS[t.period_id]||'')} · ${escapeHTML(t.admin_instructions||'')}</div></div><div class="task-time">${niceTime(t.start_time)} – ${niceTime(t.end_time)}</div></div>
      <div class="status-control" role="group" aria-label="حالة المهمة"><button class="status-option ${status==='COMPLETED'?'selected':''}" data-task="${t.task_id}" data-status="COMPLETED">✓ تم الإنجاز</button><button class="status-option ${status==='PARTIAL'?'selected':''}" data-task="${t.task_id}" data-status="PARTIAL">◐ جزئي / عذر</button><button class="status-option ${status==='LAZY'?'selected':''}" data-task="${t.task_id}" data-status="LAZY">× لم تُنجز</button></div>
      <details class="private-note"><summary>🔒 ملاحظات شخصية — خاصة بك</summary><textarea id="note-${t.task_id}" rows="2" placeholder="اكتب ملاحظتك الشخصية هنا…">${escapeHTML(note)}</textarea><button class="button ghost small-button save-note" data-task="${t.task_id}" type="button">حفظ الملاحظة</button></details></article>`;
  }
  async function updateStatus(taskId,status) {
    const {error}=await supabase.from('task_progress').upsert({task_id:taskId,status},{onConflict:'task_id'});
    if(error){toast('تعذر حفظ الحالة: '+error.message);return;}
    $$('.status-option[data-task="'+taskId+'"]').forEach(b=>b.classList.toggle('selected',b.dataset.status===status));
    const task = currentTasks.find(t=>t.task_id===taskId); if(task) task.status=status;
    renderSummary(currentTasks.map(t=>({task_id:t.task_id,status:(t.task_id===taskId?status:t.status)})));
    toast('تم حفظ حالة المهمة.');
  }
  async function savePrivateNote(taskId) {
    const noteText=$('#note-'+taskId).value;
    const {error}=await supabase.from('private_task_notes').upsert({task_id:taskId,user_id:currentUser.id,note_text:noteText},{onConflict:'task_id'});
    if(error){toast('تعذر حفظ الملاحظة: '+error.message);return;}
    toast('تم حفظ الملاحظة الخاصة.');
  }
  function renderSummary(rows) {
    const total=rows.length, done=rows.filter(x=>x.status==='COMPLETED').length, partial=rows.filter(x=>x.status==='PARTIAL').length, lazy=rows.filter(x=>x.status==='LAZY').length;
    $('#task-summary').innerHTML=[['إجمالي المهام',total],['تم الإنجاز',done],['جزئي / عذر',partial],['لم تُنجز',lazy]].map(([l,n])=>`<div class="summary-item"><span>${l}</span><strong>${n}</strong></div>`).join('');
  }
  async function loadReview() {
    if(!currentUser||!selectedWeek)return;
    const {data,error}=await supabase.from('weekly_reviews').select('*').eq('user_id',currentUser.id).eq('week_id',selectedWeek.week_id).maybeSingle();
    if(error){msg('#review-message','تعذر تحميل المراجعة: '+error.message,true);return;}
    const r=data||{};
    $('#review-accomplished').value=r.accomplished_tasks_summary||'';$('#review-reasons').value=r.accomplishment_reasons||'';$('#review-unaccomplished').value=r.unaccomplished_tasks_summary||'';$('#review-unreasons').value=r.unaccomplishment_reasons||'';$('#review-improve').value=r.improvement_points||'';$('#review-next').value=r.next_week_plan||'';
  }
  async function saveReview(e) {
    e.preventDefault(); if(!selectedWeek){msg('#review-message','لا يوجد أسبوع نشط.',true);return;}
    const data={user_id:currentUser.id,week_id:selectedWeek.week_id,accomplished_tasks_summary:$('#review-accomplished').value,accomplishment_reasons:$('#review-reasons').value,unaccomplished_tasks_summary:$('#review-unaccomplished').value,unaccomplishment_reasons:$('#review-unreasons').value,improvement_points:$('#review-improve').value,next_week_plan:$('#review-next').value};
    const {error}=await supabase.from('weekly_reviews').upsert(data,{onConflict:'user_id,week_id'});
    msg('#review-message',error?'تعذر الحفظ: '+error.message:'تم حفظ المراجعة في المساحة الخاصة بك.',!!error);
  }
  async function createTicket(e) {
    e.preventDefault(); const btn=$('#ticket-form button[type="submit"]');btn.disabled=true;msg('#ticket-message','جارٍ إرسال الطلب…');
    const {data:ticket,error}=await supabase.from('communication_tickets').insert({user_id:currentUser.id,subject:$('#ticket-subject').value.trim(),message_body:$('#ticket-body').value.trim()}).select().single();
    if(error){msg('#ticket-message','تعذر إنشاء التذكرة: '+error.message,true);btn.disabled=false;return;}
    const files=[...($('#ticket-files').files||[])]; let uploadErrors=[];
    for(const file of files){
      if(file.size>20*1024*1024){uploadErrors.push(`${file.name}: أكبر من 20 ميجابايت`);continue;}
      const path=`${currentUser.id}/${ticket.ticket_id}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
      const {error:upErr}=await supabase.storage.from('ticket-attachments').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
      if(upErr){uploadErrors.push(`${file.name}: ${upErr.message}`);continue;}
      const fileType=file.type.startsWith('image/')?'IMAGE':file.type.startsWith('video/')?'VIDEO':file.type.startsWith('audio/')?'AUDIO':'DOCUMENT';
      const {error:metaErr}=await supabase.from('ticket_attachments').insert({ticket_id:ticket.ticket_id,file_path:path,file_type:fileType,file_size_bytes:file.size});
      if(metaErr)uploadErrors.push(`${file.name}: رُفع الملف لكن تعذرت إضافة بياناته (${metaErr.message})`);
    }
    $('#ticket-form').reset();btn.disabled=false;
    msg('#ticket-message',uploadErrors.length?`أُنشئت التذكرة، لكن حدثت مشكلات في بعض المرفقات: ${uploadErrors.join(' | ')}`:'تم إرسال التذكرة بنجاح.',!!uploadErrors.length);
    await loadTickets(); if(currentRole==='ADMIN') await loadAdmin();
  }
  async function loadTickets() {
    if(!currentUser)return;
    const query=supabase.from('communication_tickets').select('ticket_id,user_id,subject,message_body,status,created_at').order('created_at',{ascending:false});
    const {data,error}=await query;
    if(error){$('#ticket-list').innerHTML=`<div class="empty-state">تعذر تحميل التذاكر: ${escapeHTML(error.message)}</div>`;return;}
    const tickets=data||[];
    if(!tickets.length){$('#ticket-list').innerHTML='<div class="empty-state">لا توجد تذاكر بعد.</div>';return;}
    const cards=await Promise.all(tickets.map(t=>ticketCard(t,false)));
    $('#ticket-list').innerHTML=cards.join('');
    if(currentRole==='ADMIN') $('#admin-ticket-list').innerHTML=(await Promise.all(tickets.map(t=>ticketCard(t,true)))).join('');
    $$('.reply-form').forEach(form=>form.addEventListener('submit',e=>sendTicketReply(e,form.dataset.ticket)));
    $$('.ticket-status-select').forEach(sel=>sel.addEventListener('change',()=>updateTicketStatus(sel.dataset.ticket,sel.value)));
    $$('.open-ticket').forEach(btn=>btn.addEventListener('click',()=>loadTicketConversation(btn.dataset.ticket)));
  }
  async function ticketCard(t,admin) {
    const {data:atts}=await supabase.from('ticket_attachments').select('attachment_id,file_path,file_type,file_size_bytes').eq('ticket_id',t.ticket_id);
    const links=[];
    for(const a of (atts||[])){
      const bucket=a.file_type==='AUDIO' && a.file_path.includes('/audio-notes/')?'audio-notes':'ticket-attachments';
      const {data}=await supabase.storage.from('ticket-attachments').createSignedUrl(a.file_path,1800);
      if(data?.signedUrl) links.push(`<a class="attachment-link" href="${data.signedUrl}" target="_blank" rel="noopener">عرض مرفق (${escapeHTML(a.file_type)})</a>`);
    }
    return `<article class="ticket-card"><div class="ticket-top"><h4>${escapeHTML(t.subject)}</h4><span class="status-badge">${escapeHTML(ticketStatusText(t.status))}</span></div><p class="ticket-body">${escapeHTML(t.message_body)}</p><div class="tiny muted">${new Date(t.created_at).toLocaleString('ar-EG')}</div><div class="ticket-attachments">${links.join('')}</div><div id="conversation-${t.ticket_id}" class="ticket-replies" hidden></div><button type="button" class="button ghost small-button open-ticket" data-ticket="${t.ticket_id}">عرض المحادثة / الرد</button>${admin?`<label for="status-${t.ticket_id}" class="tiny">حالة التذكرة</label><select id="status-${t.ticket_id}" class="ticket-status-select" data-ticket="${t.ticket_id}"><option value="OPEN" ${t.status==='OPEN'?'selected':''}>مفتوحة</option><option value="IN_PROGRESS" ${t.status==='IN_PROGRESS'?'selected':''}>قيد المعالجة</option><option value="RESOLVED" ${t.status==='RESOLVED'?'selected':''}>تم الحل</option></select>`:''}</article>`;
  }
  function ticketStatusText(s){return ({OPEN:'مفتوحة',IN_PROGRESS:'قيد المعالجة',RESOLVED:'تم الحل'})[s]||s;}
  async function loadTicketConversation(ticketId) {
    const box=$('#conversation-'+ticketId); if(!box)return;
    box.hidden=false; box.innerHTML='<p class="muted">جارٍ تحميل المحادثة…</p>';
    const {data,error}=await supabase.from('ticket_messages').select('message_id,sender_id,message_body,created_at').eq('ticket_id',ticketId).order('created_at');
    if(error){box.innerHTML=`<p class="inline-message error">تعذر تحميل الردود: ${escapeHTML(error.message)}</p>`;return;}
    const messages=(data||[]).map(m=>`<div class="reply-line"><strong>${m.sender_id===currentUser.id?'أنت':'رد من الطرف الآخر'}</strong><div>${escapeHTML(m.message_body)}</div><small class="muted">${new Date(m.created_at).toLocaleString('ar-EG')}</small></div>`).join('');
    box.innerHTML=`${messages||'<p class="muted">لا توجد ردود حتى الآن.</p>'}<form class="reply-form" data-ticket="${ticketId}"><input name="reply" required maxlength="5000" placeholder="اكتب ردًا…"><button class="button primary" type="submit">إرسال</button></form>`;
    $('.reply-form',box).addEventListener('submit',e=>sendTicketReply(e,ticketId));
  }
  async function sendTicketReply(e,ticketId) {
    e.preventDefault(); const form=e.currentTarget, body=$('input[name="reply"]',form).value.trim(); if(!body)return;
    const {error}=await supabase.from('ticket_messages').insert({ticket_id:ticketId,sender_id:currentUser.id,message_body:body});
    if(error){toast('تعذر إرسال الرد: '+error.message);return;}
    await loadTicketConversation(ticketId); toast('تم إرسال الرد.');
  }
  async function updateTicketStatus(ticketId,status) {
    const {error}=await supabase.from('communication_tickets').update({status}).eq('ticket_id',ticketId);
    if(error){toast('تعذر تحديث حالة التذكرة: '+error.message);await loadTickets();return;}
    toast('تم تحديث حالة التذكرة.');
  }
  async function saveSettings(e) {
    e.preventDefault(); const data={preferred_language:$('#setting-language').value,theme_mode:$('#setting-theme').value,font_size_level:Number($('#setting-font').value)};
    const {error}=await supabase.from('profiles').update(data).eq('id',currentUser.id);
    if(error){msg('#settings-message','تعذر حفظ الإعدادات: '+error.message,true);return;}
    currentProfile={...currentProfile,...data};applyPreferences(currentProfile);msg('#settings-message','تم حفظ الإعدادات.');
  }
  async function createWeek(e) {
    e.preventDefault(); const start=$('#week-start-date').value; if(!start)return;
    const d=new Date(`${start}T12:00:00`); if(d.getDay()!==6){msg('#week-message','تاريخ بداية الأسبوع يجب أن يكون يوم السبت.',true);return;}
    const end=new Date(d);end.setDate(end.getDate()+6);
    const {error}=await supabase.from('weeks').insert({start_date:start,end_date:isoDate(end),is_active:true,friday_leisure_message:'خصص وقتًا للراحة والأسرة والعبادات.'});
    if(error){msg('#week-message','تعذر إنشاء الأسبوع: '+error.message,true);return;}
    msg('#week-message','تم إنشاء الأسبوع.');await loadWeeks();await loadAdmin();
  }
  async function loadAdmin() {
    if(currentRole!=='ADMIN')return;
    await loadWeeks();
    const {data:profiles,error:profilesError}=await supabase.from('profiles').select('id,username,role').order('username');
    if(profilesError){toast('تعذر قراءة قائمة الحسابات: '+profilesError.message);return;}
    const userSel=$('#task-user');userSel.innerHTML='';(profiles||[]).filter(p=>p.role==='USER').forEach(p=>{const op=document.createElement('option');op.value=p.id;op.textContent=p.username;userSel.appendChild(op);});
    const {data:allTasks,error}=await supabase.from('tasks').select('task_id,week_id,user_id,day_of_week,period_id,title,admin_instructions,start_time,end_time').order('week_id',{ascending:false}).order('day_of_week').order('period_id').order('display_order');
    if(error){$('#admin-task-list').innerHTML=`<div class="empty-state">تعذر تحميل المهام: ${escapeHTML(error.message)}</div>`;return;}
    const ids=(allTasks||[]).map(t=>t.task_id); let progress=[];
    if(ids.length){const p=await supabase.from('task_progress').select('task_id,status').in('task_id',ids);progress=p.data||[];}
    const pMap=Object.fromEntries(progress.map(p=>[p.task_id,p.status]));
    const totals={total:(allTasks||[]).length,done:progress.filter(p=>p.status==='COMPLETED').length,partial:progress.filter(p=>p.status==='PARTIAL').length,lazy:progress.filter(p=>p.status==='LAZY').length};
    $('#admin-stats').innerHTML=[['إجمالي المهام',totals.total],['تم الإنجاز',totals.done],['جزئي / عذر',totals.partial],['لم تُنجز',totals.lazy]].map(([l,n])=>`<div class="stat-item"><span>${l}</span><strong>${n}</strong></div>`).join('');
    const profileNames=Object.fromEntries((profiles||[]).map(p=>[p.id,p.username]));
    $('#admin-task-list').innerHTML=allTasks?.length?`<table><thead><tr><th>اليوم</th><th>الفترة</th><th>المستفيد</th><th>المهمة</th><th>الوقت</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${allTasks.map(t=>`<tr><td>${DAYS[t.day_of_week]}</td><td>${PERIODS[t.period_id]}</td><td>${escapeHTML(profileNames[t.user_id]||'—')}</td><td>${escapeHTML(t.title)}</td><td>${niceTime(t.start_time)}–${niceTime(t.end_time)}</td><td>${escapeHTML(STATUS[pMap[t.task_id]]||'لم تُحدد')}</td><td><button type="button" class="button ghost small-button delete-task" data-task="${t.task_id}">حذف</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">لا توجد مهام حتى الآن.</div>';
    $$('.delete-task').forEach(b=>b.addEventListener('click',()=>deleteTask(b.dataset.task)));
    await loadTickets();
  }
  async function createTask(e) {
    e.preventDefault(); const button=$('#task-form button[type="submit"]');button.disabled=true;
    const weekId=$('#task-week').value,userId=$('#task-user').value,day=Number($('#task-day').value),period=Number($('#task-period').value);
    if(!weekId||!userId){msg('#task-message','أنشئ أسبوعًا وأضف حساب مستفيد أولًا.',true);button.disabled=false;return;}
    const {count,error:countError}=await supabase.from('tasks').select('*',{count:'exact',head:true}).eq('week_id',weekId).eq('user_id',userId).eq('day_of_week',day);
    if(countError){msg('#task-message','تعذر التحقق من عدد المهام: '+countError.message,true);button.disabled=false;return;}
    if((count||0)>=100){msg('#task-message','تم الوصول إلى الحد الأقصى 100 مهمة لهذا اليوم.',true);button.disabled=false;return;}
    const {data:existing}=await supabase.from('tasks').select('display_order').eq('week_id',weekId).eq('user_id',userId).eq('day_of_week',day).order('display_order',{ascending:false}).limit(1);
    const payload={week_id:weekId,user_id:userId,day_of_week:day,period_id:period,title:$('#task-title').value.trim(),admin_instructions:$('#task-instructions').value.trim(),start_time:$('#task-start').value,end_time:$('#task-end').value,is_time_editable:$('#task-time-editable').checked,display_order:(existing?.[0]?.display_order||0)+1};
    if(!payload.title||!payload.start_time||!payload.end_time){msg('#task-message','أكمل اسم المهمة ووقتي البداية والنهاية.',true);button.disabled=false;return;}
    const {error}=await supabase.from('tasks').insert(payload);
    button.disabled=false;
    if(error){msg('#task-message','تعذر إضافة المهمة: '+error.message,true);return;}
    msg('#task-message','تمت إضافة المهمة.');$('#task-title').value='';$('#task-instructions').value='';await loadAdmin();
  }
  async function deleteTask(taskId) {
    if(!confirm('هل تريد حذف هذه المهمة؟ سيتم حذف حالتها وملاحظاتها المرتبطة بها.'))return;
    const {error}=await supabase.from('tasks').delete().eq('task_id',taskId);
    if(error){toast('تعذر حذف المهمة: '+error.message);return;} toast('تم حذف المهمة.');await loadAdmin();
  }
  async function startAudio() {
    msg('#audio-message','');
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){msg('#audio-message','المتصفح لا يدعم التسجيل؛ استخدم تسجيلًا صوتيًا من الجهاز وارفعه كتذكرة تواصل.',true);return;}
    try {
      audioStream=await navigator.mediaDevices.getUserMedia({audio:true});
      let mimeType='audio/webm;codecs=opus';
      if(!MediaRecorder.isTypeSupported(mimeType)){if(MediaRecorder.isTypeSupported('audio/mp4'))mimeType='audio/mp4';else if(MediaRecorder.isTypeSupported('audio/ogg;codecs=opus'))mimeType='audio/ogg;codecs=opus';else mimeType='';}
      mediaRecorder=new MediaRecorder(audioStream,mimeType?{mimeType,audioBitsPerSecond:128000}:{audioBitsPerSecond:128000});
      audioChunks=[];audioBlob=null;audioSeconds=0;$('#audio-timer').textContent='00:00';
      mediaRecorder.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data);};
      mediaRecorder.onstop=()=>{audioBlob=new Blob(audioChunks,{type:mediaRecorder.mimeType||'audio/webm'});$('#audio-preview').src=URL.createObjectURL(audioBlob);$('#audio-preview').hidden=false;$('#audio-upload').disabled=false;if(audioStream)audioStream.getTracks().forEach(t=>t.stop());};
      mediaRecorder.start();$('#audio-start').disabled=true;$('#audio-stop').disabled=false;$('#audio-upload').disabled=true;
      audioInterval=setInterval(()=>{audioSeconds++;$('#audio-timer').textContent=`${String(Math.floor(audioSeconds/60)).padStart(2,'0')}:${String(audioSeconds%60).padStart(2,'0')}`;},1000);
      msg('#audio-message','التسجيل جارٍ.');
    } catch(err){msg('#audio-message','تعذر بدء التسجيل: '+err.message,true);}
  }
  function stopAudio(){if(mediaRecorder&&mediaRecorder.state==='recording')mediaRecorder.stop();clearInterval(audioInterval);$('#audio-start').disabled=false;$('#audio-stop').disabled=true;}
  async function uploadAudio() {
    if(!audioBlob||!selectedWeek){msg('#audio-message','لا يوجد تسجيل جاهز أو لا يوجد أسبوع نشط.',true);return;}
    const extension=audioBlob.type.includes('mp4')?'m4a':audioBlob.type.includes('ogg')?'ogg':'webm';
    const path=`${currentUser.id}/${selectedWeek.week_id}/${selectedDay}/${crypto.randomUUID()}.${extension}`;
    const uploadContentType=(audioBlob.type||'audio/webm').split(';')[0];
    const {error:upErr}=await supabase.storage.from('audio-notes').upload(path,audioBlob,{contentType:uploadContentType,upsert:false});
    if(upErr){msg('#audio-message','تعذر رفع التسجيل: '+upErr.message,true);return;}
    const {error}=await supabase.from('audio_notes').insert({user_id:currentUser.id,week_id:selectedWeek.week_id,day_of_week:selectedDay,file_path:path,duration_seconds:audioSeconds,mime_type:audioBlob.type||'audio/webm'});
    if(error){msg('#audio-message','رُفع الملف لكن تعذّر حفظ بياناته: '+error.message,true);return;}
    msg('#audio-message','تم حفظ التسجيل في المساحة الخاصة بك.');$('#audio-upload').disabled=true;
  }
  function safeFilename(name){return name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-100)||'attachment';}
  function escapeHTML(value){return String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  document.addEventListener('DOMContentLoaded',boot);
})();
