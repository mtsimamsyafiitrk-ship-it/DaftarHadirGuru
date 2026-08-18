// ── iOS SAFARI COMPATIBILITY HELPERS ──
// Deteksi perangkat iOS (iPhone, iPad, iPod)
const isIOS = /iP(ad|hone|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Helper download Excel yang kompatibel dengan iOS Safari.
// iOS Safari tidak mendukung atribut 'download' pada anchor tag,
// sehingga XLSX.writeFile() tidak bekerja. Solusi: buka file sebagai
// data URI di tab baru (harus dipanggil synchronous dari click event).
function xlsxDownload(wb, filename) {
  if (isIOS) {
    try {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const w = window.open();
      if (!w) { showToast('Popup diblokir. Izinkan popup untuk mengunduh file.', false); return; }
      w.location.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + wbout;
      showToast('✅ File Excel siap — simpan dari tab yang terbuka');
    } catch(e) {
      showToast('Gagal mengunduh Excel di iOS: ' + e.message, false);
    }
  } else {
    XLSX.writeFile(wb, filename);
  }
}

// ── LAZY-LOAD XLSX ──
// Library XLSX (±900KB) hanya dipakai admin untuk template/upload jadwal & ekspor rekap.
// Dimuat on-demand agar tidak membebani load awal untuk mayoritas pengguna (guru).
let _xlsxLoad = null;
function ensureXLSX(){
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!_xlsxLoad){
    _xlsxLoad = new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload  = ()=> resolve(window.XLSX);
      s.onerror = ()=>{ _xlsxLoad = null; reject(new Error('Gagal memuat modul Excel')); };
      document.head.appendChild(s);
    });
  }
  return _xlsxLoad;
}
// Muat di latar tanpa menunggu — dipanggil saat admin membuka layar yang butuh Excel,
// agar tombol download/ekspor tetap responsif (sinkron) saat diklik.
function prewarmXLSX(){ ensureXLSX().catch(()=>{}); }

// ── IMPORTS ──
// Firebase & Firestore wrappers
import {
  fs, doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs,
  query, where, documentId
} from "./js/firebase.js";

import {
  SESSIONS, ROLES, MONTHS, DS, DF,
  CAL_COLS, CAL_JS, TODAY, ADMIN_DEFAULT_PW
} from "./js/constants.js";
import {
  getOrderIndex, hashPw, encodePw, decodePw,
  dim, fd, wom, wim, dk, emptyDay, cntDay, scDay
} from "./js/utils.js";
import {
  showLoading, hideLoading, showToast, showScreen,
  openModal, closeModal, togglePw,
  getRoleColor, getRoles, rolesDisplay, rolesText
} from "./js/ui-helpers.js";

// Fungsi yang dipanggil dari HTML onclick/onchange harus diekspos ke window.
window.closeModal = closeModal;
window.togglePw = togglePw;

// Modul fitur
import {
  loadHolidayDates, getHolidayDates, saveHolidayDates,
  isHolidayDate, isHolidayKey,
  refreshRincianLibur, renderRincianLibur,
  hapusSatuHariLibur, hapusSemuaHariLibur
} from "./js/hari-libur.js";

import {
  KET_TYPES, getKetType, loadKetHarianMonth, resetKetCache,
  getKetHarian, getKetLockedSessions, getKetForSession,
  isKetFullDay, getKetEntriesForMonth,
  saveKetHarian, deleteKetHarian
} from "./js/keterangan-harian.js";

// Ekspos ke window untuk dipanggil dari HTML onclick
window.refreshRincianLibur = refreshRincianLibur;
window.renderRincianLibur = renderRincianLibur;
window.hapusSatuHariLibur = hapusSatuHariLibur;
window.hapusSemuaHariLibur = hapusSemuaHariLibur;

// ── STATE ──
let users=[], archivedUsers=[], localDb={};
let currentUser=null;
let loginRole='user';
window.muRoles=["Pengajar"];
let cYear=TODAY.getFullYear(), cMonth=TODAY.getMonth();
let rekapYear=TODAY.getFullYear(), rekapMonth=TODAY.getMonth();
let cView='monthly', cView2='monthly';
let selWeek=1, editDay=null, editDayW=null;
let viewingUser=null;

function sortUsers(){
  users.sort((a,b)=>{
    const ia=getOrderIndex(a.name),ib=getOrderIndex(b.name);
    if(ia!==ib)return ia-ib;
    return a.name.localeCompare(b.name);
  });
}

// ── FIRESTORE ──
async function loadUsers(){
  const snap=await getDocs(collection(fs,"users"));
  users=[];archivedUsers=[];
  snap.forEach(d=>{
    const user={id:d.id,...d.data()};
    if(user.archived) archivedUsers.push(user);
    else users.push(user);
  });
  sortUsers();
}
async function saveUserDoc(user){const{id,...data}=user;await setDoc(doc(fs,"users",id),data);}
async function deleteUserDoc(id){
  await deleteDoc(doc(fs,"users",id));
  const snap=await getDocs(collection(fs,"att_"+id));
  await Promise.all(snap.docs.map(d=>deleteDoc(doc(fs,"att_"+id,d.id))));
}
// ── Pemuatan kehadiran (cache) ──
// localDb[uid] = {dateKey: dayData}. Bisa terisi penuh (loadAtt) atau per-bulan (loadAttMonth).
// attFullyLoaded  : uid yang seluruh riwayatnya sudah dimuat.
// attLoadedMonths : {uid: Set("YYYY-MM")} bulan yang sudah dimuat (agar tidak dibaca ulang).
const attFullyLoaded = new Set();
const attLoadedMonths = {};
const monthKeyOf = (y,m)=> `${y}-${String(m+1).padStart(2,'0')}`;

// Lupakan cache pemuatan untuk uid (mis. saat user dihapus / data di-reset).
function forgetAttCache(uid){
  attFullyLoaded.delete(uid);
  delete attLoadedMonths[uid];
}

// Muat SELURUH riwayat kehadiran user. Dipakai fitur yang butuh data lintas-bulan.
async function loadAtt(uid){
  if(attFullyLoaded.has(uid))return;
  const snap=await getDocs(collection(fs,"att_"+uid));
  localDb[uid]={};
  snap.forEach(d=>{localDb[uid][d.id]=d.data()});
  attFullyLoaded.add(uid);
  attLoadedMonths[uid] = new Set(); // penuh → cek termuat lewat attFullyLoaded
}

// Muat kehadiran user HANYA untuk satu bulan (query rentang berdasar id dokumen = tanggal).
// Jauh lebih ringan untuk rekap: baca ~1 bulan, bukan seluruh riwayat.
async function loadAttMonth(uid, y, m){
  if(attFullyLoaded.has(uid)) return;
  const mk = monthKeyOf(y,m);
  if(attLoadedMonths[uid] && attLoadedMonths[uid].has(mk)) return;
  const startKey = dk(y,m,1);
  const endKey   = dk(y,m,dim(y,m));
  const qy = query(collection(fs,"att_"+uid),
                   where(documentId(),'>=',startKey),
                   where(documentId(),'<=',endKey));
  const snap = await getDocs(qy);
  if(!localDb[uid]) localDb[uid] = {};
  snap.forEach(d=>{ localDb[uid][d.id] = d.data(); });
  (attLoadedMonths[uid] = attLoadedMonths[uid] || new Set()).add(mk);
}
async function saveAtt(uid,dateKey,data){await setDoc(doc(fs,"att_"+uid,dateKey),data);}
async function getAdminDoc(){const d=await getDoc(doc(fs,"config","admin"));return d.exists()?d.data():null;}
async function saveAdminDoc(data){
  // Merge with existing data to avoid overwriting fields
  const existing=await getAdminDoc()||{};
  await setDoc(doc(fs,"config","admin"),{...existing,...data});
}

// ── CALC (helper functions yang tergantung state lokal) ──
function gdd(uid,y,m,d){return(localDb[uid]&&localDb[uid][dk(y,m,d)])||emptyDay()}
function wRec(uid,y,m,wk){
  const t=dim(y,m),f=fd(y,m),days=[];
  for(let d=1;d<=t;d++)if(wom(d,f)===wk)days.push(d);
  const tots=SESSIONS.reduce((a,s)=>({...a,[s.key]:0}),{});
  let ts=0;days.forEach(d=>{
    if(isBeforeJoinDate(uid,y,m,d))return; // skip hari sebelum bergabung
    const dd=gdd(uid,y,m,d);SESSIONS.forEach(s=>{if(dd[s.key])tots[s.key]++;});ts+=scDay(dd);
    // Sesi double-duty (milik sendiri + penggantian) dihitung ekstra
    (dd._substituteExtra||[]).forEach(sk=>{tots[sk]++;ts+=2;});
  });
  return{totals:tots,totalScore:ts,days};
}
function mRec(uid,y,m){
  const t=dim(y,m),tots=SESSIONS.reduce((a,s)=>({...a,[s.key]:0}),{});
  let ts=0;for(let d=1;d<=t;d++){
    if(isBeforeJoinDate(uid,y,m,d))continue; // skip hari sebelum bergabung
    const dd=gdd(uid,y,m,d);SESSIONS.forEach(s=>{if(dd[s.key])tots[s.key]++;});ts+=scDay(dd);
    // Sesi double-duty (milik sendiri + penggantian) dihitung ekstra
    (dd._substituteExtra||[]).forEach(sk=>{tots[sk]++;ts+=2;});
  }
  return{totals:tots,totalScore:ts};
}
// Jumlah hadir (hari dengan minimal 1 sesi) per pekan
function weekAttCount(uid,y,m,wk){
  const t=dim(y,m),f=fd(y,m);let c=0;
  for(let d=1;d<=t;d++)if(wom(d,f)===wk&&!isBeforeJoinDate(uid,y,m,d)&&cntDay(gdd(uid,y,m,d))>0)c++;
  return c;
}
function monthAttCount(uid,y,m){
  const t=dim(y,m);let c=0;
  for(let d=1;d<=t;d++)if(!isBeforeJoinDate(uid,y,m,d)&&cntDay(gdd(uid,y,m,d))>0)c++;
  return c;
}
function yRec(uid,y){return MONTHS.map((_,m)=>({month:m,...mRec(uid,y,m)}))}

// ── LOGIN ──
function setLoginRole(r){
  loginRole=r;
  document.getElementById('rtab-user').classList.toggle('active',r==='user');
  document.getElementById('rtab-admin').classList.toggle('active',r==='admin');
  document.getElementById('login-err').style.display='none';
}
window.setLoginRole=setLoginRole;

async function doLogin(){
  const username=document.getElementById('l-user').value.trim();
  const password=document.getElementById('l-pass').value;
  const errEl=document.getElementById('login-err');
  errEl.style.display='none';
  if(!username||!password){errEl.textContent='Username dan password wajib diisi.';errEl.style.display='block';return;}
  showLoading("Memeriksa akun...");
  try{
    if(loginRole==='admin'){
      const adminDoc=await getAdminDoc();
      const pwHash=await hashPw(password);
      let validPw=adminDoc?adminDoc.pwHash===pwHash:password===ADMIN_DEFAULT_PW;
      const adminUsername=adminDoc&&adminDoc.username?adminDoc.username:'admin';
      if(username!==adminUsername||!validPw){hideLoading();errEl.textContent='Username atau password admin salah.';errEl.style.display='block';return;}
      if(!adminDoc)await saveAdminDoc({pwHash:await hashPw(ADMIN_DEFAULT_PW)});
      currentUser={id:'admin',name:'Administrator',username:'admin',role:'Admin',isAdmin:true};
      saveSession('admin', 'admin');
      hideLoading();
      showScreen('admin-users');
      renderAdminUsers();
    } else {
      const pwHash=await hashPw(password);
      const found=users.find(u=>u.username===username&&u.pwHash===pwHash);
      if(!found){hideLoading();errEl.textContent='Username atau password salah.';errEl.style.display='block';return;}
      currentUser={...found,isAdmin:false};
      showLoading("Memuat data absensi...");
      await loadAtt(currentUser.id);
      await loadHolidayDates();
      // Load jadwal dari Firestore untuk validasi sesi
      try{ globalSchedule = await getHolidaySchedule(); }catch(e){ globalSchedule = {}; }
      // Load substitusi bulan ini
      try{ await loadSubstitutionsForMonth(TODAY.getFullYear(), TODAY.getMonth()); }catch(e){}
      // Load keterangan harian bulan ini (untuk kunci sesi)
      try{ await loadKetHarianMonth(TODAY.getFullYear(), TODAY.getMonth()); }catch(e){}
      hideLoading();
      cYear=TODAY.getFullYear();cMonth=TODAY.getMonth();cView='monthly';editDay=null;editDayW=null;selWeek=1;
      document.getElementById('u-name').textContent=currentUser.name;
      document.getElementById('u-role').textContent=rolesText(currentUser);
      document.getElementById('att-month').textContent=MONTHS[cMonth];
      document.getElementById('att-year').textContent=cYear;
      saveSession('user', currentUser.id);
      showScreen('user-att');
      switchTab('monthly'); // render kalender SETELAH hari libur terisi
      cekNotifikasiPengingat(currentUser.id); // cek notif pengingat dari admin
      updateUserNotifBadge(currentUser.id); // update badge notif navbar
      // Load access grants & cek notif akses
      await loadAccessGrants(currentUser.id);
      checkAndShowActiveBanners();
      await cekNotifAkses(currentUser.id);
      // Admin: load badge notif
      if(currentUser.roles && currentUser.roles.includes('Admin')) checkAdminNotifBadge();
    }
  }catch(e){hideLoading();errEl.textContent='Terjadi kesalahan. Coba lagi.';errEl.style.display='block';}
}
window.doLogin=doLogin;

function doLogout(){
  clearSession();
  resetKetCache();
  currentUser=null;viewingUser=null;
  document.getElementById('l-user').value='';
  document.getElementById('l-pass').value='';
  document.getElementById('login-err').style.display='none';
  showScreen('login');
}
window.doLogout=doLogout;

// ── ADMIN NAV ──
function adminNav(tab){
  const tabs=['users','rekap','profile','keterangan'];
  tabs.forEach(t=>{
    [1,2,3].forEach(n=>{const el=document.getElementById(`anav-${t}${n===1?'':n}`);if(el)el.classList.toggle('active',t===tab);});
    const el=document.getElementById(`anav-${t}`);if(el)el.classList.toggle('active',t===tab);
    const elk=document.getElementById(`anav-${t}-k`);if(elk)elk.classList.toggle('active',t===tab);
  });
  // notif tab active state
  ['','-n','2','3','-k'].forEach(s=>{
    const el=document.getElementById('anav-notif'+s);
    if(el)el.classList.toggle('active',tab==='notif');
  });
  if(tab==='users'){showScreen('admin-users');renderAdminUsers();}
  else if(tab==='rekap'){
    showScreen('admin-rekap');
    rekapYear=TODAY.getFullYear();rekapMonth=TODAY.getMonth();
    renderRekapPage();
  }
  else if(tab==='notif'){showScreen('admin-notif');renderAdminNotifPage();}
  else if(tab==='profile'){showScreen('admin-profile');loadAdminProfileDisplay();}
  else if(tab==='keterangan'){showScreen('admin-keterangan');renderKetPage();}
}
window.adminNav=adminNav;

// ── USER NAV ──
function userNav(tab){
  ['att','notif','profile'].forEach(t=>{
    ['unav-'+t,'unav-'+t+'2','unav-'+t+'3'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.toggle('active',t===tab);});
  });
  if(tab==='att'){
    showScreen('user-att');
    document.getElementById('u-name').textContent=currentUser.name;
    document.getElementById('u-role').textContent=rolesText(currentUser);
    renderCurView();
  } else if(tab==='notif'){
    showScreen('user-notif');
    renderUserNotifPage();
  } else {
    showScreen('user-profile');
    document.getElementById('up-name').textContent=currentUser.name;
    document.getElementById('up-role').textContent=rolesText(currentUser);
    document.getElementById('up-name2').textContent=currentUser.name;
    document.getElementById('up-username').textContent=currentUser.username;
    document.getElementById('up-avatar').textContent=currentUser.name[0].toUpperCase();
    document.getElementById('up-badge').innerHTML=rolesDisplay(currentUser);
    renderChangeReqStatus();
  }
}
window.userNav=userNav;

// ── USER NOTIF: Update badge ──
async function updateUserNotifBadge(uid){
  try{
    const snap=await getDoc(doc(fs,'notifications',uid));
    const hasBadge=snap.exists()&&snap.data().dibaca===false;
    ['unav-notif-badge','unav-notif-badge2','unav-notif-badge3'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.style.display=hasBadge?'flex':'none';
    });
  }catch(e){console.warn('updateUserNotifBadge err:',e.message);}
}

// ── USER NOTIF: Render halaman notifikasi ──
async function renderUserNotifPage(){
  const container=document.getElementById('user-notif-list');
  container.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)">⏳ Memuat...</div>';
  try{
    const snap=await getDoc(doc(fs,'notifications',currentUser.id));
    if(!snap.exists()||!snap.data().pesan){
      container.innerHTML='<div style="text-align:center;padding:48px 24px"><div style="font-size:48px;margin-bottom:12px">🔕</div><div style="font-size:15px;font-weight:700;color:var(--muted)">Belum ada notifikasi</div></div>';
      return;
    }
    const d=snap.data();
    const dibaca=d.dibaca===true;
    const ts=d.timestamp?new Date(d.timestamp):null;
    const tglStr=ts?ts.toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
    let icon='🔔', bg='linear-gradient(135deg,#fffbeb,#fef3c7)', border='#fcd34d', titleColor='#92400e';
    if(d.type==='accessGranted'){icon='✅';bg='linear-gradient(135deg,#f0fdf4,#dcfce7)';border='#86efac';titleColor='#166534';}
    else if(d.type==='accessRejected'){icon='❌';bg='linear-gradient(135deg,#fff5f5,#fee2e2)';border='#fca5a5';titleColor='#991b1b';}
    else if(d.type==='reminder'||!d.type){icon='🔔';bg='linear-gradient(135deg,#fffbeb,#fef3c7)';border='#fcd34d';titleColor='#92400e';}
    const labelType = d.type==='accessGranted'?'Akses Disetujui':d.type==='accessRejected'?'Akses Ditolak':'Pengingat Kehadiran';
    container.innerHTML=`
      <div style="background:${bg};border:1.5px solid ${border};border-radius:16px;padding:18px 16px;position:relative${dibaca?'':';box-shadow:0 4px 18px rgba(0,0,0,0.10)'}">
        ${!dibaca?'<div style="position:absolute;top:14px;right:14px;width:10px;height:10px;background:#ef4444;border-radius:50%"></div>':''}
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="font-size:32px;flex-shrink:0;line-height:1.1">${icon}</div>
          <div style="flex:1">
            <div style="font-size:11px;font-weight:800;color:${titleColor};text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${labelType}</div>
            <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:6px">${d.bulan||''}</div>
            <div style="font-size:13px;color:#4b5563;line-height:1.6">${d.pesan||''}</div>
            ${tglStr?`<div style="font-size:11px;color:var(--muted);margin-top:8px">🕐 ${tglStr}</div>`:''}
          </div>
        </div>
      </div>`;
    // Tandai sudah dibaca
    if(!dibaca){
      await setDoc(doc(fs,'notifications',currentUser.id),{...d,dibaca:true});
      ['unav-notif-badge','unav-notif-badge2','unav-notif-badge3'].forEach(id=>{
        const el=document.getElementById(id);if(el)el.style.display='none';
      });
    }
  }catch(e){
    container.innerHTML=`<div style="text-align:center;padding:32px;color:#ef4444">Gagal memuat: ${e.message}</div>`;
  }
}
window.renderUserNotifPage=renderUserNotifPage;

// ── ADMIN: RENDER USER LIST ──
function renderAdminUsers(){
  const ul=document.getElementById('admin-user-list');
  if(!users.length){
    ul.innerHTML=`<div class="empty"><div style="font-size:52px;margin-bottom:12px">👤</div><div style="font-weight:800;font-size:16px">Belum ada pengguna</div><div style="font-size:13px;margin-top:5px">Tambahkan pengguna baru</div></div>`;return;
  }
  ul.innerHTML=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">`+
    users.map(u=>{
      const roles=getRoles(u);const rc=getRoleColor(roles[0]||'');
      const isCuti=u.status==='cuti';const isNew=u.employeeType==='baru';
      const dot=isCuti
        ?`<div style="position:absolute;top:7px;right:7px;width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 0 2px #fff"></div>`
        :isNew?`<div style="position:absolute;top:7px;right:7px;width:8px;height:8px;border-radius:50%;background:#3b82f6;box-shadow:0 0 0 2px #fff"></div>`:'';
      return`<div onclick="window.__openUserMenu('${u.id}')" style="background:#fff;border-radius:16px;padding:14px 8px 12px;text-align:center;border:1px solid var(--border);cursor:pointer;transition:all .2s cubic-bezier(.34,1.56,.64,1);box-shadow:0 2px 10px rgba(45,55,72,.06);position:relative;-webkit-tap-highlight-color:transparent" onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(45,55,72,.12)';this.style.borderColor='var(--sage4)'" onmouseleave="this.style.transform='';this.style.boxShadow='0 2px 10px rgba(45,55,72,.06)';this.style.borderColor='var(--border)'">
        ${dot}
        <div style="width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,${rc}bb,${rc});display:flex;align-items:center;justify-content:center;font-weight:800;font-size:21px;color:#fff;margin:0 auto 9px;box-shadow:0 3px 10px ${rc}55">${u.name[0].toUpperCase()}</div>
        <div style="font-weight:800;font-size:11.5px;color:var(--text);line-height:1.35;word-break:break-word;padding:0 2px">${u.name}</div>
        <div style="font-size:9.5px;color:var(--sage2);font-weight:700;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px">${roles[0]||'—'}</div>
      </div>`;
    }).join('')+`</div>`;
}

window.__openUserMenu=function(uid){
  const u=users.find(x=>x.id===uid);if(!u)return;
  const roles=getRoles(u);const rc=getRoleColor(roles[0]||'');
  const isCuti=u.status==='cuti';
  const CLOSE=`closeModal('modal-user-actions')`;

  // ── Ikon 3D (wrapper div bergradien + SVG putih) ──
  function ic3d(grad,shadow,svgPath){
    return`<div style="width:54px;height:54px;border-radius:16px;background:${grad};box-shadow:${shadow},inset 0 1px 0 rgba(255,255,255,0.35);display:flex;align-items:center;justify-content:center;margin:0 auto 7px;transition:transform .18s cubic-bezier(.34,1.56,.64,1)">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>
    </div>`;
  }

  const IC={
    cal: ic3d(
      'linear-gradient(150deg,#60a5fa 0%,#2563eb 100%)',
      '0 5px 16px rgba(37,99,235,0.45)',
      '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'
    ),
    edit: ic3d(
      'linear-gradient(150deg,#fb923c 0%,#ea580c 100%)',
      '0 5px 16px rgba(234,88,12,0.45)',
      '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'
    ),
    status: ic3d(
      'linear-gradient(150deg,#4ade80 0%,#16a34a 100%)',
      '0 5px 16px rgba(22,163,74,0.45)',
      '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>'
    ),
    key: ic3d(
      'linear-gradient(150deg,#fbbf24 0%,#d97706 100%)',
      '0 5px 16px rgba(217,119,6,0.45)',
      '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'
    ),
    trash: ic3d(
      'linear-gradient(150deg,#94a3b8 0%,#475569 100%)',
      '0 5px 16px rgba(71,85,105,0.35)',
      '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'
    ),
    archive: ic3d(
      'linear-gradient(150deg,#818cf8 0%,#4f46e5 100%)',
      '0 5px 16px rgba(79,70,229,0.45)',
      '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><line x1="10" y1="12" x2="14" y2="12"/>'
    ),
  };

  const acts=[
    {ic:IC.cal,     label:'Absensi',                   fn:`window.__viewAtt('${uid}');${CLOSE}`},
    {ic:IC.edit,    label:'Edit',                       fn:`window.__editUser('${uid}');${CLOSE}`},
    {ic:IC.status,  label:isCuti?'Aktifkan':'Status',   fn:`window.__editStatus('${uid}');${CLOSE}`},
    {ic:IC.key,     label:'Reset PW',                   fn:`window.__resetPw('${uid}');${CLOSE}`},
    {ic:IC.archive, label:'Arsipkan',                   fn:`window.__archiveUser('${uid}');${CLOSE}`},
    {ic:IC.trash,   label:'Hapus',                      fn:`window.__delUser('${uid}');${CLOSE}`},
  ];

  let modal=document.getElementById('modal-user-actions');
  if(!modal){
    modal=document.createElement('div');
    modal.id='modal-user-actions';
    modal.className='modal-bg';
    modal.style.display='none';
    modal.addEventListener('click',e=>{if(e.target===modal)closeModal('modal-user-actions');});
    const inner=document.createElement('div');
    inner.id='modal-user-actions-inner';
    inner.className='modal';
    inner.style.cssText='max-width:320px;padding:0;overflow:hidden';
    modal.appendChild(inner);
    document.body.appendChild(modal);
  }

  document.getElementById('modal-user-actions-inner').innerHTML=`
    <div style="padding:18px 18px 14px;background:linear-gradient(135deg,var(--sage3),#fff);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px">
      <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,${rc}bb,${rc});display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;color:#fff;flex-shrink:0;box-shadow:0 3px 10px ${rc}44">${u.name[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.name}</div>
        <div style="font-size:11px;color:var(--sage2);font-weight:700;margin-top:1px">${roles.join(' · ')||'—'}</div>
        ${isCuti?`<div style="font-size:10px;color:#d97706;font-weight:700;margin-top:2px">● Sedang Cuti</div>`:''}
      </div>
      <button onclick="${CLOSE}" style="background:none;border:none;padding:6px;cursor:pointer;color:var(--muted);border-radius:8px;flex-shrink:0;font-size:18px;line-height:1">✕</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;padding:20px 16px 18px">
      ${acts.map(a=>`<button onclick="${a.fn}"
        style="flex:0 0 calc(33.33% - 6px);background:transparent;border:none;border-radius:14px;padding:12px 6px 10px;display:flex;flex-direction:column;align-items:center;cursor:pointer;transition:all .18s cubic-bezier(.34,1.56,.64,1)"
        onmouseenter="this.querySelector('div').style.transform='scale(1.1) translateY(-2px)'"
        onmouseleave="this.querySelector('div').style.transform=''">
        ${a.ic}
        <span style="font-size:11px;font-weight:700;color:var(--text2);line-height:1">${a.label}</span>
      </button>`).join('')}
    </div>`;

  openModal('modal-user-actions');
};



// ── ADMIN: REKAPITULASI BULANAN ──
function rekapPrevMonth(){
  if(rekapMonth===0){rekapMonth=11;rekapYear--;}else rekapMonth--;
  renderRekapPage();
}
function rekapNextMonth(){
  if(rekapMonth===11){rekapMonth=0;rekapYear++;}else rekapMonth++;
  renderRekapPage();
}
window.rekapPrevMonth=rekapPrevMonth;
window.rekapNextMonth=rekapNextMonth;

async function renderRekapPage(){
  document.getElementById('rekap-month').textContent=MONTHS[rekapMonth];
  document.getElementById('rekap-year').textContent=rekapYear;
  // Load attendance untuk semua user yang belum di-cache
  showLoading("Memuat data rekapitulasi...");
  prewarmXLSX(); // siapkan modul Excel untuk ekspor rekap
  // Muat kehadiran HANYA untuk bulan yang sedang dilihat (hemat baca Firestore).
  await Promise.all(users.map(u=>loadAttMonth(u.id, rekapYear, rekapMonth)));
  hideLoading();
  renderRekapTable();
}

function renderRekapTable(){
  const y=rekapYear,m=rekapMonth,tw=wim(y,m);
  if(!users.length){
    document.getElementById('rekap-table-wrap').innerHTML=`<div class="empty"><div style="font-size:42px;margin-bottom:10px">📋</div><div style="font-weight:700">Belum ada pengguna</div></div>`;
    return;
  }
  // Build header
  let thWeeks='';
  for(let w=1;w<=tw;w++)thWeeks+=`<th>Pekan ${w}</th>`;
  // Build rows
  let rows='';
  let grandTotalPoin=0;
  let grandTotalPoinPerWeek=Array(tw).fill(0);
  users.forEach((u,idx)=>{
    const isCuti=u.status==='cuti';
    let tdWeeks='';
    let rowTotalPoin=mRec(u.id,y,m).totalScore;
    for(let w=1;w<=tw;w++){
      const pts=wRec(u.id,y,m,w).totalScore;
      grandTotalPoinPerWeek[w-1]+=pts;
      const ptsCell=pts>0?'<span style="font-weight:800;color:var(--sage2)">'+pts+'</span>':'<span style="color:var(--muted)">—</span>';
      tdWeeks+=`<td>${ptsCell}</td>`;
    }
    grandTotalPoin+=rowTotalPoin;
    const cutiTag=isCuti?`<span style="font-size:10px;background:#fef3c7;color:#d97706;border:1px solid #fde68a;border-radius:8px;padding:2px 7px;font-weight:700;margin-left:6px">🏖️ Cuti</span>`:'';
    rows+=`<tr style="${isCuti?'opacity:0.65':''}">
      <td style="font-weight:700;color:var(--muted)">${idx+1}</td>
      <td><div style="font-weight:800;display:flex;align-items:center;flex-wrap:wrap;gap:4px">${u.name}${cutiTag}</div><div style="margin-top:3px;display:flex;flex-wrap:wrap">${rolesDisplay(u)}</div></td>
      ${tdWeeks}
      <td><span style="font-weight:900;font-size:16px;color:var(--amber2)">${rowTotalPoin}</span><span style="font-size:11px;color:var(--muted)"> jam</span></td>
    </tr>`;
  });
  // Total row
  let tdTotalWeeks='';
  for(let w=1;w<=tw;w++)tdTotalWeeks+=`<td style="font-weight:800;color:var(--sage2)">${grandTotalPoinPerWeek[w-1]}</td>`;
  const totalRow=`<tr class="total-row">
    <td colspan="2" style="text-align:left;font-weight:800">Total Keseluruhan</td>
    ${tdTotalWeeks}
    <td style="font-weight:900;font-size:16px;color:var(--amber2)">${grandTotalPoin}</td>
  </tr>`;
  document.getElementById('rekap-table-wrap').innerHTML=`
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border);background:var(--sage3)">
        <div style="font-weight:800;font-size:14px;color:var(--sage2)">📋 Rekapitulasi Kehadiran — ${MONTHS[m]} ${y}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:3px;font-weight:600">${users.length} pengguna · ${tw} pekan · ${dim(y,m)} hari</div>
      </div>
      <div class="recap-table-wrap">
        <table class="recap-table">
          <thead><tr>
            <th style="width:40px">No</th>
            <th style="text-align:left">Nama & Jabatan</th>
            ${thWeeks}
            <th style="background:linear-gradient(135deg,#c4a46b,#a8874d)">Total Jam</th>
          </tr></thead>
          <tbody>${rows}${totalRow}</tbody>
        </table>
      </div>
    </div>`;
}

// ── EMAILJS CONFIG ──
// Isi dengan credentials EmailJS Anda
const EMAILJS_SERVICE_ID  = 'service_hslumfq';
const EMAILJS_TEMPLATE_ID = 'template_1o6guza';
const EMAILJS_PUBLIC_KEY  = 'OKFiGZTDpsAbkIFCZ';

// ── FORGOT PASSWORD STATE ──
let fpwOtpCode = '';
let fpwOtpExpiry = 0;

function showForgotPw(){
  document.getElementById('fpw-step1').style.display='';
  document.getElementById('fpw-step2').style.display='none';
  document.getElementById('fpw-step3').style.display='none';
  document.getElementById('fpw-email').value='';
  document.getElementById('fpw-otp').value='';
  ['fpw-err1','fpw-err2','fpw-err3'].forEach(id=>{const el=document.getElementById(id);el.style.display='none';el.textContent='';});
  const m=document.getElementById('modal-forgot-pw');
  m.style.display='flex';
}
function hideForgotPw(){
  document.getElementById('modal-forgot-pw').style.display='none';
}
function fpwBackStep1(){
  document.getElementById('fpw-step2').style.display='none';
  document.getElementById('fpw-step1').style.display='';
}
async function fpwSendOtp(){
  const email=document.getElementById('fpw-email').value.trim();
  const errEl=document.getElementById('fpw-err1');
  errEl.style.display='none';
  if(!email){errEl.textContent='Masukkan email terdaftar.';errEl.style.display='block';return;}
  showLoading('Memeriksa email...');
  try{
    const adminDoc=await getAdminDoc();
    const adminEmail=adminDoc&&adminDoc.email?adminDoc.email:'';
    if(!adminEmail){hideLoading();errEl.textContent='Email admin belum terdaftar. Hubungi administrator.';errEl.style.display='block';return;}
    if(email.toLowerCase()!==adminEmail.toLowerCase()){hideLoading();errEl.textContent='Email tidak cocok dengan yang terdaftar.';errEl.style.display='block';return;}
    // Generate 6-digit OTP
    fpwOtpCode=String(Math.floor(100000+Math.random()*900000));
    fpwOtpExpiry=Date.now()+10*60*1000; // valid 10 menit
    // Init EmailJS dan kirim
    emailjs.init(EMAILJS_PUBLIC_KEY);
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: adminEmail,
      otp_code: fpwOtpCode,
      app_name: 'Daftar Hadir Halaqah'
    });
    hideLoading();
    document.getElementById('fpw-step1').style.display='none';
    document.getElementById('fpw-step2').style.display='';
    document.getElementById('fpw-otp').focus();
  }catch(e){hideLoading();errEl.textContent='Gagal mengirim email: '+e.text||e.message||'Cek konfigurasi EmailJS.';errEl.style.display='block';}
}
function fpwVerifyOtp(){
  const code=document.getElementById('fpw-otp').value.trim();
  const errEl=document.getElementById('fpw-err2');
  errEl.style.display='none';
  if(!code){errEl.textContent='Masukkan kode verifikasi.';errEl.style.display='block';return;}
  if(Date.now()>fpwOtpExpiry){errEl.textContent='Kode sudah kadaluarsa. Kirim ulang kode.';errEl.style.display='block';return;}
  if(code!==fpwOtpCode){errEl.textContent='Kode verifikasi salah.';errEl.style.display='block';return;}
  document.getElementById('fpw-step2').style.display='none';
  document.getElementById('fpw-step3').style.display='';
  document.getElementById('fpw-new').focus();
}
async function fpwSaveNew(){
  const np=document.getElementById('fpw-new').value;
  const cp=document.getElementById('fpw-conf').value;
  const errEl=document.getElementById('fpw-err3');
  errEl.style.display='none';
  if(!np||!cp){errEl.textContent='Semua kolom wajib diisi.';errEl.style.display='block';return;}
  if(np!==cp){errEl.textContent='Konfirmasi password tidak cocok.';errEl.style.display='block';return;}
  if(np.length<6){errEl.textContent='Password minimal 6 karakter.';errEl.style.display='block';return;}
  showLoading('Menyimpan password baru...');
  try{
    await saveAdminDoc({pwHash:await hashPw(np)});
    fpwOtpCode='';fpwOtpExpiry=0;
    hideLoading();
    hideForgotPw();
    showToast('✅ Password berhasil direset! Silakan login kembali.');
  }catch(e){hideLoading();errEl.textContent='Gagal menyimpan: '+e.message;errEl.style.display='block';}
}

// ── ADMIN PROFILE: LOAD DISPLAY ──
async function loadAdminProfileDisplay(){
  try{
    const adminDoc=await getAdminDoc();
    const uname=adminDoc&&adminDoc.username?adminDoc.username:'admin';
    const email=adminDoc&&adminDoc.email?adminDoc.email:'—';
    const el1=document.getElementById('ap-username-display');
    const el2=document.getElementById('ap-email-display');
    if(el1)el1.textContent=uname;
    if(el2)el2.textContent=email;
    const inp=document.getElementById('ap-uname');
    if(inp)inp.value=uname==='admin'?'':uname;
    const inpEmail=document.getElementById('ap-email');
    if(inpEmail)inpEmail.value=email==='—'?'':email;
  }catch(e){}
}
window.loadAdminProfileDisplay=loadAdminProfileDisplay;

// ── ADMIN: GANTI USERNAME & EMAIL ──
async function changeAdminIdentity(){
  const newUname=document.getElementById('ap-uname').value.trim();
  const newEmail=document.getElementById('ap-email').value.trim();
  const pw=document.getElementById('ap-uname-pw').value;
  if(!newUname&&!newEmail){showToast('Isi username atau email yang ingin diubah.',false);return;}
  if(!pw){showToast('Masukkan password untuk konfirmasi.',false);return;}
  showLoading('Memverifikasi...');
  try{
    const adminDoc=await getAdminDoc();
    const pwHash=await hashPw(pw);
    const valid=adminDoc?adminDoc.pwHash===pwHash:pw===ADMIN_DEFAULT_PW;
    if(!valid){hideLoading();showToast('Password salah.',false);return;}
    const updates={};
    if(newUname)updates.username=newUname;
    if(newEmail){
      // Basic email validation
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)){hideLoading();showToast('Format email tidak valid.',false);return;}
      updates.email=newEmail;
    }
    // Preserve existing fields
    if(adminDoc){Object.keys(adminDoc).forEach(k=>{if(!(k in updates))updates[k]=adminDoc[k];});}
    await saveAdminDoc(updates);
    document.getElementById('ap-uname-pw').value='';
    hideLoading();
    showToast('✅ Username/email berhasil diperbarui!');
    loadAdminProfileDisplay();
  }catch(e){hideLoading();showToast('Gagal menyimpan: '+e.message,false);}
}
window.changeAdminIdentity=changeAdminIdentity;
window.showForgotPw=showForgotPw;
window.hideForgotPw=hideForgotPw;
window.fpwBackStep1=fpwBackStep1;
window.fpwSendOtp=fpwSendOtp;
window.fpwVerifyOtp=fpwVerifyOtp;
window.fpwSaveNew=fpwSaveNew;


// ══════════════════════════════════════════════
// ── HARI LIBUR & JADWAL PELAJARAN ──
// ══════════════════════════════════════════════

let hCalYear = TODAY.getFullYear();
let hCalMonth = TODAY.getMonth();
let hSelectedDates = new Set(); // Set of "YYYY-MM-DD" strings
let hMode = 'range'; // 'range' | 'pick'
let hScheduleData = null; // {uid: {H1:bool, J1:bool, ...}}
let globalSchedule = null; // Cache jadwal semua user: {uid: {dayJsIdx: {H1:bool,...}}}
let _savedScheduleCache = null; // cache jadwal tersimpan untuk render & edit di tempat
let scheduleEditMode = false;   // apakah tabel jadwal sedang dalam mode edit
let scheduleEditData = null;    // salinan jadwal yang sedang diedit di tempat
let _scheduleRowUids = [];      // urutan uid per baris tabel (untuk toggle sel)
let _savedScheduleEffective = ''; // tanggal mulai berlaku jadwal aktif ('' bila belum tercatat)

// ── Helpers jadwal pengguna ──
// Ambil jadwal sesi untuk uid pada dayJsIdx (0=Ahad,...,6=Sab)
// Return: {H1:bool,...} atau null jika tidak ada jadwal
function getUserDaySchedule(uid, dayJsIdx){
  if(!globalSchedule) return null; // jadwal belum termuat
  // Fallback: cek pakai uid dulu, lalu pakai username (sesuai cara upload template)
  const u = users.find(x=>x.id===uid);
  const uSched = globalSchedule[uid] || (u ? globalSchedule[u.username] : null);
  if(!uSched) return null; // user belum punya jadwal
  return uSched[dayJsIdx] || null; // hari ini tidak terjadwal
}

// Cek apakah sesi sk dijadwalkan untuk uid pada hari dayJsIdx
function isSessionScheduled(uid, dayJsIdx, sk){
  const daySched = getUserDaySchedule(uid, dayJsIdx);
  if(daySched === null) return false; // tidak ada jadwal = tidak boleh mengisi
  return daySched[sk] === true;
}

// Cek apakah user punya jadwal apapun (untuk info "jadwal belum diatur")
function userHasAnySchedule(uid){
  if(!globalSchedule) return false;
  const u = users.find(x=>x.id===uid);
  return !!(globalSchedule[uid] || (u && globalSchedule[u.username]));
}

// ── Firestore helpers ──
async function getHolidaySchedule(){
  const d = await getDoc(doc(fs,'config','schedule'));
  return d.exists() ? d.data() : {};
}
async function saveHolidaySchedule(data){
  const existing = await getHolidaySchedule();
  await setDoc(doc(fs,'config','schedule'), {...existing, ...data});
}
// Tanggal mulai berlaku jadwal terakhir yang diupload. '' jika belum pernah dicatat.
async function getScheduleEffectiveDate(){
  try{
    const d = await getDoc(doc(fs,'config','scheduleMeta'));
    return d.exists() ? (d.data().effectiveDate || '') : '';
  }catch(e){ return ''; }
}

// ── Modal open/close ──
function openHolidayModal(){
  hSelectedDates = new Set();
  hMode = 'range';
  document.getElementById('hm-range').style.display = '';
  document.getElementById('hm-pick').style.display = 'none';
  document.getElementById('h-err').style.display = 'none';
  document.getElementById('h-date-from').value = '';
  document.getElementById('h-date-to').value = '';
  document.getElementById('hpanel-rincian').style.display = 'none';
  switchHTab('libur');
  switchHMode('range');
  // Load saved schedule display
  loadSavedScheduleDisplay();
  prewarmXLSX(); // siapkan modul Excel untuk template/upload jadwal
  document.getElementById('modal-holiday').style.display = 'flex';
}
window.openHolidayModal = openHolidayModal;

function closeHolidayModal(){
  document.getElementById('modal-holiday').style.display = 'none';
}
window.closeHolidayModal = closeHolidayModal;

function switchHTab(tab){
  const isLibur = tab === 'libur';
  const isJadwal = tab === 'jadwal';
  const isRincian = tab === 'rincian';
  document.getElementById('hpanel-libur').style.display = isLibur ? '' : 'none';
  document.getElementById('hpanel-jadwal').style.display = isJadwal ? '' : 'none';
  document.getElementById('hpanel-rincian').style.display = isRincian ? '' : 'none';

  const btLibur = document.getElementById('htab-libur');
  const btJadwal = document.getElementById('htab-jadwal');
  const btRincian = document.getElementById('htab-rincian');

  btLibur.style.background = isLibur ? 'linear-gradient(135deg,#e8956d,#c4634a)' : 'var(--card)';
  btLibur.style.color = isLibur ? '#fff' : 'var(--muted)';
  btLibur.style.border = isLibur ? 'none' : '2px solid var(--border)';

  btJadwal.style.background = isJadwal ? 'linear-gradient(135deg,#7fb3a0,#5a9b86)' : 'var(--card)';
  btJadwal.style.color = isJadwal ? '#fff' : 'var(--muted)';
  btJadwal.style.border = isJadwal ? 'none' : '2px solid var(--border)';

  btRincian.style.background = isRincian ? 'linear-gradient(135deg,#f87171,#dc2626)' : 'var(--card)';
  btRincian.style.color = isRincian ? '#fff' : 'var(--muted)';
  btRincian.style.border = isRincian ? 'none' : '2px solid var(--border)';

  if(isRincian) refreshRincianLibur();
}
window.switchHTab = switchHTab;

function switchHMode(mode){
  hMode = mode;
  const isRange = mode === 'range';
  document.getElementById('hm-range').style.display = isRange ? '' : 'none';
  document.getElementById('hm-pick').style.display = isRange ? 'none' : '';
  const btRange = document.getElementById('hmode-range');
  const btPick = document.getElementById('hmode-pick');
  btRange.style.background = isRange ? 'var(--sage)' : 'var(--card)';
  btRange.style.color = isRange ? '#fff' : 'var(--muted)';
  btRange.style.border = isRange ? 'none' : '2px solid var(--border)';
  btPick.style.background = !isRange ? 'var(--sage)' : 'var(--card)';
  btPick.style.color = !isRange ? '#fff' : 'var(--muted)';
  btPick.style.border = !isRange ? 'none' : '2px solid var(--border)';
  if(!isRange) renderHCal();
}
window.switchHMode = switchHMode;

// ── Kalender picker ──
function renderHCal(){
  const y = hCalYear, m = hCalMonth;
  document.getElementById('hcal-label').textContent = MONTHS[m] + ' ' + y;
  const firstDay = new Date(y, m, 1).getDay();
  const totalDays = new Date(y, m+1, 0).getDate();
  // Header kalender admin: Sab, Ahd, Sen, Sel, Rab, Kam (skip Jumat)
  const hCalOffset = firstDay===5 ? 0 : (CAL_JS.indexOf(firstDay)>=0 ? CAL_JS.indexOf(firstDay) : 0);
  let html = CAL_COLS.map(d=>`<div style="text-align:center;font-size:10px;font-weight:700;color:var(--muted);padding:2px">${d}</div>`).join('');
  for(let i=0;i<hCalOffset;i++) html += '<div></div>';
  for(let d=1;d<=totalDays;d++){
    if(new Date(y,m,d).getDay()===5) continue; // skip Jumat
    const key = dk(y,m,d);
    const sel = hSelectedDates.has(key);
    html += `<div onclick="hToggleDay('${key}')" style="text-align:center;padding:4px 2px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:${sel?'800':'500'};background:${sel?'var(--sage)':'transparent'};color:${sel?'#fff':'var(--text)'};border:1px solid ${sel?'var(--sage)':'var(--border)'};">${d}</div>`;
  }
  document.getElementById('hcal-grid').innerHTML = html;
  const sel = [...hSelectedDates].sort();
  document.getElementById('hcal-selected').textContent = sel.length > 0 ? `${sel.length} hari dipilih: ${sel.join(', ')}` : 'Belum ada hari dipilih';
}
window.renderHCal = renderHCal;

function hToggleDay(key){
  if(hSelectedDates.has(key)) hSelectedDates.delete(key);
  else hSelectedDates.add(key);
  renderHCal();
}
window.hToggleDay = hToggleDay;

function hCalPrev(){
  hCalMonth--;
  if(hCalMonth < 0){ hCalMonth=11; hCalYear--; }
  renderHCal();
}
function hCalNext(){
  hCalMonth++;
  if(hCalMonth > 11){ hCalMonth=0; hCalYear++; }
  renderHCal();
}
window.hCalPrev = hCalPrev;
window.hCalNext = hCalNext;

// ── Kumpulkan tanggal yang dipilih ──
function getSelectedDates(){
  if(hMode === 'range'){
    const from = document.getElementById('h-date-from').value;
    const to = document.getElementById('h-date-to').value;
    if(!from) return {err:'Pilih tanggal mulai'};
    const dateFrom = new Date(from + 'T00:00:00');
    const dateTo = to ? new Date(to + 'T00:00:00') : dateFrom;
    if(dateTo < dateFrom) return {err:'Tanggal akhir harus setelah tanggal mulai'};
    const dates = [];
    for(let d=new Date(dateFrom); d<=dateTo; d.setDate(d.getDate()+1)){
      const y=d.getFullYear(), m=d.getMonth(), day=d.getDate();
      dates.push(dk(y,m,day));
    }
    return {dates};
  } else {
    if(hSelectedDates.size === 0) return {err:'Pilih minimal satu hari'};
    return {dates:[...hSelectedDates].sort()};
  }
}

// ── Apply kehadiran otomatis ──
async function applyHolidays(){
  const errEl = document.getElementById('h-err');
  errEl.style.display = 'none';
  const result = getSelectedDates();
  if(result.err){ errEl.textContent=result.err; errEl.style.display='block'; return; }
  const dates = result.dates;
  showLoading('Memuat jadwal pelajaran...');
  try{
    const schedule = await getHolidaySchedule();
    // Dapatkan user aktif (bukan cuti)
    const activeUsers = users.filter(u => u.status !== 'cuti');
    if(activeUsers.length === 0){ hideLoading(); errEl.textContent='Tidak ada pengguna aktif.'; errEl.style.display='block'; return; }
    
    // Check apakah ada jadwal tersimpan
    const hasSchedule = Object.keys(schedule).length > 0;
    
    showLoading(`Menerapkan kehadiran untuk ${dates.length} hari...`);
    let applied = 0, skipped = 0;
    const savePromises = [];
    
    for(const dateKey of dates){
      for(const user of activeUsers){
        // Load data user jika belum
        await loadAtt(user.id);
        
        // Tentukan hari dalam seminggu (0=Ahad/Minggu, 1=Senin, dst)
        // iOS Safari fix: tambah 'T00:00:00' agar diparsing sebagai local time bukan UTC
        const dateObj = new Date(dateKey + 'T00:00:00');
        const dayOfWeek = dateObj.getDay(); // 0=Ahad, 1=Senin, ..., 5=Jumat, 6=Sabtu
        // Jumat selalu libur - skip
        if(dayOfWeek === 5){ skipped++; continue; }
        // Ambil jadwal user untuk hari tersebut, atau default semua sesi true
        let dayData;
        const userSchedule = schedule[user.id] || schedule[user.username];
        if(hasSchedule && userSchedule && userSchedule[dayOfWeek]){
          dayData = {...emptyDay(), ...userSchedule[dayOfWeek]};
        } else if(hasSchedule && userSchedule){
          // Hari ini tidak ada jadwal untuk user ini = tidak masuk
          skipped++;
          continue;
        } else {
          // Jika tidak ada jadwal sama sekali: isi semua sesi
          dayData = SESSIONS.reduce((a,s)=>({...a,[s.key]:true}),{});
        }
        
        if(!localDb[user.id]) localDb[user.id] = {};
        localDb[user.id][dateKey] = dayData;
        savePromises.push(saveAtt(user.id, dateKey, dayData));
        applied++;
      }
    }
    
    await Promise.all(savePromises);
    // Simpan tanggal libur ke Firestore agar pengguna tidak bisa mengisi sendiri
    await saveHolidayDates(dates);
    hideLoading();
    closeHolidayModal();
    // Refresh rekap
    await renderRekapPage();
    showToast(`✅ ${applied} data kehadiran diterapkan sesuai jadwal`);
  }catch(e){ hideLoading(); errEl.textContent='Gagal: '+e.message; errEl.style.display='block'; }
}
window.applyHolidays = applyHolidays;

// ── Template download ──
function downloadScheduleTemplate(){
  if(!window.XLSX){ prewarmXLSX(); showToast('⏳ Menyiapkan modul Excel, klik lagi sebentar…',false); return; }
  const SESS_KEYS = SESSIONS.map(s=>s.key);
  // Urutan hari aktif: Sabtu, Ahad, Senin→Kamis (tanpa Jumat)
  const dayNames = ['Sabtu','Ahad','Senin','Selasa','Rabu','Kamis'];
  // Baris 1: header kelompok hari (nama hari diulang sebanyak jumlah sesi, sisanya kosong)
  const dayGroupRow = ['',''];
  dayNames.forEach(d=>{
    dayGroupRow.push(d);
    for(let i=1;i<SESS_KEYS.length;i++) dayGroupRow.push('');
  });
  // Baris 2: header kolom Username, Nama, lalu Hari_Sesi
  const colHeaders = [];
  dayNames.forEach(d => SESS_KEYS.forEach(s => colHeaders.push(d+'_'+s)));
  const headerRow = ['Username','Nama',...colHeaders];
  // Baris data: satu baris per user, default semua 0
  const dataRows = [];
  users.forEach(u=>{
    dataRows.push([u.username||u.id, u.name||'', ...colHeaders.map(()=>0)]);
  });
  // Susun: baris grup hari, lalu header kolom, lalu data
  const allRows = [dayGroupRow, headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  // Lebar kolom
  ws['!cols'] = [{wch:18},{wch:24},...colHeaders.map(()=>({wch:6}))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Jadwal');
  xlsxDownload(wb, 'template_jadwal_pelajaran.xlsx');
}
window.downloadScheduleTemplate = downloadScheduleTemplate;

// ── Preview jadwal dari file upload ──
async function previewSchedule(event){
  const file = event.target.files[0];
  if(!file) return;
  const errEl = document.getElementById('h-jadwal-err');
  errEl.style.display = 'none';
  try{
    await ensureXLSX(); // pastikan modul Excel siap sebelum membaca file
    const parsed = await parseScheduleFile(file);
    hScheduleData = parsed.data;
    const DAY_NAMES  = ['Sabtu','Ahad','Senin','Selasa','Rabu','Kamis'];
    const DAY_INDICES= [6,0,1,2,3,4];
    const SESS_KEYS  = SESSIONS.map(s=>s.key);
    // Header baris 1: hari (merged visual)
    let dayHeaderCells = `<th colspan="2" style="padding:4px 6px;background:var(--sage);color:#fff;border:1px solid var(--border)"></th>`;
    DAY_NAMES.forEach(d=>{
      dayHeaderCells += `<th colspan="${SESS_KEYS.length}" style="padding:4px 6px;background:var(--sage);color:#fff;border:1px solid var(--border);text-align:center">${d}</th>`;
    });
    // Header baris 2: sesi
    let sessHeaderCells = `<th style="padding:4px 6px;background:var(--sage2);color:#fff;border:1px solid var(--border)">Username</th><th style="padding:4px 6px;background:var(--sage2);color:#fff;border:1px solid var(--border)">Nama</th>`;
    DAY_NAMES.forEach((_,di)=> SESS_KEYS.forEach(s=>{
      sessHeaderCells += `<th style="padding:4px 4px;background:var(--sage2);color:#fff;border:1px solid var(--border);font-size:10px">${s}</th>`;
    }));
    let html = `<table style="border-collapse:collapse;font-size:11px"><thead>
      <tr>${dayHeaderCells}</tr>
      <tr>${sessHeaderCells}</tr>
    </thead><tbody>`;
    parsed.rows.forEach(row=>{
      html += `<tr>${row.map((v,i)=>`<td style="padding:3px 4px;border:1px solid var(--border);text-align:${i>1?'center':'left'};color:${(i>1&&v)?'var(--sage2)':'var(--text)'}">${i>1?(v?'✅':'—'):v}</td>`).join('')}</tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('h-schedule-table').innerHTML = html;
    document.getElementById('h-schedule-preview').style.display = '';
    document.getElementById('h-save-schedule-btn').style.display = '';
    // Tampilkan input tanggal mulai berlaku; default = hari ini agar libur lama tidak tersentuh
    const effWrap = document.getElementById('h-schedule-effective-wrap');
    const effInput = document.getElementById('h-schedule-effective-date');
    if(effWrap) effWrap.style.display = '';
    if(effInput && !effInput.value){
      const t = new Date();
      effInput.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    }
  }catch(e){ errEl.textContent='Gagal baca file: '+e.message; errEl.style.display='block'; }
}
window.previewSchedule = previewSchedule;

// ── Parse file Excel/CSV ──
async function parseScheduleFile(file){
  // Format template:
  //   Baris 1 : grup hari  → ['','','Senin','','','','','','','','','Selasa',...]
  //   Baris 2 : header     → ['Username','Nama','Senin_H1','Senin_H2',...,'Ahad_S2']
  //   Baris 3+ : data user → ['p01','Nama Guru', 1, 0, ...]
  // Hari aktif (tanpa Jumat), urutan Sabtu → Kamis
  const SESS_KEYS  = SESSIONS.map(s=>s.key);
  const DAY_NAMES  = ['Sabtu','Ahad','Senin','Selasa','Rabu','Kamis'];
  const DAY_INDICES= [6,0,1,2,3,4]; // sesuai Date.getDay()

  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        let rows2d;
        if(file.name.toLowerCase().endsWith('.csv')){
          const text = e.target.result;
          rows2d = text.split('\n')
            .map(r=>r.split(',').map(v=>v.trim().replace(/^"|"$/g,'')))
            .filter(r=>r.some(c=>c!==''));
        } else {
          const wb = XLSX.read(e.target.result, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows2d = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        }

        // Cari baris header (yang mengandung 'username' di salah satu selnya)
        let headerRowIdx = -1;
        for(let i=0; i<Math.min(5, rows2d.length); i++){
          if(rows2d[i].some(c=>String(c).trim().toLowerCase()==='username')){
            headerRowIdx = i; break;
          }
        }
        if(headerRowIdx < 0){ reject(new Error('Baris header "Username" tidak ditemukan. Pastikan format sesuai template.')); return; }

        const header = rows2d[headerRowIdx].map(h=>String(h).trim());
        const unameIdx = header.findIndex(h=>h.toLowerCase()==='username');
        const namaIdx  = header.findIndex(h=>h.toLowerCase()==='nama');

        // Mapping kolom index → {dayIndex (JS), sessKey}
        // Kolom format: "Senin_H1", "Selasa_J3", dst
        const colMap = {};
        header.forEach((h,i)=>{
          const sep = h.lastIndexOf('_');
          if(sep < 0) return;
          const day  = h.substring(0, sep);
          const sess = h.substring(sep+1);
          const di   = DAY_NAMES.indexOf(day);
          if(di >= 0 && SESS_KEYS.includes(sess)){
            colMap[i] = {dayJsIdx: DAY_INDICES[di], sess};
          }
        });

        if(Object.keys(colMap).length === 0){
          reject(new Error('Tidak ada kolom jadwal yang dikenali. Pastikan format kolom: Senin_H1, Selasa_J2, dst.')); return;
        }

        const data = {};
        const previewRows = [];

        for(let i=headerRowIdx+1; i<rows2d.length; i++){
          const row = rows2d[i];
          const uname = String(row[unameIdx]||'').trim();
          if(!uname) continue;
          const nama = namaIdx>=0 ? String(row[namaIdx]||'').trim() : '';
          const user = users.find(u=>u.username===uname||u.id===uname);
          const uid  = user ? user.id : uname;

          // Inisialisasi weekData: {dayJsIdx: {H1:false, H2:false, ...}}
          const weekData = {};
          DAY_INDICES.forEach(di=>{
            weekData[di] = SESS_KEYS.reduce((a,s)=>({...a,[s]:false}),{});
          });

          // Isi dari kolom yang terbaca
          Object.entries(colMap).forEach(([ci,{dayJsIdx,sess}])=>{
            const val = row[parseInt(ci)];
            weekData[dayJsIdx][sess] = !!val && val!==0 && val!=='0' && val!=='';
          });

          data[uid] = weekData;

          // Preview row: Username, Nama, lalu nilai per hari-sesi (urutan DAY_NAMES)
          const previewCols = [uname, nama||user?.name||user?.username||'—'];
          DAY_NAMES.forEach((_,di)=>
            SESS_KEYS.forEach(s=> previewCols.push(weekData[DAY_INDICES[di]][s] ? 1 : 0))
          );
          previewRows.push(previewCols);
        }

        if(previewRows.length === 0){ reject(new Error('Tidak ada data pengguna yang terbaca.')); return; }
        resolve({data, rows:previewRows, colHeaders: DAY_NAMES.flatMap(d=>SESS_KEYS.map(s=>d+'_'+s))});
      }catch(err){ reject(err); }
    };
    if(file.name.toLowerCase().endsWith('.csv')) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

// ── Simpan jadwal ke Firestore ──
async function saveSchedule(){
  if(!hScheduleData){ showToast('Tidak ada data jadwal',false); return; }
  // Tanggal mulai berlaku: hari libur sebelum tanggal ini TIDAK disentuh
  const effInput = document.getElementById('h-schedule-effective-date');
  const effectiveDate = effInput ? effInput.value : '';
  if(!effectiveDate){ showToast('Tentukan dulu Tanggal Mulai Berlaku',false); return; }
  showLoading('Menyimpan jadwal...');
  try{
    // 1. Simpan jadwal baru ke Firestore + catat tanggal mulai berlaku (dipakai edit di tempat)
    await setDoc(doc(fs,'config','schedule'), hScheduleData);
    await setDoc(doc(fs,'config','scheduleMeta'), {effectiveDate});

    // 2. Ambil tanggal libur yang sudah ditandai, batasi hanya tanggal >= tanggal mulai berlaku.
    // Perbandingan string "YYYY-MM-DD" aman secara leksikografis untuk urutan tanggal.
    const allHolidayDates = await getHolidayDates();
    const holidayDates = allHolidayDates.filter(d => d >= effectiveDate);

    if(holidayDates.length > 0){
      showLoading(`Memperbarui absensi untuk ${holidayDates.length} hari libur sesuai jadwal baru...`);

      const schedule = hScheduleData;
      const hasSchedule = Object.keys(schedule).length > 0;
      const activeUsers = users.filter(u => u.status !== 'cuti');
      const savePromises = [];

      for(const dateKey of holidayDates){
        // iOS Safari fix: tambah 'T00:00:00' agar diparsing sebagai local time bukan UTC
        const dateObj = new Date(dateKey + 'T00:00:00');
        const dayOfWeek = dateObj.getDay();
        if(dayOfWeek === 5) continue; // Jumat skip

        for(const user of activeUsers){
          await loadAtt(user.id);

          let dayData;
          const userSchedule = schedule[user.id] || schedule[user.username];
          if(hasSchedule && userSchedule && userSchedule[dayOfWeek]){
            dayData = {...emptyDay(), ...userSchedule[dayOfWeek]};
          } else if(hasSchedule && userSchedule){
            // User tidak ada jadwal di hari ini → kosongkan
            dayData = emptyDay();
          } else {
            // Tidak ada jadwal sama sekali → isi semua sesi
            dayData = SESSIONS.reduce((a,s)=>({...a,[s.key]:true}),{});
          }

          if(!localDb[user.id]) localDb[user.id] = {};
          localDb[user.id][dateKey] = dayData;
          savePromises.push(saveAtt(user.id, dateKey, dayData));
        }
      }

      await Promise.all(savePromises);
      await renderRekapPage();
      showToast(`✅ Jadwal disimpan & ${holidayDates.length} hari libur sejak ${effectiveDate} diperbarui. Data sebelumnya tidak diubah.`);
    } else {
      showToast('✅ Jadwal pelajaran berhasil disimpan! Tidak ada hari libur sejak tanggal berlaku yang perlu diperbarui.');
    }

    loadSavedScheduleDisplay();
    document.getElementById('h-save-schedule-btn').style.display = 'none';
    document.getElementById('h-schedule-preview').style.display = 'none';
    const effWrap = document.getElementById('h-schedule-effective-wrap');
    if(effWrap) effWrap.style.display = 'none';
    document.getElementById('h-schedule-file').value = '';
    hideLoading();
  }catch(e){ hideLoading(); showToast('Gagal simpan: '+e.message, false); }
}
window.saveSchedule = saveSchedule;

// ── Tampilkan jadwal tersimpan ──
// Ambil data dari Firestore lalu render. Selalu keluar dari mode edit saat data dimuat ulang.
async function loadSavedScheduleDisplay(){
  const savedEl = document.getElementById('h-saved-schedule');
  const tableEl = document.getElementById('h-saved-table');
  if(!savedEl||!tableEl) return;
  try{
    _savedScheduleCache = await getHolidaySchedule();
    // Tanggal mulai berlaku di-cache agar tombol unduh tetap sinkron (syarat popup iOS).
    _savedScheduleEffective = await getScheduleEffectiveDate();
    scheduleEditMode = false;
    scheduleEditData = null;
    setScheduleEditButtons(false);
    renderScheduleEffectiveInfo();
    renderSavedSchedule();
  }catch(e){ savedEl.style.display='none'; }
}
window.loadSavedScheduleDisplay = loadSavedScheduleDisplay;

// Tampilkan keterangan sejak kapan jadwal tersimpan berlaku.
function renderScheduleEffectiveInfo(){
  const el = document.getElementById('h-schedule-eff-info');
  if(!el) return;
  el.textContent = _savedScheduleEffective
    ? `Berlaku sejak ${fmtEffectiveDate(_savedScheduleEffective)}`
    : 'Tanggal mulai berlaku belum tercatat';
}

// "2026-08-04" → "4 Agustus 2026". Kembalikan apa adanya bila format tak dikenali.
function fmtEffectiveDate(key){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key||'');
  if(!m) return key||'';
  return `${Number(m[3])} ${MONTHS[Number(m[2])-1]} ${m[1]}`;
}

// Atur tampilan tombol Edit / Simpan / Batal + hint.
function setScheduleEditButtons(editing){
  const ids = {edit:'h-edit-schedule-btn', save:'h-save-edit-btn', cancel:'h-cancel-edit-btn',
               hint:'h-edit-hint', dl:'h-download-schedule-btn'};
  const eb=document.getElementById(ids.edit), sb=document.getElementById(ids.save),
        cb=document.getElementById(ids.cancel), hb=document.getElementById(ids.hint),
        db=document.getElementById(ids.dl);
  if(db) db.style.display = editing ? 'none' : ''; // unduh hanya untuk jadwal aktif tersimpan
  if(eb) eb.style.display = editing ? 'none' : '';
  if(sb) sb.style.display = editing ? '' : 'none';
  if(cb) cb.style.display = editing ? '' : 'none';
  if(hb) hb.style.display = editing ? '' : 'none';
}

// Susun urutan baris tabel jadwal: user yang ada di `source` (mode edit sudah berisi semua
// user aktif), lalu user aktif yang belum punya jadwal sama sekali.
// `schedule` = jadwal tersimpan asli, dipakai menandai baris "belum diatur".
// Dipakai bersama oleh render tabel & ekspor Excel agar urutannya selalu sama.
function buildScheduleRows(source, schedule){
  const src = source || {};
  const origScheduledUids = new Set(Object.keys(schedule || {}));
  const rows = [];
  Object.keys(src).forEach(uid=>{
    const user = users.find(u=>u.id===uid);
    rows.push({
      uid,
      label: user ? (user.name||user.username||uid) : uid,
      username: user ? (user.username||user.id) : uid,
      week: src[uid]||{},
      unscheduled: !origScheduledUids.has(uid),
      inSource: true
    });
  });
  const sourceUids = new Set(Object.keys(src));
  users.filter(u => u.status !== 'cuti' && !sourceUids.has(u.id)).forEach(user=>{
    rows.push({
      uid: user.id,
      label: user.name||user.username||user.id,
      username: user.username||user.id,
      week: {},
      unscheduled: true,
      inSource: false
    });
  });
  return rows;
}

// Render tabel jadwal dari cache (mode lihat) atau scheduleEditData (mode edit).
function renderSavedSchedule(){
  const savedEl = document.getElementById('h-saved-schedule');
  const tableEl = document.getElementById('h-saved-table');
  if(!savedEl||!tableEl) return;

  const schedule = _savedScheduleCache || {};
  const source = scheduleEditMode ? (scheduleEditData || {}) : schedule;
  const SESS_KEYS  = SESSIONS.map(s=>s.key);
  const DAY_NAMES  = ['Sabtu','Ahad','Senin','Selasa','Rabu','Kamis'];
  const DAY_INDICES= [6,0,1,2,3,4];

  const rows = buildScheduleRows(source, schedule);

  if(rows.length === 0){ savedEl.style.display='none'; return; }
  _scheduleRowUids = rows.map(r=>r.uid);

  // Header baris 1: hari
  let dayHdr = `<th rowspan="2" style="padding:4px 6px;background:var(--amber);color:#fff;border:1px solid var(--border);vertical-align:middle">Nama</th>`;
  DAY_NAMES.forEach(d=>{
    dayHdr += `<th colspan="${SESS_KEYS.length}" style="padding:3px 4px;background:var(--amber);color:#fff;border:1px solid var(--border);text-align:center;font-size:11px">${d}</th>`;
  });
  let sessHdr = DAY_NAMES.flatMap(()=>SESS_KEYS.map(s=>`<th style="padding:2px 3px;background:var(--amber2);color:#fff;border:1px solid var(--border);font-size:9px">${s}</th>`)).join('');
  let html = `<table style="border-collapse:collapse;font-size:11px"><thead>
    <tr>${dayHdr}</tr><tr>${sessHdr}</tr>
  </thead><tbody>`;

  rows.forEach((row, ri)=>{
    const rowBg = (!scheduleEditMode && row.unscheduled) ? 'background:#fffbeb' : '';
    const nameColor = (row.unscheduled && !scheduleEditMode) ? 'color:#d97706' : '';
    const badge = row.unscheduled
      ? ` <span style="font-size:10px;background:#fef3c7;color:#d97706;border:1px solid #fde68a;border-radius:6px;padding:1px 5px;margin-left:4px">⚠️ Belum diatur</span>`
      : '';
    let cells = `<td style="padding:3px 6px;border:1px solid var(--border);font-weight:600;white-space:nowrap;${nameColor}">${row.label}${badge}</td>`;
    DAY_NAMES.forEach((_,di)=>{
      const dayIdx = DAY_INDICES[di];
      const dayData = row.week[dayIdx] || {};
      SESS_KEYS.forEach(s=>{
        const on = dayData[s] === true;
        if(scheduleEditMode){
          cells += `<td id="sc-${ri}-${dayIdx}-${s}" onclick="toggleScheduleCell(${ri},${dayIdx},'${s}')" title="Klik untuk ubah" style="padding:2px 3px;border:1px solid var(--border);text-align:center;cursor:pointer;user-select:none;color:${on?'var(--sage2)':'var(--muted)'};${on?'background:#f0fdf4':''}">${on?'✅':'—'}</td>`;
        } else {
          const c = on ? 'var(--sage2)' : (row.unscheduled ? '#d97706' : 'var(--muted)');
          cells += `<td style="padding:2px 3px;border:1px solid var(--border);text-align:center;color:${c}">${on?'✅':'—'}</td>`;
        }
      });
    });
    html += `<tr style="${rowBg}">${cells}</tr>`;
  });

  html += '</tbody></table>';

  if(!scheduleEditMode){
    const cnt = rows.filter(r=>!r.inSource).length;
    if(cnt > 0){
      html += `<div style="margin-top:8px;padding:8px 12px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:8px;font-size:11px;color:#92400e;font-weight:600">
        ⚠️ ${cnt} pengguna belum memiliki jadwal. Klik <b>✏️ Edit di Tempat</b> untuk mengaturnya langsung, atau upload template.
      </div>`;
    }
  }
  tableEl.innerHTML = html;
  savedEl.style.display = '';
}
window.renderSavedSchedule = renderSavedSchedule;

// ── Download jadwal aktif ke Excel ──
// Mengunduh jadwal yang berlaku sekarang (tersimpan di config/schedule) dengan format
// kolom yang sama seperti template, sehingga file hasil unduhan bisa diedit lalu
// diupload kembali. Dua baris judul di atas tabel tetap terbaca parser (mencari
// baris header "Username" pada 5 baris pertama).
function downloadActiveSchedule(){
  if(!window.XLSX){ prewarmXLSX(); showToast('⏳ Menyiapkan modul Excel, klik lagi sebentar…',false); return; }
  const schedule = _savedScheduleCache || {};
  if(Object.keys(schedule).length === 0){ showToast('Belum ada jadwal aktif untuk diunduh',false); return; }

  const SESS_KEYS  = SESSIONS.map(s=>s.key);
  const DAY_NAMES  = ['Sabtu','Ahad','Senin','Selasa','Rabu','Kamis'];
  const DAY_INDICES= [6,0,1,2,3,4];
  const rows = buildScheduleRows(schedule, schedule);

  const totalCols = 2 + DAY_NAMES.length * SESS_KEYS.length;
  const pad = (arr)=>[...arr, ...Array(Math.max(0, totalCols-arr.length)).fill('')];

  const todayKey = dateToKey(new Date());
  const effLabel = _savedScheduleEffective
    ? `Berlaku sejak ${fmtEffectiveDate(_savedScheduleEffective)}`
    : 'Tanggal mulai berlaku belum tercatat';

  // Baris 1-2: judul & keterangan berlaku, baris 3: grup hari, baris 4: header kolom.
  const titleRow = pad(['JADWAL PELAJARAN AKTIF']);
  const metaRow  = pad([`${effLabel} — diunduh ${fmtEffectiveDate(todayKey)}`]);
  const dayGroupRow = ['',''];
  DAY_NAMES.forEach(d=>{
    dayGroupRow.push(d);
    for(let i=1;i<SESS_KEYS.length;i++) dayGroupRow.push('');
  });
  const colHeaders = [];
  DAY_NAMES.forEach(d => SESS_KEYS.forEach(s => colHeaders.push(d+'_'+s)));
  const headerRow = ['Username','Nama',...colHeaders];

  const dataRows = rows.map(row=>{
    const cells = [row.username, row.label];
    DAY_INDICES.forEach(dayIdx=>{
      const dayData = row.week[dayIdx] || {};
      SESS_KEYS.forEach(s=>cells.push(dayData[s] === true ? 1 : 0));
    });
    return cells;
  });

  const ws = XLSX.utils.aoa_to_sheet([titleRow, metaRow, dayGroupRow, headerRow, ...dataRows]);
  ws['!cols'] = [{wch:18},{wch:28},...colHeaders.map(()=>({wch:5}))];
  // Gabungkan judul (baris 1-2) dan tiap grup hari (baris 3) agar mudah dibaca.
  const merges = [
    {s:{r:0,c:0}, e:{r:0,c:totalCols-1}},
    {s:{r:1,c:0}, e:{r:1,c:totalCols-1}}
  ];
  DAY_NAMES.forEach((_,di)=>{
    const start = 2 + di*SESS_KEYS.length;
    merges.push({s:{r:2,c:start}, e:{r:2,c:start+SESS_KEYS.length-1}});
  });
  ws['!merges'] = merges;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Jadwal Aktif');
  xlsxDownload(wb, `Jadwal_Aktif_${_savedScheduleEffective || todayKey}.xlsx`);
  if(!isIOS) showToast('✅ Jadwal aktif berhasil diunduh');
}
window.downloadActiveSchedule = downloadActiveSchedule;

// Masuk mode edit: salin jadwal saat ini, siapkan slot kosong untuk semua user aktif.
async function toggleScheduleEdit(){
  try{
    if(!_savedScheduleCache) _savedScheduleCache = await getHolidaySchedule();
    scheduleEditData = JSON.parse(JSON.stringify(_savedScheduleCache || {}));
    const DAY_INDICES=[6,0,1,2,3,4];
    users.filter(u=>u.status!=='cuti').forEach(u=>{
      if(!scheduleEditData[u.id]){
        const wk={}; DAY_INDICES.forEach(di=>wk[di]={}); scheduleEditData[u.id]=wk;
      }
    });
    scheduleEditMode = true;
    setScheduleEditButtons(true);
    renderSavedSchedule();
  }catch(e){ showToast('Gagal memuat jadwal untuk diedit: '+e.message, false); }
}
window.toggleScheduleEdit = toggleScheduleEdit;

// Toggle satu sel jadwal (update data + tampilan sel saja, tanpa render ulang penuh).
function toggleScheduleCell(rowIdx, dayIdx, sess){
  if(!scheduleEditMode || !scheduleEditData) return;
  const uid = _scheduleRowUids[rowIdx];
  if(!uid) return;
  if(!scheduleEditData[uid]) scheduleEditData[uid] = {};
  if(!scheduleEditData[uid][dayIdx]) scheduleEditData[uid][dayIdx] = {};
  const nv = !scheduleEditData[uid][dayIdx][sess];
  scheduleEditData[uid][dayIdx][sess] = nv;
  const cell = document.getElementById(`sc-${rowIdx}-${dayIdx}-${sess}`);
  if(cell){
    cell.textContent = nv ? '✅' : '—';
    cell.style.color = nv ? 'var(--sage2)' : 'var(--muted)';
    cell.style.background = nv ? '#f0fdf4' : '';
  }
}
window.toggleScheduleCell = toggleScheduleCell;

// Batalkan edit: buang perubahan, kembali ke mode lihat.
function cancelScheduleEdit(){
  scheduleEditMode = false;
  scheduleEditData = null;
  setScheduleEditButtons(false);
  renderSavedSchedule();
}
window.cancelScheduleEdit = cancelScheduleEdit;

// Format Date → "YYYY-MM-DD" (local time).
function dateToKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Hitung perubahan sesi (delta) antara jadwal lama & baru.
// Return: [{uid, day(JsIdx), sess, newVal(bool)}]
function computeScheduleDelta(orig, cleaned){
  const SESS_KEYS = SESSIONS.map(s=>s.key);
  const DAY_INDICES = [6,0,1,2,3,4];
  const uids = new Set([...Object.keys(orig||{}), ...Object.keys(cleaned||{})]);
  const delta = [];
  uids.forEach(uid=>{
    DAY_INDICES.forEach(day=>{
      SESS_KEYS.forEach(sess=>{
        const o = !!(orig[uid] && orig[uid][day] && orig[uid][day][sess]===true);
        const n = !!(cleaned[uid] && cleaned[uid][day] && cleaned[uid][day][sess]===true);
        if(o!==n) delta.push({uid, day, sess, newVal:n});
      });
    });
  });
  return delta;
}

// Peta tanggal per hari-dalam-minggu untuk rentang [startKey, endKey] inklusif.
function datesInRangeByDow(startKey, endKey){
  const map = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
  const cur = new Date(startKey+'T00:00:00');
  const end = new Date(endKey+'T00:00:00');
  while(cur <= end){
    map[cur.getDay()].push(dateToKey(cur));
    cur.setDate(cur.getDate()+1);
  }
  return map;
}

// Ringkasan delta untuk dialog konfirmasi.
function summarizeDelta(delta){
  const DF_FULL = ['Ahad','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const lines = delta.slice(0,8).map(d=>{
    const u = users.find(x=>x.id===d.uid);
    const label = u ? (u.name||u.username||d.uid) : d.uid;
    return `• ${d.sess} ${DF_FULL[d.day]} → ${d.newVal?'ON':'OFF'} (${label})`;
  });
  if(delta.length>8) lines.push(`• …dan ${delta.length-8} perubahan lain`);
  return lines.join('\n');
}

// Terapkan delta ke tanggal-tanggal lampau. Hanya sesi yang berubah yang diubah;
// sesi lain pada tanggal itu tidak disentuh. Return jumlah tanggal-guru yang ditulis.
async function applyScheduleDeltaRetro(delta, dowDates){
  // Kelompokkan perubahan per (uid, tanggal) → 1 tulis per tanggal walau banyak sesi berubah.
  const changesByUidDate = {};
  for(const dch of delta){
    for(const dateKey of (dowDates[dch.day] || [])){
      const k = `${dch.uid}|${dateKey}`;
      (changesByUidDate[k] = changesByUidDate[k] || []).push(dch);
    }
  }
  // Muat kehadiran semua user yang terdampak.
  for(const uid of new Set(delta.map(d=>d.uid))){ await loadAtt(uid); }

  const savePromises = [];
  let count = 0;
  for(const [k, changes] of Object.entries(changesByUidDate)){
    const sep = k.indexOf('|');
    const uid = k.slice(0, sep);
    const dateKey = k.slice(sep+1);
    const [y,m,d] = dateKey.split('-').map(Number);
    if(isBeforeJoinDate(uid, y, m-1, d)) continue; // lewati sebelum bergabung
    const existed = !!(localDb[uid] && localDb[uid][dateKey]);
    // Tanggal belum ada catatan & semua perubahan hanya mematikan sesi → tidak perlu tulis apa pun.
    if(!existed && changes.every(c=>c.newVal===false)) continue;
    const day = existed ? {...localDb[uid][dateKey]} : emptyDay();
    changes.forEach(c=>{ day[c.sess] = c.newVal; });
    if(!localDb[uid]) localDb[uid] = {};
    localDb[uid][dateKey] = day;
    savePromises.push(saveAtt(uid, dateKey, day));
    count++;
  }
  await Promise.all(savePromises);
  return count;
}

// Simpan hasil edit ke Firestore. Pola jadwal (config/schedule) selalu diperbarui untuk ke depan.
// Jika ada perubahan sesi, tawarkan menerapkannya MUNDUR ke tanggal sejak jadwal terakhir berlaku —
// hanya sesi yang berubah yang disesuaikan, data lain tidak disentuh.
async function saveScheduleEdits(){
  if(!scheduleEditMode || !scheduleEditData){ return; }
  showLoading('Menyimpan perubahan jadwal...');
  try{
    // Buang slot kosong untuk user yang sebelumnya belum punya jadwal & tidak diberi sesi apa pun,
    // agar status "belum diatur" mereka tidak berubah tanpa sengaja.
    const orig = _savedScheduleCache || {};
    const cleaned = {};
    Object.entries(scheduleEditData).forEach(([uid, week])=>{
      const wasScheduled = !!orig[uid];
      const hasAnySession = Object.values(week||{}).some(day=>Object.values(day||{}).some(Boolean));
      if(wasScheduled || hasAnySession) cleaned[uid] = week;
    });

    // Hitung delta SEBELUM cache lama ditimpa.
    const delta = computeScheduleDelta(orig, cleaned);

    // Simpan pola jadwal untuk ke depan.
    await setDoc(doc(fs,'config','schedule'), cleaned);
    _savedScheduleCache = JSON.parse(JSON.stringify(cleaned));
    globalSchedule = _savedScheduleCache; // sinkronkan cache validasi sesi
    scheduleEditMode = false;
    scheduleEditData = null;
    setScheduleEditButtons(false);
    renderSavedSchedule();
    hideLoading();

    if(delta.length === 0){
      showToast('✅ Jadwal disimpan. Tidak ada perubahan sesi yang terdeteksi.');
      return;
    }

    // Ambil tanggal mulai berlaku jadwal terakhir; jika belum tercatat, minta sekali.
    let effectiveDate = await getScheduleEffectiveDate();
    const todayKey = dateToKey(new Date());
    if(!effectiveDate){
      const inp = prompt('Jadwal terakhir belum punya "tanggal mulai berlaku" tersimpan.\n\nIsi tanggal acuan (format YYYY-MM-DD) untuk menerapkan perubahan mundur, atau tekan Batal untuk hanya berlaku ke depan:', todayKey);
      if(inp && /^\d{4}-\d{2}-\d{2}$/.test(inp.trim())){
        effectiveDate = inp.trim();
        await setDoc(doc(fs,'config','scheduleMeta'), {effectiveDate});
      } else {
        showToast('✅ Perubahan jadwal disimpan (hanya berlaku ke depan).');
        return;
      }
    }

    if(effectiveDate > todayKey){
      showToast('✅ Perubahan jadwal disimpan (berlaku ke depan). Tanggal berlaku belum lewat.');
      return;
    }

    // Pratinjau jumlah tanggal terdampak.
    const dowDates = datesInRangeByDow(effectiveDate, todayKey);
    let affected = 0;
    delta.forEach(dch=>{ affected += (dowDates[dch.day]||[]).length; });

    const ok = confirm(
      `Perubahan jadwal:\n${summarizeDelta(delta)}\n\n` +
      `Terapkan juga MUNDUR ke tanggal yang sudah lalu sejak jadwal terakhir berlaku (${effectiveDate})?\n\n` +
      `• Hanya sesi yang berubah yang disesuaikan; kehadiran lain tidak diubah.\n` +
      `• Sekitar ${affected} tanggal-guru akan disesuaikan.\n` +
      `• Hitungan jam pada bulan yang sudah lewat bisa berubah.\n\n` +
      `OK = Terapkan mundur    •    Batal = Hanya ke depan`
    );
    if(!ok){
      showToast('✅ Perubahan jadwal disimpan (hanya berlaku ke depan).');
      return;
    }

    showLoading('Menerapkan perubahan ke tanggal sebelumnya...');
    const applied = await applyScheduleDeltaRetro(delta, dowDates);
    hideLoading();
    showToast(`✅ Perubahan diterapkan ke ${applied} tanggal sejak ${effectiveDate}. Sesi & data lain tidak diubah.`);
  }catch(e){ hideLoading(); showToast('Gagal simpan: '+e.message, false); }
}
window.saveScheduleEdits = saveScheduleEdits;



// ══════════════════════════════════════════════════════════
// ── KETERANGAN KEHADIRAN (HARIAN & RENTANG) ──
// ══════════════════════════════════════════════════════════
// Dua tampilan, satu sumber data (collection 'ket_harian'):
//   • Tab "Harian"          : pilih tanggal → daftar guru yang jadwalnya aktif hari
//                             itu → admin beri keterangan per guru, untuk seluruh
//                             sesi terjadwal atau sebagian sesi saja.
//   • Tab "Daftar Bulanan"  : rekap keterangan sebulan + tambah untuk beberapa hari
//                             (rentang tanggal di-expand menjadi entri harian).
// Keterangan mengunci sesi terkait pada isian guru; admin tetap bisa mengubah.

let ketYear = TODAY.getFullYear();
let ketMonth = TODAY.getMonth();
let ketType = '';           // jenis pada modal rentang
let ketTab = 'harian';

// Tanggal aktif pada tab Harian
let harDate = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());

// State modal keterangan harian
let khScheduled = [];        // sesi yang boleh diberi keterangan (jadwal guru hari itu)
let khSelected = new Set();  // sesi yang dicentang admin
let khType = '';

// ── Helpers ──

// Sesi yang dijadwalkan untuk uid pada hari dayJsIdx.
// Bila jadwal user belum pernah diatur sama sekali → anggap semua sesi
// (konsisten dengan perhitungan rekap "Belum Lengkap").
function ketScheduledSessions(uid, dayJsIdx){
  const day = getUserDaySchedule(uid, dayJsIdx);
  if(day === null){
    return userHasAnySchedule(uid) ? [] : SESSIONS.map(s=>s.key);
  }
  return SESSIONS.filter(s=>day[s.key]===true).map(s=>s.key);
}

// Urutkan daftar sesi mengikuti urutan SESSIONS.
function sortSessKeys(keys){
  const order = SESSIONS.map(s=>s.key);
  return [...new Set(keys)].sort((a,b)=>order.indexOf(a)-order.indexOf(b));
}

// Pastikan jadwal global sudah termuat (admin tidak memuatnya saat login).
async function ensureGlobalSchedule(){
  if(globalSchedule) return;
  try{ globalSchedule = await getHolidaySchedule(); }catch(e){ globalSchedule = {}; }
}

// Hari kerja = bukan Jumat dan bukan hari libur.
function isHariKerja(y, m, d){
  return new Date(y,m,d).getDay() !== 5 && !isHolidayKey(dk(y,m,d));
}

// ── Tab switch ──
function switchKetTab(tab){
  ketTab = tab;
  ['harian','daftar'].forEach(t=>{
    const btn = document.getElementById('ktab-'+t);
    if(btn) btn.classList.toggle('active', t===tab);
    const view = document.getElementById('ket-view-'+t);
    if(view) view.style.display = t===tab ? '' : 'none';
  });
  if(tab==='harian') renderHarianPage(); else renderKetListPage();
}
window.switchKetTab = switchKetTab;

// Dipanggil dari adminNav('keterangan')
function renderKetPage(){
  switchKetTab(ketTab);
}
window.renderKetPage = renderKetPage;

// ══════════════════════════════════════════════════════════
// TAB HARIAN
// ══════════════════════════════════════════════════════════

const harKey = () => dk(harDate.getFullYear(), harDate.getMonth(), harDate.getDate());

// Geser tanggal, lewati Jumat (tidak ada KBM).
function harShiftDay(delta){
  do { harDate.setDate(harDate.getDate()+delta); } while(harDate.getDay()===5);
  renderHarianPage();
}
function harPrevDay(){ harShiftDay(-1); }
function harNextDay(){ harShiftDay(1); }
function harToday(){
  harDate = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  renderHarianPage();
}
function harPickDate(v){
  if(!v) return;
  // iOS Safari fix: 'T00:00:00' agar diparsing sebagai waktu lokal
  const d = new Date(v+'T00:00:00');
  if(isNaN(d.getTime())) return;
  harDate = d;
  renderHarianPage();
}
window.harPrevDay = harPrevDay;
window.harNextDay = harNextDay;
window.harToday = harToday;
window.harPickDate = harPickDate;

async function renderHarianPage(){
  const y = harDate.getFullYear(), m = harDate.getMonth(), d = harDate.getDate();
  const dow = harDate.getDay(), dateKey = dk(y,m,d);
  document.getElementById('har-day-label').textContent = DF[dow];
  document.getElementById('har-date-label').textContent = `${d} ${MONTHS[m]} ${y}`;
  document.getElementById('har-date-picker').value = dateKey;

  const noticeEl = document.getElementById('har-notice');
  const sumEl    = document.getElementById('har-summary');
  const listEl   = document.getElementById('har-list');
  noticeEl.innerHTML = ''; sumEl.innerHTML = '';
  listEl.innerHTML = '<div class="empty" style="margin-top:24px"><div style="font-size:36px">⏳</div><div style="font-weight:700;margin-top:8px">Memuat...</div></div>';

  try{
    await ensureGlobalSchedule();
    try{ await loadHolidayDates(); }catch(e){}
    await loadKetHarianMonth(y,m);

    if(dow === 5){
      noticeEl.innerHTML = `<div style="margin-bottom:12px;padding:12px 14px;background:#f1f5f9;border:1.5px solid #cbd5e1;border-radius:12px;font-size:13px;font-weight:700;color:#475569">🕌 Jumat — tidak ada KBM, tidak perlu keterangan.</div>`;
      listEl.innerHTML = '';
      return;
    }
    if(isHolidayKey(dateKey)){
      noticeEl.innerHTML = `<div style="margin-bottom:12px;padding:12px 14px;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;font-size:13px;font-weight:700;color:#dc2626">🌙 Hari Libur — isian guru sudah terkunci, keterangan tidak diperlukan.</div>`;
      listEl.innerHTML = '';
      return;
    }

    // Hanya guru yang jadwalnya aktif hari ini
    const rows = users
      .filter(u => u.status !== 'cuti')
      .map(u => ({ u, sess: ketScheduledSessions(u.id, dow) }))
      .filter(r => r.sess.length > 0 && !isBeforeJoinDate(r.u.id, y, m, d));

    if(!rows.length){
      listEl.innerHTML = '<div class="empty" style="margin-top:24px"><div style="font-size:40px">📭</div><div style="font-weight:700;margin-top:8px">Tidak ada guru terjadwal</div><div style="font-size:13px;color:var(--muted);margin-top:4px">Tidak ada mapel/halaqah yang aktif pada hari ini</div></div>';
      return;
    }

    // Muat kehadiran bulan ini untuk guru-guru tersebut (di-cache per bulan)
    await Promise.all(rows.map(r => loadAttMonth(r.u.id, y, m).catch(()=>{})));

    let nKet = 0, nLengkap = 0;
    const cards = rows.map(({u, sess})=>{
      const ket = getKetHarian(dateKey, u.id);
      const dd  = (localDb[u.id] && localDb[u.id][dateKey]) || emptyDay();
      const terisi = sess.filter(sk => dd[sk]);
      if(ket) nKet++;
      if(terisi.length === sess.length) nLengkap++;
      const t = ket ? getKetType(ket.type) : null;
      const lockedSet = new Set(ket && ket.sessions ? ket.sessions : []);

      const chips = sess.map(sk=>{
        const s = SESSIONS.find(x=>x.key===sk);
        const locked = lockedSet.has(sk);
        if(locked && t){
          return `<span class="chip" style="background:${t.bg};border:1px solid ${t.color}55;color:${t.color};font-size:10px;padding:2px 7px">${t.icon}${sk}</span>`;
        }
        const on = dd[sk];
        return `<span class="chip" style="background:${on?s.color+'18':'var(--bg2)'};border:1px solid ${on?s.color+'44':'var(--border)'};color:${on?s.color:'var(--muted)'};font-size:10px;padding:2px 7px">${on?'✅':'⬜'}${sk}</span>`;
      }).join('');

      const ketLine = ket
        ? `<div style="font-size:11px;font-weight:800;color:${t?t.color:'var(--muted)'};margin-top:4px">${t?t.icon+' '+t.label:ket.type} — ${ket.allDay?'seluruh sesi':ket.sessions.length+' sesi'} 🔒${ket.kegiatanNama?` · ${ket.kegiatanNama}`:''}${ket.catatan?` · ${ket.catatan}`:''}</div>`
        : `<div style="font-size:11px;font-weight:600;color:var(--muted);margin-top:4px">${terisi.length}/${sess.length} sesi terisi</div>`;

      return `<div class="ucard fade-in" style="cursor:pointer;padding:12px 14px;border-left:4px solid ${t?t.color:'var(--border)'}" onclick="openKhModal('${u.id}')">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;border-radius:10px;background:${t?t.color:'linear-gradient(135deg,#7fb3a0,#5a9b86)'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;flex-shrink:0">${t?t.icon:u.name[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:13px;color:var(--text)">${u.name}</div>
            <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:5px">${chips}</div>
            ${ketLine}
          </div>
          <div style="font-size:18px;color:var(--muted);flex-shrink:0">›</div>
        </div>
      </div>`;
    }).join('');

    sumEl.innerHTML = `<div style="margin-bottom:10px;padding:9px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;font-size:12px;font-weight:700;color:var(--muted)">👥 ${rows.length} guru terjadwal · ✅ ${nLengkap} lengkap · 📋 ${nKet} berketerangan</div>`;
    listEl.innerHTML = cards;

  }catch(e){
    listEl.innerHTML = `<div class="empty"><div style="color:var(--rose2);font-weight:700">Gagal memuat: ${e.message}</div></div>`;
  }
}
window.renderHarianPage = renderHarianPage;

// ── Modal keterangan harian ──

function openKhModal(uid){
  const y = harDate.getFullYear(), m = harDate.getMonth(), d = harDate.getDate();
  const dow = harDate.getDay(), dateKey = dk(y,m,d);
  const u = users.find(x=>x.id===uid);
  if(!u) return;

  const existing = getKetHarian(dateKey, uid);
  // Sertakan sesi yang terkunci walau sudah tidak terjadwal lagi (jadwal berubah),
  // agar admin tetap bisa membuka kuncinya.
  khScheduled = sortSessKeys([...ketScheduledSessions(uid, dow), ...(existing && existing.sessions ? existing.sessions : [])]);
  khType = existing ? existing.type : '';
  khSelected = new Set(existing && existing.sessions && existing.sessions.length ? existing.sessions : khScheduled);

  document.getElementById('kh-uid').value = uid;
  document.getElementById('kh-date').value = dateKey;
  document.getElementById('kh-title').textContent = existing ? '✏️ Ubah Keterangan' : '📅 Beri Keterangan';
  document.getElementById('kh-sub').textContent = `${u.name} — ${DF[dow]}, ${d} ${MONTHS[m]} ${y}`;
  document.getElementById('kh-catatan').value = existing ? (existing.catatan||'') : '';
  document.getElementById('kh-kegiatan').value = existing ? (existing.kegiatanNama||'') : '';
  document.getElementById('kh-delete-btn').style.display = existing ? '' : 'none';

  renderKhTypes();
  renderKhSessions();
  openModal('modal-ket-harian');
}
window.openKhModal = openKhModal;

function renderKhTypes(){
  document.getElementById('kh-types').innerHTML = KET_TYPES.map(t=>{
    const active = t.key === khType;
    return `<button onclick="khSetType('${t.key}')" style="padding:9px 4px;border-radius:10px;border:2px solid ${active?t.color:'var(--border)'};background:${active?t.color+'22':'var(--card)'};color:${active?t.color:'var(--muted)'};font-weight:800;font-size:11px;cursor:pointer;line-height:1.3">${t.icon}<br>${t.label}</button>`;
  }).join('');
  const info = document.getElementById('kh-type-info');
  const t = getKetType(khType);
  if(t){
    info.style.display = '';
    info.style.background = t.bg;
    info.style.color = t.color;
    info.textContent = t.info;
  } else {
    info.style.display = 'none';
  }
  document.getElementById('kh-kegiatan-wrap').style.display = khType==='luar' ? '' : 'none';
}

function khSetType(key){
  khType = key;
  renderKhTypes();
  renderKhSessions();
}
window.khSetType = khSetType;

function renderKhSessions(){
  const t = getKetType(khType);
  const col = t ? t.color : '#5a9b86';
  const bg  = t ? t.bg : '#f0fdf4';
  document.getElementById('kh-sessions').innerHTML = khScheduled.map(sk=>{
    const s = SESSIONS.find(x=>x.key===sk);
    const on = khSelected.has(sk);
    return `<button onclick="khToggleSess('${sk}')" title="${s?s.desc:sk}" style="padding:7px 11px;border-radius:10px;border:2px solid ${on?col:'var(--border)'};background:${on?bg:'var(--card)'};color:${on?col:'var(--muted)'};font-weight:800;font-size:12px;cursor:pointer">${on?'✓ ':''}${s?s.icon:''}${sk}</button>`;
  }).join('') || '<div style="font-size:12px;color:var(--muted);font-weight:600">Tidak ada sesi terjadwal pada hari ini.</div>';

  const allBtn = document.getElementById('kh-all-btn');
  const allOn = khScheduled.length>0 && khSelected.size === khScheduled.length;
  allBtn.textContent = allOn ? 'Kosongkan pilihan' : 'Seluruh sesi';
  updateKhEffect();
}

function khToggleSess(sk){
  if(khSelected.has(sk)) khSelected.delete(sk); else khSelected.add(sk);
  renderKhSessions();
}
window.khToggleSess = khToggleSess;

function khToggleAll(){
  if(khSelected.size === khScheduled.length) khSelected.clear();
  else khScheduled.forEach(sk=>khSelected.add(sk));
  renderKhSessions();
}
window.khToggleAll = khToggleAll;

function updateKhEffect(){
  const el = document.getElementById('kh-effect');
  const t = getKetType(khType);
  const sel = sortSessKeys([...khSelected]);
  if(!t || !sel.length){
    el.style.background = 'var(--bg2)'; el.style.color = 'var(--muted)';
    el.textContent = !t ? 'Pilih jenis keterangan terlebih dahulu.' : 'Pilih minimal satu sesi.';
    return;
  }
  const uid = document.getElementById('kh-uid').value;
  const dateKey = document.getElementById('kh-date').value;
  const dd = (localDb[uid] && localDb[uid][dateKey]) || emptyDay();
  const bentrok = t.hadir ? [] : sel.filter(sk=>dd[sk]);
  const lingkup = (khScheduled.length && sel.length===khScheduled.length) ? 'seluruh sesi' : `${sel.length} sesi`;
  el.style.background = t.bg; el.style.color = t.color;
  el.innerHTML = `${t.icon} <b>${t.label}</b> — ${lingkup} (${sel.join(', ')}) akan ${t.hadir?'diisi HADIR':'dikosongkan'} & dikunci untuk guru.`
    + (bentrok.length ? `<br><span style="color:#b91c1c">⚠️ ${bentrok.length} sesi yang sudah diisi guru (${bentrok.join(', ')}) akan dikosongkan.</span>` : '');
}

async function khSave(){
  const uid = document.getElementById('kh-uid').value;
  const dateKey = document.getElementById('kh-date').value;
  const u = users.find(x=>x.id===uid);
  const t = getKetType(khType);
  const sessions = sortSessKeys([...khSelected]);
  const catatan = document.getElementById('kh-catatan').value.trim();
  const kegiatanNama = document.getElementById('kh-kegiatan').value.trim();

  if(!t){ showToast('Pilih jenis keterangan', false); return; }
  if(!sessions.length){ showToast('Pilih minimal satu sesi', false); return; }
  if(khType==='luar' && !kegiatanNama){ showToast('Isi nama kegiatan', false); return; }

  const dd = (localDb[uid] && localDb[uid][dateKey]) || emptyDay();
  if(!t.hadir){
    const terisi = sessions.filter(sk=>dd[sk]);
    if(terisi.length && !confirm(
      `${u ? u.name : 'Guru ini'} sudah mengisi ${terisi.length} sesi (${terisi.join(', ')}) pada tanggal ini.\n\n` +
      `Tandai "${t.label}" dan kosongkan sesi tersebut?`)) return;
  }

  showLoading('Menyimpan keterangan...');
  try{
    const allDay = khScheduled.length>0 && sessions.length === khScheduled.length;
    await saveKetHarian({ dateKey, uid, type: khType, sessions, allDay, catatan,
                          kegiatanNama: khType==='luar' ? kegiatanNama : '' });
    await applyKetToAtt(uid, dateKey, sessions, t.hadir);
    hideLoading();
    closeModal('modal-ket-harian');
    showToast(`✅ Keterangan ${t.label} tersimpan & sesi dikunci`);
    renderHarianPage();
  }catch(e){ hideLoading(); showToast('Gagal: '+e.message, false); }
}
window.khSave = khSave;

async function khDelete(){
  const uid = document.getElementById('kh-uid').value;
  const dateKey = document.getElementById('kh-date').value;
  if(!confirm('Hapus keterangan ini?\n\nKunci sesi akan dibuka sehingga guru bisa mengisi kembali. Data kehadiran yang sudah dikosongkan TIDAK dikembalikan.')) return;
  showLoading('Menghapus...');
  try{
    await deleteKetHarian(dateKey, uid);
    hideLoading();
    closeModal('modal-ket-harian');
    showToast('✅ Keterangan dihapus — kunci dibuka');
    renderHarianPage();
  }catch(e){ hideLoading(); showToast('Gagal: '+e.message, false); }
}
window.khDelete = khDelete;

// Terapkan efek keterangan ke data kehadiran satu tanggal.
// hadir=true  → sesi diisi; hadir=false → sesi dikosongkan.
async function applyKetToAtt(uid, dateKey, sessions, hadir){
  const cur = (localDb[uid] && localDb[uid][dateKey]) || null;
  const updated = { ...emptyDay(), ...(cur||{}) };
  let changed = false;
  sessions.forEach(sk=>{ if(updated[sk] !== hadir){ updated[sk] = hadir; changed = true; } });
  if(!changed) return false;
  if(!localDb[uid]) localDb[uid] = {};
  localDb[uid][dateKey] = updated;
  await saveAtt(uid, dateKey, updated);
  return true;
}

// ══════════════════════════════════════════════════════════
// TAB DAFTAR BULANAN
// ══════════════════════════════════════════════════════════

function ketPrevMonth(){
  ketMonth--; if(ketMonth<0){ketMonth=11;ketYear--;}
  renderKetListPage();
}
function ketNextMonth(){
  ketMonth++; if(ketMonth>11){ketMonth=0;ketYear++;}
  renderKetListPage();
}
window.ketPrevMonth = ketPrevMonth;
window.ketNextMonth = ketNextMonth;

// Gabungkan entri harian yang berurutan (jenis & sesi sama) menjadi satu baris rentang.
// Jeda yang hanya berisi hari Jumat / hari libur tetap dianggap berurutan.
function groupKetEntries(entries){
  const sig = e => `${e.uid}|${e.type}|${(e.sessions||[]).join(',')}|${e.kegiatanNama||''}|${e.catatan||''}`;
  const byKey = {};
  entries.forEach(e=>{ (byKey[sig(e)] = byKey[sig(e)] || []).push(e); });
  const groups = [];
  Object.values(byKey).forEach(list=>{
    list.sort((a,b)=>a.dateKey.localeCompare(b.dateKey));
    let cur = null;
    list.forEach(e=>{
      if(cur && isKetContiguous(cur.dateTo, e.dateKey)){
        cur.dateTo = e.dateKey;
        cur.dates.push(e.dateKey);
      } else {
        cur = { ...e, dateFrom: e.dateKey, dateTo: e.dateKey, dates: [e.dateKey] };
        groups.push(cur);
      }
    });
  });
  return groups.sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom));
}

// Apakah antara prevKey dan nextKey hanya ada hari non-kerja?
function isKetContiguous(prevKey, nextKey){
  const prev = new Date(prevKey+'T00:00:00');
  const next = new Date(nextKey+'T00:00:00');
  const cur = new Date(prev.getTime());
  cur.setDate(cur.getDate()+1);
  while(cur < next){
    if(isHariKerja(cur.getFullYear(), cur.getMonth(), cur.getDate())) return false;
    cur.setDate(cur.getDate()+1);
  }
  return true;
}

function fmtKetDate(key){
  const [y,m,d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m-1]} ${y}`;
}

async function renderKetListPage(){
  document.getElementById('ket-month-label').textContent = MONTHS[ketMonth];
  document.getElementById('ket-year-label').textContent = ketYear;
  const listEl = document.getElementById('ket-list');
  listEl.innerHTML = '<div class="empty" style="margin-top:30px"><div style="font-size:36px">⏳</div><div style="font-weight:700;margin-top:8px">Memuat...</div></div>';
  try{
    await ensureGlobalSchedule();
    try{ await loadHolidayDates(); }catch(e){}
    await loadKetHarianMonth(ketYear, ketMonth, true);
    checkLegacyKeterangan();

    const groups = groupKetEntries(getKetEntriesForMonth(ketYear, ketMonth));
    if(!groups.length){
      listEl.innerHTML = '<div class="empty" style="margin-top:30px"><div style="font-size:40px">📋</div><div style="font-weight:700;margin-top:8px">Belum ada keterangan</div><div style="font-size:13px;color:var(--muted);margin-top:4px">Bulan ini tidak ada keterangan kehadiran</div></div>';
      return;
    }
    listEl.innerHTML = groups.map(g=>{
      const u = users.find(x=>x.id===g.uid);
      const nama = u ? u.name : g.uid;
      const t = getKetType(g.type) || {icon:'📋', label:g.type, color:'#64748b', bg:'#f8fafc', hadir:false};
      const dateStr = g.dateFrom===g.dateTo ? fmtKetDate(g.dateFrom) : `${fmtKetDate(g.dateFrom)} s/d ${fmtKetDate(g.dateTo)}`;
      const lingkup = g.allDay ? 'Seluruh sesi' : (g.sessions||[]).join(', ');
      return `<div class="ucard fade-in" style="border-left:4px solid ${t.color};margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
              <span style="background:${t.bg};color:${t.color};border:1px solid ${t.color}44;border-radius:8px;padding:2px 8px;font-size:11px;font-weight:800">${t.icon} ${t.label}</span>
              <span style="background:${t.hadir?'#dcfce7':'#f1f5f9'};color:${t.hadir?'#166534':'#64748b'};border-radius:6px;padding:1px 6px;font-size:10px;font-weight:700">${t.hadir?'✅ Diisi hadir':'📭 Dikosongkan'}</span>
              <span style="background:#f1f5f9;color:#64748b;border-radius:6px;padding:1px 6px;font-size:10px;font-weight:700">🔒 ${g.dates.length} hari</span>
            </div>
            <div style="font-weight:800;font-size:14px">${nama}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">📅 ${dateStr}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">🕐 ${lingkup}</div>
            ${g.kegiatanNama?`<div style="font-size:12px;color:var(--sage2);margin-top:2px;font-weight:600">🏫 ${g.kegiatanNama}</div>`:''}
            ${g.catatan?`<div style="font-size:12px;color:var(--muted);margin-top:2px">📝 ${g.catatan}</div>`:''}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
            <button class="btn-icon" title="Buka di tab Harian" onclick="ketOpenInHarian('${g.dateFrom}')">📅</button>
            <button class="btn-icon" title="Hapus" onclick="ketDeleteGroup('${g.uid}','${g.dates.join(',')}')">🗑️</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    listEl.innerHTML = `<div class="empty"><div style="color:var(--rose2);font-weight:700">Gagal memuat: ${e.message}</div></div>`;
  }
}
window.renderKetListPage = renderKetListPage;

function ketOpenInHarian(dateKey){
  harDate = new Date(dateKey+'T00:00:00');
  switchKetTab('harian');
}
window.ketOpenInHarian = ketOpenInHarian;

async function ketDeleteGroup(uid, dateList){
  const dates = dateList.split(',').filter(Boolean);
  if(!confirm(`Hapus keterangan untuk ${dates.length} hari?\n\nKunci sesi akan dibuka. Data kehadiran yang sudah dikosongkan TIDAK dikembalikan.`)) return;
  showLoading('Menghapus...');
  try{
    await Promise.all(dates.map(dkey=>deleteKetHarian(dkey, uid)));
    hideLoading();
    showToast(`✅ ${dates.length} keterangan dihapus`);
    renderKetListPage();
  }catch(e){ hideLoading(); showToast('Gagal: '+e.message, false); }
}
window.ketDeleteGroup = ketDeleteGroup;

// ── Modal tambah untuk beberapa hari (rentang tanggal) ──

function renderKetTypes(){
  document.getElementById('ket-types').innerHTML = KET_TYPES.map(t=>{
    const active = t.key === ketType;
    return `<button onclick="setKetType('${t.key}')" style="padding:9px 4px;border-radius:10px;border:2px solid ${active?t.color:'var(--border)'};background:${active?t.color+'22':'var(--card)'};color:${active?t.color:'var(--muted)'};font-weight:800;font-size:11px;cursor:pointer;line-height:1.3">${t.icon}<br>${t.label}</button>`;
  }).join('');
  const info = document.getElementById('ket-type-info');
  const t = getKetType(ketType);
  if(t){
    info.style.display = '';
    info.style.background = t.bg;
    info.style.color = t.color;
    info.textContent = t.info + ' Berlaku untuk seluruh sesi terjadwal pada rentang tanggal ini.';
  } else {
    info.style.display = 'none';
  }
  document.getElementById('ket-kegiatan-wrap').style.display = ketType==='luar' ? '' : 'none';
}

function setKetType(type){
  ketType = type;
  renderKetTypes();
}
window.setKetType = setKetType;

function openKetModal(){
  document.getElementById('ket-modal-title').textContent = '📋 Tambah untuk Beberapa Hari';
  document.getElementById('ket-edit-id').value = '';
  document.getElementById('ket-catatan').value = '';
  document.getElementById('ket-kegiatan-nama').value = '';
  document.getElementById('ket-date-from').value = '';
  document.getElementById('ket-date-to').value = '';
  ketType = '';
  renderKetTypes();
  const sel = document.getElementById('ket-user');
  sel.innerHTML = '<option value="">-- Pilih --</option>' +
    users.filter(u=>u.status!=='cuti').map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  openModal('modal-keterangan');
}
window.openKetModal = openKetModal;

// Expand rentang tanggal → entri keterangan harian (satu per hari kerja terjadwal).
// Mengembalikan {dates:[...], skipped:number, bentrok:[{dateKey,sessions}]}
async function planKetRange(uid, dateFrom, dateTo){
  await ensureGlobalSchedule();
  try{ await loadHolidayDates(); }catch(e){}
  const plan = [], bentrok = [];
  let skipped = 0;
  const cur = new Date(dateFrom+'T00:00:00');
  const end = new Date(dateTo+'T00:00:00');
  const monthsSeen = new Set();
  while(cur <= end){
    const y=cur.getFullYear(), m=cur.getMonth(), d=cur.getDate(), dow=cur.getDay();
    const dateKey = dk(y,m,d);
    if(isHariKerja(y,m,d) && !isBeforeJoinDate(uid,y,m,d)){
      const sess = ketScheduledSessions(uid, dow);
      if(sess.length){
        const mk = `${y}-${m}`;
        if(!monthsSeen.has(mk)){ monthsSeen.add(mk); await loadAttMonth(uid,y,m).catch(()=>{}); }
        plan.push({ dateKey, sessions: sess });
        const dd = (localDb[uid] && localDb[uid][dateKey]) || emptyDay();
        const terisi = sess.filter(sk=>dd[sk]);
        if(terisi.length) bentrok.push({ dateKey, sessions: terisi });
      } else skipped++;
    } else skipped++;
    cur.setDate(cur.getDate()+1);
  }
  return { plan, skipped, bentrok };
}

async function saveKeterangan(){
  const uid = document.getElementById('ket-user').value;
  const dateFrom = document.getElementById('ket-date-from').value;
  const dateTo = document.getElementById('ket-date-to').value || dateFrom;
  const catatan = document.getElementById('ket-catatan').value.trim();
  const kegiatanNama = document.getElementById('ket-kegiatan-nama').value.trim();
  const t = getKetType(ketType);

  if(!uid){ showToast('Pilih guru terlebih dahulu', false); return; }
  if(!t){ showToast('Pilih jenis keterangan', false); return; }
  if(!dateFrom){ showToast('Pilih tanggal', false); return; }
  if(ketType==='luar' && !kegiatanNama){ showToast('Isi nama kegiatan', false); return; }
  if(dateTo < dateFrom){ showToast('Tanggal akhir harus setelah tanggal mulai', false); return; }

  showLoading('Menyiapkan...');
  try{
    const { plan, skipped, bentrok } = await planKetRange(uid, dateFrom, dateTo);
    hideLoading();
    if(!plan.length){
      showToast('Tidak ada hari terjadwal pada rentang tersebut', false);
      return;
    }
    const u = users.find(x=>x.id===uid);
    if(!t.hadir && bentrok.length){
      const totalSesi = bentrok.reduce((a,b)=>a+b.sessions.length,0);
      if(!confirm(
        `${u ? u.name : 'Guru ini'} sudah mengisi ${totalSesi} sesi pada ${bentrok.length} hari di rentang tersebut.\n\n` +
        `Tandai "${t.label}" untuk ${plan.length} hari dan kosongkan sesi tersebut?`)) return;
    }

    showLoading(`Menyimpan ${plan.length} hari...`);
    for(const item of plan){
      await saveKetHarian({
        dateKey: item.dateKey, uid, type: ketType,
        sessions: item.sessions, allDay: true, catatan,
        kegiatanNama: ketType==='luar' ? kegiatanNama : ''
      });
      await applyKetToAtt(uid, item.dateKey, item.sessions, t.hadir);
    }
    hideLoading();
    closeModal('modal-keterangan');
    showToast(`✅ ${t.label} tersimpan untuk ${plan.length} hari${skipped?` (${skipped} hari dilewati)`:''}`);
    renderKetListPage();
  }catch(e){ hideLoading(); showToast('Gagal: '+e.message, false); }
}
window.saveKeterangan = saveKeterangan;

// ── Konversi data keterangan format lama (collection 'keterangans') ──

let legacyKetDocs = null;

async function checkLegacyKeterangan(){
  const banner = document.getElementById('ket-migrate-banner');
  if(!banner) return;
  if(legacyKetDocs === null){
    try{
      const snap = await getDocs(collection(fs,'keterangans'));
      legacyKetDocs = snap.docs.map(d=>({id:d.id, ...d.data()}));
    }catch(e){ legacyKetDocs = []; }
  }
  if(!legacyKetDocs.length){ banner.style.display = 'none'; return; }
  banner.style.display = '';
  banner.innerHTML = `<div style="margin-bottom:12px;padding:12px 14px;background:#fffbeb;border:1.5px solid #fde047;border-radius:12px;font-size:12px;font-weight:700;color:#854d0e">
    📦 Ada ${legacyKetDocs.length} keterangan format lama yang belum mengunci isian guru.
    <button onclick="migrateLegacyKeterangan()" style="display:block;width:100%;margin-top:8px;padding:8px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-weight:800;font-size:12px;cursor:pointer">🔄 Konversi Sekarang</button>
  </div>`;
}

async function migrateLegacyKeterangan(){
  if(!legacyKetDocs || !legacyKetDocs.length) return;
  if(!confirm(`Konversi ${legacyKetDocs.length} keterangan lama menjadi keterangan harian?\n\nSetiap keterangan akan diterapkan per hari terjadwal dan mengunci sesi guru.`)) return;
  showLoading('Mengonversi...');
  let ok = 0, gagal = 0;
  try{
    for(const old of legacyKetDocs){
      try{
        const t = getKetType(old.type) || getKetType('izin');
        const from = old.dateFrom, to = old.dateTo || old.dateFrom;
        if(!old.uid || !from){ gagal++; continue; }
        const { plan } = await planKetRange(old.uid, from, to);
        for(const item of plan){
          await saveKetHarian({
            dateKey: item.dateKey, uid: old.uid, type: t.key,
            sessions: item.sessions, allDay: true,
            catatan: old.catatan || '', kegiatanNama: old.kegiatanNama || ''
          });
          await applyKetToAtt(old.uid, item.dateKey, item.sessions, t.hadir);
        }
        await deleteKeteranganDoc(old.id);
        ok++;
      }catch(e){ gagal++; }
    }
    legacyKetDocs = null;
    hideLoading();
    showToast(`✅ ${ok} keterangan dikonversi${gagal?`, ${gagal} gagal`:''}`);
    renderKetListPage();
  }catch(e){ hideLoading(); showToast('Gagal: '+e.message, false); }
}
window.migrateLegacyKeterangan = migrateLegacyKeterangan;

async function deleteKeteranganDoc(id){
  await deleteDoc(doc(fs,'keterangans',id));
}


function printRekap(){
  const y=rekapYear,m=rekapMonth,tw=wim(y,m);
  let thWeeks='';for(let w=1;w<=tw;w++)thWeeks+=`<th>Pekan ${w}</th>`;
  let rows='';
  let totalPerWeek=Array(tw).fill(0);
  let grandTotalPoin=0;
  users.forEach((u,idx)=>{
    let tdWeeks='';
    let rowTotalPoin=mRec(u.id,y,m).totalScore;
    for(let w=1;w<=tw;w++){const poin=wRec(u.id,y,m,w).totalScore;totalPerWeek[w-1]+=poin;tdWeeks+=`<td>${poin}</td>`;}
    grandTotalPoin+=rowTotalPoin;
    const statusStr=u.status==='cuti'?` (Cuti${u.cutiReason?': '+u.cutiReason:''})` :'';
    rows+=`<tr><td>${idx+1}</td><td>${u.name}${statusStr}</td><td>${rolesText(u)}</td>${tdWeeks}<td><b>${rowTotalPoin}</b></td></tr>`;
  });
  let tdTotalWeeks='';for(let w=1;w<=tw;w++)tdTotalWeeks+=`<td><b>${totalPerWeek[w-1]}</b></td>`;
  // ── Tanda tangan: cari nama Kepala Madrasah & Operator dari data akun ──
  const kmUser = users.find(u=>getRoles(u).includes('Kepala Madrasah'));
  const bdUser = users.find(u=>getRoles(u).includes('Operator'));
  const kmName = kmUser ? kmUser.name : '___________________';
  const bdName = bdUser ? bdUser.name : '___________________';
  // iOS Safari fix: gunakan format manual sebagai fallback
  const _tglNow = new Date();
  const _BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const tglExport = `${_tglNow.getDate()} ${_BULAN_ID[_tglNow.getMonth()]} ${_tglNow.getFullYear()}`;
  const html=`<html><head><title>Rekapitulasi ${MONTHS[m]} ${y}</title>
  <style>@page{size:A4 portrait;margin:15mm}body{font-family:Arial,sans-serif;padding:20px;color:#2d3748}h1{color:#5a9b86;font-size:20px;margin-bottom:4px}
  p{color:#8a97a8;font-size:13px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#5a9b86;color:#fff;padding:8px 6px;text-align:center}
  th:nth-child(2){text-align:left}th:nth-child(3){text-align:left}
  th.poin{background:#a8874d}
  td{padding:7px 6px;border-bottom:1px solid #e2e8f0;text-align:center}
  td:nth-child(2),td:nth-child(3){text-align:left}
  tr:nth-child(even){background:#f7f9fc}
  .tot{background:#e8f4f0!important;font-weight:bold}
  </style></head><body>
  <div style="display:flex;align-items:flex-start;gap:16px;border-bottom:4px solid #1a5c2a;padding-bottom:10px;margin-bottom:14px">
    <img src="assets/logo.png" style="width:70px;height:70px;object-fit:contain;flex-shrink:0"/>
    <div style="flex:1">
      <div style="font-size:9pt;color:#555;text-transform:uppercase;letter-spacing:0.5px">YAYASAN AL-IMAM ASY-SYAFI'I</div>
      <div style="font-size:18pt;font-weight:bold;color:#1a5c2a;line-height:1.1">Pondok Pesantren Al Imam Asy-Syafi'i Tarakan</div>
      <div style="font-size:8.5pt;color:#333;margin-top:2px">Jalan Swaran Jaya RT 15, Juata Permai, Tarakan, Kalimantan Utara</div>
      <div style="font-size:8.5pt;color:#333">Telp. +62 853-2786-3877</div>
    </div>
  </div>
  <h1 style="text-align:center;font-size:13pt;margin:10px 0 4px">REKAPITULASI KEHADIRAN</h1>
  <p style="text-align:center">${MONTHS[m]} ${y} · ${users.length} pengguna · ${tw} pekan</p>
  <table><thead><tr><th>No</th><th>Nama</th><th>Jabatan</th>${thWeeks}<th class="poin">Total Jam</th></tr></thead>
  <tbody>${rows}<tr class="tot"><td colspan="3">Total Keseluruhan</td>${tdTotalWeeks}<td><b>${grandTotalPoin}</b></td></tr></tbody>
  </table>
  <div style="margin-top:32px;page-break-inside:avoid">
    <table style="width:100%;border:none;border-collapse:collapse"><tr>
      <td style="width:50%;vertical-align:top;padding:0">
        <div style="margin-left:40pt;display:inline-block;text-align:center">
          <div style="font-size:9pt;color:#333">&nbsp;</div>
          <div style="font-size:9pt;font-weight:bold;color:#333;margin-top:2px">Menyetujui,</div>
          <div style="font-size:9pt;color:#333;margin-top:2px">Kepala Madrasah</div>
          <div style="height:56px"></div>
          <div style="border-top:1.5px solid #333;padding-top:4px;font-size:9pt;font-weight:bold;color:#1a5c2a">${kmName}</div>
        </div>
      </td>
      <td style="width:50%;vertical-align:top;padding:0;text-align:right">
        <div style="margin-right:40pt;display:inline-block;text-align:center">
          <div style="font-size:9pt;color:#333">Kota Tarakan, ${tglExport}</div>
          <div style="font-size:9pt;font-weight:bold;color:#333;margin-top:2px">Mengetahui,</div>
          <div style="font-size:9pt;color:#333;margin-top:2px">Operator</div>
          <div style="height:56px"></div>
          <div style="border-top:1.5px solid #333;padding-top:4px;font-size:9pt;font-weight:bold;color:#1a5c2a">${bdName}</div>
        </div>
      </td>
    </tr></table>
  </div>
  </body></html>`;
  // iOS Safari fix: window.open harus dipanggil synchronous dari click event
  const w=window.open("","_blank");
  if(!w){ showToast('Popup diblokir browser. Izinkan popup untuk halaman ini.', false); return; }
  w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),400);
}
window.printRekap=printRekap;

// ══════════════════════════════════════════════════
// ── BELUM LENGKAP & PENGINGAT ADMIN ──
// ══════════════════════════════════════════════════

async function openBelumLengkapModal(){
  const y=rekapYear, m=rekapMonth;
  document.getElementById("bl-subtitle").textContent = `Bulan: ${MONTHS[m]} ${y}`;
  document.getElementById("bl-loading").style.display = "";
  document.getElementById("bl-empty").style.display = "none";
  document.getElementById("bl-list").style.display = "none";
  document.getElementById("bl-footer").style.display = "none";
  document.getElementById("modal-belum-lengkap").style.display = "flex";

  try{
    // Ambil jadwal dari Firestore
    const schedule = await getHolidaySchedule();
    const hasSchedule = Object.keys(schedule).length > 0;
    // Keterangan admin bulan ini — sesi yang sudah berketerangan tidak dianggap kurang.
    try{ await loadKetHarianMonth(y, m); }catch(e){}
    const SESS_KEYS = SESSIONS.map(s=>s.key);
    const dim2 = dim(y,m);
    const belumLengkap = [];

    for(const user of users){
      if(user.status === "cuti") continue;
      await loadAttMonth(user.id, y, m); // hanya butuh bulan rekap yang dilihat
      const kurang = [];

      for(let d=1; d<=dim2; d++){
        const dateObj = new Date(y,m,d);
        const dow = dateObj.getDay();
        if(dow === 5) continue; // skip Jumat
        const dateKey = dk(y,m,d);
        const isLibur = isHolidayKey(dateKey);

        // Tentukan sesi yang seharusnya diisi
        let expectedSessions = [];
        const userSchedule = schedule[user.id] || schedule[user.username];
        if(hasSchedule && userSchedule && userSchedule[dow]){
          expectedSessions = SESS_KEYS.filter(s => userSchedule[dow][s]);
        } else if(hasSchedule && userSchedule){
          expectedSessions = []; // tidak ada jadwal hari ini
        } else {
          expectedSessions = SESS_KEYS; // default semua
        }
        // Sesi yang sudah diberi keterangan admin (sakit/izin/dinas/dll) bukan tunggakan guru.
        const lockedKet = getKetLockedSessions(dateKey, user.id);
        if(lockedKet.length) expectedSessions = expectedSessions.filter(sk => !lockedKet.includes(sk));
        if(expectedSessions.length === 0) continue;

        const dd = gdd(user.id,y,m,d);
        const filledSessions = expectedSessions.filter(s => dd[s]);
        if(filledSessions.length < expectedSessions.length){
          const missing = expectedSessions.filter(s => !dd[s]);
          kurang.push({d, dow, isLibur, missing, expected: expectedSessions.length, filled: filledSessions.length});
        }
      }

      if(kurang.length > 0){
        belumLengkap.push({user, kurang});
      }
    }

    document.getElementById("bl-loading").style.display = "none";

    if(belumLengkap.length === 0){
      document.getElementById("bl-empty").style.display = "";
      return;
    }

    const DAY_SHORT = ["Ahd","Sen","Sel","Rab","Kam","Jum","Sab"];
    const BULAN_SHORT = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
    let html = "";
    belumLengkap.forEach(({user, kurang})=>{
      const totalKurang = kurang.reduce((a,k)=>a+k.missing.length,0);
      html += `<div style="background:var(--card);border:1px solid #fca5a5;border-radius:14px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#f87171,#dc2626);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;flex-shrink:0">${user.name[0].toUpperCase()}</div>
          <div style="flex:1">
            <div style="font-weight:800;font-size:13px;color:var(--text)">${user.name}</div>
            <div style="font-size:11px;color:#ef4444;font-weight:600">${kurang.length} hari belum lengkap · ${totalKurang} sesi kurang</div>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${kurang.slice(0,5).map(k=>`<span style="background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700;color:#dc2626">${DAY_SHORT[k.dow]} ${k.d} ${BULAN_SHORT[m]}: -${k.missing.join(",")}</span>`).join("")}${kurang.length>5?`<span style="font-size:10px;color:var(--muted);font-weight:600;padding:2px 4px">+${kurang.length-5} lainnya</span>`:""}</div>
      </div>`;
    });

    const listEl = document.getElementById("bl-list");
    listEl.innerHTML = html;
    listEl.style.display = "flex";
    document.getElementById("bl-count").textContent = `${belumLengkap.length} pengguna belum melengkapi kehadiran di ${MONTHS[m]} ${y}`;
    document.getElementById("bl-footer").style.display = "";

    // Simpan untuk dipakai saat kirim pengingat
    window._belumLengkapUsers = belumLengkap.map(b=>b.user);

  }catch(e){
    document.getElementById("bl-loading").innerHTML = `<div style="color:var(--rose2);font-weight:700">❌ Gagal memuat: ${e.message}</div>`;
  }
}
window.openBelumLengkapModal = openBelumLengkapModal;

function closeBelumLengkapModal(){
  document.getElementById("modal-belum-lengkap").style.display = "none";
}
window.closeBelumLengkapModal = closeBelumLengkapModal;

async function kirimPengingatSemua(){
  const targetUsers = window._belumLengkapUsers || [];
  if(targetUsers.length === 0){ showToast("Tidak ada pengguna yang perlu diingatkan",false); return; }
  showLoading("Mengirim pengingat...");
  try{
    const y=rekapYear, m=rekapMonth;
    const pesan = `Halo! Admin mengingatkan bahwa kehadiran Anda di ${MONTHS[m]} ${y} belum lengkap. Mohon segera lengkapi sesuai jadwal. Terima kasih.`;
    const batch = targetUsers.map(user=>{
      return setDoc(doc(fs,"notifications",user.id),{
        pesan,
        bulan: `${MONTHS[m]} ${y}`,
        timestamp: Date.now(),
        dibaca: false,
        type: 'reminder'
      });
    });
    await Promise.all(batch);
    hideLoading();
    closeBelumLengkapModal();
    showToast(`✅ Pengingat terkirim ke ${targetUsers.length} pengguna`);
  }catch(e){ hideLoading(); showToast("Gagal kirim: "+e.message, false); }
}
window.kirimPengingatSemua = kirimPengingatSemua;

// ── Cek notifikasi pengingat saat pengguna login ──
async function cekNotifikasiPengingat(uid){
  try{
    const d = await getDoc(doc(fs,"notifications",uid));
    if(!d.exists()) return;
    const data = d.data();
    if(data.dibaca) return;
    // Update badge dulu
    updateUserNotifBadge(uid);
    // Hanya tampilkan pop-up modal untuk notif pengingat kehadiran (bukan akses)
    if(data.type && data.type !== 'reminder') return;
    document.getElementById("pengingat-msg").innerHTML =
      `<b>Kehadiran ${data.bulan} Anda belum lengkap.</b><br><br>${data.pesan}`;
    document.getElementById("modal-pengingat-notif").style.display = "flex";
  }catch(e){ console.warn("Cek notif gagal:",e.message); }
}

async function tutupPengingatNotif(){
  document.getElementById("modal-pengingat-notif").style.display = "none";
}
window.tutupPengingatNotif = tutupPengingatNotif;

function exportRekapExcel(){
  const y=rekapYear,m=rekapMonth,tw=wim(y,m);
  if(!window.XLSX){ prewarmXLSX(); showToast('⏳ Menyiapkan modul Excel, klik lagi sebentar…',false); return; }

  const wb=XLSX.utils.book_new();
  const aoa=[]; // array of arrays — baris demi baris

  // ── Helper kolom letter (0-based index) ──
  const col=(n)=>{let s='';n++;while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-1)/26);}return s;};
  // Kolom: 0=NO, 1=NAMA, 2..2+tw-1=PEKAN 1..tw, 2+tw=TOTAL
  const C_NO=0, C_NAMA=1, C_PEKAN=2, C_TOTAL=2+tw;
  const totalCols=C_TOTAL+1;

  // Baris kosong helper
  const emptyRow=()=>Array(totalCols).fill('');

  // ── R1: YAYASAN ──
  const r1=emptyRow(); r1[C_NAMA]='YAYASAN AL-IMAM ASY-SYAFI\'I'; aoa.push(r1);
  // ── R2: NAMA PESANTREN ──
  const r2=emptyRow(); r2[C_NAMA]='Pondok Pesantren Al Imam Asy-Syafi\'i Tarakan'; aoa.push(r2);
  // ── R3: ALAMAT ──
  const r3=emptyRow(); r3[C_NAMA]='Jalan Swaran Jaya RT 15, Juata Permai'; aoa.push(r3);
  // ── R4: TELP ──
  const r4=emptyRow(); r4[C_NAMA]='Telp. +62 853-2786-3877'; aoa.push(r4);
  // ── R5: GARIS (kosong) ──
  aoa.push(emptyRow());
  // ── R6: JUDUL ──
  const r6=emptyRow(); r6[C_NO]='REKAPITULASI JAM MENGAJAR'; aoa.push(r6);
  // ── R7: BULAN TAHUN ──
  const r7=emptyRow(); r7[C_NO]=`${MONTHS[m].toUpperCase()} ${y}`; aoa.push(r7);
  // ── R8: KOSONG ──
  aoa.push(emptyRow());

  // ── R9: HEADER ATAS (NO, NAMA, PEKAN [merge], TOTAL) ──
  const rH1=emptyRow();
  rH1[C_NO]='NO'; rH1[C_NAMA]='NAMA'; rH1[C_PEKAN]='PEKAN'; rH1[C_TOTAL]='TOTAL';
  aoa.push(rH1);

  // ── R10: HEADER BAWAH (angka pekan) ──
  const rH2=emptyRow();
  for(let w=0;w<tw;w++) rH2[C_PEKAN+w]=w+1;
  aoa.push(rH2);

  // ── DATA ──
  let grandTotal=0;
  const weekTotals=Array(tw).fill(0);
  users.forEach((u,idx)=>{
    const row=emptyRow();
    const pts=mRec(u.id,y,m).totalScore;
    grandTotal+=pts;
    row[C_NO]=idx+1;
    row[C_NAMA]=u.name;
    for(let w=0;w<tw;w++){
      const wp=wRec(u.id,y,m,w+1).totalScore;
      weekTotals[w]+=wp;
      row[C_PEKAN+w]=wp;
    }
    row[C_TOTAL]=pts;
    aoa.push(row);
  });

  // ── GRAND TOTAL ──
  const rGT=emptyRow();
  rGT[C_NO]='GRAND TOTAL JAM MENGAJAR';
  rGT[C_TOTAL]=grandTotal;
  aoa.push(rGT);
  aoa.push(emptyRow());

  // ── TANDA TANGAN ──
  const today=new Date();
  const dd=String(today.getDate()).padStart(2,'0');
  const mm=MONTHS[today.getMonth()];
  const yy=today.getFullYear();
  const tglStr=`Kota Tarakan, ${dd} ${mm.charAt(0).toUpperCase()+mm.slice(1)} ${yy}`;

  const rTD1=emptyRow(); rTD1[C_NO]='PIMPINAN PONDOK PESANTREN'; rTD1[C_TOTAL]=tglStr; aoa.push(rTD1);
  const rTD2=emptyRow(); rTD2[C_TOTAL]='TATA USAHA,'; aoa.push(rTD2);
  aoa.push(emptyRow()); aoa.push(emptyRow()); aoa.push(emptyRow());
  const rTD3=emptyRow(); rTD3[C_NO]='HARMIN, S.Pd.'; rTD3[C_TOTAL]='ADNAN ABDUL RASYID, ST.'; aoa.push(rTD3);

  // ── BUILD WORKSHEET ──
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  const totalRows=aoa.length;

  // ── MERGES ──
  const M=[];
  const mr=(r1,c1,r2,c2)=>M.push({s:{r:r1,c:c1},e:{r:r2,c:c2}});
  // KOP (rows 0-3): merge col 1..C_TOTAL
  for(let r=0;r<=3;r++) mr(r,1,r,C_TOTAL);
  // Judul (rows 5-6): merge col 0..C_TOTAL
  mr(5,0,5,C_TOTAL); mr(6,0,6,C_TOTAL);
  // Header NO: merge rows 8-9 col 0
  mr(8,0,9,0);
  // Header NAMA: merge rows 8-9 col 1
  mr(8,1,9,1);
  // Header PEKAN: merge row 8 col 2..C_TOTAL-1
  mr(8,2,8,C_TOTAL-1);
  // Header TOTAL: merge rows 8-9 col C_TOTAL
  mr(8,C_TOTAL,9,C_TOTAL);
  // Grand Total label: merge col 0..C_TOTAL-1
  const gtRow=10+users.length;
  mr(gtRow,0,gtRow,C_TOTAL-1);
  ws['!merges']=M;

  // ── STYLES ──
  const S={};
  // Fonts
  const fBold=(sz,rgb)=>({bold:true,sz:sz||11,name:'Times New Roman',color:{rgb:rgb||'000000'}});
  const fNorm=(sz,rgb)=>({sz:sz||10,name:'Times New Roman',color:{rgb:rgb||'000000'}});
  // Borders
  const bThin={style:'thin',color:{rgb:'000000'}};
  const bAll={top:bThin,bottom:bThin,left:bThin,right:bThin};
  const bMedBot={top:bThin,bottom:{style:'medium',color:{rgb:'000000'}},left:bThin,right:bThin};
  // Fills
  const fGreen={patternType:'solid',fgColor:{rgb:'1A5C2A'}};   // header gelap
  const fLGreen={patternType:'solid',fgColor:{rgb:'92D050'}};  // sub-header / total
  const fYellow={patternType:'solid',fgColor:{rgb:'FFFF00'}};  // grand total
  const fEven={patternType:'solid',fgColor:{rgb:'E2EFDA'}};    // baris genap
  const fOdd={patternType:'solid',fgColor:{rgb:'FFFFFF'}};     // baris ganjil
  const fWhite={patternType:'solid',fgColor:{rgb:'FFFFFF'}};

  const aCenter={horizontal:'center',vertical:'center',wrapText:true};
  const aLeft={horizontal:'left',vertical:'center'};
  const aRight={horizontal:'right',vertical:'center'};

  // ── Style helper: apply to cell ──
  const applyStyle=(addr,style)=>{
    if(!ws[addr])ws[addr]={v:'',t:'s'};
    ws[addr].s=style;
  };

  // KOP rows 1-4 (0-indexed 0-3)
  for(let r=0;r<=3;r++){
    const addr=col(1)+(r+1);
    const sz=r===1?14:r===0?11:10;
    const bold=r<=1;
    applyStyle(addr,{font:{bold,sz,name:'Times New Roman'},alignment:aCenter});
  }
  // Judul rows 6-7 (0-indexed 5-6)
  applyStyle(col(0)+'6',{font:fBold(13),alignment:aCenter});
  applyStyle(col(0)+'7',{font:fBold(12),alignment:aCenter});

  // Header row 1 (0-indexed 8): NO, NAMA, PEKAN, TOTAL
  const hStyle={font:fBold(11,'FFFFFF'),fill:fGreen,alignment:aCenter,border:bAll};
  [col(0),col(1),col(C_PEKAN),col(C_TOTAL)].forEach(c2=>{
    applyStyle(c2+'9',hStyle);
  });
  // Fill empty header cells in PEKAN span
  for(let w=1;w<tw;w++) applyStyle(col(C_PEKAN+w)+'9',hStyle);

  // Header row 2 (0-indexed 9): angka pekan
  applyStyle(col(0)+'10',hStyle);
  applyStyle(col(1)+'10',hStyle);
  for(let w=0;w<tw;w++) applyStyle(col(C_PEKAN+w)+'10',{font:fBold(11,'FFFFFF'),fill:fGreen,alignment:aCenter,border:bAll});
  applyStyle(col(C_TOTAL)+'10',hStyle);

  // Data rows (0-indexed 10..10+users.length-1)
  users.forEach((u,idx)=>{
    const r=11+idx; // 1-indexed row
    const fill=idx%2===0?fEven:fOdd;
    applyStyle(col(0)+''+r,{font:fNorm(10),fill,alignment:aCenter,border:bAll});
    applyStyle(col(1)+''+r,{font:fNorm(10),fill,alignment:aLeft,border:bAll});
    for(let w=0;w<tw;w++) applyStyle(col(C_PEKAN+w)+''+r,{font:fNorm(10),fill,alignment:aCenter,border:bAll});
    applyStyle(col(C_TOTAL)+''+r,{font:fBold(10),fill,alignment:aCenter,border:bAll});
  });

  // Grand total row
  const gtR=11+users.length;
  applyStyle(col(0)+''+gtR,{font:fBold(10),fill:fYellow,alignment:aCenter,border:bAll});
  for(let w=0;w<tw;w++) applyStyle(col(C_PEKAN+w)+''+gtR,{font:fBold(10),fill:fYellow,alignment:aCenter,border:bAll});
  applyStyle(col(C_TOTAL)+''+gtR,{font:fBold(11),fill:fYellow,alignment:aCenter,border:bAll});

  // ── COL WIDTHS ──
  ws['!cols']=[{wch:5},{wch:34},...Array(tw).fill({wch:8}),{wch:10}];

  // ── ROW HEIGHTS ──
  ws['!rows']=Array(totalRows).fill({hpt:18});
  ws['!rows'][1]={hpt:24}; // nama pesantren lebih tinggi
  ws['!rows'][5]={hpt:22}; // judul
  ws['!rows'][8]={hpt:22}; // header
  ws['!rows'][9]={hpt:20}; // header angka

  // ── REF ──
  ws['!ref']=`A1:${col(C_TOTAL)}${totalRows}`;

  XLSX.utils.book_append_sheet(wb,ws,`${MONTHS[m]} ${y}`);
  xlsxDownload(wb, `Rekapitulasi_${MONTHS[m]}_${y}.xlsx`);
  if(!isIOS) showToast('✅ File Excel berhasil diunduh');
}
window.exportRekapExcel=exportRekapExcel;

// ── ADMIN: ADD/EDIT MODAL ──
function openAddUserModal(){
  window.muRoles=["Pengajar"];
  document.getElementById('modal-uid').value='';
  document.getElementById('modal-user-title').textContent='➕ Tambah Pengguna';
  document.getElementById('mu-name').value='';
  document.getElementById('mu-username').value='';
  document.getElementById('mu-pw').value='';
  document.getElementById('mu-pw-wrap').style.display='block';
  // Tampilkan & reset section karyawan baru/lama
  document.getElementById('mu-emptype-wrap').style.display='';
  document.getElementById('mu-joindate').value='';
  window.muEmpType='baru';
  setEmpType('baru');
  renderMuRoles();
  openModal('modal-user');
}
window.openAddUserModal=openAddUserModal;

// ── Employee type selector ──
function setEmpType(type){
  window.muEmpType = type;
  const btnNew = document.getElementById('mu-type-new');
  const btnOld = document.getElementById('mu-type-old');
  const infoNew = document.getElementById('mu-type-new-info');
  const infoOld = document.getElementById('mu-type-old-info');
  if(type === 'baru'){
    btnNew.style.background='var(--sage)'; btnNew.style.color='#fff'; btnNew.style.border='2px solid var(--sage)';
    btnOld.style.background='var(--card)'; btnOld.style.color='var(--muted)'; btnOld.style.border='2px solid var(--border)';
    infoNew.style.display=''; infoOld.style.display='none';
  } else {
    btnOld.style.background='var(--amber)'; btnOld.style.color='#fff'; btnOld.style.border='2px solid var(--amber)';
    btnNew.style.background='var(--card)'; btnNew.style.color='var(--muted)'; btnNew.style.border='2px solid var(--border)';
    infoNew.style.display='none'; infoOld.style.display='';
  }
}
window.setEmpType=setEmpType;

function renderMuRoles(){
  const sel=window.muRoles||[];
  document.getElementById('mu-roles').innerHTML=ROLES.map(r=>{
    const active=sel.includes(r);
    const rc=getRoleColor(r);
    return`<button onclick="window.__toggleMuRole('${r}')" style="padding:6px 12px;border-radius:10px;border:2px solid ${active?rc+'99':'var(--border)'};background:${active?rc+'22':'var(--bg2)'};color:${active?rc:'var(--muted)'};font-weight:700;font-size:12px;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:5px">${active?'✓ ':''}<span>${r}</span></button>`;
  }).join('');
}
window.renderMuRoles=renderMuRoles;
window.__toggleMuRole=(r)=>{
  if(!window.muRoles)window.muRoles=[];
  const idx=window.muRoles.indexOf(r);
  if(idx>=0)window.muRoles.splice(idx,1);
  else window.muRoles.push(r);
  renderMuRoles();
};


async function saveUserModal(){
  const uid=document.getElementById('modal-uid').value;
  const name=document.getElementById('mu-name').value.trim();
  const username=document.getElementById('mu-username').value.trim().toLowerCase();
  const pw=document.getElementById('mu-pw').value;
  const phoneRaw=document.getElementById('mu-phone').value.trim().replace(/^0+/,'');
  const phone=phoneRaw?'62'+phoneRaw:'';
  const isEdit=!!uid;
  if(!name||!username){showToast('Nama dan username wajib diisi',false);return;}
  if(!window.muRoles||window.muRoles.length===0){showToast('Pilih minimal satu jabatan',false);return;}
  if(!isEdit&&!pw){showToast('Password wajib diisi',false);return;}
  const dup=users.find(u=>u.username===username&&u.id!==uid);
  if(dup){showToast('Username sudah digunakan',false);return;}
  showLoading(isEdit?'Menyimpan perubahan...':'Menambah pengguna...');
  try{
    if(isEdit){
      const user=users.find(u=>u.id===uid);
      user.name=name;user.username=username;user.roles=window.muRoles||[];delete user.role;
      user.phone=phone;
      if(pw){user.pwHash=await hashPw(pw);user.pwPlain=encodePw(pw);}
      await saveUserDoc(user);
      showToast('✅ Data pengguna diperbarui');
    } else {
      const id=Date.now().toString();
      const pwHash=await hashPw(pw);
      const pwPlain=encodePw(pw);
      // Tentukan employeeType dan joinDate
      const empType = window.muEmpType || 'baru';
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      let joinDate = '';
      if(empType === 'baru'){
        joinDate = todayStr; // karyawan baru: mulai hari ini
      } else {
        joinDate = document.getElementById('mu-joindate').value || ''; // karyawan lama: opsional
      }
      const user={id,name,username,roles:window.muRoles||[],pwHash,pwPlain,phone,status:'aktif',employeeType:empType,joinDate};
      await saveUserDoc(user);
      users.push(user);
      sortUsers();
      showToast('✅ Pengguna berhasil ditambahkan');
    }
    closeModal('modal-user');
    renderAdminUsers();
  }catch(e){showToast('❌ Gagal menyimpan',false);}
  hideLoading();
}
window.saveUserModal=saveUserModal;

window.__editUser=(id)=>{
  const u=users.find(x=>x.id===id);if(!u)return;
  window.muRoles=Array.isArray(u.roles)?[...u.roles]:(u.role?[u.role]:[]);
  document.getElementById('modal-uid').value=id;
  document.getElementById('modal-user-title').textContent='✏️ Edit Pengguna';
  document.getElementById('mu-name').value=u.name;
  document.getElementById('mu-username').value=u.username;
  document.getElementById('mu-pw').value='';
  document.getElementById('mu-pw-wrap').style.display='block';
  // Isi nomor HP: hapus prefix 62, tampilkan sisanya
  const phoneVal=u.phone?u.phone.replace(/^62/,''):'';
  document.getElementById('mu-phone').value=phoneVal;
  // Sembunyikan section karyawan baru/lama saat edit
  document.getElementById('mu-emptype-wrap').style.display='none';
  renderMuRoles();
  openModal('modal-user');
};
window.__delUser=async(id)=>{
  const u=users.find(x=>x.id===id);
  if(!confirm(`Hapus "${u?.name}"? Data absensinya ikut terhapus.`))return;
  showLoading('Menghapus...');
  try{
    await deleteUserDoc(id);
    users=users.filter(x=>x.id!==id);
    delete localDb[id];
    forgetAttCache(id);
    showToast('🗑️ Pengguna dihapus');
    renderAdminUsers();
  }catch(e){showToast('❌ Gagal menghapus',false);}
  hideLoading();
};
window.__archiveUser=async(id)=>{
  const u=users.find(x=>x.id===id);if(!u)return;
  if(!confirm(`Arsipkan "${u.name}"?\n\nAkun tidak dapat diakses hingga dipulihkan dari menu Arsip.`))return;
  showLoading('Mengarsipkan...');
  try{
    u.archived=true;
    await saveUserDoc(u);
    users=users.filter(x=>x.id!==id);
    archivedUsers.push(u);
    showToast('📁 Pengguna diarsipkan');
    renderAdminUsers();
  }catch(e){showToast('❌ Gagal mengarsipkan',false);}
  hideLoading();
};
window.__unarchiveUser=async(id)=>{
  const u=archivedUsers.find(x=>x.id===id);if(!u)return;
  showLoading('Memulihkan akun...');
  try{
    u.archived=false;
    await saveUserDoc(u);
    archivedUsers=archivedUsers.filter(x=>x.id!==id);
    users.push(u);
    sortUsers();
    showToast('✅ Akun dipulihkan');
    renderAdminUsers();
    renderArchivedUsersModal();
  }catch(e){showToast('❌ Gagal memulihkan',false);}
  hideLoading();
};
function renderArchivedUsersModal(){
  const container=document.getElementById('archived-user-list');if(!container)return;
  if(!archivedUsers.length){
    container.innerHTML=`<div style="text-align:center;padding:40px 20px"><div style="font-size:48px;margin-bottom:12px">📭</div><div style="font-weight:700;color:var(--muted)">Tidak ada akun yang diarsipkan</div></div>`;
    return;
  }
  container.innerHTML=archivedUsers.map(u=>{
    const roles=getRoles(u);const rc=getRoleColor(roles[0]||'');
    return`<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,${rc}99,${rc}66);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;color:#fff;flex-shrink:0">${u.name[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.name}</div>
        <div style="font-size:11px;color:var(--muted);font-weight:600">${roles[0]||'—'}</div>
      </div>
      <button onclick="window.__unarchiveUser('${u.id}')" style="padding:7px 14px;border-radius:10px;border:none;background:linear-gradient(135deg,#4ade80,#16a34a);color:#fff;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap">↩️ Pulihkan</button>
    </div>`;
  }).join('');
}
window.openArchivedUsers=()=>{renderArchivedUsersModal();openModal('modal-archived-users');};
window.__resetPw=(id)=>{
  const u=users.find(x=>x.id===id);if(!u)return;
  document.getElementById('rp-uid').value=id;
  document.getElementById('rp-name').textContent=u.name;
  document.getElementById('rp-new').value='';
  document.getElementById('rp-conf').value='';
  openModal('modal-reset-pw');
};
// ── STATUS MODAL ──
window.__editStatus=(id)=>{
  const u=users.find(x=>x.id===id);if(!u)return;
  document.getElementById('ms-uid').value=id;
  document.getElementById('ms-name').textContent=u.name;
  document.getElementById('ms-cuti-reason').value=u.cutiReason||'';
  document.getElementById('ms-cuti-start').value=u.cutiStart||'';
  document.getElementById('ms-cuti-end').value=u.cutiEnd||'';
  window.__setMsStatus(u.status||'aktif');
  openModal('modal-status');
};
window.__setMsStatus=(s)=>{
  const ca=document.getElementById('ms-status-active');
  const cc=document.getElementById('ms-status-cuti');
  const cw=document.getElementById('ms-cuti-wrap');
  window.msStatus=s;
  if(s==='aktif'){
    ca.style.cssText='flex:1;padding:10px;border-radius:10px;border:2px solid var(--sage);background:var(--sage3);color:var(--sage2);font-weight:800;font-size:13px;cursor:pointer;transition:all .2s';
    cc.style.cssText='flex:1;padding:10px;border-radius:10px;border:2px solid var(--border);background:var(--bg2);color:var(--muted);font-weight:800;font-size:13px;cursor:pointer;transition:all .2s';
    cw.style.display='none';
  } else {
    cc.style.cssText='flex:1;padding:10px;border-radius:10px;border:2px solid #f59e0b;background:#fef3c7;color:#d97706;font-weight:800;font-size:13px;cursor:pointer;transition:all .2s';
    ca.style.cssText='flex:1;padding:10px;border-radius:10px;border:2px solid var(--border);background:var(--bg2);color:var(--muted);font-weight:800;font-size:13px;cursor:pointer;transition:all .2s';
    cw.style.display='block';
  }
};
window.saveStatusModal=async()=>{
  const id=document.getElementById('ms-uid').value;
  const status=window.msStatus||'aktif';
  const reason=document.getElementById('ms-cuti-reason').value||'';
  const start=document.getElementById('ms-cuti-start').value||'';
  const end=document.getElementById('ms-cuti-end').value||'';
  showLoading('Menyimpan status...');
  try{
    const u=users.find(x=>x.id===id);if(!u){hideLoading();return;}
    u.status=status;u.cutiReason=reason;u.cutiStart=start;u.cutiEnd=end;
    await saveUserDoc(u);
    closeModal('modal-status');
    renderAdminUsers();
    showToast(status==='aktif'?'✅ Status diubah ke Aktif':'🏖️ Status Cuti disimpan');
  }catch(e){showToast('❌ Gagal menyimpan',false);}
  hideLoading();
};

// Toggle tampil/sembunyikan password di kartu pengguna
window.__togglePwView=(id)=>{
  const u=users.find(x=>x.id===id);if(!u)return;
  const el=document.getElementById('pw-display-'+id);if(!el)return;
  if(el.dataset.shown==='1'){
    el.textContent='••••••';el.style.color='var(--muted)';el.style.letterSpacing='1px';
    el.dataset.shown='0';
  } else {
    const plain=u.pwPlain?decodePw(u.pwPlain):'(belum di-set)';
    el.textContent=plain;el.style.color='var(--rose2)';el.style.letterSpacing='normal';
    el.dataset.shown='1';
  }
};

// Export PDF daftar pengguna
window.exportUsersPdf=()=>{
  const rows=users.map((u,idx)=>{
    const pw=u.pwPlain?decodePw(u.pwPlain):'—';
    const status=u.status==='cuti'?' 🏖️':'';
    return`<tr>
      <td>${idx+1}</td>
      <td>${u.name}${status}</td>
      <td>${rolesText(u)}</td>
      <td>${u.username}</td>
      <td>${pw}</td>
    </tr>`;
  }).join('');
  const today=new Date();
  const tgl=`${String(today.getDate()).padStart(2,'0')} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`;
  const html=`<!DOCTYPE html><html><head><title>Daftar Pengguna</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Times New Roman',serif;padding:20px;color:#1a1a1a;font-size:11pt}
    .kop{text-align:center;border-bottom:3px double #1a5c2a;padding-bottom:10px;margin-bottom:14px}
    .kop .inst{font-size:15pt;font-weight:bold;margin:2px 0}
    .kop .sub{font-size:10pt}
    h2{text-align:center;font-size:13pt;margin:12px 0 4px;text-transform:uppercase}
    h3{text-align:center;font-size:11pt;margin-bottom:14px;font-weight:normal}
    table{width:100%;border-collapse:collapse;font-size:10pt}
    th{background:#1a5c2a;color:#fff;padding:7px 8px;text-align:center;border:1px solid #1a5c2a}
    th:nth-child(2),th:nth-child(3){text-align:left}
    td{padding:6px 8px;border:1px solid #ccc;vertical-align:top}
    td:nth-child(2),td:nth-child(3){text-align:left}
    tr:nth-child(even) td{background:#e8f4ee}
    .grand{background:#f0f9f6;font-weight:bold;text-align:center;border:1px solid #ccc;padding:6px}
    .ttd{display:flex;justify-content:space-between;margin-top:40px;font-size:10pt}
    .ttd-box{text-align:center;width:220px}
    .ttd-name{font-weight:bold;text-decoration:underline;margin-top:50px}
    .note{font-size:9pt;color:#888;text-align:center;margin-top:16px}
    @media print{body{padding:10px}}
  </style></head><body>
  <div class="kop">
    <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:6px">
      <img src="assets/logo.png" style="width:64px;height:64px;object-fit:contain"/>
      <div>
        <div style="font-size:10pt">YAYASAN AL-IMAM ASY-SYAFI'I</div>
        <div class="inst">Pondok Pesantren Al Imam Asy-Syafi'i Tarakan</div>
        <div class="sub">Jalan Swaran Jaya RT 15, Juata Permai &nbsp;|&nbsp; Telp. +62 853-2786-3877</div>
      </div>
      <img src="assets/logo.png" style="width:64px;height:64px;object-fit:contain"/>
    </div>
  </div>
  <h2>Daftar Pengguna Sistem</h2>
  <h3>Data Akun Aplikasi Daftar Hadir Halaqah</h3>
  <table>
    <thead><tr><th style="width:35px">No</th><th>Nama</th><th>Jabatan</th><th style="width:120px">Username</th><th style="width:120px">Password</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="5" class="grand">Total: ${users.length} Pengguna</td></tr></tfoot>
  </table>
  <div class="ttd">
    <div class="ttd-box">
      <div>PIMPINAN PONDOK PESANTREN</div>
      <div class="ttd-name">HARMIN, S.Pd.</div>
    </div>
    <div class="ttd-box">
      <div>Kota Tarakan, ${tgl}</div>
      <div style="margin-top:4px">TATA USAHA,</div>
      <div class="ttd-name">ADNAN ABDUL RASYID, ST.</div>
    </div>
  </div>
  <div class="note">⚠️ Dokumen ini bersifat RAHASIA — hanya untuk keperluan internal</div>
  </body></html>`;
  // iOS Safari fix: window.open harus dipanggil synchronous dari click event
  const w=window.open('','_blank');
  if(!w){ showToast('Popup diblokir browser. Izinkan popup untuk halaman ini.', false); return; }
  w.document.write(html);w.document.close();w.focus();
  setTimeout(()=>w.print(),500);
};

window.doResetPw=async()=>{
  const id=document.getElementById('rp-uid').value;
  const np=document.getElementById('rp-new').value;
  const cp=document.getElementById('rp-conf').value;
  if(!np){showToast('Password baru wajib diisi',false);return;}
  if(np!==cp){showToast('Konfirmasi password tidak cocok',false);return;}
  showLoading('Mereset password...');
  try{
    const u=users.find(x=>x.id===id);
    u.pwHash=await hashPw(np);
    u.pwPlain=encodePw(np);
    await saveUserDoc(u);
    closeModal('modal-reset-pw');
    showToast('✅ Password berhasil direset');
  }catch(e){showToast('❌ Gagal mereset',false);}
  hideLoading();
};

// ── ADMIN VIEW ATTENDANCE ──
window.__viewAtt=async(id)=>{
  const u=users.find(x=>x.id===id);if(!u)return;
  viewingUser=u;
  showLoading('Memuat absensi...');
  await loadAtt(id);
  try{ await loadKetHarianMonth(TODAY.getFullYear(), TODAY.getMonth()); }catch(e){}
  hideLoading();
  cYear=TODAY.getFullYear();cMonth=TODAY.getMonth();cView2='monthly';editDay=null;editDayW=null;selWeek=1;
  document.getElementById('aa-name').textContent=u.name;
  document.getElementById('aa-role').textContent=rolesText(u);
  document.getElementById('att-month2').textContent=MONTHS[cMonth];
  document.getElementById('att-year2').textContent=cYear;
  showScreen('admin-att');
  switchTab2('monthly');
};

// ── CHANGE PASSWORD ──
async function changeAdminPw(){
  const op=document.getElementById('ap-old').value;
  const np=document.getElementById('ap-new').value;
  const cp=document.getElementById('ap-conf').value;
  if(!op||!np||!cp){showToast('Semua kolom wajib diisi',false);return;}
  if(np!==cp){showToast('Konfirmasi password tidak cocok',false);return;}
  showLoading('Menyimpan password...');
  try{
    const adminDoc=await getAdminDoc();
    const opHash=await hashPw(op);
    const valid=adminDoc?adminDoc.pwHash===opHash:op===ADMIN_DEFAULT_PW;
    if(!valid){hideLoading();showToast('Password lama salah',false);return;}
    await saveAdminDoc({pwHash:await hashPw(np)});
    ['ap-old','ap-new','ap-conf'].forEach(id=>document.getElementById(id).value='');
    showToast('✅ Password admin berhasil diubah');
  }catch(e){showToast('❌ Gagal menyimpan',false);}
  hideLoading();
}
window.changeAdminPw=changeAdminPw;

// changeUserPw dihapus - hanya admin yang bisa ubah password

// ── RENDER HELPERS ──
function sbHTML(score,label,color,big=false){
  return`<div class="score-badge" style="background:linear-gradient(135deg,${color}18,${color}08);border:1.5px solid ${color}33">
    <div style="color:${color};font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;opacity:0.8">${label}</div>
    <div style="font-weight:900;font-size:${big?52:36}px;color:${color};line-height:1;font-family:'Amiri',serif">${score}</div>
    <div style="color:var(--muted);font-size:12px;margin-top:4px;font-weight:600">jam</div></div>`;
}
function recapGrid(totals,color){
  return`<div class="recap-grid">${SESSIONS.map(s=>`<div class="recap-item" style="border-left:3px solid ${s.color}">
    <div style="font-weight:800;font-size:11px;color:${s.color};margin-bottom:4px">${s.icon} ${s.label}</div>
    <div style="font-weight:900;font-size:20px;color:var(--text)">${totals[s.key]}</div>
    <div style="font-size:10px;color:var(--muted)">×2=<b style="color:${color}">${totals[s.key]*2}</b></div>
  </div>`).join('')}</div>`;
}

// ── TAB SWITCH ──
function switchTab(v){
  cView=v;
  ['monthly','weekly','recap'].forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('active',t===v);
    document.getElementById('view-'+t).style.display=t===v?'block':'none';
  });
  renderCurView();
}
window.switchTab=switchTab;

function renderCurView(){
  if(cView==='monthly')renderMonthlyFor(currentUser.id,'view-monthly',true);
  else if(cView==='weekly')renderWeeklyFor(currentUser.id,'view-weekly',true);
  else renderRecapFor(currentUser.id,'view-recap',true);
}

function switchTab2(v){
  cView2=v;
  ['monthly','weekly','recap'].forEach(t=>{
    const el=document.getElementById('tab-'+t+'2');if(el)el.classList.toggle('active',t===v);
    const vel=document.getElementById('view-'+t+'2');if(vel)vel.style.display=t===v?'block':'none';
  });
  renderCurView2();
}
window.switchTab2=switchTab2;

function renderCurView2(){
  if(!viewingUser)return;
  const uid=viewingUser.id;
  if(cView2==='monthly')renderMonthlyFor(uid,'view-monthly2',false);
  else if(cView2==='weekly')renderWeeklyFor(uid,'view-weekly2',false);
  else renderRecapFor(uid,'view-recap2',false);
}

// ── MONTH NAV ──
function prevMonth(){
  if(cMonth===0){cMonth=11;cYear--;}else cMonth--;
  editDay=null;editDayW=null;selWeek=1;
  loadSubstitutionsForMonth(cYear,cMonth);
  // Keterangan bulan tujuan dimuat asinkron, lalu tampilan disegarkan.
  loadKetHarianMonth(cYear,cMonth)
    .then(()=>{ if(currentUser?.isAdmin&&viewingUser) renderCurView2(); else renderCurView(); })
    .catch(()=>{});
  const isAdmin=currentUser?.isAdmin&&viewingUser;
  if(isAdmin){
    document.getElementById('att-month2').textContent=MONTHS[cMonth];
    document.getElementById('att-year2').textContent=cYear;
    renderCurView2();
  } else {
    document.getElementById('att-month').textContent=MONTHS[cMonth];
    document.getElementById('att-year').textContent=cYear;
    renderCurView();
  }
}
function nextMonth(){
  if(cMonth===11){cMonth=0;cYear++;}else cMonth++;
  editDay=null;editDayW=null;selWeek=1;
  loadSubstitutionsForMonth(cYear,cMonth);
  // Keterangan bulan tujuan dimuat asinkron, lalu tampilan disegarkan.
  loadKetHarianMonth(cYear,cMonth)
    .then(()=>{ if(currentUser?.isAdmin&&viewingUser) renderCurView2(); else renderCurView(); })
    .catch(()=>{});
  const isAdmin=currentUser?.isAdmin&&viewingUser;
  if(isAdmin){
    document.getElementById('att-month2').textContent=MONTHS[cMonth];
    document.getElementById('att-year2').textContent=cYear;
    renderCurView2();
  } else {
    document.getElementById('att-month').textContent=MONTHS[cMonth];
    document.getElementById('att-year').textContent=cYear;
    renderCurView();
  }
}
window.prevMonth=prevMonth;window.nextMonth=nextMonth;

// ── MONTHLY ──
function renderMonthlyFor(uid,targetId,canEdit){
  const y=cYear,m=cMonth,total=dim(y,m),f=fd(y,m),recap=mRec(uid,y,m);
  // Status bar bulan
  let monthStatusBar = '';
  if(canEdit && currentUser && uid===currentUser.id){
    if(isBulanMendatang(y,m)){
      monthStatusBar = `<div style="margin:0 0 12px;padding:10px 14px;background:#fef9c3;border:1.5px solid #fde047;border-radius:12px;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#854d0e"><span>📅</span>Bulan ini belum aktif — tidak dapat diisi</div>`;
    } else if(isBulanLewat(y,m)){
      if(hasActiveAccess(uid,y,m)){
        const exp = getAccessExpiry(uid,y,m);
        const rem = exp ? Math.max(0,Math.ceil((exp-Date.now())/60000)) : 0;
        const color = rem>5?'#22c55e':rem>2?'#f59e0b':'#ef4444';
        monthStatusBar = `<div style="margin:0 0 12px;padding:10px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;font-size:13px;font-weight:700;color:#166534"><div style="display:flex;align-items:center;gap:8px;margin-bottom:5px"><span>✅</span>Akses aktif — sisa <span style="color:${color};font-size:15px">${rem} menit</span></div><div style="height:4px;background:#bbf7d0;border-radius:4px"><div style="height:4px;background:${color};width:${Math.min(100,rem/10*100)}%;border-radius:4px"></div></div></div>`;
      } else {
        monthStatusBar = `<div onclick="showRequestAccessModal(${y},${m})" style="margin:0 0 12px;padding:10px 14px;background:#fff7ed;border:1.5px solid #fdba74;border-radius:12px;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#9a3412;cursor:pointer"><span>🔒</span>Bulan sudah lewat — Klik untuk request akses</div>`;
      }
    }
  }
  const legend=SESSIONS.map(s=>`<span class="chip" style="background:${s.color}18;border:1px solid ${s.color}44;color:${s.color}">${s.icon}${s.label}</span>`).join('');
  // Keterangan admin hanya mengunci tampilan guru; admin melihat data apa adanya.
  const isUserViewCal = canEdit && currentUser && uid===currentUser.id && !currentUser.isAdmin;
  let cells='';
  for(let i=0;i<f;i++)cells+='<div></div>';
  for(let d=1;d<=total;d++){
    const dowJs=new Date(y,m,d).getDay();
    if(dowJs===5)continue; // Skip Jumat — tidak ditampilkan di kalender 6 kolom
    const dd=gdd(uid,y,m,d),cnt=cntDay(dd),sc=scDay(dd);
    const isT=d===TODAY.getDate()&&m===TODAY.getMonth()&&y===TODAY.getFullYear(),isE=editDay===d;
    const isHoliday=isHolidayDate(y,m,d);
    const isBeforeJoin=canEdit&&isBeforeJoinDate(uid,y,m,d);
    const ketDay=getKetHarian(dk(y,m,d),uid);
    const ketT=ketDay?getKetType(ketDay.type):null;
    const ketFullLock=isUserViewCal&&ketDay&&ketDay.allDay;
    const cls=['cal-day',cnt>0?'has-d':'',isT?'is-today':'',isE?'editing':'',isHoliday?'holiday-day':'',isBeforeJoin?'before-join':''].filter(Boolean).join(' ');
    const dots=cnt>0?`<div class="cal-dots">${SESSIONS.filter(s=>dd[s.key]).map(s=>`<span class="dot" style="background:${s.color}"></span>`).join('')}</div>`:'';
    const click=canEdit&&!isBeforeJoin&&!ketFullLock?`onclick="window.__tglDay(${d})"`:''
    const holidayOverlay=isHoliday?`<div class="cal-holiday-mark" title="Hari Libur — sudah diisi otomatis oleh admin">🌙</div>`:'';
    const beforeJoinOverlay=isBeforeJoin?`<div class="cal-holiday-mark" title="Sebelum tanggal bergabung">🔒</div>`:'';
    const ketOverlay=(ketT&&!isHoliday&&!isBeforeJoin)?`<div class="cal-holiday-mark" title="${ketT.label}${ketDay.allDay?' — seluruh sesi dikunci admin':' — '+ketDay.sessions.join(', ')+' dikunci admin'}">${ketT.icon}</div>`:'';
    cells+=`<div class="${cls}" ${click} ${isHoliday?'title="Hari Libur — tidak dapat diubah"':''} ${isBeforeJoin?'title="Sebelum tanggal bergabung — tidak dapat diisi"':''}><div class="cal-day-num">${d}</div>${cnt>0?`<div class="cal-score">${sc}p</div>`:''} ${dots}${holidayOverlay}${beforeJoinOverlay}${ketOverlay}</div>`;
  }
  let editPanel='';
  if(canEdit&&editDay&&!isHolidayDate(y,m,editDay)){
    const dd=gdd(uid,y,m,editDay),dow=new Date(y,m,editDay).getDay();
    const isUserView = currentUser && uid===currentUser.id && !currentUser.isAdmin;
    const hasSchedule = isUserView ? userHasAnySchedule(uid) : true;
    const dateKeyEdit = dk(y,m,editDay);
    const incomingSubM = isUserView ? getSubstitution(dateKeyEdit, uid) : null;
    const outgoingSubsM = isUserView ? getSubstitutionsAsSubstitute(dateKeyEdit, uid) : [];
    const noScheduleWarning = isUserView && !hasSchedule
      ? `<div style="padding:10px 12px;background:#fef9c3;border:1.5px solid #fde047;border-radius:10px;font-size:12px;font-weight:700;color:#854d0e;margin-bottom:10px">📋 Jadwal belum diatur oleh admin — tidak dapat mengisi</div>`
      : '';
    const btns=SESSIONS.map(s=>{
      const a=dd[s.key];
      const scheduled = isUserView ? (hasSchedule ? isSessionScheduled(uid,dow,s.key) : false) : true;
      const takenBySub = incomingSubM && incomingSubM.sessions && incomingSubM.sessions.includes(s.key);
      const ketLock = isUserView ? getKetForSession(dateKeyEdit, uid, s.key) : null;
      const ketLt = ketLock ? getKetType(ketLock.type) : null;
      const disabled = !scheduled || takenBySub || !!ketLock;
      const disabledReason = ketLt ? `${ketLt.label} — dikunci admin`
        : takenBySub ? `Diisi ${incomingSubM.substituteName}` : 'Bukan jadwal Anda';
      const bdC = ketLt?ketLt.color:takenBySub?'#fbbf24':disabled?'#e2e8f0':a?s.color:'var(--border)';
      const bgC = ketLt?ketLt.bg:takenBySub?'#fef9c3':disabled?'#f1f5f9':a?s.color+'22':'var(--bg2)';
      const fgC = ketLt?ketLt.color:takenBySub?'#92400e':disabled?'#cbd5e1':a?s.color:'var(--muted)';
      const mark = ketLt?ketLt.icon:takenBySub?'👤':disabled?'🚫':a?'✅':'⬜';
      return`<button class="sess-btn" ${disabled?'disabled':''} onclick="${disabled?'':'window.__tog(\''+uid+'\','+y+','+m+','+editDay+',\''+s.key+'\')'}"
        style="border-color:${bdC};background:${bgC};color:${fgC};cursor:${disabled?'not-allowed':'pointer'};opacity:${disabled?0.75:1}">
        <div class="s-icon">${mark}</div><div style="font-weight:800;font-size:11px">${s.icon}${s.label}</div><div class="s-desc">${disabled?disabledReason:s.desc}</div></button>`;}).join('');
    const sc=scDay(dd),cnt=cntDay(dd);
    const extraCntM=(dd._substituteExtra||[]).length;
    const totalScM=sc+extraCntM*2,totalCntM=cnt+extraCntM;
    const subInTagM = incomingSubM
      ? `<div style="padding:8px 12px;background:#fef9c3;border:1.5px solid #fbbf24;border-radius:10px;font-size:12px;font-weight:700;color:#92400e;margin-bottom:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span>👤 ${incomingSubM.substituteName} mengisi sebagai pengganti Anda (${incomingSubM.sessions.join(', ')})</span>
          <button onclick="window.__cancelSubstitute('${dateKeyEdit}','${uid}')" style="padding:3px 8px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✕ Batalkan</button>
         </div>` : '';
    // Tag keterangan admin (mengunci sesi hari ini)
    const ketDayM = isUserView ? getKetHarian(dateKeyEdit, uid) : null;
    const ketTM = ketDayM ? getKetType(ketDayM.type) : null;
    const ketTagM = ketTM
      ? `<div style="padding:8px 12px;background:${ketTM.bg};border:1.5px solid ${ketTM.color}66;border-radius:10px;font-size:12px;font-weight:700;color:${ketTM.color};margin-bottom:10px">
          🔒 ${ketTM.icon} ${ketTM.label} — ${ketDayM.allDay?'seluruh sesi':ketDayM.sessions.join(', ')} dikunci admin${ketDayM.kegiatanNama?` · ${ketDayM.kegiatanNama}`:''}${ketDayM.catatan?` · ${ketDayM.catatan}`:''}
         </div>` : '';
    const subOutTagsM = outgoingSubsM.map(s=>
      `<div style="padding:8px 12px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;font-size:12px;font-weight:700;color:#166534;margin-bottom:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span>✅ Anda menggantikan <strong>${s.targetName}</strong> (${s.sessions.join(', ')})</span>
        <button onclick="window.__cancelSubstitute('${dateKeyEdit}','${s.targetUid}')" style="padding:3px 8px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✕</button>
       </div>`).join('');
    const subBtnM = isUserView
      ? `<button onclick="window.__openSubstituteModal('${dateKeyEdit}',${editDay},${dow})" style="width:100%;margin-top:10px;padding:10px;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border:1.5px dashed #7dd3fc;border-radius:12px;color:#0369a1;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          👤 Isi Sebagai Guru Pengganti
         </button>` : '';
    editPanel=`<div class="edit-panel fade-in">
      <div style="font-weight:800;font-size:15px;color:var(--teal2);margin-bottom:12px">✏️ ${DF[dow]}, ${editDay} ${MONTHS[m]} ${y}</div>
      ${ketTagM}${subInTagM}${subOutTagsM}${noScheduleWarning}<div class="sess-grid">${btns}</div>${subBtnM}
      <div style="margin-top:14px;text-align:center;background:var(--sage3);border:1px solid var(--sage4);border-radius:14px;padding:12px">
        <span style="color:var(--muted);font-size:13px">Skor hari ini: </span>
        <span style="font-weight:900;font-size:28px;color:var(--sage2);font-family:'Amiri',serif">${totalScM}</span>
        <span style="color:var(--muted);font-size:12px"> jam (${totalCntM} sesi × 2)</span></div></div>`;
  }
  document.getElementById(targetId).innerHTML=`
    ${monthStatusBar}<div class="legend">${legend}</div>
    <div class="card" style="padding:12px">
      <div class="cal-grid" style="margin-bottom:6px;grid-template-columns:repeat(6,1fr)">${CAL_COLS.map(d=>`<div class="cal-hdr">${d}</div>`).join('')}</div>
      <div class="cal-grid" style="grid-template-columns:repeat(6,1fr)">${cells}</div></div>
    ${editPanel}
    <div class="card card-teal">
      <div style="font-weight:800;font-size:14px;color:var(--teal2);margin-bottom:12px">📅 Ringkasan ${MONTHS[m]} ${y}</div>
      ${recapGrid(recap.totals,'var(--sage2)')}${sbHTML(recap.totalScore,`Total Bulan ${MONTHS[m]}`,'#6ba8b8')}</div>`;
}

// ── WEEKLY ──
function renderWeeklyFor(uid,targetId,canEdit){
  const y=cYear,m=cMonth,tw=wim(y,m);
  if(selWeek>tw)selWeek=1;
  const wr=wRec(uid,y,m,selWeek);
  const t=dim(y,m),f=fd(y,m),days=[];
  for(let d=1;d<=t;d++)if(wom(d,f)===selWeek)days.push(d);
  const wBtns=Array.from({length:tw},(_,i)=>i+1).map(w=>`<button class="btn-week ${selWeek===w?'active':''}" onclick="window.__setWeek(${w})">Pekan ${w}</button>`).join('');
  const dCards=days.map(d=>{
    const dd=gdd(uid,y,m,d),cnt=cntDay(dd),sc=scDay(dd),dow=new Date(y,m,d).getDay();
    const isT=d===TODAY.getDate()&&m===TODAY.getMonth()&&y===TODAY.getFullYear(),isE=canEdit&&editDayW===d;
    const isHoliday=isHolidayDate(y,m,d);
    const isBeforeJoin=canEdit&&isBeforeJoinDate(uid,y,m,d);
    const chips=SESSIONS.filter(s=>dd[s.key]).map(s=>`<span class="chip" style="background:${s.color}18;border:1px solid ${s.color}44;color:${s.color};font-size:10px;padding:2px 8px">${s.key}</span>`).join('');
    const extraScCard=(dd._substituteExtra||[]).length*2;
    let body='';
    if(isE&&!isHoliday){
      const isUserView = currentUser && uid===currentUser.id && !currentUser.isAdmin;
      const hasSchedule = isUserView ? userHasAnySchedule(uid) : true;
      const dateKey = dk(y,m,d);
      // Cek apakah ada yang menggantikan guru ini
      const incomingSub = isUserView ? getSubstitution(dateKey, uid) : null;
      // Cek apakah guru ini sedang menggantikan guru lain hari ini
      const outgoingSubs = isUserView ? getSubstitutionsAsSubstitute(dateKey, uid) : [];
      const noScheduleWarning = isUserView && !hasSchedule
        ? `<div style="padding:9px 12px;background:#fef9c3;border:1.5px solid #fde047;border-radius:10px;font-size:12px;font-weight:700;color:#854d0e;margin-bottom:8px">📋 Jadwal belum diatur oleh admin</div>`
        : '';
      const btns=SESSIONS.map(s=>{
        const a=dd[s.key];
        const scheduled = isUserView ? (hasSchedule ? isSessionScheduled(uid,dow,s.key) : false) : true;
        // Sesi ini sudah diisi oleh pengganti?
        const takenBySub = incomingSub && incomingSub.sessions && incomingSub.sessions.includes(s.key);
        // Sesi ini dikunci keterangan admin?
        const ketLock = isUserView ? getKetForSession(dateKey, uid, s.key) : null;
        const ketLt = ketLock ? getKetType(ketLock.type) : null;
        const disabled = !scheduled || takenBySub || !!ketLock;
        const disabledReason = ketLt ? `${ketLt.label} — dikunci admin`
          : takenBySub ? `Diisi ${incomingSub.substituteName}` : 'Bukan jadwal Anda';
        const bdC = ketLt?ketLt.color:takenBySub?'#fbbf24':disabled?'#e2e8f0':a?s.color:'var(--border)';
        const bgC = ketLt?ketLt.bg:takenBySub?'#fef9c3':disabled?'#f1f5f9':a?s.color+'22':'var(--card)';
        const fgC = ketLt?ketLt.color:takenBySub?'#92400e':disabled?'#cbd5e1':a?s.color:'var(--muted)';
        const mark = ketLt?ketLt.icon:takenBySub?'👤':disabled?'🚫':a?'✅':'⬜';
        return`<button class="sess-btn" ${disabled?'disabled':''} onclick="${disabled?'':'window.__tog(\''+uid+'\','+y+','+m+','+d+',\''+s.key+'\')'}"
          style="border-color:${bdC};background:${bgC};color:${fgC};cursor:${disabled?'not-allowed':'pointer'};opacity:${disabled?0.75:1}">
          <div>${mark} ${s.icon}${s.label}</div><div class="s-desc">${disabled?disabledReason:s.desc}</div></button>`;}).join('');
      // Info substitusi masuk
      const subInTag = incomingSub
        ? `<div style="padding:8px 12px;background:#fef9c3;border:1.5px solid #fbbf24;border-radius:10px;font-size:12px;font-weight:700;color:#92400e;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <span>👤</span><span>${incomingSub.substituteName} mengisi sebagai pengganti Anda (${incomingSub.sessions.join(', ')})</span>
            <button onclick="window.__cancelSubstitute('${dateKey}','${uid}')" style="margin-left:auto;padding:3px 8px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✕ Batalkan</button>
           </div>` : '';
      // Info substitusi keluar (guru ini sedang jadi pengganti)
      const subOutTags = outgoingSubs.map(s=>
        `<div style="padding:8px 12px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;font-size:12px;font-weight:700;color:#166534;margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <span>✅</span><span>Anda menggantikan <strong>${s.targetName}</strong> (${s.sessions.join(', ')})</span>
          <button onclick="window.__cancelSubstitute('${dateKey}','${s.targetUid}')" style="margin-left:auto;padding:3px 8px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✕</button>
         </div>`).join('');
      // Tombol isi sebagai pengganti (hanya user biasa, hanya hari terjadwal atau ada jadwal)
      const subBtn = isUserView
        ? `<button onclick="window.__openSubstituteModal('${dateKey}',${d},${dow})" style="width:100%;margin-top:10px;padding:10px;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border:1.5px dashed #7dd3fc;border-radius:12px;color:#0369a1;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
            👤 Isi Sebagai Guru Pengganti
           </button>` : '';
      const ketDayW2 = isUserView ? getKetHarian(dateKey, uid) : null;
      const ketTW = ketDayW2 ? getKetType(ketDayW2.type) : null;
      const ketTagW = ketTW
        ? `<div style="padding:8px 12px;background:${ketTW.bg};border:1.5px solid ${ketTW.color}66;border-radius:10px;font-size:12px;font-weight:700;color:${ketTW.color};margin-bottom:8px">
            🔒 ${ketTW.icon} ${ketTW.label} — ${ketDayW2.allDay?'seluruh sesi':ketDayW2.sessions.join(', ')} dikunci admin${ketDayW2.kegiatanNama?` · ${ketDayW2.kegiatanNama}`:''}${ketDayW2.catatan?` · ${ketDayW2.catatan}`:''}
           </div>` : '';
      body=`<div class="day-body open">${ketTagW}${subInTag}${subOutTags}${noScheduleWarning}<div class="sess-grid">${btns}</div>${subBtn}</div>`;
    }
    const isUserView2 = canEdit && currentUser && uid===currentUser.id && !currentUser.isAdmin;
    const ketCard = getKetHarian(dk(y,m,d), uid);
    const ketTc = ketCard ? getKetType(ketCard.type) : null;
    const ketFullLockW = isUserView2 && ketCard && ketCard.allDay;
    const ketTagHdr = ketTc
      ? `<span style="font-size:10px;background:${ketTc.bg};color:${ketTc.color};border:1px solid ${ketTc.color}55;border-radius:6px;padding:1px 6px;font-weight:700">${ketTc.icon} ${ketTc.label} 🔒</span>`
      : '';
    const dayHasSchedule = isUserView2 ? (userHasAnySchedule(uid) && getUserDaySchedule(uid,dow)!==null) : true;
    const noScheduleTag = isUserView2 && !userHasAnySchedule(uid)
      ? `<span style="font-size:10px;background:#fef9c3;color:#92400e;border:1px solid #fde047;border-radius:6px;padding:1px 6px;font-weight:700">📋 Jadwal belum diatur</span>`
      : (isUserView2 && !dayHasSchedule && !isHoliday)
      ? `<span style="font-size:10px;background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0;border-radius:6px;padding:1px 6px;font-weight:700">🚫 Tidak terjadwal</span>`
      : '';
    return`<div class="day-card" style="border-color:${isT?'var(--sage)':isE?'var(--teal)':isBeforeJoin?'#94a3b8':isHoliday?'var(--rose2)':(!dayHasSchedule&&isUserView2&&!isHoliday)?'#e2e8f0':'var(--border)'}">
      <div class="day-card-hdr" ${canEdit&&!isBeforeJoin&&!ketFullLockW&&(dayHasSchedule||isHoliday)?`onclick="window.__tglDayW(${d})"`:''}>
        <div class="day-num-box ${isT?'today':''}" style="${(!dayHasSchedule&&isUserView2&&!isHoliday)?'opacity:0.5':''}">
          <div style="font-weight:800;font-size:16px;line-height:1;color:${isT?'#fff':'var(--text)'}">${d}</div>
          <div style="font-size:9px;color:${isT?'rgba(255,255,255,0.8)':'var(--muted)'};font-weight:700">${DS[dow]}</div>
        </div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:14px;color:${isT?'var(--sage2)':(!dayHasSchedule&&isUserView2&&!isHoliday)?'var(--muted)':'var(--text)'}">${DF[dow]}${isHoliday?` <span style="font-size:11px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:8px;padding:1px 7px;font-weight:700;margin-left:4px">🌙 Hari Libur</span>`:''} ${isBeforeJoin?` <span style="font-size:11px;background:#f1f5f9;color:#64748b;border:1px solid #cbd5e1;border-radius:8px;padding:1px 7px;font-weight:700;margin-left:4px">🔒 Sebelum Bergabung</span>`:''}</div>
          <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:5px">${ketTagHdr}${noScheduleTag||(isHoliday&&cnt===0?`<span style="font-size:11px;color:#dc2626;font-weight:600">Libur — diisi otomatis admin</span>`:cnt===0?`<span style="font-size:11px;color:var(--muted);font-weight:600">Belum diisi</span>`:chips)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-weight:900;font-size:24px;color:var(--sage2);font-family:'Amiri',serif">${sc+extraScCard}</div>
          <div style="font-size:10px;color:var(--muted);font-weight:600">jam</div>
        </div>
      </div>${body}</div>`;
  }).join('');
  document.getElementById(targetId).innerHTML=`
    <div style="display:flex;gap:6px;margin-bottom:14px;overflow-x:auto;padding-bottom:4px">${wBtns}</div>
    ${dCards}
    <div class="card card-sage">
      <div style="font-weight:800;color:var(--sage2);margin-bottom:12px;font-size:14px">📊 Rekap Pekan ${selWeek} — ${MONTHS[m]} ${y}</div>
      ${recapGrid(wr.totals,'var(--sage2)')}${sbHTML(wr.totalScore,`Total Pekan ${selWeek}`,'#7fb3a0')}</div>`;
}

// ── RECAP ──
function renderRecapFor(uid,targetId,canPrint){
  const y=cYear,m=cMonth,tw=wim(y,m),monthly=mRec(uid,y,m);
  const wCards=Array.from({length:tw},(_,i)=>i+1).map(w=>{
    const wr=wRec(uid,y,m,w);
    const chips=SESSIONS.map(s=>`<span class="chip" style="background:${s.color}18;border:1px solid ${s.color}44;color:${s.color}">${s.icon}${s.key}: ${wr.totals[s.key]} <span style="color:var(--muted);font-weight:500">(=${wr.totals[s.key]*2}p)</span></span>`).join('');
    return`<div class="card card-amber">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-weight:800;color:var(--amber2);font-size:14px">⭐ Pekan ${w}</div>
        <div style="font-weight:900;color:var(--sage2);font-size:20px;font-family:'Amiri',serif">${wr.totalScore} <span style="font-size:11px;color:var(--muted);font-family:'Nunito',sans-serif">jam</span></div>
      </div><div>${chips}</div></div>`;
  }).join('');
  const pBtn=canPrint?`<div style="display:flex;gap:8px"><button class="btn btn-teal" style="font-size:12px;padding:8px 14px" onclick="window.__exportMExcel('${uid}')">📊 Excel</button><button class="btn btn-amber" style="font-size:12px;padding:8px 14px" onclick="window.__printM('${uid}')">🖨️ Cetak</button></div>`:'';
  document.getElementById(targetId).innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-weight:800;font-size:15px;color:var(--amber2)">📊 Rekap ${MONTHS[m]} ${y}</div>${pBtn}</div>
    ${wCards}
    <div class="card" style="border:2px solid var(--sage4)">
      <div style="font-weight:800;font-size:16px;color:var(--sage2);margin-bottom:14px">🗓️ Total Bulan ${MONTHS[m]} ${y}</div>
      ${recapGrid(monthly.totals,'var(--sage2)')}${sbHTML(monthly.totalScore,`Grand Total ${MONTHS[m]} ${y}`,'#7fb3a0',true)}</div>`;
}

// ── POP-UP NOTIF HARI LIBUR ──
function showHolidayNotif(){
  const el=document.getElementById('modal-holiday-notif');
  if(!el){console.error('modal-holiday-notif tidak ditemukan!');return;}
  el.classList.add('show');
  document.body.style.overflow='hidden';
}
function closeHolidayNotif(){
  const el=document.getElementById('modal-holiday-notif');
  if(!el)return;
  el.classList.remove('show');
  document.body.style.overflow='';
}
window.showHolidayNotif=showHolidayNotif;
window.closeHolidayNotif=closeHolidayNotif;

// ── GLOBAL HANDLERS ──
// ══════════════════════════════════════════════════════════════
// KONTROL AKSES PER BULAN
// ══════════════════════════════════════════════════════════════
// Durasi akses setelah disetujui admin: 10 menit
const ACCESS_DURATION_MS = 10 * 60 * 1000;

// Cek apakah bulan (y,m) adalah bulan berjalan
function isBulanBerjalan(y, m){
  return y === TODAY.getFullYear() && m === TODAY.getMonth();
}
// Cek apakah bulan (y,m) sudah lewat
// ── JOIN DATE: cek apakah tanggal sebelum joinDate user ──
function isBeforeJoinDate(uid, y, m, d){
  const u = users.find(x=>x.id===uid);
  if(!u || u.employeeType!=='baru' || !u.joinDate) return false;
  const tgt = new Date(y, m, d);
  // iOS Safari fix: tambah 'T00:00:00' agar joinDate diparsing sebagai local time bukan UTC
  const join = new Date(u.joinDate + 'T00:00:00');
  // Set join ke awal hari
  join.setHours(0,0,0,0); tgt.setHours(0,0,0,0);
  return tgt < join;
}

function isBulanLewat(y, m){
  const now = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  const tgt = new Date(y, m, 1);
  return tgt < now;
}
// Cek apakah bulan (y,m) adalah bulan mendatang
function isBulanMendatang(y, m){
  const now = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  const tgt = new Date(y, m, 1);
  return tgt > now;
}

// Cek apakah user punya akses aktif ke bulan lampau tertentu
// Akses disimpan di Firestore: accessGrants/{uid}/grants/{YYYY-MM} = {expiresAt: timestamp}
let accessGrantsCache = {}; // {uid: {YYYY-MM: expiresAt}}

// ── SUBSTITUSI: Cache data penggantian ──
// substitutionsCache[dateKey][targetUid] = {substituteUid, substituteName, targetUid, targetName, sessions:[sk,...]}
let substitutionsCache = {};

// Load semua substitusi untuk bulan tertentu (y, m)
async function loadSubstitutionsForMonth(y, m){
  const prefix = `${y}-${String(m+1).padStart(2,'0')}`;
  try{
    const snap = await getDocs(collection(fs,'substitutions'));
    snap.forEach(d=>{
      const data = d.data();
      if(d.id.startsWith(prefix)){
        if(!substitutionsCache[data.dateKey]) substitutionsCache[data.dateKey] = {};
        substitutionsCache[data.dateKey][data.targetUid] = data;
      }
    });
  }catch(e){ console.warn('loadSubstitutions err:',e.message); }
}

// Simpan/update substitusi
async function saveSubstitution(dateKey, targetUid, subData){
  const docId = `${dateKey}_${targetUid}`;
  await setDoc(doc(fs,'substitutions',docId), subData);
  if(!substitutionsCache[dateKey]) substitutionsCache[dateKey] = {};
  substitutionsCache[dateKey][targetUid] = subData;
}

// Hapus substitusi (jika pengganti membatalkan)
async function deleteSubstitution(dateKey, targetUid){
  const docId = `${dateKey}_${targetUid}`;
  await deleteDoc(doc(fs,'substitutions',docId));
  if(substitutionsCache[dateKey]) delete substitutionsCache[dateKey][targetUid];
}

// Ambil substitusi untuk tanggal & guru tertentu
function getSubstitution(dateKey, targetUid){
  return substitutionsCache[dateKey]?.[targetUid] || null;
}

// Ambil semua substitusi di mana uid ini menjadi pengganti (pada dateKey)
function getSubstitutionsAsSubstitute(dateKey, substituteUid){
  if(!substitutionsCache[dateKey]) return [];
  return Object.values(substitutionsCache[dateKey]).filter(s=>s.substituteUid===substituteUid);
}

async function loadAccessGrants(uid){
  try{
    const snap = await getDoc(doc(fs, 'accessGrants', uid));
    if(snap.exists()) accessGrantsCache[uid] = snap.data().grants || {};
    else accessGrantsCache[uid] = {};
  }catch(e){ accessGrantsCache[uid] = {}; }
}

async function saveAccessGrant(uid, monthKey, expiresAt){
  if(!accessGrantsCache[uid]) accessGrantsCache[uid] = {};
  accessGrantsCache[uid][monthKey] = expiresAt;
  await setDoc(doc(fs,'accessGrants',uid),{grants: accessGrantsCache[uid]});
}

function hasActiveAccess(uid, y, m){
  if(!accessGrantsCache[uid]) return false;
  const key = `${y}-${String(m+1).padStart(2,'0')}`;
  const exp = accessGrantsCache[uid][key];
  if(!exp) return false;
  return Date.now() < exp;
}

function getAccessExpiry(uid, y, m){
  if(!accessGrantsCache[uid]) return null;
  const key = `${y}-${String(m+1).padStart(2,'0')}`;
  return accessGrantsCache[uid][key] || null;
}

// Cek apakah pengguna boleh edit bulan ini
function canEditMonth(uid, y, m){
  if(isBulanBerjalan(y,m)) return true;
  if(isBulanLewat(y,m)) return hasActiveAccess(uid,y,m);
  return false; // bulan mendatang
}

// ── ACCESS REQUEST: simpan di Firestore ──
// accessRequests/{requestId} = {uid, userName, monthKey, status:'pending'/'approved'/'rejected', requestedAt, processedAt?, grantOption?}
// changeRequests/{uid} = {uid, userName, type:'username'/'password'/'both', newUsername?, newPassword?, status:'pending'/'approved'/'rejected', requestedAt, processedAt?}

async function loadAccessRequests(){
  try{
    const snap = await getDocs(collection(fs,'accessRequests'));
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){return [];}
}

// ── changeRequests helpers ──
async function loadChangeRequests(){
  try{
    const snap = await getDocs(collection(fs,'changeRequests'));
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){return [];}
}
async function saveChangeRequest(uid,data){
  await setDoc(doc(fs,'changeRequests',uid),data);
}
async function getChangeRequest(uid){
  try{
    const d = await getDoc(doc(fs,'changeRequests',uid));
    return d.exists()?d.data():null;
  }catch(e){return null;}
}

async function submitAccessRequest(uid, y, m){
  const monthKey = `${y}-${String(m+1).padStart(2,'0')}`;
  const monthLabel = `${MONTHS[m]} ${y}`;
  const u = users.find(x=>x.id===uid);
  const reqId = `${uid}_${monthKey}`;
  await setDoc(doc(fs,'accessRequests',reqId),{
    uid, userName: u?.name||'', monthKey, monthLabel,
    status:'pending', requestedAt: Date.now()
  });
  // Simpan notif untuk admin (semua admin)
  const adminUsers = users.filter(u=>u.roles&&u.roles.includes('Admin'));
  for(const adm of adminUsers){
    await setDoc(doc(fs,'adminNotifs',adm.id),{
      hasNew: true,
      lastReqId: reqId,
      lastReqName: u?.name||'',
      lastReqMonth: monthLabel,
      updatedAt: Date.now()
    });
  }
}

async function processAccessRequest(reqId, action, grantOption){
  const reqRef = doc(fs,'accessRequests',reqId);
  const snap = await getDoc(reqRef);
  if(!snap.exists()) return;
  const req = snap.data();
  const [yStr,mStr] = req.monthKey.split('-');
  const y = parseInt(yStr), m = parseInt(mStr)-1;

  await updateDoc(reqRef,{
    status: action==='approve'?'approved':'rejected',
    processedAt: Date.now(),
    grantOption: grantOption||null
  });

  if(action==='approve'){
    const expiresAt = Date.now() + ACCESS_DURATION_MS;
    await saveAccessGrant(req.uid, req.monthKey, expiresAt);
    // Reload grants untuk user ini
    await loadAccessGrants(req.uid);
    // Jika ini user yang sedang login, update UI
    if(currentUser && currentUser.id === req.uid){
      renderCurView();
      showAccessGrantedBanner(req.monthLabel, expiresAt, grantOption);
    }
    // Kirim notif ke pengguna
    await setDoc(doc(fs,'notifications',req.uid),{
      pesan:`Admin menyetujui akses Anda ke bulan ${req.monthLabel}. Akses aktif 10 menit.`,
      bulan: req.monthLabel, timestamp: Date.now(), dibaca: false,
      type:'accessGranted', expiresAt
    });
  } else {
    await setDoc(doc(fs,'notifications',req.uid),{
      pesan:`Permintaan akses ke bulan ${req.monthLabel} ditolak oleh admin.`,
      bulan: req.monthLabel, timestamp: Date.now(), dibaca: false,
      type:'accessRejected'
    });
  }
}

// Timer management
let accessTimers = {}; // {uid_monthKey: intervalId}
let accessBannerInterval = null;

function showAccessGrantedBanner(monthLabel, expiresAt, grantOption){
  let banner = document.getElementById('access-timer-banner');
  if(!banner){
    banner = document.createElement('div');
    banner.id = 'access-timer-banner';
    banner.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;z-index:9999;padding:0;pointer-events:auto;';
    document.body.appendChild(banner);
  }
  function update(){
    const remain = expiresAt - Date.now();
    if(remain <= 0){
      banner.innerHTML = '';
      if(accessBannerInterval) clearInterval(accessBannerInterval);
      renderCurView();
      showToast('⏰ Akses ke bulan '+monthLabel+' telah berakhir.');
      return;
    }
    const mins = Math.floor(remain/60000);
    const secs = Math.floor((remain%60000)/1000);
    const pct = Math.max(0, remain / ACCESS_DURATION_MS * 100);
    const color = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444';
    banner.innerHTML = `
      <div style="background:#1e293b;color:#fff;padding:8px 16px 0;font-size:12px;font-weight:700;display:flex;align-items:center;gap:8px">
        <span style="font-size:14px">⏱️</span>
        <span style="flex:1">Akses ${monthLabel} aktif — sisa <span style="color:${color};font-size:14px;font-weight:900">${mins}:${String(secs).padStart(2,'0')}</span></span>
        <span style="font-size:10px;color:#94a3b8">${grantOption||''}</span>
      </div>
      <div style="height:5px;background:#334155;width:100%">
        <div style="height:5px;background:${color};width:${pct}%;transition:width 1s linear;border-radius:0 3px 3px 0"></div>
      </div>`;
  }
  if(accessBannerInterval) clearInterval(accessBannerInterval);
  update();
  accessBannerInterval = setInterval(update, 1000);
}

// Cek dan tampilkan banner jika ada akses aktif saat login
function checkAndShowActiveBanners(){
  if(!currentUser) return;
  const grants = accessGrantsCache[currentUser.id] || {};
  for(const [mk, exp] of Object.entries(grants)){
    if(Date.now() < exp){
      const [yS,mS] = mk.split('-');
      const y=parseInt(yS), m=parseInt(mS)-1;
      if(isBulanLewat(y,m)){
        showAccessGrantedBanner(`${MONTHS[m]} ${yS}`, exp, '');
        break;
      }
    }
  }
}

// Pop-up request akses untuk pengguna
function showRequestAccessModal(y, m){
  const monthLabel = `${MONTHS[m]} ${y}`;
  let modal = document.getElementById('modal-request-access');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'modal-request-access';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:flex-end;justify-content:center';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="fade-in" style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:24px 20px 32px;box-shadow:0 -4px 32px rgba(0,0,0,0.18)">
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:40px;margin-bottom:8px">🔒</div>
        <div style="font-weight:800;font-size:17px;color:#1e293b">Akses Terkunci</div>
        <div style="font-size:13px;color:#64748b;margin-top:6px;line-height:1.6">Bulan <strong>${monthLabel}</strong> sudah lewat.<br>Anda perlu persetujuan admin untuk mengisi absensi.</div>
      </div>
      <button onclick="doRequestAccess(${y},${m})" class="btn" style="width:100%;padding:13px;background:linear-gradient(135deg,#5a9b86,#3d7a68);color:#fff;font-weight:800;font-size:15px;border-radius:14px;margin-bottom:10px">📨 Kirim Request Akses</button>
      <button onclick="document.getElementById('modal-request-access').style.display='none'" style="width:100%;padding:11px;background:none;border:2px solid #e2e8f0;border-radius:14px;font-weight:700;font-size:14px;color:#64748b;cursor:pointer">Batalkan</button>
    </div>`;
}

async function doRequestAccess(y, m){
  const monthLabel = `${MONTHS[m]} ${y}`;
  document.getElementById('modal-request-access').style.display = 'none';
  showLoading('Mengirim request...');
  try{
    await submitAccessRequest(currentUser.id, y, m);
    hideLoading();
    showToast(`📨 Request akses ${monthLabel} terkirim ke admin`);
  }catch(e){
    hideLoading();
    showToast('❌ Gagal mengirim request',false);
  }
}
window.doRequestAccess = doRequestAccess;

// Render admin notif page dengan request akses
async function renderAdminNotifPage(){
  const el = document.getElementById('notif-admin-list');
  el.innerHTML = `<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">Memuat...</div>`;
  try{
    const [requests, changeReqs] = await Promise.all([loadAccessRequests(), loadChangeRequests()]);
    const pendingAccess = requests.filter(r=>r.status==='pending');
    const recentAccess = requests.filter(r=>r.status!=='pending').sort((a,b)=>(b.processedAt||0)-(a.processedAt||0)).slice(0,5);
    const pendingChange = changeReqs.filter(r=>r.status==='pending');
    const recentChange = changeReqs.filter(r=>r.status==='approved'||r.status==='rejected').sort((a,b)=>(b.processedAt||0)-(a.processedAt||0)).slice(0,5);

    const totalPending = pendingAccess.length + pendingChange.length;
    if(!totalPending && !recentAccess.length && !recentChange.length){
      el.innerHTML = `<div class="empty" style="margin-top:40px"><div style="font-size:48px;margin-bottom:12px">🔔</div><div style="font-weight:800;font-size:16px">Tidak ada notifikasi</div><div style="font-size:13px;margin-top:5px;color:var(--muted)">Belum ada request dari pengguna</div></div>`;
      updateAdminNotifBadge(0);
      return;
    }
    let html = '';

    // ── Request Ganti Akun (pending) ──
    if(pendingChange.length){
      html += `<div style="padding:14px 16px 6px;font-weight:800;font-size:13px;color:#d97706;text-transform:uppercase;letter-spacing:.5px">✏️ Request Ganti Akun (${pendingChange.length})</div>`;
      for(const r of pendingChange){
        const ago = Math.round((Date.now()-r.requestedAt)/60000);
        const typeLabel = r.type==='username'?'Username':r.type==='password'?'Password':'Username & Password';
        html += `<div style="margin:8px 12px;background:#fff;border:1.5px solid #fcd34d;border-radius:16px;padding:14px 16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:40px;height:40px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px">✏️</div>
            <div style="flex:1">
              <div style="font-weight:800;font-size:14px">${r.userName}</div>
              <div style="font-size:12px;color:#64748b">Minta ganti <strong>${typeLabel}</strong>
                ${r.type==='username'||r.type==='both'?`<br><span style="color:#6366f1">→ username: <strong>${r.newUsername||'-'}</strong></span>`:''}
                ${r.note?`<br><em style="color:#92400e">"${r.note}"</em>`:''}
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px">${ago < 2 ? 'Baru saja' : ago+'m lalu'}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button onclick="window.__approveChangeReq('${r.uid}')" style="flex:1;padding:9px;background:linear-gradient(135deg,#5a9b86,#3d7a68);color:#fff;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer">✅ Setujui & Edit</button>
            <button onclick="window.__rejectChangeReq('${r.uid}')" style="flex:1;padding:9px;background:linear-gradient(135deg,#f87171,#dc2626);color:#fff;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer">❌ Tolak</button>
          </div>
        </div>`;
      }
    }

    // ── Request Akses Bulan (pending) ──
    if(pendingAccess.length){
      html += `<div style="padding:14px 16px 6px;font-weight:800;font-size:13px;color:#ef4444;text-transform:uppercase;letter-spacing:.5px">🔴 Request Akses (${pendingAccess.length})</div>`;
      for(const r of pendingAccess){
        const ago = Math.round((Date.now()-r.requestedAt)/60000);
        html += `<div style="margin:8px 12px;background:#fff;border:1.5px solid #fca5a5;border-radius:16px;padding:14px 16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:40px;height:40px;background:linear-gradient(135deg,#fee2e2,#fecaca);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px">📨</div>
            <div style="flex:1">
              <div style="font-weight:800;font-size:14px">${r.userName}</div>
              <div style="font-size:12px;color:#64748b">Minta akses <strong>${r.monthLabel}</strong> · ${ago < 2 ? 'Baru saja' : ago+'m lalu'}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button onclick="showApproveOptions('${r.id}','${r.monthLabel}')" style="flex:1;padding:9px;background:linear-gradient(135deg,#5a9b86,#3d7a68);color:#fff;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer">✅ Setujui</button>
            <button onclick="rejectRequest('${r.id}')" style="flex:1;padding:9px;background:linear-gradient(135deg,#f87171,#dc2626);color:#fff;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer">❌ Tolak</button>
          </div>
        </div>`;
      }
    }

    // ── Riwayat ──
    const hasRecent = recentChange.length || recentAccess.length;
    if(hasRecent){
      html += `<div style="padding:14px 16px 6px;font-weight:800;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">📋 Riwayat Terakhir</div>`;
      // Merge & sort by processedAt
      const allRecent = [
        ...recentChange.map(r=>({...r,_kind:'change'})),
        ...recentAccess.map(r=>({...r,_kind:'access'}))
      ].sort((a,b)=>(b.processedAt||0)-(a.processedAt||0)).slice(0,8);

      for(const r of allRecent){
        const icon = r.status==='approved'?'✅':'❌';
        const color = r.status==='approved'?'#22c55e':'#ef4444';
        if(r._kind==='change'){
          const typeLabel = r.type==='username'?'username':r.type==='password'?'password':'username & password';
          html += `<div style="margin:6px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px">
            <span style="font-size:20px">${icon}</span>
            <div style="flex:1">
              <div style="font-weight:700;font-size:13px">${r.userName} — Ganti ${typeLabel}</div>
              <div style="font-size:11px;color:${color};font-weight:600">${r.status==='approved'?'Disetujui':'Ditolak'}${r.rejectReason?' — '+r.rejectReason:''}</div>
            </div>
          </div>`;
        } else {
          html += `<div style="margin:6px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px">
            <span style="font-size:20px">${icon}</span>
            <div style="flex:1">
              <div style="font-weight:700;font-size:13px">${r.userName} — ${r.monthLabel}</div>
              <div style="font-size:11px;color:${color};font-weight:600">${r.status==='approved'?'Akses disetujui':'Ditolak'}</div>
            </div>
          </div>`;
        }
      }
    }

    el.innerHTML = html;
    updateAdminNotifBadge(totalPending);
  }catch(e){
    el.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444">Gagal memuat notifikasi</div>`;
  }
}

function showApproveOptions(reqId, monthLabel){
  let modal = document.getElementById('modal-approve-options');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'modal-approve-options';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:flex-end;justify-content:center';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="fade-in" style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:24px 20px 32px">
      <div style="font-weight:800;font-size:16px;margin-bottom:6px;text-align:center">✅ Setujui Akses</div>
      <div style="font-size:13px;color:#64748b;text-align:center;margin-bottom:20px">Pilih opsi pengisian untuk <strong>${monthLabel}</strong><br><span style="color:#f59e0b;font-size:12px">⏱️ Akses aktif selama 10 menit</span></div>
      <button onclick="approveRequest('${reqId}','all')" style="width:100%;padding:13px;background:linear-gradient(135deg,#5a9b86,#3d7a68);color:#fff;border:none;border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;margin-bottom:10px;display:block">📅 Semua tanggal (termasuk yang sudah diisi)</button>
      <button onclick="approveRequest('${reqId}','empty')" style="width:100%;padding:13px;background:linear-gradient(135deg,#4d8fa0,#2d7a8f);color:#fff;border:none;border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;margin-bottom:10px;display:block">⬜ Hanya yang kosong saja</button>
      <button onclick="document.getElementById('modal-approve-options').style.display='none'" style="width:100%;padding:11px;background:none;border:2px solid #e2e8f0;border-radius:14px;font-weight:700;font-size:14px;color:#64748b;cursor:pointer">Batal</button>
    </div>`;
}

async function approveRequest(reqId, grantOption){
  document.getElementById('modal-approve-options').style.display = 'none';
  showLoading('Menyetujui...');
  try{
    await processAccessRequest(reqId,'approve',grantOption);
    hideLoading();
    showToast('✅ Akses disetujui — pengguna punya waktu 10 menit');
    renderAdminNotifPage();
  }catch(e){
    hideLoading();
    showToast('❌ Gagal menyetujui',false);
  }
}

async function rejectRequest(reqId){
  showLoading('Menolak...');
  try{
    await processAccessRequest(reqId,'reject',null);
    hideLoading();
    showToast('Request ditolak');
    renderAdminNotifPage();
  }catch(e){
    hideLoading();
    showToast('❌ Gagal',false);
  }
}

function updateAdminNotifBadge(count){
  // navbar badges (masih ada di DOM walau tersembunyi)
  ['','2','3','-n'].forEach(s=>{
    const el=document.getElementById('anav-notif-badge'+s);
    if(el){ el.style.display=count>0?'block':'none'; el.textContent=count>0?count:''; }
  });
  // header badges (bell icon di samping tombol Keluar)
  ['hadm-notif-u','hadm-notif-r','hadm-notif-k','hadm-notif-p'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){ el.style.display=count>0?'block':'none'; el.textContent=count>0?count:''; }
  });
}

window.showApproveOptions = showApproveOptions;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;

// Cek notif akses untuk pengguna
async function cekNotifAkses(uid){
  try{
    const snap = await getDoc(doc(fs,'notifications',uid));
    if(!snap.exists()) return;
    const d = snap.data();
    if(!d.dibaca && (d.type==='accessGranted'||d.type==='accessRejected')){
      // Update badge dulu sebelum auto-dismiss
      updateUserNotifBadge(uid);
      const color = d.type==='accessGranted'?'#22c55e':'#ef4444';
      const icon = d.type==='accessGranted'?'✅':'❌';
      const banner = document.createElement('div');
      banner.style.cssText = `position:fixed;top:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:${d.type==='accessGranted'?'#f0fdf4':'#fef2f2'};border-bottom:2px solid ${color};padding:12px 16px;z-index:9998;display:flex;align-items:center;gap:10px`;
      banner.innerHTML = `<span style="font-size:20px">${icon}</span><span style="flex:1;font-size:13px;font-weight:700;color:#1e293b">${d.pesan}</span><button onclick="this.parentElement.remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:#64748b">×</button>`;
      document.body.prepend(banner);
      setTimeout(()=>banner.remove(),6000);
      await setDoc(doc(fs,'notifications',uid),{...d,dibaca:true});
      // Reload access grants jika approved
      if(d.type==='accessGranted'){
        await loadAccessGrants(uid);
        if(d.expiresAt) showAccessGrantedBanner(d.bulan, d.expiresAt,'');
        renderCurView();
      }
    }
  }catch(e){}
}

// Cek pending request count untuk admin badge
async function checkAdminNotifBadge(){
  if(!currentUser || !currentUser.roles || !currentUser.roles.includes('Admin')) return;
  try{
    const snap = await getDocs(collection(fs,'accessRequests'));
    const count = snap.docs.filter(d=>d.data().status==='pending').length;
    updateAdminNotifBadge(count);
  }catch(e){}
}

// ══════════════════════════════════════════════════════════════

// Pesan saat guru menyentuh hari yang seluruh sesinya dikunci keterangan admin.
function showKetLockToast(dateKey, uid){
  const k = getKetHarian(dateKey, uid);
  const t = k ? getKetType(k.type) : null;
  showToast(`🔒 Hari ini dikunci admin — ${t?t.icon+' '+t.label:'ada keterangan'}${k&&k.catatan?' ('+k.catatan+')':''}`, false);
}

window.__tog=async(uid,y,m,d,sk)=>{
  // === BLOKIR HARI LIBUR ===
  try{ await loadHolidayDates(); }catch(e){}
  const dateKey=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  if(isHolidayKey(dateKey)){ showHolidayNotif(); return; }

  // === BLOKIR AKSES BULAN ===
  if(isBulanMendatang(y,m)){
    showToast('📅 Bulan belum aktif — tidak dapat diisi',false);
    return;
  }
  if(isBulanLewat(y,m) && !canEditMonth(uid,y,m)){
    showRequestAccessModal(y,m);
    return;
  }

  // === BLOKIR JADWAL (hanya untuk pengguna biasa, bukan admin) ===
  if(currentUser && !currentUser.isAdmin){
    const dowJs = new Date(y,m,d).getDay();
    if(!userHasAnySchedule(uid)){
      showToast('📋 Jadwal Anda belum diatur oleh admin — tidak dapat mengisi',false);
      return;
    }
    if(!isSessionScheduled(uid, dowJs, sk)){
      showToast(`🚫 Sesi ${sk} tidak termasuk jadwal Anda hari ini`,false);
      return;
    }
    // === BLOKIR KETERANGAN ADMIN (kunci per sesi) ===
    const ketLock = getKetForSession(dateKey, uid, sk);
    if(ketLock){
      const t = getKetType(ketLock.type);
      showToast(`🔒 Sesi ${sk} dikunci admin — ${t?t.label:ketLock.type}`,false);
      return;
    }
  }

  const k=dk(y,m,d);
  if(!localDb[uid])localDb[uid]={};
  const cur=localDb[uid][k]||emptyDay();
  const updated={...cur,[sk]:!cur[sk]};
  localDb[uid][k]=updated;
  renderCurView();
  try{await saveAtt(uid,k,updated);showToast('✅ Tersimpan');}
  catch(e){showToast('❌ Gagal simpan',false);}
};
window.__tglDay=async(d)=>{
  try{ await loadHolidayDates(); }catch(e){}
  if(isHolidayDate(cYear,cMonth,d)){showHolidayNotif();return;}
  if(isBulanMendatang(cYear,cMonth)){showToast('📅 Bulan belum aktif',false);return;}
  // Cek join date — karyawan baru tidak bisa isi sebelum tanggal bergabung
  const uid = currentUser?.isAdmin && viewingUser ? viewingUser.id : currentUser?.id;
  if(uid && isBeforeJoinDate(uid,cYear,cMonth,d)){
    showToast('🔒 Tanggal ini sebelum bergabung — tidak dapat diisi',false);return;
  }
  if(isBulanLewat(cYear,cMonth) && !canEditMonth(currentUser.id,cYear,cMonth)){
    showRequestAccessModal(cYear,cMonth);return;
  }
  // Cek jadwal (hanya pengguna biasa)
  if(currentUser && !currentUser.isAdmin){
    const dowJs = new Date(cYear,cMonth,d).getDay();
    if(!userHasAnySchedule(currentUser.id)){
      showToast('📋 Jadwal Anda belum diatur oleh admin — tidak dapat mengisi',false);return;
    }
    if(!getUserDaySchedule(currentUser.id, dowJs)){
      showToast('🚫 Hari ini tidak termasuk jadwal Anda',false);return;
    }
    if(isKetFullDay(dk(cYear,cMonth,d), currentUser.id)){ showKetLockToast(dk(cYear,cMonth,d), currentUser.id); return; }
  }
  editDay=editDay===d?null:d;renderMonthlyFor(currentUser.id,'view-monthly',true);
};
window.__tglDayW=async(d)=>{
  try{ await loadHolidayDates(); }catch(e){}
  if(isHolidayDate(cYear,cMonth,d)){showHolidayNotif();return;}
  if(isBulanMendatang(cYear,cMonth)){showToast('📅 Bulan belum aktif',false);return;}
  // Cek join date — karyawan baru tidak bisa isi sebelum tanggal bergabung
  const uid = currentUser?.isAdmin && viewingUser ? viewingUser.id : currentUser?.id;
  if(uid && isBeforeJoinDate(uid,cYear,cMonth,d)){
    showToast('🔒 Tanggal ini sebelum bergabung — tidak dapat diisi',false);return;
  }
  if(isBulanLewat(cYear,cMonth) && !canEditMonth(currentUser.id,cYear,cMonth)){
    showRequestAccessModal(cYear,cMonth);return;
  }
  // Cek jadwal (hanya pengguna biasa)
  if(currentUser && !currentUser.isAdmin){
    const dowJs = new Date(cYear,cMonth,d).getDay();
    if(!userHasAnySchedule(currentUser.id)){
      showToast('📋 Jadwal Anda belum diatur oleh admin',false);return;
    }
    if(!getUserDaySchedule(currentUser.id, dowJs)){
      showToast('🚫 Hari ini tidak termasuk jadwal Anda',false);return;
    }
    if(isKetFullDay(dk(cYear,cMonth,d), currentUser.id)){ showKetLockToast(dk(cYear,cMonth,d), currentUser.id); return; }
  }
  editDayW=editDayW===d?null:d;renderWeeklyFor(currentUser.id,'view-weekly',true);
};
window.__setWeek=(w)=>{selWeek=w;editDayW=null;renderCurView();renderCurView2();};

// ══════════════════════════════════════════════════════
// FITUR GURU PENGGANTI
// ══════════════════════════════════════════════════════

// Buka modal pilih guru yang digantikan
window.__openSubstituteModal = async(dateKey, day, dow) => {
  // Cari guru-guru yang punya jadwal hari ini TAPI belum mengisi (absen)
  // Exclude diri sendiri
  showLoading('Memuat daftar guru...');
  try{
    // Pastikan semua attendance user sudah ter-load
    await Promise.all(users.filter(u=>!u.isAdmin).map(u=>loadAtt(u.id)));
    const [yStr,mStr,dStr] = dateKey.split('-');
    const y=parseInt(yStr), m=parseInt(mStr)-1, d=parseInt(dStr);
    // Guru yang punya jadwal hari ini, bukan diri sendiri, belum ada penggantinya, dan masih ada sesi terjadwal yang belum diisi
    const absentGurus = users.filter(u=>{
      if(u.id === currentUser.id) return false; // skip diri sendiri
      if(u.roles && u.roles.includes('Admin') && !(u.roles.includes('Pengajar'))) return false; // skip pure admin
      const uSched = getUserDaySchedule(u.id, dow);
      if(!uSched) return false; // tidak ada jadwal hari ini
      const scheduledSessions = SESSIONS.filter(s=>uSched[s.key]);
      if(!scheduledSessions.length) return false;
      // Cek sesi mana yang sudah diisi oleh pengganti
      const existingSub = getSubstitution(dateKey, u.id);
      const subSessions = existingSub ? existingSub.sessions : [];
      // Sesi yang masih tersedia = terjadwal - sudah diisi pengganti - sudah diisi sendiri
      const dd = gdd(u.id, y, m, d);
      const availableSessions = scheduledSessions.filter(s=>
        !subSessions.includes(s.key) && !dd[s.key]
      );
      return availableSessions.length > 0; // masih ada sesi yang bisa digantikan
    });
    hideLoading();
    // Render modal
    let modal = document.getElementById('modal-substitute');
    if(!modal){
      modal = document.createElement('div');
      modal.id = 'modal-substitute';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:flex-end;justify-content:center';
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    if(!absentGurus.length){
      modal.innerHTML = `
        <div class="fade-in" style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:24px 20px 32px">
          <div style="font-weight:800;font-size:16px;margin-bottom:6px;text-align:center">👤 Isi Sebagai Pengganti</div>
          <div style="font-size:13px;color:#64748b;text-align:center;margin-bottom:20px">${DF[dow]}, ${day} ${MONTHS[m]} ${y}</div>
          <div style="text-align:center;padding:24px;color:#94a3b8">
            <div style="font-size:36px;margin-bottom:8px">✅</div>
            <div style="font-size:14px;font-weight:700">Tidak ada guru yang absen hari ini</div>
            <div style="font-size:12px;margin-top:4px">Semua guru terjadwal sudah mengisi atau sudah ada penggantinya</div>
          </div>
          <button onclick="document.getElementById('modal-substitute').style.display='none'" style="width:100%;padding:12px;background:none;border:2px solid #e2e8f0;border-radius:14px;font-weight:700;font-size:14px;color:#64748b;cursor:pointer;margin-top:8px">Tutup</button>
        </div>`;
      return;
    }
    const guruItems = absentGurus.map(u=>{
      const uSched = getUserDaySchedule(u.id, dow);
      const existingSub = getSubstitution(dateKey, u.id);
      const alreadySubSessions = existingSub ? existingSub.sessions : [];
      const ddU = gdd(u.id, y, m, d);
      // Hanya tampilkan sesi yang masih kosong dan belum ada penggantinya
      const availSessions = SESSIONS.filter(s=>
        uSched && uSched[s.key] && !ddU[s.key] && !alreadySubSessions.includes(s.key)
      );
      const sessLabels = availSessions.map(s=>
        `<span style="font-size:10px;background:${s.color}18;border:1px solid ${s.color}44;color:${s.color};border-radius:6px;padding:1px 6px;font-weight:700">${s.key}</span>`
      ).join(' ');
      return`<div onclick="window.__selectSubstituteTarget('${dateKey}',${day},${dow},'${u.id}')"
        style="padding:14px;border:1.5px solid #e2e8f0;border-radius:14px;margin-bottom:8px;cursor:pointer;background:#f8fafc;display:flex;align-items:center;gap:12px;transition:border-color .15s"
        onmouseover="this.style.borderColor='#7dd3fc';this.style.background='#f0f9ff'"
        onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc'">
        <div style="width:38px;height:38px;background:linear-gradient(135deg,#dbeafe,#bfdbfe);border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:#1d4ed8">${u.name[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:14px;color:#1e293b">${u.name}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${sessLabels}</div>
        </div>
        <div style="color:#94a3b8;font-size:18px">›</div>
      </div>`;
    }).join('');
    modal.innerHTML = `
      <div class="fade-in" style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:24px 20px 32px;max-height:80vh;overflow-y:auto">
        <div style="font-weight:800;font-size:16px;margin-bottom:4px;text-align:center">👤 Isi Sebagai Pengganti</div>
        <div style="font-size:13px;color:#64748b;text-align:center;margin-bottom:16px">${DF[dow]}, ${day} ${MONTHS[m]} ${y} — Pilih guru yang Anda gantikan</div>
        ${guruItems}
        <button onclick="document.getElementById('modal-substitute').style.display='none'" style="width:100%;padding:12px;background:none;border:2px solid #e2e8f0;border-radius:14px;font-weight:700;font-size:14px;color:#64748b;cursor:pointer;margin-top:4px">Batal</button>
      </div>`;
  }catch(e){
    hideLoading();
    showToast('❌ Gagal memuat: '+e.message, false);
  }
};

// Setelah pilih guru target, tampilkan konfirmasi sesi yang akan diisi
window.__selectSubstituteTarget = async(dateKey, day, dow, targetUid) => {
  const target = users.find(u=>u.id===targetUid);
  if(!target) return;
  const [yStr,mStr,dStr] = dateKey.split('-');
  const y=parseInt(yStr), m=parseInt(mStr)-1, d=parseInt(dStr);
  const uSched = getUserDaySchedule(targetUid, dow);
  // Hanya sesi yang terjadwal, belum diisi sendiri, dan belum ada penggantinya
  const existingSub = getSubstitution(dateKey, targetUid);
  const alreadySubSessions = existingSub ? existingSub.sessions : [];
  const ddTarget = gdd(targetUid, y, m, d);
  const sessions = SESSIONS.filter(s=>
    uSched && uSched[s.key] &&           // terjadwal untuk guru ini
    !ddTarget[s.key] &&                  // belum diisi sendiri
    !alreadySubSessions.includes(s.key)  // belum ada pengganti lain
  ).map(s=>s.key);
  const modal = document.getElementById('modal-substitute');
  const sessButtons = sessions.map(sk=>{
    const s=SESSIONS.find(x=>x.key===sk);
    return`<button id="sub-sess-${sk}" onclick="window.__toggleSubSess('${sk}')"
      style="padding:10px 14px;border:2px solid ${s.color}44;border-radius:10px;background:${s.color}11;color:${s.color};font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all .15s"
      data-selected="true">
      <span id="sub-sess-icon-${sk}">✅</span> ${s.icon}${s.label} <span style="font-size:11px;color:#94a3b8">${s.desc}</span>
    </button>`;
  }).join('');
  modal.innerHTML = `
    <div class="fade-in" style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:24px 20px 32px;max-height:80vh;overflow-y:auto">
      <div style="font-weight:800;font-size:16px;margin-bottom:4px;text-align:center">✅ Konfirmasi Penggantian</div>
      <div style="font-size:13px;color:#64748b;text-align:center;margin-bottom:16px">Anda akan menggantikan <strong>${target.name}</strong><br>${DF[dow]}, ${day} ${MONTHS[m]} ${y}</div>
      <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Sesi yang akan Anda isi:</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">${sessButtons}</div>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:16px;text-align:center">Hapus centang untuk tidak mengisi sesi tertentu</div>
      <button onclick="window.__confirmSubstitute('${dateKey}','${targetUid}','${target.name}')" style="width:100%;padding:13px;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;border:none;border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;margin-bottom:10px">✅ Konfirmasi — Isi Sebagai Pengganti</button>
      <button onclick="window.__openSubstituteModal('${dateKey}',${day},${dow})" style="width:100%;padding:11px;background:none;border:2px solid #e2e8f0;border-radius:14px;font-weight:700;font-size:14px;color:#64748b;cursor:pointer">← Kembali</button>
    </div>`;
};

window.__toggleSubSess = (sk) => {
  const btn = document.getElementById('sub-sess-'+sk);
  const icon = document.getElementById('sub-sess-icon-'+sk);
  const selected = btn.dataset.selected === 'true';
  btn.dataset.selected = (!selected).toString();
  if(!selected){
    btn.style.opacity='1'; icon.textContent='✅';
  } else {
    btn.style.opacity='0.4'; icon.textContent='⬜';
  }
};

window.__confirmSubstitute = async(dateKey, targetUid, targetName) => {
  // Kumpulkan sesi yang dipilih
  const selectedSessions = SESSIONS.map(s=>s.key).filter(sk=>{
    const btn = document.getElementById('sub-sess-'+sk);
    return btn && btn.dataset.selected === 'true';
  });
  if(!selectedSessions.length){
    showToast('❌ Pilih minimal satu sesi', false);
    return;
  }
  document.getElementById('modal-substitute').style.display='none';
  showLoading('Menyimpan...');
  try{
    // Simpan substitusi ke Firestore
    const subData = {
      substituteUid: currentUser.id,
      substituteName: currentUser.name,
      targetUid, targetName,
      sessions: selectedSessions,
      dateKey, timestamp: Date.now()
    };
    await saveSubstitution(dateKey, targetUid, subData);
    // Update attendance pengganti
    if(!localDb[currentUser.id]) localDb[currentUser.id] = {};
    const existing = localDb[currentUser.id][dateKey] || emptyDay();
    const updated = {...existing};
    // Sesi yang ada di jadwal sendiri → hitung 2x (double-duty: jadwal sendiri + pengganti)
    const [yStr,mStr,dStr] = dateKey.split('-');
    const dow = new Date(parseInt(yStr), parseInt(mStr)-1, parseInt(dStr)).getDay();
    const ownScheduled = selectedSessions.filter(sk => isSessionScheduled(currentUser.id, dow, sk));
    selectedSessions.forEach(sk=>{ updated[sk]=true; });
    if(ownScheduled.length > 0){
      const extra = Array.isArray(updated._substituteExtra) ? [...updated._substituteExtra] : [];
      ownScheduled.forEach(sk=>{ if(!extra.includes(sk)) extra.push(sk); });
      updated._substituteExtra = extra;
    }
    localDb[currentUser.id][dateKey] = updated;
    await saveAtt(currentUser.id, dateKey, updated);
    hideLoading();
    showToast(`✅ Berhasil mengisi sebagai pengganti ${targetName}`);
    renderCurView();
  }catch(e){
    hideLoading();
    showToast('❌ Gagal: '+e.message, false);
  }
};

window.__cancelSubstitute = async(dateKey, targetUid) => {
  if(!confirm('Batalkan pengisian pengganti ini?')) return;
  showLoading('Membatalkan...');
  try{
    const sub = getSubstitution(dateKey, targetUid);
    if(sub){
      const subUid = sub.substituteUid;
      if(localDb[subUid] && localDb[subUid][dateKey]){
        const updated = {...localDb[subUid][dateKey]};
        const extra = Array.isArray(updated._substituteExtra) ? [...updated._substituteExtra] : [];
        sub.sessions.forEach(sk=>{
          if(extra.includes(sk)){
            // Sesi milik sendiri + penggantian → tetap true, hapus dari extra saja
          } else {
            // Hanya dari penggantian → hapus
            updated[sk]=false;
          }
        });
        // Hapus sesi yang dibatalkan dari _substituteExtra
        updated._substituteExtra = extra.filter(sk=>!sub.sessions.includes(sk));
        if(!updated._substituteExtra.length) delete updated._substituteExtra;
        localDb[subUid][dateKey] = updated;
        await saveAtt(subUid, dateKey, updated);
      }
    }
    await deleteSubstitution(dateKey, targetUid);
    hideLoading();
    showToast('Penggantian dibatalkan');
    renderCurView();
  }catch(e){
    hideLoading();
    showToast('❌ Gagal: '+e.message, false);
  }
};

// ══════════════════════════════════════════════════════════
// FITUR: REQUEST GANTI USERNAME / PASSWORD
// ══════════════════════════════════════════════════════════

// Render status request di halaman profil pengguna
async function renderChangeReqStatus(){
  const el = document.getElementById('up-change-req-status');
  if(!el || !currentUser) return;
  const req = await getChangeRequest(currentUser.id);
  if(!req || req.status==='cancelled'){
    el.innerHTML = ''; return;
  }
  if(req.status==='approved'){
    const typeLabel = req.type==='username'?'Username':req.type==='password'?'Password':'Username & Password';
    el.innerHTML = `<div style="background:#dcfce7;border:1.5px solid #86efac;border-radius:12px;padding:12px 14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:800;color:#166534;margin-bottom:6px">✅ Request disetujui Admin</div>
      <div style="font-size:11px;color:#15803d;margin-bottom:10px">Silakan isi perubahan <strong>${typeLabel}</strong> Anda sekarang.</div>
      <button onclick="window.__openEditProfileModal()" style="width:100%;padding:10px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer">✏️ Edit Profil Sekarang</button>
    </div>`;
    return;
  }
  if(req.status==='rejected'){
    el.innerHTML = `<div style="background:#fee2e2;border:1.5px solid #fca5a5;border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#991b1b;font-weight:700;display:flex;align-items:center;gap:8px"><span>❌</span><span>Request ditolak Admin${req.rejectReason?' — '+req.rejectReason:''}</span></div>`;
    return;
  }
  if(req.status==='pending'){
    const typeLabel = req.type==='username'?'Username':req.type==='password'?'Password':'Username & Password';
    const ago = Math.round((Date.now()-req.requestedAt)/60000);
    el.innerHTML = `<div style="background:#fef3c7;border:1.5px solid #fcd34d;border-radius:12px;padding:12px 14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:800;color:#92400e;margin-bottom:4px">⏳ Menunggu persetujuan admin</div>
      <div style="font-size:11px;color:#78350f">Request ganti <strong>${typeLabel}</strong> · ${ago < 2 ? 'Baru saja' : ago+'m lalu'}</div>
      <button onclick="window.__cancelChangeReq()" style="margin-top:8px;padding:6px 12px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">✕ Batalkan Request</button>
    </div>`;
  }
}

// Buka modal kirim request
window.__openChangeReqModal = async() => {
  // Cek apakah sudah ada request pending
  const existing = await getChangeRequest(currentUser.id);
  if(existing && existing.status === 'pending'){
    showToast('⚠️ Masih ada request yang belum diproses admin');
    return;
  }

  let modal = document.getElementById('modal-change-req');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'modal-change-req';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:flex-end;justify-content:center';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="fade-in" style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:24px 20px 32px;max-height:85vh;overflow-y:auto">
      <div style="font-weight:800;font-size:16px;margin-bottom:4px;text-align:center">✏️ Request Ganti Akun</div>
      <div style="font-size:12px;color:#64748b;text-align:center;margin-bottom:18px">Request akan dikirim ke Admin untuk disetujui</div>
      
      <!-- Pilihan jenis perubahan -->
      <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Apa yang ingin diubah?</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:18px">
        <button id="crq-type-username" onclick="window.__setCrqType('username')" 
          style="padding:10px 6px;border-radius:12px;border:2px solid #e2e8f0;background:#f8fafc;font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">
          👤 Username
        </button>
        <button id="crq-type-password" onclick="window.__setCrqType('password')"
          style="padding:10px 6px;border-radius:12px;border:2px solid #e2e8f0;background:#f8fafc;font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">
          🔑 Password
        </button>
        <button id="crq-type-both" onclick="window.__setCrqType('both')"
          style="padding:10px 6px;border-radius:12px;border:2px solid #e2e8f0;background:#f8fafc;font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">
          🔄 Keduanya
        </button>
      </div>

      <!-- Catatan -->
      <div style="margin-bottom:18px">
        <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">Catatan / Alasan <span style="color:#94a3b8;font-weight:400">(opsional)</span></label>
        <textarea id="crq-note" rows="2" placeholder="Misal: lupa password lama, ganti username karena salah ketik..."
          style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:12px;font-size:13px;box-sizing:border-box;outline:none;resize:none;font-family:inherit"></textarea>
      </div>

      <button onclick="window.__submitChangeReq()" style="width:100%;padding:13px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;margin-bottom:10px">📨 Kirim Request</button>
      <button onclick="document.getElementById('modal-change-req').style.display='none'" style="width:100%;padding:11px;background:none;border:2px solid #e2e8f0;border-radius:14px;font-weight:700;font-size:14px;color:#64748b;cursor:pointer">Batal</button>
    </div>`;
  // Set default type
  window.__setCrqType('username');
};

window.__setCrqType = (type) => {
  window.crqType = type;
  const active = 'padding:10px 6px;border-radius:12px;border:2px solid #f59e0b;background:#fef3c7;font-weight:800;font-size:12px;cursor:pointer;color:#92400e';
  const inactive = 'padding:10px 6px;border-radius:12px;border:2px solid #e2e8f0;background:#f8fafc;font-weight:700;font-size:12px;cursor:pointer;color:#475569';
  ['username','password','both'].forEach(t=>{
    const btn = document.getElementById('crq-type-'+t);
    if(btn) btn.style.cssText = (t===type) ? active : inactive;
  });
};

window.__submitChangeReq = async() => {
  const type = window.crqType || 'username';
  const note = document.getElementById('crq-note')?.value.trim();

  document.getElementById('modal-change-req').style.display = 'none';
  showLoading('Mengirim request...');
  try{
    const reqData = {
      uid: currentUser.id,
      userName: currentUser.name,
      userUsername: currentUser.username,
      type,
      status: 'pending',
      requestedAt: Date.now(),
      note: note || ''
    };
    await saveChangeRequest(currentUser.id, reqData);

    // Kirim notif ke semua admin
    const admins = users.filter(u=>u.roles&&u.roles.includes('Admin'));
    for(const adm of admins){
      await setDoc(doc(fs,'adminNotifs',adm.id),{
        hasNew: true, hasNewChange: true,
        lastChangeUid: currentUser.id,
        lastChangeName: currentUser.name,
        lastChangeType: type,
        updatedAt: Date.now()
      },{merge:true});
    }
    hideLoading();
    showToast('📨 Request terkirim! Menunggu persetujuan admin');
    renderChangeReqStatus();
  }catch(e){
    hideLoading();
    showToast('❌ Gagal: '+e.message, false);
  }
};

window.__cancelChangeReq = async() => {
  if(!confirm('Batalkan request ini?')) return;
  showLoading('Membatalkan...');
  try{
    await saveChangeRequest(currentUser.id, {
      uid: currentUser.id,
      status: 'cancelled',
      cancelledAt: Date.now()
    });
    hideLoading();
    showToast('Request dibatalkan');
    renderChangeReqStatus();
  }catch(e){
    hideLoading();
    showToast('❌ Gagal', false);
  }
};

// Modal edit profil pengguna — hanya aktif setelah request disetujui admin
window.__openEditProfileModal = async() => {
  const req = await getChangeRequest(currentUser.id);
  if(!req || req.status !== 'approved'){
    showToast('⚠️ Tidak ada izin edit profil', false); return;
  }
  const type = req.type;

  let modal = document.getElementById('modal-edit-profile');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'modal-edit-profile';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:flex-end;justify-content:center';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="fade-in" style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:24px 20px 32px">
      <div style="font-weight:800;font-size:16px;margin-bottom:4px;text-align:center">✏️ Edit Profil</div>
      <div style="font-size:12px;color:#64748b;text-align:center;margin-bottom:20px">Perubahan yang diizinkan admin</div>

      ${(type==='username'||type==='both')?`
      <div style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">Username Baru</label>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:6px">Saat ini: <strong>${currentUser.username}</strong></div>
        <input id="ep-username" type="text" value="" placeholder="Username baru..." autocomplete="off"
          style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:12px;font-size:14px;box-sizing:border-box;outline:none;font-family:inherit"/>
      </div>`:''}

      ${(type==='password'||type==='both')?`
      <div style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">Password Baru</label>
        <input id="ep-password" type="password" placeholder="Password baru..." autocomplete="new-password"
          style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:12px;font-size:14px;box-sizing:border-box;outline:none;font-family:inherit;margin-bottom:8px"/>
        <input id="ep-conf" type="password" placeholder="Konfirmasi password baru..." autocomplete="new-password"
          style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:12px;font-size:14px;box-sizing:border-box;outline:none;font-family:inherit"/>
      </div>`:''}

      <button onclick="window.__saveEditProfile()" style="width:100%;padding:13px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;margin-bottom:10px">💾 Simpan Perubahan</button>
      <button onclick="document.getElementById('modal-edit-profile').style.display='none'" style="width:100%;padding:11px;background:none;border:2px solid #e2e8f0;border-radius:14px;font-weight:700;font-size:14px;color:#64748b;cursor:pointer">Batal</button>
    </div>`;
};

window.__saveEditProfile = async() => {
  const req = await getChangeRequest(currentUser.id);
  if(!req || req.status !== 'approved'){ showToast('⚠️ Tidak ada izin', false); return; }
  const type = req.type;

  const newUsername = document.getElementById('ep-username')?.value.trim();
  const newPassword = document.getElementById('ep-password')?.value;
  const confPassword = document.getElementById('ep-conf')?.value;

  // Validasi
  if(type==='username'||type==='both'){
    if(!newUsername){ showToast('⚠️ Isi username baru', false); return; }
    if(newUsername === currentUser.username){ showToast('⚠️ Sama dengan username sekarang', false); return; }
    const taken = users.find(u=>u.id!==currentUser.id && u.username===newUsername);
    if(taken){ showToast('⚠️ Username sudah dipakai', false); return; }
  }
  if(type==='password'||type==='both'){
    if(!newPassword){ showToast('⚠️ Isi password baru', false); return; }
    if(newPassword.length < 4){ showToast('⚠️ Minimal 4 karakter', false); return; }
    if(newPassword !== confPassword){ showToast('⚠️ Konfirmasi tidak cocok', false); return; }
  }

  document.getElementById('modal-edit-profile').style.display = 'none';
  showLoading('Menyimpan...');
  try{
    // Terapkan perubahan ke user
    const user = users.find(u=>u.id===currentUser.id);
    if(type==='username'||type==='both') user.username = newUsername;
    if(type==='password'||type==='both'){
      user.pwHash = await hashPw(newPassword);
      user.pwPlain = encodePw(newPassword);
    }
    await saveUserDoc(user);
    // Update currentUser
    currentUser.username = user.username;
    currentUser.pwHash = user.pwHash;
    currentUser.pwPlain = user.pwPlain;

    // Tandai request sebagai selesai (done)
    await saveChangeRequest(currentUser.id, {...req, status:'done', doneAt: Date.now()});

    hideLoading();
    showToast('✅ Profil berhasil diperbarui');
    // Refresh tampilan profil
    document.getElementById('up-username').textContent = currentUser.username;
    renderChangeReqStatus();
  }catch(e){
    hideLoading();
    showToast('❌ Gagal: '+e.message, false);
  }
};

// ── Admin: approve change request ──
window.__approveChangeReq = async(uid) => {
  const req = await getChangeRequest(uid);
  if(!req){ showToast('Request tidak ditemukan', false); return; }
  showLoading('Menyetujui...');
  try{
    // Hanya update status — pengguna yang akan mengisi sendiri perubahannya
    await saveChangeRequest(uid, {...req, status:'approved', processedAt: Date.now()});

    // Kirim notif ke pengguna
    const typeLabel = req.type==='username'?'username':req.type==='password'?'password':'username & password';
    await setDoc(doc(fs,'notifications',uid),{
      pesan: `✅ Request ganti ${typeLabel} Anda disetujui Admin. Buka tab Profil untuk mengisi perubahan.`,
      timestamp: Date.now(), dibaca: false,
      type: 'changeApproved'
    },{merge:false});

    hideLoading();
    showToast('✅ Request disetujui');
    renderAdminNotifPage();
  }catch(e){
    hideLoading();
    showToast('❌ Gagal: '+e.message, false);
  }
};

window.__rejectChangeReq = async(uid) => {
  const reason = prompt('Alasan penolakan (opsional):') ?? null;
  if(reason === null) return; // user tekan Cancel
  showLoading('Menolak...');
  try{
    const req = await getChangeRequest(uid);
    await saveChangeRequest(uid, {...(req||{}), status:'rejected', processedAt: Date.now(), rejectReason: reason||''});

    // Notif ke pengguna
    const u = users.find(x=>x.id===uid);
    await setDoc(doc(fs,'notifications',uid),{
      pesan: `❌ Request ganti akun Anda ditolak Admin.${reason?' Alasan: '+reason:''}`,
      timestamp: Date.now(), dibaca: false,
      type: 'changeRejected'
    },{merge:false});

    hideLoading();
    showToast('Request ditolak');
    renderAdminNotifPage();
  }catch(e){
    hideLoading();
    showToast('❌ Gagal', false);
  }
};

window.__printM=(uid)=>{
  const y=cYear,m=cMonth,tw=wim(y,m),monthly=mRec(uid,y,m),td=dim(y,m);
  const u=users.find(x=>x.id===uid)||currentUser;
  const uRolesStr=u?rolesText(u):'';  let html=`<html><head><title>Rekap ${MONTHS[m]} ${y}</title><style>body{font-family:Arial,sans-serif;padding:20px;color:#2d3748}h1{color:#5a9b86;font-size:20px}h2{color:#4d8fa0;font-size:15px;margin:16px 0 8px}table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px}th{background:#5a9b86;color:#fff;padding:8px;text-align:left}td{padding:6px 8px;border-bottom:1px solid #e2e8f0}tr:nth-child(even){background:#f7f9fc}.tot{background:#e8f4f0;font-weight:bold}.sc{font-size:32px;font-weight:900;color:#5a9b86;text-align:center;margin:16px 0}.sub{color:#8a97a8;font-size:12px;text-align:center}</style></head><body>
  <h1>🕌 Rekap Daftar Hadir Halaqah</h1><p style="color:#8a97a8;font-size:13px">${u?.name} · ${uRolesStr} · ${MONTHS[m]} ${y}</p>`;
  for(let w=1;w<=tw;w++){const wr=wRec(uid,y,m,w);html+=`<h2>Pekan ${w}</h2><table><tr><th>Sesi</th><th>Keterangan</th><th>Hadir</th><th>Jam (×2)</th></tr>${SESSIONS.map(s=>`<tr><td>${s.label}</td><td>${s.desc}</td><td>${wr.totals[s.key]}</td><td>${wr.totals[s.key]*2}</td></tr>`).join('')}<tr class="tot"><td colspan="2">Total Pekan ${w}</td><td colspan="2">${wr.totalScore} jam</td></tr></table>`;}
  html+=`<h2 style="color:#5a9b86">📅 Total Bulanan</h2><table><tr><th>Sesi</th><th>Keterangan</th><th>Hadir</th><th>Jam (×2)</th></tr>${SESSIONS.map(s=>`<tr><td>${s.label}</td><td>${s.desc}</td><td>${monthly.totals[s.key]}</td><td>${monthly.totals[s.key]*2}</td></tr>`).join('')}<tr class="tot"><td colspan="2">GRAND TOTAL</td><td colspan="2">${monthly.totalScore} jam</td></tr></table><div class="sc">${monthly.totalScore}</div><div class="sub">Total Jam ${MONTHS[m]} ${y} — ${td} hari</div></body></html>`;
  // iOS Safari fix: window.open harus dipanggil synchronous dari click event
  const w=window.open("","_blank");
  if(!w){ showToast('Popup diblokir browser. Izinkan popup untuk halaman ini.', false); return; }
  w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),400);
};

window.__exportMExcel=(uid)=>{
  const y=cYear,m=cMonth,tw=wim(y,m),monthly=mRec(uid,y,m);
  const u=users.find(x=>x.id===uid)||currentUser;
  const nama=u?.name||'';
  const jabatan=u?rolesText(u):'';
  // Header info rows
  const rows=[
    ['Daftar Hadir Halaqah'],
    ['Nama',nama],
    ['Jabatan',jabatan],
    ['Bulan',`${MONTHS[m]} ${y}`],
    [],
  ];
  // Per week
  for(let w=1;w<=tw;w++){
    const wr=wRec(uid,y,m,w);
    rows.push([`PEKAN ${w}`,'Keterangan','Jumlah Hadir','Jam (×2)']);
    SESSIONS.forEach(s=>{rows.push([s.label,s.desc,wr.totals[s.key],wr.totals[s.key]*2]);});
    rows.push(['','Total Pekan '+w,'',wr.totalScore+' jam']);
    rows.push([]);
  }
  // Monthly total
  rows.push(['TOTAL BULANAN','Keterangan','Jumlah Hadir','Jam (×2)']);
  SESSIONS.forEach(s=>{rows.push([s.label,s.desc,monthly.totals[s.key],monthly.totals[s.key]*2]);});
  rows.push(['','GRAND TOTAL','',monthly.totalScore+' jam']);
  if(typeof XLSX!=='undefined'){
    const ws=XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=[{wch:8},{wch:34},{wch:14},{wch:12}];
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,`${nama.substring(0,20)}`);
    xlsxDownload(wb, `Rekap_${nama.replace(/[^a-zA-Z0-9]/g,'_')}_${MONTHS[m]}_${y}.xlsx`);
    if(!isIOS) showToast('✅ File Excel berhasil diunduh');
  } else {
    const csv=rows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download=`Rekap_${MONTHS[m]}_${y}.csv`;a.click();
    showToast('✅ File CSV berhasil diunduh');
  }
};

// ── INIT ──
// SESSION KEY & TTL (7 hari)
const DHG_SESSION_KEY = 'dhg_session_v2';
const SESSION_TTL_MS  = 7 * 24 * 60 * 60 * 1000;

// Simpan session ke localStorage setelah login berhasil
function saveSession(type, userId) {
  try {
    localStorage.setItem(DHG_SESSION_KEY, JSON.stringify({
      type, userId, savedAt: Date.now()
    }));
  } catch(e) { /* private browsing — graceful fail */ }
}

// Hapus session saat logout
function clearSession() {
  try { localStorage.removeItem(DHG_SESSION_KEY); } catch(e) {}
}

// Helper: restore session guru (user biasa)
async function restoreUserSession(found) {
  currentUser = {...found, isAdmin: false};
  showLoading('Memuat data absensi...');
  await loadAtt(currentUser.id);
  await loadHolidayDates();
  try { globalSchedule = await getHolidaySchedule(); } catch(e) { globalSchedule = {}; }
  try { await loadSubstitutionsForMonth(TODAY.getFullYear(), TODAY.getMonth()); } catch(e) {}
  try { await loadKetHarianMonth(TODAY.getFullYear(), TODAY.getMonth()); } catch(e) {}
  hideLoading();
  cYear = TODAY.getFullYear(); cMonth = TODAY.getMonth();
  cView = 'monthly'; editDay = null; editDayW = null; selWeek = 1;
  document.getElementById('u-name').textContent  = currentUser.name;
  document.getElementById('u-role').textContent  = rolesText(currentUser);
  document.getElementById('att-month').textContent = MONTHS[cMonth];
  document.getElementById('att-year').textContent  = cYear;
  showScreen('user-att');
  switchTab('monthly');
  cekNotifikasiPengingat(currentUser.id);
  updateUserNotifBadge(currentUser.id);
  await loadAccessGrants(currentUser.id);
  checkAndShowActiveBanners();
  await cekNotifAkses(currentUser.id);
  if (currentUser.roles && currentUser.roles.includes('Admin')) checkAdminNotifBadge();
}

(async () => {
  try {
    await loadUsers();

    // ── Coba restore session tersimpan ──────────────────────────────────
    let restored = false;
    try {
      const raw = localStorage.getItem(DHG_SESSION_KEY);
      if (raw) {
        const sess = JSON.parse(raw);
        const expired = !sess.savedAt || (Date.now() - sess.savedAt) > SESSION_TTL_MS;
        if (!expired) {
          if (sess.type === 'admin') {
            // Restore sesi Admin
            currentUser = {id:'admin', name:'Administrator', username:'admin', role:'Admin', isAdmin:true};
            hideLoading();
            showScreen('admin-users');
            renderAdminUsers();
            restored = true;
          } else if (sess.type === 'user' && sess.userId) {
            // Restore sesi Guru
            const found = users.find(u => u.id === sess.userId);
            if (found) {
              await restoreUserSession(found);
              restored = true;
            }
          }
        }
        if (!restored) clearSession(); // expired atau user tidak ditemukan
      }
    } catch(e) {
      clearSession(); // JSON rusak atau localStorage tidak tersedia
    }

    if (!restored) {
      hideLoading();
      showScreen('login');
    }

  } catch(e) {
    document.getElementById('loading').innerHTML=`
      <div style="text-align:center;padding:30px 20px">
        <div style="font-size:52px;margin-bottom:14px">❌</div>
        <div style="color:var(--rose2);font-weight:800;font-size:16px;margin-bottom:8px">Gagal terhubung ke cloud</div>
        <div style="color:var(--muted);font-size:13px;margin-bottom:4px">Pastikan Firestore sudah aktif</div>
        <div style="color:var(--muted);font-size:12px;margin-bottom:16px">dan Rules sudah di-publish</div>
        <button onclick="location.reload()" style="padding:10px 24px;background:linear-gradient(135deg,#7fb3a0,#5a9b86);color:#fff;border:none;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer">🔄 Coba Lagi</button>
      </div>`;
  }
})();
