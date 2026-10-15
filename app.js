import {DriveStore, DRIVE_SCOPE} from './drive.js?v=2.2.0';
import {PersistentGateway} from './backend-client.js?v=2.2.0';
const $=(s)=>document.querySelector(s);
const $$=(s)=>Array.from(document.querySelectorAll(s));
const WEEK=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const SHORT=['dom','seg','ter','qua','qui','sex','sáb'];
const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const BASE={version:1,events:[],routines:[],archive:[],exceptions:{}};
const DEFAULTS={themeLight:'medium',themeHue:'blue',edgeNavigate:true,soundOn:false,vibrationOn:false,largeText:false,highContrast:false,reduceMotion:false,latitude:'',longitude:''};
const storage=(()=>{try{return window.localStorage}catch{return {getItem:()=>null,setItem:()=>{},removeItem:()=>{}}}})();
const settings={...DEFAULTS,...JSON.parse(storage.getItem('atlas.settings')||'{}')};
// Migration: version 1.4 offered three combined presets.
if(settings.theme&&!('themeLight' in JSON.parse(storage.getItem('atlas.settings')||'{}'))){settings.themeLight=settings.theme==='light'?'light':settings.theme==='dark'?'dark':'medium';settings.themeHue='blue';}

const now=new Date();const state={db:structuredClone(BASE),view:'year',date:new Date(now.getFullYear(),now.getMonth(),now.getDate()),page:'calendar',timeline:false,ready:false};
const pad=(n)=>String(n).padStart(2,'0');
const iso=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const isodt=(d)=>`${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseDate=(s)=>new Date(`${s}T00:00:00`);
const startOfDay=(d)=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
function plusDays(d,n){const t=new Date(d);t.setDate(t.getDate()+n);return t}
function plusMonths(d,n){return new Date(d.getFullYear(),d.getMonth()+n,1)}
function startOfWeek(d){return plusDays(startOfDay(d),-d.getDay())}
function rangeForView(){let d=state.date,y=d.getFullYear(),m=d.getMonth();switch(state.view){case 'day':return [startOfDay(d),plusDays(startOfDay(d),1)];case 'week':{let s=startOfWeek(d);return [s,plusDays(s,7)]}case 'month':return [new Date(y,m,1),new Date(y,m+1,1)];case 'quarter':{let s=new Date(y,Math.floor(m/3)*3,1);return [s,new Date(y,s.getMonth()+3,1)]}case 'half':{let s=new Date(y,Math.floor(m/6)*6,1);return [s,new Date(y,s.getMonth()+6,1)]}default:return [new Date(y,0,1),new Date(y+1,0,1)]}}
function movePeriod(amount){let d=state.date;switch(state.view){case 'day':state.date=plusDays(d,amount);break;case 'week':state.date=plusDays(d,amount*7);break;case 'month':state.date=plusMonths(d,amount);break;case 'quarter':state.date=plusMonths(d,amount*3);break;case 'half':state.date=plusMonths(d,amount*6);break;case 'year':state.date=new Date(d.getFullYear()+amount,0,1);break;}renderCalendar()}
function escaped(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function attr(s){return escaped(s)}
function shortDate(d){return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})}
function readableDate(d){return d.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
const equalDay=(a,b)=>iso(a)===iso(b);
const tm=(d)=>`${pad(d.getHours())}:${pad(d.getMinutes())}`;
const uid=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const nonBlank=(s)=>String(s??'').trim();
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),3500)}

// IndexedDB é a fonte local na versão PWA; o localStorage é apenas backup compatível.
let idbPromise;
function dbOpen(){
 if(!('indexedDB' in window))return Promise.reject(new Error('IndexedDB indisponível'));
 if(!idbPromise)idbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open('atlas-organizer-offline-v2',1);
  req.onupgradeneeded=()=>{for(const name of ['kv','attachments'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name)};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });return idbPromise;
}
async function dbValue(store,key,value,write=false){const db=await dbOpen();return new Promise((resolve,reject)=>{
 const tx=db.transaction(store,write?'readwrite':'readonly');const request=write?tx.objectStore(store).put(value,key):tx.objectStore(store).get(key);
 tx.oncomplete=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.onerror=()=>reject(tx.error);
});}
async function dbDelete(store,key){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');const req=tx.objectStore(store).delete(key);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error)})}
let driveConnection=null;
let persistentGateway=null;
const GATEWAY_URL_KEY='atlas.gatewayUrl';
const GATEWAY_SESSION_KEY='atlas-backend-session';
const activeGatewayUrl=()=>storage.getItem(GATEWAY_URL_KEY)?.trim()||'';
function gatewayFromSetting(){
 const addr=$('#atlasGatewayUrl')?.value.trim()||activeGatewayUrl();
 if(!addr)return null;
 return new PersistentGateway(addr,()=>dbValue('kv',GATEWAY_SESSION_KEY),session=>dbValue('kv',GATEWAY_SESSION_KEY,session,true),()=>dbDelete('kv',GATEWAY_SESSION_KEY));
}
function gatewayMessage(msg){const e=$('#atlasGatewayStatus');if(e)e.textContent=msg;}
const DRIVE_REMEMBER_KEY='atlas.drivePreviouslyAuthorized';
const driveWasAuthorized=()=>storage.getItem(DRIVE_REMEMBER_KEY)==='1';
function rememberDrive(){storage.setItem(DRIVE_REMEMBER_KEY,'1');updateDriveReconnectUI();}
function updateDriveReconnectUI(){
 const button=$('#quickConnectDrive');if(!button)return;
 // A indicação de conexão só representa uma autorização que está de fato ativa.
 button.classList.toggle('hidden',!driveWasAuthorized()||!!driveConnection?.store);
 button.disabled=false;
}
function restoreDrivePrompt(){
 updateDriveReconnectUI();
 if(driveWasAuthorized()&&!driveConnection){
  syncStatus(navigator.onLine
    ?'O Google Drive foi configurado anteriormente. Retome a conexão com um clique para sincronizar. Os registros locais estão preservados.'
    :'Offline · registros salvos neste dispositivo; retome a conexão ao voltar a internet.');
 }
}
let localChangeVersion=0;
function syncStatus(message){const el=$('#cloudStatus');if(el)el.textContent=message}

async function load(){
 let source='novo';
 try {const saved=await dbValue('kv','atlas-data');if(validData(saved)){state.db=saved;source='IndexedDB';}}
 catch(err){console.warn('IndexedDB:',err);}
 if(source==='novo'){try{const raw=storage.getItem('atlas.backup');if(raw&&validData(JSON.parse(raw))){state.db=JSON.parse(raw);source='backup do navegador';await dbValue('kv','atlas-data',state.db,true)}}catch{}}
 state.ready=false;
 $('#saveState').textContent=source==='novo'?'Armazenamento local pronto':`Carregado: ${source}`;
 renderAll();
 restoreDrivePrompt();
 if(activeGatewayUrl())restoreGatewaySession().catch(err=>gatewayMessage('Reconexão adiada: '+err.message));
}
function validData(db){return db&&Array.isArray(db.events)&&Array.isArray(db.routines)&&Array.isArray(db.archive)&&db.exceptions&&typeof db.exceptions==='object'}
let saveChain=Promise.resolve(),pendingWrites=0;
function save(){
 const snapshot=structuredClone(state.db);storage.setItem('atlas.backup',JSON.stringify(snapshot));localChangeVersion++;
 pendingWrites++;$('#saveState').textContent='Salvando no dispositivo…';
 saveChain=saveChain.catch(()=>{}).then(async()=>{
  try{await dbValue('kv','atlas-data',snapshot,true)}catch(err){console.error(err);toast('Falha no armazenamento persistente; exporte um backup JSON.');throw err}
  if(driveConnection?.active && !driveConnection.blocked) scheduleDriveSync();
 }).finally(()=>{pendingWrites--;if(!pendingWrites)$('#saveState').textContent='Salvo neste dispositivo'+(driveConnection?.active?' · Drive conectado':driveWasAuthorized()?' · Drive precisa ser retomado':'')});
 return saveChain;
}
window.addEventListener('beforeunload',e=>{if(pendingWrites){e.preventDefault();e.returnValue=''}});
function settingSaved(){storage.setItem('atlas.settings',JSON.stringify(settings));applySettings()}
function applySettings(){
 const palette={blue:[205,62],green:[151,37],yellow:[44,54],neutral:[210,5],purple:[272,35],orange:[28,48],rose:[341,38]};
 const [h,s]=palette[settings.themeHue]||palette.blue;
 const dark=settings.themeLight==='dark',light=settings.themeLight==='light';
 const css=(name,v)=>document.body.style.setProperty(name,v);
 const tone=(l,ss=s)=>`hsl(${h} ${ss}% ${l}%)`;
 if(light){css('--bg',tone(92,Math.round(s*.43)));css('--side',tone(88,Math.round(s*.36)));css('--panel',tone(98,Math.round(s*.24)));css('--panel2',tone(94,Math.round(s*.3)));css('--cell',tone(90,Math.round(s*.4)));css('--line',`hsl(${h} ${s}% 24% / .17)`);css('--text',tone(20,Math.max(s,12)));css('--muted',tone(40,Math.max(Math.round(s*.7),13)));css('--shadow','rgba(20,34,49,.14)');}
 else if(dark){css('--bg',tone(10,Math.round(s*.55)));css('--side',tone(7,Math.round(s*.5)));css('--panel',tone(15,Math.round(s*.53)));css('--panel2',tone(18,Math.round(s*.55)));css('--cell',tone(22,Math.round(s*.5)));css('--line',`hsl(${h} 48% 90% / .14)`);css('--text',tone(94,15));css('--muted',tone(69,16));css('--shadow','rgba(0,0,0,.42)');}
 else{css('--bg',tone(26,Math.round(s*.68)));css('--side',tone(23,Math.round(s*.74)));css('--panel',tone(33,Math.round(s*.57)));css('--panel2',tone(36,Math.round(s*.56)));css('--cell',tone(39,Math.round(s*.52)));css('--line',`hsl(${h} 58% 93% / .19)`);css('--text',tone(97,12));css('--muted',tone(83,16));css('--shadow','rgba(0,10,26,.18)');}
 const complement=settings.themeHue==='neutral'?27:(h+180)%360; // destaque complementar no círculo cromático
 css('--accent',`hsl(${complement} ${light?73:80}% ${light?34:76}%)`);css('--accentText',light?'#fff':'#1f2a32');
 document.body.dataset.theme='custom';document.body.classList.toggle('large-text',settings.largeText);document.body.classList.toggle('high-contrast',settings.highContrast);document.body.classList.toggle('reduce-motion',settings.reduceMotion);
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',getComputedStyle(document.body).getPropertyValue('--bg').trim());
 for(const key of Object.keys(DEFAULTS)){let el=$('#'+key);if(!el)continue;if(el.type==='checkbox')el.checked=!!settings[key];else el.value=settings[key]}
 const desc=$('#themeDescription');if(desc)desc.textContent=`${$('#themeHue').selectedOptions[0].text} · ${$('#themeLight').selectedOptions[0].text}`;
}

function selectPage(page){state.page=page;$$('.page').forEach(el=>el.classList.toggle('hidden',el.id!==page+'Page'));$$('.nav-btn').forEach(el=>el.classList.toggle('selected',el.dataset.page===page));$('#pageTitle').textContent=({calendar:'Calendário Atlas Organizer',routines:'Rotinas',archive:'Acervo',settings:'Configurações'})[page];$('#pageKicker').textContent=({calendar:'ORGANIZE SEU TEMPO',routines:'SEUS HÁBITOS',archive:'SUA BIBLIOTECA',settings:'SUA EXPERIÊNCIA'})[page];if(page==='calendar')renderCalendar();if(page==='routines')renderRoutines();if(page==='archive')renderArchive();}
function renderAll(){applySettings();$('#todayLabel').textContent=now.toLocaleDateString('pt-BR',{day:'numeric',month:'short',year:'numeric'});selectPage(state.page)}
// NOAA-inspired approximate solar times (no network calls): location may be configured explicitly.
function solarMinutes(date,rising){let lat=Number(settings.latitude),lon=Number(settings.longitude);
 if(settings.latitude===''||settings.longitude===''||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return rising?360:1080;
 let y=date.getFullYear(),N=(Date.UTC(y,date.getMonth(),date.getDate())-Date.UTC(y,0,0))/86400000;
 const rad=Math.PI/180, norm=(v)=>((v%360)+360)%360;
 const lngHour=lon/15,t=N+((rising?6:18)-lngHour)/24,M=.9856*t-3.289;
 let L=norm(M+1.916*Math.sin(M*rad)+.020*Math.sin(2*M*rad)+282.634);
 let RA=norm(Math.atan(.91764*Math.tan(L*rad))/rad),Lq=Math.floor(L/90)*90,RAq=Math.floor(RA/90)*90;RA=(RA+Lq-RAq)/15;
 const sinDec=.39782*Math.sin(L*rad),cosDec=Math.cos(Math.asin(sinDec));
 let cosH=(Math.cos(90.833*rad)-sinDec*Math.sin(lat*rad))/(cosDec*Math.cos(lat*rad));
 if(cosH>1||cosH< -1)return rising?360:1080;
 let H=(rising?360-Math.acos(cosH)/rad:Math.acos(cosH)/rad)/15;
 let T=H+RA-.06571*t-6.622,ut=((T-lngHour)%24+24)%24;
 const instant=new Date(Date.UTC(y,date.getMonth(),date.getDate())+ut*3600000);
 // Times calculated in UTC then displayed according to browser time zone.
 return instant.getHours()*60+instant.getMinutes();
}
function periodsForDay(d){const sunrise=solarMinutes(d,true),sunset=solarMinutes(d,false);let a=Math.max(0,Math.min(710,sunrise)),b=Math.max(730,Math.min(1440,sunset));return [
 {name:'Madrugada',start:0,end:a},{name:'Manhã',start:a,end:720},{name:'Tarde',start:720,end:b},{name:'Noite',start:b,end:1440}
]}
function timeAt(d,minutes){let o=startOfDay(d);o.setMinutes(minutes);return o}
function intersects(a,b,c,d){return a<d&&b>c}
function occurrenceStart(r,anchor){return new Date(`${anchor}T${r.startTime||'00:00'}:00`)}
function occurrenceEnd(r,anchor){let s=occurrenceStart(r,anchor),e=new Date(`${anchor}T${r.endTime||'00:00'}:00`);if(e<=s)e=plusDays(e,1);return e}
function cardForDay(day,view){const dayStr=iso(day),items=occurrencesForDay(day),selected=equalDay(day,state.date),today=equalDay(day,new Date());return `<article class="day-card ${selected?'selected':''} ${today?'today':''}" data-date="${dayStr}"><div class="day-top"><button class="day-num" data-action="select-day" data-date="${dayStr}" title="Abrir ${attr(readableDate(day))}">${day.getDate()}<span class="visually-hidden"> de ${MONTHS[day.getMonth()]}</span></button><button class="day-add" data-action="add-event" data-date="${dayStr}" aria-label="Adicionar atividade em ${attr(readableDate(day))}">+</button></div><div class="day-items">${dayItemsHtml(items,view==='year'?2:(view==='month'?4:18))}</div></article>`}
function weekdayHeader(){return `<div class="weekdays">${SHORT.map(s=>`<span class="weekday">${s}</span>`).join('')}</div>`}
function renderMonthGrid(month,view){let start=new Date(month.getFullYear(),month.getMonth(),1),last=new Date(month.getFullYear(),month.getMonth()+1,0);let blanks=start.getDay(),out=Array.from({length:blanks},()=>'<div class="day-card blank" aria-hidden="true"></div>');for(let i=1;i<=last.getDate();i++)out.push(cardForDay(new Date(month.getFullYear(),month.getMonth(),i),view));return `<div class="days-grid">${out.join('')}</div>`}
function renderYear(d){let y=d.getFullYear();let out=`<div class="year-area"><div class="year-hero">${y}</div>${weekdayHeader()}`;
 for(let m=0;m<12;m++){let cur=new Date(y,m,1);out+=`<section class="year-month" data-month="${m}"><h2 class="months-label">${MONTHS[m]}</h2>${renderMonthGrid(cur,'year')}</section>`}
 out+=`<p class="year-hint">${settings.edgeNavigate?'Puxe além da extremidade para mudar de ano.':'Use as setas para mudar de ano.'}</p></div>`;return out}
function renderMonth(d){return `<div class="month-view"><h2 class="month-head">${MONTHS[d.getMonth()]} ${d.getFullYear()}</h2>${weekdayHeader()}${renderMonthGrid(d,'month')}</div>`}
function renderWeek(d){const start=startOfWeek(d);let days=[];for(let i=0;i<7;i++){let date=plusDays(start,i);days.push(`<div class="week-date">${SHORT[i]}, ${shortDate(date)}</div>`)}let cards=[];for(let i=0;i<7;i++)cards.push(cardForDay(plusDays(start,i),'week'));
 return `<div class="week-view"><h2 class="month-head">${shortDate(start)} — ${shortDate(plusDays(start,6))}</h2>${weekdayHeader()}<div class="days-grid">${cards.join('')}</div><button class="timeline-toggle" data-action="toggle-timeline">${state.timeline?'Ocultar':'Mostrar'} linha do tempo da semana</button>${state.timeline?weekTimeline(start):''}</div>`}
function renderDay(d){let periods=periodsForDay(d),items=occurrencesForDay(d),out=`<div class="day-main"><div class="day-large-date">${readableDate(d)}</div><div class="day-subtitle">Nascer do sol ~ ${pad(Math.floor(solarMinutes(d,true)/60))}:${pad(solarMinutes(d,true)%60)} · Pôr do sol ~ ${pad(Math.floor(solarMinutes(d,false)/60))}:${pad(solarMinutes(d,false)%60)} ${settings.latitude===''?'(horários padrão)':'(estimativas astronômicas)'}</div><button class="timeline-toggle" data-action="toggle-timeline">${state.timeline?'Ocultar':'Mostrar'} linha do tempo</button>`;
 if(state.timeline)out+=dayTimeline(d);
 for(const p of periods){const s=timeAt(d,p.start),e=timeAt(d,p.end),list=items.filter(it=>intersects(it.start,it.end,s,e));out+=`<section class="day-period"><div class="period-head"><h3>${p.name}</h3><small>${tm(s)} – ${p.end===1440?'24:00':tm(e)}</small></div>${list.length?list.map(x=>eventLine(x,d)).join(''):'<div class="empty-period">Nenhuma atividade neste período.</div>'}</section>`;}
 return out+'</div>'}
function dayTimeline(day){const list=occurrencesForDay(day),html=[];for(let h=0;h<24;h+=2){const s=timeAt(day,h*60),e=timeAt(day,Math.min(1440,(h+2)*60));let events=list.filter(it=>intersects(it.start,it.end,s,e));html.push(`<div class="timeline-row"><span>${pad(h)}:00</span><div>${events.map(it=>`<div class="timeline-bar">${escaped(it.title)} · ${tm(it.start)}–${tm(it.end)}</div>`).join('')}</div></div>`)}return `<div class="timeline" aria-label="Linha do tempo de ${attr(readableDate(day))}">${html.join('')}</div>`}
function weekTimeline(start){let rows=[];for(let k=0;k<7;k++){let d=plusDays(start,k),list=occurrencesForDay(d);rows.push(`<div class="timeline-row"><span>${SHORT[k]}</span><div>${list.length?list.map(i=>`<div class="timeline-bar">${tm(i.start)} ${escaped(i.title)}</div>`).join(''):'<div class="subtle">Sem atividades</div>'}</div></div>`)}return `<div class="timeline">${rows.join('')}</div>`}
function renderReview(){const [s,e]=rangeForView(),step=state.view==='quarter'?3:6;let out=`<div class="review-page">${reviewBlock(state.view==='quarter'?'Revisão trimestral':'Revisão semestral',s,e)}<h2 class="months-label">Visão por mês</h2>`;for(let m=s.getMonth();m<e.getMonth()||(e.getFullYear()>s.getFullYear()&&m<12);m++){let cur=new Date(s.getFullYear(),m,1),next=new Date(s.getFullYear(),m+1,1);out+=reviewBlock(MONTHS[m],cur,next)}return out+'</div>'}
function renderCalendar(){if(state.page!=='calendar')return;let d=state.date,month=d.getMonth(),y=d.getFullYear();let title=state.view==='day'?shortDate(d):state.view==='week'?`${shortDate(startOfWeek(d))} — ${shortDate(plusDays(startOfWeek(d),6))}`:state.view==='month'?`${MONTHS[month]} ${y}`:state.view==='quarter'?`${Math.floor(month/3)+1}º tri. ${y}`:state.view==='half'?`${Math.floor(month/6)+1}º sem. ${y}`:String(y);
 $('#periodTitle').textContent=title;$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));let html=state.view==='day'?renderDay(d):state.view==='week'?renderWeek(d):state.view==='month'?renderMonth(d):state.view==='year'?renderYear(d):renderReview();$('#calendarContent').innerHTML=html;$('#calendarScroll').scrollTop=0;}
function showDialog(id){const el=$('#'+id);if(!el.open)el.showModal()}
function closeDialog(id){$('#'+id).close()}
function toggleDone(kind,id,anchor,done){if(kind==='event'){let e=state.db.events.find(x=>x.id===id);if(e)e.done=done;}else{let key=`${id}@${anchor}`;state.db.exceptions[key]={...state.db.exceptions[key],done};}save();refreshActive()}
function skipRoutine(id,anchor){if(!confirm(`Dispensar somente a ocorrência de ${anchor}? As demais semanas permanecem inalteradas.`))return;const key=`${id}@${anchor}`;state.db.exceptions[key]={...state.db.exceptions[key],skip:true};save();refreshActive()}
function refreshActive(){if(state.page==='calendar')renderCalendar();else if(state.page==='routines')renderRoutines();else if(state.page==='archive')renderArchive()}
async function downloadAttachment(id,name){
 try{let blob=await dbValue('attachments',id);
 if(!blob && driveConnection?.store){blob=await driveConnection.store.downloadAttachment(id);await dbValue('attachments',id,blob,true);}
 if(!blob)return toast('Anexo indisponível neste dispositivo. Conecte ao Drive ou restaure o arquivo original.');
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name||'anexo';a.click();setTimeout(()=>URL.revokeObjectURL(url),2500);
 }catch(err){toast('Não foi possível abrir o anexo.');console.warn(err)}
}
async function deleteArchive(){const id=$('#archiveForm').elements.id.value;let item=state.db.archive.find(x=>x.id===id);if(!item||!confirm('Excluir este material e seu anexo?'))return;state.db.archive=state.db.archive.filter(x=>x.id!==id);await save();if(item.attachment)dbDelete('attachments',item.attachment.id).catch(console.warn);closeDialog('archiveDialog');renderArchive()}
// Event delegation keeps dynamically generated controls functional.
document.addEventListener('click',async(ev)=>{
 const btn=ev.target.closest('[data-action]');if(!btn)return;
 switch(btn.dataset.action){
 case 'select-day':state.date=parseDate(btn.dataset.date);state.view='day';renderCalendar();break;
 case 'add-event':newEvent(parseDate(btn.dataset.date));break;
 case 'open-item':btn.dataset.kind==='routine'?openRoutineOccurrence(btn.dataset.id,btn.dataset.anchor,btn.dataset.slot):openEvent(btn.dataset.id);break;
 case 'skip-routine':skipRoutine(btn.dataset.id,btn.dataset.anchor);break;
 case 'toggle-timeline':state.timeline=!state.timeline;renderCalendar();break;
 case 'add-routine':newRoutine(Number(btn.dataset.weekday));break;
 case 'open-routine':openRoutine(btn.dataset.id);break;
 case 'open-archive':openArchive(btn.dataset.id);break;
 case 'download-attachment':downloadAttachment(btn.dataset.id,btn.dataset.name);break;
 }
});
document.addEventListener('change',(ev)=>{let el=ev.target;if(el.matches('[data-action="toggle-done"]'))toggleDone(el.dataset.kind,el.dataset.id,el.dataset.anchor,el.checked)});
$$('.nav-btn').forEach(b=>b.addEventListener('click',()=>selectPage(b.dataset.page)));
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;state.timeline=false;renderCalendar()}));
$('#toggleSidebar').addEventListener('click',()=>$('#sidebar').classList.toggle('collapsed'));
$('#prevPeriod').addEventListener('click',()=>movePeriod(-1));$('#nextPeriod').addEventListener('click',()=>movePeriod(1));
$('#goToday').addEventListener('click',()=>{state.date=startOfDay(new Date());selectPage('calendar')});
$('#addEvent').addEventListener('click',()=>newEvent());$('#addRoutine').addEventListener('click',()=>newRoutine());$('#addArchive').addEventListener('click',()=>newArchive());
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDialog(b.dataset.close)));
$('#eventForm').addEventListener('submit',e=>{e.preventDefault();saveEvent(e.currentTarget)});
$('#routineForm').addEventListener('submit',e=>{e.preventDefault();saveRoutine(e.currentTarget)});
$('#archiveForm').addEventListener('submit',async e=>{e.preventDefault();try{await saveArchive(e.currentTarget)}catch{toast('Não foi possível salvar o material.')}});
$('#deleteEvent').addEventListener('click',()=>{let id=$('#eventForm').elements.id.value;if(!confirm('Excluir esta atividade?'))return;state.db.events=state.db.events.filter(e=>e.id!==id);save();closeDialog('eventDialog');refreshActive()});
$('#deleteRoutine').addEventListener('click',()=>stopRoutine($('#routineForm').elements.id.value));
$('#deleteArchive').addEventListener('click',deleteArchive);
$('#archiveSearch').addEventListener('input',renderArchive);$('#archiveCategory').addEventListener('change',renderArchive);
// Settings are opt-in for audio and vibration; reduced motion is respected.
Object.keys(DEFAULTS).forEach(key=>{const id=key==='theme'?'themeSelect':key;const el=$('#'+id);if(!el)return;el.addEventListener(el.type==='checkbox'?'change':'input',()=>{settings[key]=el.type==='checkbox'?el.checked:el.value;settingSaved()})});
$('#exportData').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state.db,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`atlas-backup-${iso(new Date())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
$('#importData').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const obj=JSON.parse(await f.text());if(!validData(obj))throw Error('Formato de dados inválido');if(!confirm('Substituir os registros atuais pelos do arquivo? Exporte uma cópia antes de continuar.'))return;state.db=obj;await save();renderAll();toast('Dados importados. Anexos binários precisam ser copiados separadamente.')}catch(err){toast('Não foi possível importar: '+err.message)}e.target.value=''});
// Spring-like overscroll, with controlled year change and reduced-motion support.
let wheelTotal=0,wheelLast=0,pullTimer=null,changingYear=false,pullAmount=0;
function yearFeedback(direction){if(settings.vibrationOn&&'vibrate'in navigator)navigator.vibrate(35);
 if(settings.soundOn){try{const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){let ac=new Audio(),o=ac.createOscillator(),g=ac.createGain();o.type='sine';o.frequency.value=direction>0?540:420;g.gain.setValueAtTime(.035,ac.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+.12);o.connect(g).connect(ac.destination);o.start();o.stop(ac.currentTime+.12);o.onended=()=>ac.close()}}catch{}}
}
const scroller=$('#calendarScroll'),content=$('#calendarContent');
function pullVisual(direction,amount){if(settings.reduceMotion)return;content.style.transition='none';content.style.transform=`translateY(${Math.round(-direction*Math.min(80,Math.sqrt(Math.abs(amount))*5))}px)`;$('#edgeHint').textContent=direction<0?'Solte para voltar ao ano anterior':'Solte para avançar ao próximo ano'}
function clearPull(){pullAmount=0;wheelTotal=0;content.style.transition=settings.reduceMotion?'none':'transform .5s cubic-bezier(.18,1.35,.38,1)';content.style.transform='translateY(0)';clearTimeout(pullTimer);pullTimer=setTimeout(()=>{$('#edgeHint').textContent='';content.style.transition=''},620)}
function changeYear(direction){if(changingYear||!settings.edgeNavigate||state.view!=='year'||state.page!=='calendar')return;changingYear=true;
 const run=()=>{const y=state.date.getFullYear()+direction;state.date=new Date(y,direction<0?11:0,1);renderCalendar();const sc=$('#calendarScroll');sc.scrollTop=direction<0?sc.scrollHeight-sc.clientHeight:0;content.style.transform=settings.reduceMotion?'':'translateY('+ (direction<0?'-18px':'18px') +')';requestAnimationFrame(()=>{content.style.transition=settings.reduceMotion?'none':'transform .48s cubic-bezier(.18,1.35,.38,1)';content.style.transform='translateY(0)'});yearFeedback(direction);$('#edgeHint').textContent=`${direction<0?'Ano anterior':'Próximo ano'}: ${y}`;clearTimeout(pullTimer);pullTimer=setTimeout(()=>{$('#edgeHint').textContent='';changingYear=false;content.style.transition=''},600);pullAmount=0;wheelTotal=0};
 if(settings.reduceMotion)run();else{content.style.transition='transform .16s ease-out, opacity .16s ease-out';content.style.transform=`translateY(${direction<0?28:-28}px)`;content.style.opacity='.7';setTimeout(()=>{run();content.style.opacity='1'},160)}
}
function atBoundary(direction){return direction<0?scroller.scrollTop<=1:scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-2}
scroller.addEventListener('wheel',e=>{if(!settings.edgeNavigate||state.view!=='year'||state.page!=='calendar'||e.ctrlKey||changingYear)return;let dir=Math.sign(e.deltaY),time=Date.now();if(!dir)return;if(!atBoundary(dir)){if(pullAmount)clearPull();return}e.preventDefault();if(time-wheelLast>520||Math.sign(wheelTotal)!==dir)wheelTotal=0;wheelLast=time;wheelTotal+=Math.min(115,Math.max(-115,e.deltaY));pullAmount=wheelTotal;pullVisual(dir,wheelTotal);
 if(Math.abs(wheelTotal)>=240)changeYear(dir);else{clearTimeout(pullTimer);pullTimer=setTimeout(clearPull,240)}} ,{passive:false});
let touchY=0,touchLast=0,touchDirection=0,touchValid=false;
scroller.addEventListener('touchstart',e=>{touchY=e.touches[0].clientY;touchLast=touchY;touchDirection=0;touchValid=state.view==='year'&&state.page==='calendar'&&settings.edgeNavigate},{passive:true});
scroller.addEventListener('touchmove',e=>{if(!touchValid||changingYear)return;const y=e.touches[0].clientY,dy=touchY-y,dir=Math.sign(dy);touchLast=y;if(dir&&atBoundary(dir)){touchDirection=dir;pullAmount=dy;pullVisual(dir,dy)}else if(pullAmount)clearPull()},{passive:true});
scroller.addEventListener('touchend',()=>{if(!touchValid)return;if(touchDirection&&Math.abs(touchY-touchLast)>120&&atBoundary(touchDirection))changeYear(touchDirection);else clearPull();touchValid=false},{passive:true});
// Shortcuts are active outside inputs and dialogs only.
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;if(e.key==='ArrowLeft')movePeriod(-1);if(e.key==='ArrowRight')movePeriod(1)});
for(const dlg of $$('dialog'))dlg.addEventListener('click',ev=>{if(ev.target===dlg)dlg.close()});
// Atlas Organizer 1.4 — extensions. Compatible with the 1.3 record shape.
const PRIORITIES={low:1,normal:2,high:3,important:3,critical:4};
const PRIORITY_LABEL={low:'Baixa',normal:'Normal',high:'Alta',important:'Alta',critical:'Máxima'};
const priorityOf=x=>PRIORITIES[x?.importance]||2;
const normalizeText=s=>String(s||'').trim().replace(/\s+/g,' ');
const normKey=s=>normalizeText(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const dateOk=(s)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&iso(parseDate(s))===s;
const numericOrNull=s=>s===''||s===undefined||s===null?null:Number(s);
function importanceText(x){return PRIORITY_LABEL[x?.importance]||'Normal'}
function stars(score){if(score===null||score===undefined||score==='')return '';let n=Number(score);if(!Number.isFinite(n))return '';n=Math.max(0,Math.min(10,n));const sixth=Math.round(n*6)/6;return `<span class="stars" aria-label="Avaliação ${n.toLocaleString('pt-BR')} de 10">${Array.from({length:10},(_,i)=>{let portion=Math.max(0,Math.min(1,sixth-i))*100;return `<span class="star"><span class="star-empty">☆</span><span class="star-fill" style="width:${portion.toFixed(3)}%">★</span></span>`}).join('')}</span>`;}
function categories(){return [...new Map([...state.db.events,...state.db.routines,...state.db.archive].map(x=>normalizeText(x.category)).filter(Boolean).map(c=>[normKey(c),c])).values()].sort((a,b)=>a.localeCompare(b,'pt-BR'))}
function refreshCategories(){$('#categorySuggestions').innerHTML=categories().map(c=>`<option value="${attr(c)}"></option>`).join('')}
function canonicalCategory(input){const c=normalizeText(input);return categories().find(x=>normKey(x)===normKey(c))||c}
function categoryCheck(c){let values=categories();if(c&&!values.some(x=>normKey(x)===normKey(c))&&values.length){return confirm(`Criar a nova categoria “${c}”?\n\nCategorias existentes:\n${values.slice(0,20).join(', ')}\n\nEscolha Cancelar para reutilizar alguma delas.`)}return true}
function linkPicker(id,chosen=[]){const el=$('#'+id);el.innerHTML=state.db.archive.length?state.db.archive.map(a=>`<label class="link-option"><input type="checkbox" value="${attr(a.id)}" ${chosen.includes(a.id)?'checked':''}><span>${escaped(a.title)} <small>· ${escaped(a.category||'Sem categoria')}</small></span></label>`).join(''):'<span class="subtle">Adicione materiais ao Acervo para vinculá-los.</span>'}
function linkedIds(id){return $$('#'+id+' input:checked').map(x=>x.value)}
function linksFor(item){const ids=item.linkedArchiveIds||[];return ids.map(id=>state.db.archive.find(a=>a.id===id)).filter(Boolean).map(a=>`<button class="note-link" data-action="open-linked-archive" data-id="${attr(a.id)}">▤ ${escaped(a.title)}</button>`).join('')}
function addEventExtra(slot={}){let el=document.createElement('div');el.className='extra-slot';el.dataset.id=slot.id||uid();el.innerHTML=`<label>Início<input class="extra-start" type="datetime-local" value="${attr(slot.start||'')}" required></label><label>Fim<input class="extra-end" type="datetime-local" value="${attr(slot.end||'')}" required></label><button type="button" class="small-remove" data-action="remove-row" title="Remover data" aria-label="Remover data">×</button>`;$('#eventExtraRows').append(el)}
function eventSlots(ev){let base={id:'main',start:ev.start,end:ev.end};return [base,...(ev.extraDates||[])]}
function eventResult(ev,slotId){const record=ev.results?.[slotId];if(record)return record;return slotId==='main'&&ev.done?{status:'done'}:{status:'pending'}}
function slotStatus(kind,id,anchor,slotId){if(kind==='event'){let ev=state.db.events.find(x=>x.id===id);return ev?eventResult(ev,slotId||'main'):{status:'pending'}}return state.db.exceptions[`${id}@${anchor}${slotId&&slotId!=='legacy'?'#'+slotId:''}`]||{status:'pending'};}
function isDone(it){return it.status==='done'}
function isImportant(it){return priorityOf(it)>=3}
function newEvent(date=state.date){const f=$('#eventForm');f.reset();f.elements.id.value='';f.elements.start.value=`${iso(date)}T09:00`;f.elements.end.value=`${iso(date)}T10:00`;f.elements.importance.value='normal';$('#eventExtraRows').replaceChildren();refreshCategories();linkPicker('eventLinkedArchive');$('#eventDialogTitle').textContent='Nova atividade';$('#deleteEvent').classList.add('hidden');showDialog('eventDialog')}
function openEvent(id){const ev=state.db.events.find(x=>x.id===id);if(!ev)return;const f=$('#eventForm');f.reset();for(const key of ['id','title','start','end','category','importance','description'])f.elements[key].value=ev[key]||'';f.elements.reminderMinutes.value=ev.reminderMinutes??'';f.elements.importance.value=ev.importance==='important'?'high':ev.importance||'normal';$('#eventExtraRows').replaceChildren();(ev.extraDates||[]).forEach(addEventExtra);refreshCategories();linkPicker('eventLinkedArchive',ev.linkedArchiveIds||[]);$('#eventDialogTitle').textContent='Editar atividade';$('#deleteEvent').classList.remove('hidden');showDialog('eventDialog')}
function saveEvent(f){let v=Object.fromEntries(new FormData(f));if(!normalizeText(v.title))return toast('Informe um nome.');const slots=[{id:'main',start:v.start,end:v.end},...$$('#eventExtraRows .extra-slot').map(el=>({id:el.dataset.id,start:el.querySelector('.extra-start').value,end:el.querySelector('.extra-end').value}))];if(slots.some(x=>!x.start||!x.end||Number.isNaN(+new Date(x.start))||!(new Date(x.end)>new Date(x.start))))return toast('Confira os horários: cada fim precisa ser posterior ao início.');if(!categoryCheck(normalizeText(v.category)))return;const orig=state.db.events.find(x=>x.id===v.id);const results={...(orig?.results||{})};if(orig?.done&&!results.main)results.main={status:'done'};let ids=new Set(slots.map(x=>x.id));for(const key in results)if(!ids.has(key))delete results[key];const next={id:v.id||uid(),title:normalizeText(v.title),start:v.start,end:v.end,extraDates:slots.slice(1),category:canonicalCategory(v.category),importance:v.importance,description:normalizeText(v.description),linkedArchiveIds:linkedIds('eventLinkedArchive'),reminderMinutes:v.reminderMinutes,calendarLinks:orig?.calendarLinks||{},results,done:!!(results.main?.status==='done')};if(orig)Object.assign(orig,next);else state.db.events.push(next);save();closeDialog('eventDialog');refreshActive()}
function weekdaysOptions(selected=0){return WEEK.map((d,i)=>`<option value="${i}" ${Number(selected)===i?'selected':''}>${d}</option>`).join('')}
function addRoutineSlot(slot={}){let el=document.createElement('div');el.className='routine-slot';el.dataset.id=slot.id||uid();el.innerHTML=`<label class="slot-week">Dia da semana<select class="slot-weekday">${weekdaysOptions(slot.weekday??state.date.getDay())}</select></label><label>Início<input class="slot-start" type="time" value="${attr(slot.startTime||'08:00')}" required></label><label>Fim<input class="slot-end" type="time" value="${attr(slot.endTime||'09:00')}" required></label><button type="button" class="small-remove" data-action="remove-row" aria-label="Remover horário" title="Remover horário">×</button>`;$('#routineSlotRows').append(el);updateRoutineType()}
function addRoutineExtra(slot={}){let el=document.createElement('div');el.className='extra-slot';el.dataset.id=slot.id||uid();el.innerHTML=`<label>Início<input class="extra-start" type="datetime-local" value="${attr(slot.start||'')}" required></label><label>Fim<input class="extra-end" type="datetime-local" value="${attr(slot.end||'')}" required></label><button type="button" class="small-remove" data-action="remove-row" title="Remover data">×</button>`;$('#routineExtraRows').append(el)}
function routineSlots(r){return Array.isArray(r.slots)&&r.slots.length?r.slots:[{id:'legacy',weekday:Number(r.weekday)||0,startTime:r.startTime||'08:00',endTime:r.endTime||'09:00'}]}
function updateRoutineType(){let t=$('#routineType').value,annual=t!=='weekly';$('#annualOptions').classList.toggle('hidden',!annual);$$('.annual-fixed').forEach(e=>e.classList.toggle('hidden',t!=='annual_fixed'));$$('.annual-nth').forEach(e=>e.classList.toggle('hidden',t!=='annual_nth'));$$('.slot-week').forEach(e=>e.classList.toggle('hidden',annual));$('#routineSlotRows').dataset.annual=String(annual)}
function newRoutine(weekday=state.date.getDay()){const f=$('#routineForm');f.reset();f.elements.id.value='';f.elements.type.querySelector('option[value=annual_easter]')?.remove();f.elements.type.value='weekly';f.elements.effectiveFrom.value=iso(new Date());f.elements.until.value='';f.elements.importance.value='normal';$('#routineSlotRows').replaceChildren();$('#routineExtraRows').replaceChildren();addRoutineSlot({weekday});refreshCategories();linkPicker('routineLinkedArchive');$('#routineDialogTitle').textContent='Nova rotina';$('#deleteRoutine').classList.add('hidden');updateRoutineType();showDialog('routineDialog')}
function openRoutine(id){const r=state.db.routines.find(x=>x.id===id);if(!r)return;const f=$('#routineForm');f.reset();if(r.type==='annual_easter'&&!f.elements.type.querySelector('option[value=annual_easter]'))f.elements.type.add(new Option('Anual · Páscoa (registro legado)','annual_easter'));for(const key of ['id','title','type','importance','category','description','effectiveFrom','until','annualMonth','annualDay','nth','annualWeekday','easterOffset']){if(f.elements[key]&&r[key]!==undefined&&r[key]!==null)f.elements[key].value=String(r[key])}f.elements.type.value=r.type||'weekly';f.elements.importance.value=r.importance==='important'?'high':r.importance||'normal';f.elements.effectiveFrom.value=r.effectiveFrom||iso(new Date());$('#routineSlotRows').replaceChildren();$('#routineExtraRows').replaceChildren();routineSlots(r).forEach(addRoutineSlot);(r.additionalDates||[]).forEach(addRoutineExtra);refreshCategories();linkPicker('routineLinkedArchive',r.linkedArchiveIds||[]);$('#routineDialogTitle').textContent='Editar rotina';$('#deleteRoutine').classList.remove('hidden');updateRoutineType();showDialog('routineDialog')}
function saveRoutine(f){const v=Object.fromEntries(new FormData(f)),today=iso(new Date());if(!normalizeText(v.title))return toast('Informe um nome.');if(!dateOk(v.effectiveFrom)||v.until&&(!dateOk(v.until)||v.until<v.effectiveFrom))return toast('Confira o início e o fim da vigência.');const slots=$$('#routineSlotRows .routine-slot').map(el=>({id:el.dataset.id,weekday:Number(el.querySelector('.slot-weekday').value),startTime:el.querySelector('.slot-start').value,endTime:el.querySelector('.slot-end').value}));if(!slots.length||slots.some(x=>!x.startTime||!x.endTime))return toast('Adicione pelo menos um horário válido.');if(v.type!=='weekly'&&slots.length!==1)return toast('Uma rotina anual usa um horário. Use datas adicionais para outros encontros.');const additionalDates=$$('#routineExtraRows .extra-slot').map(el=>({id:el.dataset.id,start:el.querySelector('.extra-start').value,end:el.querySelector('.extra-end').value}));if(additionalDates.some(x=>!x.start||!x.end||!(new Date(x.end)>new Date(x.start))))return toast('Confira as datas adicionais.');if(additionalDates.some(x=>x.start.slice(0,10)<v.effectiveFrom||(v.until&&x.start.slice(0,10)>v.until)))return toast('Datas adicionais precisam estar dentro da vigência da rotina.');if(new Set(slots.map(x=>`${x.weekday}/${x.startTime}/${x.endTime}`)).size!==slots.length)return toast('Existem horários recorrentes duplicados.');if(v.type==='annual_fixed'){let d=new Date(2024,Number(v.annualMonth)-1,Number(v.annualDay));if(d.getMonth()!==Number(v.annualMonth)-1||d.getDate()!==Number(v.annualDay))return toast('Dia anual inválido para o mês.')}if(!categoryCheck(normalizeText(v.category)))return;let orig=state.db.routines.find(x=>x.id===v.id);const data={title:normalizeText(v.title),type:v.type,effectiveFrom:v.effectiveFrom,until:v.until||'',slots,additionalDates,importance:v.importance,category:canonicalCategory(v.category),description:normalizeText(v.description),linkedArchiveIds:linkedIds('routineLinkedArchive'),annualMonth:Number(v.annualMonth),annualDay:Number(v.annualDay),nth:Number(v.nth),annualWeekday:Number(v.annualWeekday),easterOffset:Number(v.easterOffset??orig?.easterOffset??0)};
if(orig){const dateChanged=v.effectiveFrom>orig.effectiveFrom||orig.effectiveFrom<today;const cutoff=v.effectiveFrom; // historical rule preserved until day before the new version begins
 if(dateChanged&&cutoff>orig.effectiveFrom){const prev=iso(plusDays(parseDate(cutoff),-1));if(!orig.until||orig.until>prev)orig.until=prev;state.db.routines.push({id:uid(),...data});}
 else if((orig.effectiveFrom||today)<today){toast('Para preservar o histórico, escolha uma nova data de início posterior ao início atual.');return}
 else Object.assign(orig,data);
}else state.db.routines.push({id:uid(),...data});save();closeDialog('routineDialog');refreshActive()}
// Gregorian computus: Easter cannot be defined by "nth weekday of month".
function easter(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7,m=Math.floor((a+11*h+22*l)/451),x=h+l-7*m+114;return new Date(y,Math.floor(x/31)-1,(x%31)+1)}
function nthDate(y,month,day,n){if(n===-1){const end=new Date(y,month,0);return plusDays(end,-((end.getDay()-day+7)%7))}let first=new Date(y,month-1,1),target=plusDays(first,(day-first.getDay()+7)%7+7*(n-1));return target.getMonth()===month-1?target:null}
function annualDay(r,y){if(r.type==='annual_fixed'){let day=new Date(y,(r.annualMonth||1)-1,r.annualDay||1);return day.getMonth()===(r.annualMonth||1)-1?day:null}if(r.type==='annual_nth')return nthDate(y,r.annualMonth||1,r.annualWeekday||0,r.nth||1);if(r.type==='annual_easter')return plusDays(easter(y),r.easterOffset||0);return null}
function recurrenceAt(r,day){const target=iso(day);if(r.effectiveFrom&&target<r.effectiveFrom||r.until&&target>r.until)return [];let result=[];const type=r.type||'weekly';if(type==='weekly'){for(const sl of routineSlots(r))if(sl.weekday===day.getDay())result.push(sl)}else {const annual=annualDay(r,day.getFullYear());if(annual&&iso(annual)===target)result.push(routineSlots(r)[0]); // Easter offsets can move across New Year
 else if(type==='annual_easter'){const prev=annualDay(r,day.getFullYear()-1),next=annualDay(r,day.getFullYear()+1);if([prev,next].some(d=>d&&iso(d)===target))result.push(routineSlots(r)[0])}}
return result}
function occurrenceFor(r,day,sl){const anchor=iso(day);if(r.effectiveFrom&&anchor<r.effectiveFrom||r.until&&anchor>r.until)return null;sl=sl||routineSlots(r)[0];let start=new Date(`${anchor}T${sl.startTime||'00:00'}:00`),end=new Date(`${anchor}T${sl.endTime||'00:00'}:00`);if(end<=start)end=plusDays(end,1);let slotId=sl.id||'legacy',key=`${r.id}@${anchor}${slotId==='legacy'?'':'#'+slotId}`,ex=state.db.exceptions[key]||{};const status=ex.status|| (ex.skip?'dismissed':ex.done?'done':'pending');const ov=ex.override||{};
 if(ov.startTime&&ov.endTime){start=new Date(`${anchor}T${ov.startTime}:00`);end=new Date(`${anchor}T${ov.endTime}:00`);if(end<=start)end=plusDays(end,1)}
 return {kind:'routine',id:r.id,key,anchor,slotId,title:ov.title||r.title||'Rotina',description:ov.description??r.description??'',importance:ov.importance||r.importance||'normal',category:ov.category??r.category??'',linkedArchiveIds:ov.linkedArchiveIds||r.linkedArchiveIds||[],start,end,status,result:ex,done:status==='done',origin:r}}
function routineExceptionKey(id,anchor,slotId){return `${id}@${anchor}${slotId==='legacy'?'':'#'+slotId}`}
function occurrenceInstance(r,anchor,slotId){
 const day=parseDate(anchor),slot=routineSlots(r).find(s=>s.id===slotId)||(r.additionalDates||[]).find(s=>s.id===slotId);
 if(!slot)return null;
 const extra=(r.additionalDates||[]).some(s=>s.id===slotId);
 return extra?routineInstancesInRange(startOfDay(day),plusDays(day,2)).find(it=>it.id===r.id&&it.anchor===anchor&&it.slotId===slotId):occurrenceFor(r,day,slot);
}
function openRoutineOccurrence(id,anchor,slotId){
 const r=state.db.routines.find(x=>x.id===id);if(!r||!dateOk(anchor))return toast('Encontro não encontrado.');
 const slot=slotId||routineSlots(r)[0]?.id||'legacy',occ=occurrenceInstance(r,anchor,slot);
 if(!occ)return toast('Encontro não encontrado nesta data.');
 const f=$('#occurrenceForm');f.reset();
 f.elements.id.value=id;f.elements.anchor.value=anchor;f.elements.slotId.value=slot;
 for(const k of ['title','description','category','importance'])f.elements[k].value=occ[k]||'';
 f.elements.startTime.value=tm(occ.start);f.elements.endTime.value=tm(occ.end);
 refreshCategories();linkPicker('occurrenceLinkedArchive',occ.linkedArchiveIds||[]);f.elements.reminderMinutes.value=(state.db.exceptions[routineExceptionKey(id,anchor,slot)]||{}).reminderMinutes??'';
 $('#occurrenceContext').textContent=`${anchor.split('-').reverse().join('/')} • ${r.title} • Alterações exclusivas deste encontro`;
 showDialog('occurrenceDialog');
}
function saveRoutineOccurrence(form){
 const v=Object.fromEntries(new FormData(form)),r=state.db.routines.find(x=>x.id===v.id);
 if(!r||!dateOk(v.anchor)||!/^\d{2}:\d{2}$/.test(v.startTime)||!/^\d{2}:\d{2}$/.test(v.endTime)||!normalizeText(v.title))return toast('Informe nome e horários válidos.');
 if(!categoryCheck(normalizeText(v.category)))return;
 const key=routineExceptionKey(v.id,v.anchor,v.slotId),old=state.db.exceptions[key]||{};
 state.db.exceptions[key]={...old,reminderMinutes:v.reminderMinutes,override:{title:normalizeText(v.title),description:normalizeText(v.description),category:canonicalCategory(v.category),importance:v.importance,startTime:v.startTime,endTime:v.endTime,linkedArchiveIds:linkedIds('occurrenceLinkedArchive')}};
 save();closeDialog('occurrenceDialog');refreshActive();toast('Somente este encontro foi atualizado.');
}
function resetRoutineOccurrence(){const f=$('#occurrenceForm'),v=Object.fromEntries(new FormData(f)),key=routineExceptionKey(v.id,v.anchor,v.slotId);if(!confirm('Restaurar os dados originais deste encontro? A situação e a avaliação serão mantidas.'))return;const ex=state.db.exceptions[key];if(ex){delete ex.override;save()}closeDialog('occurrenceDialog');refreshActive()}
function eventInstancesInRange(start,end){const out=[];for(const ev of state.db.events){for(const sl of eventSlots(ev)){const a=new Date(sl.start),b=new Date(sl.end);if(!Number.isFinite(+a)||!Number.isFinite(+b)||!intersects(a,b,start,end))continue;let result=eventResult(ev,sl.id);out.push({kind:'event',...ev,start:a,end:b,slotId:sl.id,anchor:iso(a),status:result.status||'pending',result,done:result.status==='done'})}}return out}
function routineInstancesInRange(start,end){const result=[];for(const r of state.db.routines){for(let day=plusDays(start,-1);day<end;day=plusDays(day,1)){for(const slot of recurrenceAt(r,day)){let occ=occurrenceFor(r,day,slot);if(occ&&intersects(occ.start,occ.end,start,end))result.push(occ)}}for(const sl of r.additionalDates||[]){const a=new Date(sl.start),b=new Date(sl.end);if(!Number.isFinite(+a)||!Number.isFinite(+b)||!intersects(a,b,start,end))continue;let anchor=iso(a),key=`${r.id}@${anchor}#${sl.id}`,ex=state.db.exceptions[key]||{},status=ex.status||(ex.skip?'dismissed':ex.done?'done':'pending');const ov=ex.override||{};let s=a,e=b;if(ov.startTime&&ov.endTime){s=new Date(`${anchor}T${ov.startTime}:00`);e=new Date(`${anchor}T${ov.endTime}:00`);if(e<=s)e=plusDays(e,1)}if(!intersects(s,e,start,end))continue;
 result.push({kind:'routine',id:r.id,anchor,key,slotId:sl.id,title:ov.title||r.title,category:ov.category??r.category,importance:ov.importance||r.importance,description:ov.description??r.description,linkedArchiveIds:ov.linkedArchiveIds||r.linkedArchiveIds,start:s,end:e,status,result:ex,done:status==='done',origin:r})}}return result}
function periodOccurrences(start,end){return [...eventInstancesInRange(start,end),...routineInstancesInRange(start,end)].sort((a,b)=>a.start-b.start||priorityOf(b)-priorityOf(a))}
function occurrencesForDay(day){return periodOccurrences(startOfDay(day),plusDays(startOfDay(day),1)).sort((a,b)=>a.start-b.start||priorityOf(b)-priorityOf(a))}
function dayItemsHtml(items,max=4){let out=items.slice(0,max).map(it=>`<button class="event-chip ${it.kind==='routine'?'routine':''} ${it.done?'done':''} ${it.status==='missed'?'missed':''} ${it.status==='dismissed'?'dismissed':''} ${isImportant(it)?'important':''}" data-action="open-item" data-kind="${it.kind}" data-id="${attr(it.id)}" data-anchor="${attr(it.anchor||'')}" data-slot="${attr(it.slotId||'main')}" title="${attr(tm(it.start))} · ${attr(it.title)} · ${importanceText(it)}">${priorityOf(it)>=4?'◆ ':priorityOf(it)>=3?'★ ':''}${tm(it.start)} ${escaped(it.title)}</button>`).join('');if(items.length>max)out+=`<span class="extra-num">+${items.length-max} atividades</span>`;return out}
function eventLine(it){let detail=it.category||'Sem categoria';let dates=!(equalDay(it.start,it.end))?' ↗':'';return `<div class="detail-event"><span class="time">${tm(it.start)}–${tm(it.end)}${dates}</span><div class="event-description"><button class="title-button" data-action="open-item" data-kind="${it.kind}" data-id="${attr(it.id)}" data-anchor="${attr(it.anchor)}" data-slot="${attr(it.slotId||'main')}">${priorityOf(it)>=4?'◆ ':isImportant(it)?'★ ':''}${escaped(it.title)} <small class="subtle">· ${importanceText(it)}</small><div class="subtitle">${escaped(detail)} · ${escaped(it.description||'').slice(0,140)}</div></button><div>${linksFor(it)}${it.result?.rating!==undefined&&it.result.rating!==null?stars(it.result.rating):''}</div></div><button type="button" class="status-pill status-${attr(it.status)}" data-action="open-status" data-kind="${it.kind}" data-id="${attr(it.id)}" data-anchor="${attr(it.anchor)}" data-slot="${attr(it.slotId||'main')}">${{done:'Concluída',missed:'Não realizada',dismissed:'Dispensada',pending:'Situação / avaliação'}[it.status]||'Situação / avaliação'}</button></div>`}
function statusForOutcome(kind,id,anchor,slotId){if(kind==='event'){const ev=state.db.events.find(x=>x.id===id);return ev?eventResult(ev,slotId):{status:'pending'}}let key=`${id}@${anchor}${slotId==='legacy'?'':'#'+slotId}`;return state.db.exceptions[key]||{status:'pending'}}
function updateOutcomeFields(){const f=$('#outcomeForm'),status=f.elements.status.value;$('#reasonLabel').classList.toggle('hidden',status==='pending');$('#assessmentFields').classList.toggle('hidden',status!=='done');f.elements.reason.required=['missed','dismissed'].includes(status);let r=f.elements.rating.value;$('#ratingPreview').innerHTML=r!==''?`${stars(r)} <small>${Number(r).toLocaleString('pt-BR')}/10</small>`:''}
function openOutcome(kind,id,anchor,slotId){let it=kind==='event'?state.db.events.find(x=>x.id===id):state.db.routines.find(x=>x.id===id);if(!it)return;const f=$('#outcomeForm');f.reset();for(const k of ['kind','id','anchor','slotId'])f.elements[k].value=({kind,id,anchor,slotId})[k]||'';let data=statusForOutcome(kind,id,anchor,slotId);for(const k of ['status','reason','rating','difficulty','performance','evaluationNotes']){if(data[k]!==undefined&&data[k]!==null)f.elements[k].value=data[k]}$('#outcomeContext').textContent=`${it.title} • ${anchor} • ${it.category||'Sem categoria'}`;updateOutcomeFields();showDialog('outcomeDialog')}
function saveOutcome(form){let v=Object.fromEntries(new FormData(form));if(['missed','dismissed'].includes(v.status)&&!normalizeText(v.reason))return toast('Informe uma justificativa para uma atividade não realizada ou dispensada.');for(const k of ['rating','difficulty','performance'])if(v[k]!==''&&(!Number.isFinite(Number(v[k]))||Number(v[k])<0||Number(v[k])>10))return toast('As avaliações devem estar entre 0 e 10.');let data={status:v.status,reason:normalizeText(v.reason),rating:numericOrNull(v.rating),difficulty:numericOrNull(v.difficulty),performance:numericOrNull(v.performance),evaluationNotes:normalizeText(v.evaluationNotes),updatedAt:new Date().toISOString()};if(v.status==='pending')data={status:'pending',updatedAt:data.updatedAt};if(v.kind==='event'){let e=state.db.events.find(x=>x.id===v.id);if(!e)return;e.results||={};e.results[v.slotId]=data;if(v.slotId==='main')e.done=v.status==='done'}else{const key=`${v.id}@${v.anchor}${v.slotId==='legacy'?'':'#'+v.slotId}`;state.db.exceptions[key]={...(state.db.exceptions[key]||{}),...data}}save();closeDialog('outcomeDialog');refreshActive()}
function summaryStats(start,end){let it=periodOccurrences(start,end),clock=new Date(),completed=it.filter(x=>x.status==='done'),missed=it.filter(x=>x.status==='missed'),dismissed=it.filter(x=>x.status==='dismissed'),overdue=it.filter(x=>x.status==='pending'&&x.end<clock),upcoming=it.filter(x=>x.status==='pending'&&x.end>=clock),important=it.filter(x=>isImportant(x));return {it,completed,missed,dismissed,overdue,upcoming,important}}
const STOPWORDS=new Set('sobre entre depois antes para pela pelas pelos como quando onde esse essa este esta estão serão será tenho tendo fazer mesmo muito mais menos minha meu seus suas cada atividades atividade aquele aquela porque comigo todos todas alguns algumas dentro então houve pela ainda outra outro esse nessa nisso suas hoje trabalho curso aula escola dia semana aula dia data horas horário estar estudar estudo minha tenho fui sido projeto material livros exercícios'.split(' '));
function keyPhrases(items){let words=new Map();for(let v of items){let str=[v.title,v.description,v.result?.reason,v.result?.evaluationNotes].join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');for(let w of str.match(/[a-z]{4,}/g)||[]){if(STOPWORDS.has(w))continue;words.set(w,(words.get(w)||0)+1)}}return [...words].sort((a,b)=>b[1]-a[1]).slice(0,6).filter(([,n])=>n>1).map(([w])=>w)}
function periodSummary(stats){const {it,completed,missed,dismissed,overdue,upcoming}=stats;if(!it.length)return 'Não há compromissos registrados neste período.';
 let lines=[`Foram registradas ${it.length} ocorrências: ${completed.length} concluídas, ${missed.length} não realizadas com justificativa, ${dismissed.length} dispensadas/canceladas, ${overdue.length} vencidas sem situação informada e ${upcoming.length} pendentes futuras.`];
 const byCategory=new Map();for(const x of it){let key=x.category||'Sem categoria';if(!byCategory.has(key))byCategory.set(key,{all:0,problems:[],completed:[],dismissed:[],priority:0});const g=byCategory.get(key);g.all++;g.priority=Math.max(g.priority,priorityOf(x));if(x.status==='missed'||x.status==='pending'&&x.end<new Date())g.problems.push(x);if(x.status==='done')g.completed.push(x);if(x.status==='dismissed')g.dismissed.push(x)}
 const ordered=[...byCategory].sort((a,b)=>b[1].priority-a[1].priority||b[1].problems.length-a[1].problems.length);for(const [cat,g] of ordered.slice(0,4)){let phr=`${cat}: ${g.completed.length} concluídas, ${g.problems.length} não realizadas ou vencidas sem registro, ${g.dismissed.length} canceladas/dispensadas.`;const sample=g.problems.find(x=>x.description||x.result?.reason);if(sample)phr+=` Exemplo: ${sample.title}${sample.result?.reason?' — justificativa: '+sample.result.reason.slice(0,130):sample.description?' — '+sample.description.slice(0,130):''}.`;if(g.problems.length>=2&&g.problems.length>=g.completed.length)phr+=' Vale revisar os obstáculos dessa área e ajustar o planejamento.';lines.push(phr)}
 const ratings=completed.filter(x=>x.result?.rating!==undefined&&x.result.rating!==null);if(ratings.length){let avg=ratings.reduce((sum,x)=>sum+Number(x.result.rating),0)/ratings.length;lines.push(`Avaliação média das ${ratings.length} ocorrências avaliadas: ${avg.toFixed(1).replace('.',',')}/10.`)}const themes=keyPhrases(it);if(themes.length)lines.push(`Assuntos recorrentes nos títulos, descrições e justificativas: ${themes.join(', ')}.`);let notes=it.filter(x=>x.result?.evaluationNotes).sort((a,b)=>priorityOf(b)-priorityOf(a)).slice(0,2);if(notes.length)lines.push(`Observações nas avaliações: ${notes.map(x=>`${x.title}: ${x.result.evaluationNotes.slice(0,140)}`).join('; ')}.`);return lines.join('\n')}
function reviewBlock(title,start,end){const stats=summaryStats(start,end),ordered=x=>[...x].sort((a,b)=>priorityOf(b)-priorityOf(a)||a.start-b.start),list=(items,empty)=>items.length?ordered(items).slice(0,8).map(i=>`<li><span class="priority-label">${importanceText(i)}</span> ${escaped(i.title)} <small class="subtle">(${shortDate(i.start)})</small>${i.result?.reason?`<div class="subtle">Motivo: ${escaped(i.result.reason.slice(0,140))}</div>`:''}</li>`).join(''):`<li class="subtle">${empty}</li>`;return `<section class="review-card"><h2 class="review-title">${escaped(title)}</h2><div class="review-stat-row">${[['Concluídas',stats.completed.length],['Não realizadas',stats.missed.length],['Canceladas',stats.dismissed.length],['Vencidas sem registro',stats.overdue.length],['Pendentes futuras',stats.upcoming.length]].map(([name,num])=>`<div class="review-stat"><strong>${num}</strong><span>${name}</span></div>`).join('')}</div><div class="review-columns"><div><h3>Maior prioridade</h3><ul>${list(stats.important,'Nenhuma prioritária.')}</ul></div><div><h3>Não realizadas ou vencidas</h3><ul>${list([...stats.missed,...stats.overdue],'Nenhuma registrada.')}</ul></div><div><h3>Concluídas e avaliadas</h3><ul>${list(stats.completed,'Nenhuma registrada.')}</ul></div></div><div class="review-summary"><strong>Análise descritiva local</strong><p>${escaped(periodSummary(stats)).replace(/\n/g,'<br>')}</p></div><p class="hint">Análise automática baseada nas descrições, prioridades, resultados e justificativas. Não utiliza modelo generativo e não pressupõe que compromissos vencidos foram esquecidos.</p></section>`}
function renderRoutines(){const today=iso(new Date()),groups={past:[],current:[],future:[]};for(const r of state.db.routines){let from=r.effectiveFrom||today,until=r.until||'9999-12-31',k=until<today?'past':from>today?'future':'current';groups[k].push(r)}const renderGroup=(key,label)=>`<section class="routine-status-block"><h3>${label} <span class="subtle">(${groups[key].length})</span></h3>${groups[key].length?`<div class="routine-collection">${groups[key].sort((a,b)=>(a.effectiveFrom||'').localeCompare(b.effectiveFrom||'')).map(r=>`<button class="routine-entry" data-action="open-routine" data-id="${attr(r.id)}"><span><b>${escaped(r.title)}</b> <small class="priority-label">${importanceText(r)}</small></span><small>${{weekly:'Semanal',annual_fixed:'Anual · data fixa',annual_nth:'Anual · data dinâmica',annual_easter:'Anual · Páscoa'}[r.type||'weekly']} · ${escaped(r.category||'Sem categoria')}</small><small>${r.effectiveFrom||'Sem data'} — ${r.until||'sem término'}</small><small>${(r.type||'weekly')==='weekly'?routineSlots(r).map(s=>`${SHORT[s.weekday]} ${s.startTime}–${s.endTime}`).join(' • '):`${routineSlots(r)[0].startTime}–${routineSlots(r)[0].endTime}`}</small></button>`).join('')}</div>`:'<p class="subtle">Nenhuma rotina.</p>'}</section>`;$('#routinesContent').innerHTML=`<div class="routine-overview">${renderGroup('current','Atuais')}${renderGroup('future','Futuras')}${renderGroup('past','Passadas')}</div>`}
function stopRoutine(id){let r=state.db.routines.find(x=>x.id===id);if(!r)return;if(!confirm('Encerrar futuras ocorrências desta rotina? O histórico será preservado.'))return;let today=iso(new Date()),yesterday=iso(plusDays(parseDate(today),-1));if(r.effectiveFrom>=today){state.db.routines=state.db.routines.filter(x=>x.id!==id)}else r.until=yesterday;save();closeDialog('routineDialog');refreshActive()}
function newArchive(){let f=$('#archiveForm');f.reset();f.elements.id.value='';$('#archiveDialogTitle').textContent='Novo material';$('#currentAttachment').textContent='';$('#deleteArchive').classList.add('hidden');refreshCategories();showDialog('archiveDialog')}
function openArchive(id){let item=state.db.archive.find(x=>x.id===id);if(!item)return;let f=$('#archiveForm');f.reset();for(const k of ['id','title','type','category','topic','tags','notes','link','importance','difficulty','rating'])if(item[k]!==undefined&&item[k]!==null)f.elements[k].value=String(item[k]);$('#currentAttachment').textContent=item.attachment?`Arquivo anexado: ${item.attachment.name} (${Math.round(item.attachment.size/1024)} KB)`:'Nenhum anexo.';$('#deleteArchive').classList.remove('hidden');$('#archiveDialogTitle').textContent='Editar material';refreshCategories();showDialog('archiveDialog')}
async function saveArchive(f){let v=Object.fromEntries(new FormData(f)),orig=state.db.archive.find(x=>x.id===v.id);if(!normalizeText(v.title))return toast('Informe um título.');if(v.link&&!/^https?:\/\//i.test(v.link))return toast('O link deve começar com http:// ou https://.');for(const k of ['difficulty','rating'])if(v[k]!==''&&(!Number.isFinite(Number(v[k]))||Number(v[k])<0||Number(v[k])>10))return toast('Dificuldade e avaliação devem estar entre 0 e 10.');if(!categoryCheck(normalizeText(v.category)))return;let attachment=orig?.attachment||null;const file=f.elements.file.files[0];if(file){if(file.size>20*1024*1024)return toast('O anexo deve ter no máximo 20 MB.');const id=uid();await dbValue('attachments',id,file,true);attachment={id,name:file.name,size:file.size,type:file.type,local:true}}
let item={id:v.id||uid(),title:normalizeText(v.title),type:v.type,category:canonicalCategory(v.category),topic:normalizeText(v.topic),tags:normalizeText(v.tags),notes:v.notes.trim(),link:v.link.trim(),attachment,importance:v.importance,difficulty:numericOrNull(v.difficulty),rating:numericOrNull(v.rating),createdAt:orig?.createdAt||new Date().toISOString()};if(orig)Object.assign(orig,item);else state.db.archive.push(item);await save();closeDialog('archiveDialog');renderArchive()}
function renderArchive(){const cat=$('#archiveCategory'),old=cat.value,cats=[...new Set(state.db.archive.map(x=>x.category||'Sem categoria'))].sort((a,b)=>a.localeCompare(b,'pt-BR'));cat.innerHTML='<option value="">Todas as categorias</option>'+cats.map(x=>`<option value="${attr(x)}">${escaped(x)}</option>`).join('');cat.value=cats.includes(old)?old:'';const search=normKey($('#archiveSearch').value),category=cat.value,order=$('#archiveSort').value,items=state.db.archive.filter(v=>(!category||(v.category||'Sem categoria')===category)&&normKey([v.title,v.topic,v.category,v.tags,v.notes].join(' ')).includes(search));const numSort=(key,a,b)=>{let av=a[key],bv=b[key];if(av===null||av===undefined||av==='')return bv===null||bv===undefined||bv===''?0:1;if(bv===null||bv===undefined||bv==='')return -1;return Number(bv)-Number(av)};items.sort((a,b)=>['rating','difficulty'].includes(order)?numSort(order,a,b)||a.title.localeCompare(b.title,'pt-BR'):order==='importance'?((a.importance?0:1)-(b.importance?0:1))||priorityOf(b)-priorityOf(a)||a.title.localeCompare(b.title,'pt-BR'):(String(a[order]||'')?0:1)-(String(b[order]||'')?0:1)||String(a[order]||'').localeCompare(String(b[order]||''),'pt-BR')||a.title.localeCompare(b.title,'pt-BR'));
const byCat=new Map();for(const v of items){let key=v.category||'Sem categoria';if(!byCat.has(key))byCat.set(key,[]);byCat.get(key).push(v)}$('#archiveContent').innerHTML=items.length?[...byCat].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR')).map(([name,arr])=>`<details class="archive-drawer" open><summary><span class="drawer-handle">▤</span><strong>${escaped(name)}</strong><span class="drawer-count">${arr.length} ${arr.length===1?'material':'materiais'}</span><span class="drawer-edge">▾</span></summary><div class="archive-grid">${arr.map(v=>`<article class="archive-card"><div><span class="eyebrow">${escaped(v.type||'Material')}</span><h3>${escaped(v.title)}</h3><p>${escaped(v.topic||'')}</p></div><p>${escaped((v.notes||'').slice(0,160))}${(v.notes||'').length>160?'…':''}</p><div>${(v.tags||'').split(',').filter(Boolean).map(x=>`<span class="archive-tag">${escaped(x.trim())}</span>`).join('')}</div><div class="archive-eval">${v.importance?`<span>${importanceText(v)}</span>`:''}${v.difficulty!==null&&v.difficulty!==undefined?`<span>Dificuldade ${v.difficulty}/10</span>`:''}${v.rating!==null&&v.rating!==undefined?stars(v.rating):''}</div><footer><button data-action="open-archive" data-id="${attr(v.id)}">Editar</button>${v.link?`<a href="${attr(v.link)}" target="_blank" rel="noopener noreferrer">Abrir link ↗</a>`:''}${v.attachment?`<button data-action="download-attachment" data-id="${attr(v.attachment.id)}" data-name="${attr(v.attachment.name)}">Anexo ↓</button>`:''}</footer></article>`).join('')}</div></details>`).join(''):'<p>Nenhum material corresponde aos filtros selecionados.</p>'}
function icsEscape(v){return String(v??'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')}
function icsStamp(date){return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`}
function icsFold(line){const encoder=new TextEncoder();let out=[],current='',size=0;for(const ch of line){let n=encoder.encode(ch).length;if(size+n>75){out.push(current);current=' ';size=1}current+=ch;size+=n}out.push(current);return out.join('\r\n')}
function buildIcs(year,alarm=false){
 const from=new Date(year,0,1),until=new Date(year+1,0,1),list=periodOccurrences(from,until).filter(it=>it.start<until&&it.end>from);
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Atlas Organizer//1.5//PT-BR','CALSCALE:GREGORIAN','X-WR-CALNAME:Atlas Organizer'];
 for(const it of list){const uidKey=`${it.kind}-${it.id}-${it.anchor}-${it.slotId||'main'}`.replace(/[^a-zA-Z0-9_.-]/g,'_');
 lines.push('BEGIN:VEVENT',`UID:${uidKey}@atlas.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART:${icsStamp(it.start)}`,`DTEND:${icsStamp(it.end)}`,`SUMMARY:${icsEscape(it.title)}`,`DESCRIPTION:${icsEscape([it.description||'',`Categoria: ${it.category||'Sem categoria'}`,`Prioridade: ${importanceText(it)}`].join('\n'))}`,`STATUS:${it.status==='dismissed'?'CANCELLED':'CONFIRMED'}`);
 if(alarm){lines.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:Lembrete do Atlas Organizer','TRIGGER:-PT15M','END:VALARM')}
 lines.push('END:VEVENT');
 }
 lines.push('END:VCALENDAR');return lines.map(icsFold).join('\r\n')+'\r\n';
}

// Interactive controls are added without replacing the 1.3 navigation handlers.
document.addEventListener('click',ev=>{let b=ev.target.closest('[data-action]');if(!b)return;switch(b.dataset.action){case 'extra-event':addEventExtra();break;case 'extra-routine-slot':addRoutineSlot();break;case 'extra-routine-date':addRoutineExtra();break;case 'remove-row':b.closest('.extra-slot,.routine-slot')?.remove();break;case 'open-status':openOutcome(b.dataset.kind,b.dataset.id,b.dataset.anchor,b.dataset.slot);break;case 'open-linked-archive':$$('dialog[open]').forEach(d=>d.close());selectPage('archive');openArchive(b.dataset.id);break;}});
$('#routineType').addEventListener('change',updateRoutineType);
$('#outcomeStatus').addEventListener('change',updateOutcomeFields);
$('#outcomeForm').elements.rating.addEventListener('input',updateOutcomeFields);
$('#outcomeForm').addEventListener('submit',ev=>{ev.preventDefault();saveOutcome(ev.currentTarget)});
$('#archiveSort').addEventListener('change',renderArchive);

$('#occurrenceForm').addEventListener('submit',e=>{e.preventDefault();saveRoutineOccurrence(e.currentTarget)});
$('#resetOccurrence').addEventListener('click',resetRoutineOccurrence);
$('#editEntireRoutine').addEventListener('click',()=>{const id=$('#occurrenceForm').elements.id.value;closeDialog('occurrenceDialog');openRoutine(id)});
$('#icsYear').value=String(new Date().getFullYear());
$('#exportIcs').addEventListener('click',()=>{
 const year=Number($('#icsYear').value);if(!Number.isInteger(year)||year<1900||year>2100)return toast('Escolha um ano válido para exportação.');
 const content=buildIcs(year,$('#icsAlarm').checked),blob=new Blob([content],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`atlas-calendario-${year}.ics`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

async function updateOfflineAvailability(){
 const e=$('#offlineReady');if(!e)return;
 if(!('serviceWorker' in navigator)||!('caches' in window)||!('indexedDB' in window)){
  e.textContent='Offline não disponível';e.title='Este navegador não suporta todos os recursos offline.';return;
 }
 try{
  await dbOpen();
  const cached=await caches.match(new URL('./index.html',location.href).href);
  if(!cached){e.textContent=navigator.onLine?'Preparando offline…':'Offline não preparado';e.title='Abra o Atlas com internet para armazenar a interface.';return;}
  e.textContent=navigator.onLine?'Offline pronto':'Modo offline';
  e.title='Interface disponível localmente. Dados salvos no IndexedDB; sincronização requer internet.';
 }catch{e.textContent='Offline indisponível';e.title='Falha ao verificar o armazenamento local.';}
}
load();
window.addEventListener('online',updateOfflineAvailability);
window.addEventListener('offline',updateOfflineAvailability);
window.addEventListener('load',()=>updateOfflineAvailability());
if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
 window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(updateOfflineAvailability).catch(err=>{console.warn('Offline shell:',err);updateOfflineAvailability()}));
 window.addEventListener('load',()=>scriptOnce('https://accounts.google.com/gsi/client').catch(()=>{}));
}



// Google Agenda usa a MESMA sessão persistente do Drive. Nunca há OAuth de Agenda separado no navegador.
function calendarMessage(value){const el=$('#calendarStatus');if(el)el.textContent=value}
function scriptOnce(url){return new Promise((resolve,reject)=>{if(window.google?.accounts?.oauth2)return resolve();let script=document.querySelector('script[data-google-gis]');if(script?.dataset.failed==='true'){script.remove();script=null;} if(script){script.addEventListener('load',resolve,{once:true});script.addEventListener('error',reject,{once:true});return;}script=document.createElement('script');script.dataset.googleGis='true';script.src=url;script.async=true;script.onload=resolve;script.onerror=()=>{script.dataset.failed='true';reject(new Error('Não foi possível carregar o Google Identity Services'));};document.head.append(script)})}
async function readCalendarStatus(gw){
 if(!navigator.onLine){calendarMessage('Offline · eventos salvos no Atlas aguardam envio ao Google Agenda.');return false;}
 try{await gw.calendarStatus();calendarMessage('Google Agenda conectado pela sessão persistente · '+(gw.session?.email||''));return true;}
 catch(err){calendarMessage(err.code==='calendar_scope_missing'?'Permissão do Agenda pendente. Clique em “Autorizar Google Agenda” uma única vez.':'Google Agenda: '+err.message);return false;}
}
async function connectCalendar(){
 if(!navigator.onLine)throw Error('Conecte à internet para autorizar o Google Agenda.');
 const candidate=gatewayFromSetting();
 if(!candidate)throw Error('Configure primeiro o Cloudflare Worker em Conexão Google persistente.');
 const gw=persistentGateway?.base===candidate.base?persistentGateway:candidate;
 persistentGateway=gw;
 // Sempre abre a janela DIRETAMENTE no clique, antes de qualquer await.
 // Isso permite ampliar os escopos já concedidos, sem bloqueio de popup.
 await gw.login();
 const ok=await readCalendarStatus(gw);
 if(!ok)throw Error('A autorização não incluiu o Google Agenda. Confira Data Access e a API no Google Cloud.');
 gatewayMessage('Sessão Google persistente ativa · '+gw.session.email);
 if(!driveConnection?.store)await establishDrive(authFromGateway(gw));
 return gw;
}
async function calendarGatewayForSend(){
 if(!navigator.onLine)throw Error('Sem internet. Salve os dados no Atlas e envie ao Agenda quando reconectar.');
 const candidate=gatewayFromSetting();
 if(!candidate)throw Error('Configure o Worker nas Configurações para usar o Agenda persistente.');
 const gw=persistentGateway?.base===candidate.base?persistentGateway:candidate;
 persistentGateway=gw;
 // A autorização precisa ser iniciada por um clique explícito em Configurações.
 if(!gw.session)throw Error('Abra Configurações e clique em “Autorizar Google Agenda” para conectar.');
 return gw;
}
async function sendGoogleEvent(entry,refKey,links,reminder){
 const gw=await calendarGatewayForSend();
 const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const body={summary:entry.title||'Compromisso do Atlas',description:entry.description||'',start:{dateTime:new Date(entry.start).toISOString(),timeZone},end:{dateTime:new Date(entry.end).toISOString(),timeZone},reminders:reminder!==''&&reminder!==undefined?{useDefault:false,overrides:[{method:'popup',minutes:Number(reminder)}]}:{useDefault:true}};
 let eventId=links[refKey];const root='https://www.googleapis.com/calendar/v3/calendars/primary/events';
 const opts={method:eventId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
 let response=await gw.calendarFetch(root+(eventId?'/'+encodeURIComponent(eventId):''),opts);
 if(response.status===404&&eventId){eventId=null;response=await gw.calendarFetch(root,{...opts,method:'POST'});}
 if(!response.ok){const e=await response.json().catch(()=>({}));throw Error(e.error?.message||`Google Agenda ${response.status}: verifique a conexão ou autorização.`)}
 const remote=await response.json();links[refKey]=remote.id;return remote;
}
async function syncEventOnCalendar(){
 const id=$('#eventForm').elements.id.value;const ev=state.db.events.find(x=>x.id===id);if(!ev)return toast('Salve a atividade antes de sincronizá-la.');
 try{const gw=await calendarGatewayForSend();await gw.calendarStatus();ev.calendarLinks||={};for(const sl of eventSlots(ev)){await sendGoogleEvent({...ev,start:sl.start,end:sl.end},sl.id,ev.calendarLinks,ev.reminderMinutes);await save();}calendarMessage(`Enviados ${eventSlots(ev).length} encontro(s) ao Google Agenda · sessão persistente.`);toast('Atividade enviada ao Google Agenda.')}catch(err){toast(err.message);calendarMessage('Erro: '+err.message);console.warn(err)}
}
async function syncOccurrenceOnCalendar(){
 const f=$('#occurrenceForm'),{id,anchor,slotId}=Object.fromEntries(new FormData(f));const r=state.db.routines.find(x=>x.id===id);if(!r)return toast('Rotina não encontrada.');
 const occ=occurrenceInstance(r,anchor,slotId);if(!occ)return toast('Encontro não encontrado.');
 const key=routineExceptionKey(id,anchor,slotId);const ex=state.db.exceptions[key]||{};
 try{const gw=await calendarGatewayForSend();await gw.calendarStatus();ex.calendarLinks||={};await sendGoogleEvent(occ,'single',ex.calendarLinks,ex.reminderMinutes??'');state.db.exceptions[key]=ex;await save();toast('Encontro enviado ao Google Agenda.')}catch(err){toast(err.message);calendarMessage('Erro: '+err.message);console.warn(err)}
}
$('#googleClientId').value=storage.getItem('atlas.googleClientId')||'';
$('#connectCalendar').addEventListener('click',()=>connectCalendar().catch(err=>{calendarMessage('Erro: '+err.message);toast(err.message)}));
$('#disconnectCalendar').addEventListener('click',()=>calendarMessage('O Drive e a Agenda compartilham uma única sessão. Para sair da conta, use “Desconectar” na seção Google Drive.'));
$('#syncThisEvent').addEventListener('click',syncEventOnCalendar);
$('#syncThisOccurrence').addEventListener('click',syncOccurrenceOnCalendar);

// Google Drive appDataFolder — base privada para uma única pessoa, com confirmação de conflitos.
let driveSyncing=false,driveRequested=false,driveTimer=null;
async function dataFingerprint(data){
 const bytes=new TextEncoder().encode(JSON.stringify(data));
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
function showDriveChoices(visible){$('#driveResolution').classList.toggle('hidden',!visible)}
function scheduleDriveSync(){
 if(!driveConnection?.active||driveConnection.blocked)return;
 driveRequested=true;clearTimeout(driveTimer);driveTimer=setTimeout(()=>runDriveSync().catch(console.warn),1100);
}
async function runDriveSync(){
 if(driveSyncing||!driveConnection?.active||driveConnection.blocked)return;
 driveSyncing=true;clearTimeout(driveTimer);
 try{
  await saveChain.catch(()=>{});
  while(driveRequested && driveConnection?.active && !driveConnection.blocked){
   driveRequested=false;
   if(!navigator.onLine){driveRequested=true;syncStatus('Sem internet · alterações locais aguardando sincronização.');break;}
   const conn=driveConnection,snapshot=structuredClone(state.db),fingerprint=await dataFingerprint(snapshot);
   if(fingerprint===conn.lastSyncedHash){
     try{const assets=await conn.store.uploadAttachments(snapshot,id=>dbValue('attachments',id));
       syncStatus(assets.missing?`Banco atualizado · ${assets.missing} anexo(s) ainda indisponíveis.`:'Google Drive atualizado · dados e anexos conferidos.');
     }catch(err){
       if(/autoriza[cç][aã]o do Google expirou|401/.test(err.message)){
         driveConnection=null;driveRequested=false;showDriveChoices(false);updateDriveReconnectUI();
         syncStatus('A autorização do Drive expirou. Clique em Retomar Drive para continuar.');break;
       }
       syncStatus('Banco atualizado; falha ao conferir anexos: '+err.message);
     }
     continue;}
   syncStatus('Enviando registros e anexos ao Google Drive…');
   try {
    const result=await conn.store.write(snapshot,id=>dbValue('attachments',id));
    conn.lastSyncedHash=fingerprint;
    await dbValue('kv','atlas-drive-meta',{syncedHash:fingerprint,revision:result.revision},true);
    if(result.missing)syncStatus(`Registros sincronizados · ${result.missing} anexo(s) sem arquivo local ou remoto.`);
    else syncStatus('Google Drive atualizado · versão '+result.revision+'.');
    if(await dataFingerprint(state.db)!==fingerprint)driveRequested=true;
   }catch(err){
    console.warn('Sincronização Drive:',err);driveRequested=false;
    if(/autoriza[cç][aã]o do Google expirou|401/.test(err.message)){
      driveConnection=null;showDriveChoices(false);updateDriveReconnectUI();
      syncStatus('A sessão do Google expirou. Clique em Retomar Drive para continuar. Suas atividades estão salvas localmente.');
    }else{
      conn.blocked=true;showDriveChoices(true);
      syncStatus('Envio suspenso: '+err.message+' Seus dados locais foram preservados.');
    }
    break;
   }
  }
 }finally{driveSyncing=false;}
}
// Backend permanente: o navegador guarda apenas uma sessão do Atlas; o Worker
// guarda o refresh token criptografado e faz as requisições ao Drive.
function authFromGateway(gateway){return {store:new DriveStore('via-backend',(url,opts)=>gateway.driveFetch(url,opts)),token:null,gateway};}
async function restoreGatewaySession(){
 if(!navigator.onLine){gatewayMessage('Offline · a sessão será retomada quando houver internet.');return;}
 const gw=gatewayFromSetting();if(!gw)return;
 persistentGateway=gw;gatewayMessage('Verificando a sessão persistente…');
 const resumed=await gw.resume();
 if(!resumed){gatewayMessage('Nenhuma sessão ativa. Clique em Conectar para autorizar o Google.');return;}
 gatewayMessage('Sessão recuperada automaticamente · '+gw.session.email);
 await establishDrive(authFromGateway(gw));
 readCalendarStatus(gw).catch(console.warn);
}
$('#atlasGatewayUrl').value=activeGatewayUrl();
$('#saveGatewayUrl').addEventListener('click',async()=>{
 try{
  const gw=gatewayFromSetting();if(!gw)throw Error('Informe o endereço do Cloudflare Worker.');
  const old=activeGatewayUrl();
  if(old&&new URL(old).origin!==gw.base){
   if(!confirm('Trocar o backend desconectará a sessão anterior neste dispositivo. Continuar?'))return;
   driveConnection=null;await dbDelete('kv',GATEWAY_SESSION_KEY);
  }
  storage.setItem(GATEWAY_URL_KEY,gw.base);persistentGateway=gw;calendarMessage('Backend configurado. Autorize o Google Agenda usando a mesma sessão do Drive.');
  gatewayMessage('Worker configurado. Clique em “Conectar / Retomar Drive” para autorizar.');toast('Endereço do backend salvo.');
 }catch(err){gatewayMessage(err.message)}
});
async function requestDriveToken(){
 const clientId=$('#googleClientId').value.trim();
 if(!clientId.endsWith('.apps.googleusercontent.com'))throw Error('Informe primeiro o ID OAuth Web no campo de Google Agenda.');
 storage.setItem('atlas.googleClientId',clientId);
 await scriptOnce('https://accounts.google.com/gsi/client');
 return new Promise((resolve,reject)=>{
  const client=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:DRIVE_SCOPE,callback:reply=>{
   if(reply.error||!reply.access_token)reject(Error(reply.error||'Autorização não concedida'));
   else resolve({store:new DriveStore(reply.access_token),token:reply.access_token});
  },error_callback:err=>reject(Error(err?.message||'Janela de autorização cancelada.'))});
  // Evita solicitar novamente o consentimento já concedido. O clique continua necessário por segurança.
  client.requestAccessToken({prompt:''});
 });
}
function counts(db){return (db?.events?.length||0)+(db?.routines?.length||0)+(db?.archive?.length||0)+Object.keys(db?.exceptions||{}).length}
async function establishDrive(auth){
 $('#connectDrive').disabled=true;
 $('#quickConnectDrive').disabled=true;
 try{
  const store=auth.store;
  syncStatus('Lendo a cópia privada no Drive…');
  const remote=await store.read();
  rememberDrive();
  const localHash=await dataFingerprint(state.db),remoteHash=remote?await dataFingerprint(remote.data):null;
  const meta=await dbValue('kv','atlas-drive-meta').catch(()=>null);
  driveConnection={store,token:auth.token,gateway:auth.gateway||null,lastSyncedHash:null,active:false,blocked:true};
  if(remoteHash===localHash){
    driveConnection.lastSyncedHash=localHash;driveConnection.active=true;driveConnection.blocked=false;
    await dbValue('kv','atlas-drive-meta',{syncedHash:localHash,revision:store.revision},true);
    syncStatus('Conectado · as cópias local e remota são iguais.');showDriveChoices(false);
  }else if(remote && meta?.syncedHash===remoteHash){
    // Local mudou depois da última sincronização; o Drive ainda contém a cópia anterior.
    driveConnection.lastSyncedHash=remoteHash;driveConnection.active=true;driveConnection.blocked=false;
    syncStatus('Conectado · alterações locais aguardam envio ao Drive.');showDriveChoices(false);scheduleDriveSync();
  }else if(!remote && counts(state.db)===0){
    // Mesmo uma base vazia é criada explicitamente para registrar o início da sincronização.
    driveConnection.lastSyncedHash='';driveConnection.active=true;driveConnection.blocked=false;
    syncStatus('Nenhum banco no Drive. Criando uma cópia inicial vazia…');showDriveChoices(false);scheduleDriveSync();
  }else{
    const localCount=counts(state.db),remoteCount=counts(remote?.data);
    showDriveChoices(true);
    syncStatus(remote?`Drive: ${remoteCount} registro(s) · dispositivo: ${localCount}. Escolha uma das cópias antes de sincronizar.`:`Drive vazio · ${localCount} registro(s) locais. Clique “Enviar cópia deste dispositivo” para criar o banco remoto.`);
  }
 }catch(err){syncStatus('Não conectado: '+err.message);console.warn(err)}
 finally{$('#connectDrive').disabled=false;updateDriveReconnectUI()}
}
async function connectDrive(){
 if(!navigator.onLine){syncStatus('Sem internet. Os registros continuam disponíveis neste dispositivo.');return;}
 syncStatus('Solicitando autorização Google…');
 try{
  if(activeGatewayUrl()){
   // Abra a janela OAuth antes de qualquer await: bloqueadores de pop-up exigem gesto do usuário.
   const candidate=gatewayFromSetting();
   const gw=persistentGateway?.session && persistentGateway.base===candidate.base?persistentGateway:candidate;
   persistentGateway=gw;
   if(!gw.session)await gw.login();
   gatewayMessage('Sessão persistente ativa · '+gw.session.email);
   await establishDrive(authFromGateway(gw));
   readCalendarStatus(gw).catch(console.warn);
  }else{
   const auth=await requestDriveToken();await establishDrive(auth);
  }
 }catch(err){syncStatus('Não conectado: '+err.message);gatewayMessage(err.message)}
}
async function loadDriveCopy(){
 if(!driveConnection?.store)return toast('Conecte ao Google Drive primeiro.');
 const conn=driveConnection;
 try{
  if(!confirm('CARREGAR DO DRIVE: substituir as atividades e materiais neste dispositivo? Exporte um backup JSON local antes de confirmar.'))return;
  await saveChain.catch(()=>{});
  syncStatus('Revalidando e carregando os dados do Drive…');
  const remote=await conn.store.read();if(!remote)throw Error('A cópia remota não existe mais.');
  const fingerprint=await dataFingerprint(remote.data);
  state.db=structuredClone(remote.data);
  await dbValue('kv','atlas-data',state.db,true);storage.setItem('atlas.backup',JSON.stringify(state.db));
  conn.lastSyncedHash=fingerprint;conn.blocked=false;conn.active=true;driveRequested=false;
  await dbValue('kv','atlas-drive-meta',{syncedHash:fingerprint,revision:remote.revision},true);
  renderAll();showDriveChoices(false);syncStatus('Cópia do Drive carregada. Anexos serão baixados quando você abri-los.');
 }catch(err){syncStatus('Carregamento não concluído: '+err.message)}
}
async function sendDriveCopy(){
 if(!driveConnection?.store)return toast('Conecte ao Google Drive primeiro.');
 const conn=driveConnection;
 if(!confirm('ENVIAR AO DRIVE: substituir o banco remoto pelos registros deste dispositivo? Faça um backup JSON primeiro. Continuar?'))return;
 try{
  // A gravação verifica a versão remota antes do upload; se houve mudança, bloqueia envio.
  conn.lastSyncedHash='';conn.active=true;conn.blocked=false;showDriveChoices(false);
  driveRequested=true;await runDriveSync();
 }catch(err){conn.blocked=true;showDriveChoices(true);syncStatus('Envio interrompido: '+err.message)}
}
async function disconnectDrive(){
 const old=driveConnection;driveConnection=null;driveRequested=false;clearTimeout(driveTimer);
 storage.removeItem(DRIVE_REMEMBER_KEY);
 updateDriveReconnectUI();
 const gateway=old?.gateway||persistentGateway;
 if(gateway?.session){
  try{await gateway.logout();gatewayMessage('Sessão encerrada neste dispositivo.')}catch(err){gatewayMessage('Sessão local apagada; revogação remota pode estar pendente: '+err.message)}
 }else if(activeGatewayUrl()){
  await dbDelete('kv',GATEWAY_SESSION_KEY).catch(console.warn);
  gatewayMessage('Identificador da sessão removido deste dispositivo.');
 }
 if(old?.token&&window.google?.accounts?.oauth2)google.accounts.oauth2.revoke(old.token,()=>{});
 showDriveChoices(false);calendarMessage('Google Agenda desconectado: a sessão compartilhada foi encerrada.');syncStatus('Desconectado. Registros continuam disponíveis neste dispositivo.');
}
$('#connectDrive').addEventListener('click',connectDrive);
$('#quickConnectDrive').addEventListener('click',connectDrive);
$('#disconnectDrive').addEventListener('click',disconnectDrive);
$('#loadDriveCopy').addEventListener('click',loadDriveCopy);
$('#sendDriveCopy').addEventListener('click',sendDriveCopy);
$('#syncDriveNow').addEventListener('click',()=>{
 if(!driveConnection?.store)return toast('Conecte ao Google Drive primeiro.');
 if(driveConnection.blocked)return toast('Escolha entre a cópia local e a do Drive antes de sincronizar.');
 driveRequested=true;runDriveSync().catch(console.warn);
});
window.addEventListener('online',()=>{if(driveConnection?.active&&!driveConnection.blocked){syncStatus('Internet restaurada · retomando sincronização…');driveRequested=true;runDriveSync().catch(console.warn)}else if(activeGatewayUrl()&&!driveConnection?.store){restoreGatewaySession().catch(err=>gatewayMessage('Não foi possível recuperar a sessão: '+err.message))}});
window.addEventListener('offline',()=>{if(driveConnection)syncStatus('Offline · as alterações serão guardadas neste dispositivo.')});
