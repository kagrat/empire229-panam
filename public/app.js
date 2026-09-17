/* =====================================================================
   EMPIRE 229 · PANAM — Frontend
   Communique avec l'API REST du serveur (voir server/src/server.js).
   Le jeton de connexion (JWT) est conservé dans localStorage : cette
   page est servie depuis votre propre domaine, ce n'est donc pas
   soumis aux restrictions de stockage des artefacts Claude.
   ===================================================================== */

const CURRENCY = "F";
// Si le frontend est déployé séparément du backend (ex. Vercel + Railway),
// renseigne ici l'URL complète de ton API Railway, ex. :
// "https://empire229-panam-production.up.railway.app/api"
// Laisse vide ("") si frontend et backend sont servis ensemble (Option A).
const API_BASE = "";
let token = localStorage.getItem("e229_token") || null;
let currentUser = null;
let currentScreen = "dashboard";

const state = {
  users: [], products: [], sales: [], clients: [], repairs: [],
  trocs: [], suppliers: [], expenses: [], settings: { shopName: "", location: "", lowStockThreshold: 5 }
};

let cart = [];
let selectedPaymentMethod = "Espèces";
let selectedClientForSale = "";
let posFilter = "Tous";
let inventoryFilter = "Tous";
let selectedTrocCondition = "Bon";

/* ---------------- listes de référence (marques, modèles, couleurs, capacités) ---------------- */
const PHONE_BRANDS = ["Samsung","Apple","Tecno","Infinix","Itel","Xiaomi","Oppo","Vivo","Realme","Nokia","Huawei","Autre"];
const PHONE_MODELS = {
  "Samsung": ["Galaxy A05","Galaxy A15","Galaxy A25","Galaxy A35","Galaxy A55","Galaxy S23","Galaxy S24","Galaxy Note 20","Galaxy Z Flip5","Galaxy Z Fold5","Autre"],
  "Apple": ["iPhone SE","iPhone 11","iPhone 12","iPhone 13","iPhone 14","iPhone 15","iPhone 15 Pro","iPhone 15 Pro Max","Autre"],
  "Tecno": ["Spark 10","Spark 20","Camon 20","Camon 30","Pova 5","Pop 7","Phantom X2","Autre"],
  "Infinix": ["Hot 30","Hot 40","Note 30","Note 40","Smart 8","Zero 30","Autre"],
  "Itel": ["A60","A70","P40","P55","S23","Autre"],
  "Xiaomi": ["Redmi 12","Redmi Note 12","Redmi Note 13","POCO X6","Mi 11","Autre"],
  "Oppo": ["A17","A58","A78","Reno 10","Reno 11","Autre"],
  "Vivo": ["Y17","Y28","Y36","V29","Autre"],
  "Realme": ["C55","C67","Note 50","11 Pro","Autre"],
  "Nokia": ["105","110","150","G21","G42","Autre"],
  "Huawei": ["Y6p","Y9a","Nova 11","Nova 12","Autre"],
  "Autre": ["Autre"]
};
const PHONE_COLORS = ["Noir","Blanc","Bleu","Vert","Or","Argent","Gris sidéral","Rouge","Violet","Rose","Autre"];
const PHONE_STORAGE = ["16 Go","32 Go","64 Go","128 Go","256 Go","512 Go","1 To","Autre"];
const PHONE_RAM = ["1 Go","2 Go","3 Go","4 Go","6 Go","8 Go","12 Go","16 Go","Autre"];

/** Génère le HTML d'un champ select + champ texte "Autre" caché, réutilisé
 * pour marque, modèle, couleur, capacité et RAM. */
function selectWithOther(id, label, options, currentValue){
  const isKnown = options.includes(currentValue);
  const isOther = currentValue && !isKnown;
  return `
    <div class="field">
      <label>${label}</label>
      <select id="${id}">
        <option value="">—</option>
        ${options.map(o=>`<option value="${esc(o)}" ${(!isOther && currentValue===o)?'selected':''}>${esc(o)}</option>`).join('')}
      </select>
      <input id="${id}-other" placeholder="Précisez : ${label.toLowerCase()}" style="margin-top:8px;${(isOther||currentValue==='Autre')?'':'display:none;'}" value="${isOther?esc(currentValue):''}">
    </div>`;
}
/** Lit la valeur finale d'un champ select+Autre : la saisie libre si "Autre"
 * est sélectionné, sinon la valeur du select. */
function readSelectWithOther(id){
  const sel = document.getElementById(id);
  const other = document.getElementById(id+'-other');
  if(!sel) return '';
  if(sel.value === 'Autre') return (other && other.value.trim()) || '';
  return sel.value;
}
/** Attache le comportement d'affichage du champ "Autre" quand on choisit
 * "Autre" dans le select correspondant. */
function wireSelectWithOther(id){
  const sel = document.getElementById(id);
  const other = document.getElementById(id+'-other');
  if(!sel || !other) return;
  sel.addEventListener('change', ()=>{ other.style.display = sel.value === 'Autre' ? 'block' : 'none'; });
}

/* ---------------- utils ---------------- */
function fmt(n){ return (Math.round(n)||0).toLocaleString('fr-FR') + " " + CURRENCY; }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function initials(name){ return (name||"?").split(" ").filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join(""); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function isOwner(){ return currentUser && currentUser.role === 'owner'; }
function toast(msg, isErr){
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

/* ---------------- API helper ---------------- */
async function api(method, path, body){
  const res = await fetch(API_BASE + "/api" + path, {
    method,
    headers: Object.assign(
      { "Content-Type": "application/json" },
      token ? { Authorization: "Bearer " + token } : {}
    ),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = res.status === 204 ? null : await res.json().catch(()=>null);
  if(res.status === 401){
    // Sur la tentative de connexion elle-même, un 401 veut dire
    // "identifiant/mot de passe incorrect" — pas une session expirée
    // (il n'y a pas encore de session). On garde le vrai message serveur.
    if(path === "/auth/login"){
      throw new Error((data && data.error) || "Identifiant ou mot de passe incorrect.");
    }
    logout();
    throw new Error("Session expirée");
  }
  if(!res.ok){
    throw new Error((data && data.error) || "Erreur serveur");
  }
  return data;
}

/* ---------------- boot ---------------- */
(async function boot(){
  document.getElementById('loading-screen').style.display = 'none';
  if(token){
    try{
      const { user } = await api('GET', '/auth/me');
      currentUser = user;
      await enterApp();
      return;
    }catch{
      token = null; localStorage.removeItem('e229_token');
    }
  }
  showLogin();
})();

function showLogin(){ document.getElementById('login-screen').style.display = 'block'; }

document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('login-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });

async function doLogin(){
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-err');
  errEl.style.display = 'none';
  if(!username || !password){ errEl.textContent = "Identifiant et mot de passe requis."; errEl.style.display='block'; return; }
  try{
    const data = await api('POST', '/auth/login', { username, password });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('e229_token', token);
    await enterApp();
  }catch(e){
    errEl.textContent = e.message || "Identifiant ou mot de passe incorrect.";
    errEl.style.display = 'block';
  }
}

function logout(){
  localStorage.removeItem('e229_token');
  token = null; currentUser = null;
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  showLogin();
}
document.getElementById('logout-btn').addEventListener('click', logout);

async function enterApp(){
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';
  document.getElementById('avatar-initials').textContent = initials(currentUser.name);
  document.getElementById('who-name').textContent = currentUser.name;
  document.getElementById('who-role').textContent = isOwner() ? "Propriétaire" : "Gérant boutique";
  buildNav();
  await refreshAll();
  goTo('dashboard');
}

async function refreshAll(){
  try{
    const calls = [
      ['products', '/products'], ['sales', '/sales'], ['clients', '/clients'],
      ['repairs', '/repairs'], ['trocs', '/trocs'], ['suppliers', '/suppliers'],
      ['expenses', '/expenses'], ['settings', '/settings']
    ];
    if(isOwner()) calls.push(['users', '/users']);
    const results = await Promise.all(calls.map(([, path]) => api('GET', path)));
    calls.forEach(([key], i) => { state[key] = results[i]; });
    renderScreen();
  }catch(e){ console.error(e); }
}

/* ---------------- navigation ---------------- */
const NAV_ITEMS = [
  {id:'dashboard', label:'Tableau de bord', ownerOnly:false, icon:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'},
  {id:'pos', label:'Point de vente', ownerOnly:false, icon:'<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L21 7H6"/>'},
  {id:'inventory', label:'Inventaire', ownerOnly:false, icon:'<rect x="4" y="7" width="16" height="13" rx="1.5"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'},
  {id:'clients', label:'Clients', ownerOnly:false, icon:'<circle cx="12" cy="8" r="3.4"/><path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6"/>'},
  {id:'repairs', label:'Réparations', ownerOnly:false, icon:'<path d="M14 3l7 7-8.5 8.5-4-4L3 20l1-6L12.5 5.5z"/>'},
  {id:'troc', label:'Échange / Troc', ownerOnly:false, icon:'<path d="M17 3l4 4-4 4"/><path d="M21 7H9a5 5 0 0 0-5 5"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h12a5 5 0 0 0 5-5"/>'},
  {id:'suppliers', label:'Fournisseurs', ownerOnly:false, icon:'<rect x="3" y="10" width="18" height="9" rx="1.5"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>'},
  {id:'expenses', label:'Dépenses', ownerOnly:false, icon:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9.5c0-1.4 1.3-2.3 3-2.3s3 .9 3 2.1c0 3-6 1.4-6 4.3 0 1.3 1.3 2.2 3 2.2s3-.9 3-2.2"/>'},
  {id:'reports', label:'Rapports', ownerOnly:true, icon:'<path d="M4 20V10M12 20V4M20 20v-7"/>'},
  {id:'employees', label:'Équipe', ownerOnly:true, icon:'<circle cx="9" cy="8" r="3"/><path d="M2 20c.8-3.6 3.4-5.6 7-5.6s6.2 2 7 5.6"/><circle cx="18" cy="8" r="2.4"/><path d="M16 14.4c2.6.3 4.3 1.9 5 4.4"/>'},
  {id:'settings', label:'Paramètres', ownerOnly:true, icon:'<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-1.8-1L14.8 3H9.2l-.4 2.9a7.7 7.7 0 0 0-1.8 1l-2.4-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 1.8 1l.4 2.9h5.6l.4-2.9a7.7 7.7 0 0 0 1.8-1l2.4 1 2-3.4z"/>'}
];

function buildNav(){
  const ul = document.getElementById('nav-list');
  ul.innerHTML = NAV_ITEMS.filter(it => !it.ownerOnly || isOwner()).map(it => `
    <li><button data-screen="${it.id}" class="${it.id===currentScreen?'active':''}">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${it.icon}</svg>${it.label}
    </button></li>`).join('');
  ul.querySelectorAll('button').forEach(btn=> btn.addEventListener('click', ()=> goTo(btn.dataset.screen)));
}

function goTo(screenId){
  currentScreen = screenId;
  document.querySelectorAll('#nav-list button').forEach(b=> b.classList.toggle('active', b.dataset.screen===screenId));
  renderScreen();
}

/* ---------------- modal helpers ---------------- */
function openModal(html){
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal(){
  document.getElementById('modal-overlay').classList.remove('active');
  document.getElementById('modal-content').innerHTML = '';
}
document.getElementById('modal-overlay').addEventListener('click', e=>{ if(e.target.id==='modal-overlay') closeModal(); });

/* ======================================================================
   RENDER ROUTER
   ====================================================================== */
function renderScreen(){
  if(!currentUser) return;
  const main = document.getElementById('main-area');
  const renderers = {
    dashboard: renderDashboard, pos: renderPOS, inventory: renderInventory, clients: renderClients,
    repairs: renderRepairs, troc: renderTroc, suppliers: renderSuppliers, expenses: renderExpenses,
    reports: renderReports, employees: renderEmployees, settings: renderSettings
  };
  const fn = renderers[currentScreen];
  if(!fn){ main.innerHTML=''; return; }
  if((currentScreen==='reports'||currentScreen==='employees'||currentScreen==='settings') && !isOwner()){
    main.innerHTML = `<div class="screen active"><div class="empty-state">Accès réservé au propriétaire de la boutique.</div></div>`;
    return;
  }
  main.innerHTML = fn();
  attachScreenHandlers(currentScreen);
}

/* ======================================================================
   DASHBOARD
   ====================================================================== */
function renderDashboard(){
  const today = todayISO();
  const salesToday = state.sales.filter(s=> (s.date||'').slice(0,10) === today);
  const caToday = salesToday.reduce((a,s)=>a+s.total,0);
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const caYesterday = state.sales.filter(s=>(s.date||'').slice(0,10)===yesterday).reduce((a,s)=>a+s.total,0);
  const delta = caYesterday>0 ? Math.round(((caToday-caYesterday)/caYesterday)*100) : (caToday>0?100:0);
  const repairsActive = state.repairs.filter(r=>r.status!=='pret');
  const lowStock = state.products.filter(p=>p.stock<=(state.settings.lowStockThreshold||5));

  const days = [];
  for(let i=6;i>=0;i--){
    const d = new Date(Date.now()-i*86400000);
    const iso = d.toISOString().slice(0,10);
    const label = d.toLocaleDateString('fr-FR', {weekday:'short'}).replace('.','');
    const total = state.sales.filter(s=>(s.date||'').slice(0,10)===iso).reduce((a,s)=>a+s.total,0);
    days.push({label, total});
  }
  const maxDay = Math.max(1, ...days.map(d=>d.total));
  const lastSales = [...state.sales].sort((a,b)=> (b.date||'').localeCompare(a.date||'')).slice(0,5);

  return `
  <div class="screen active">
    <div class="topbar">
      <div><h1>Tableau de bord</h1><div class="stamp">${new Date().toLocaleDateString('fr-FR',{weekday:'long', day:'numeric', month:'long'})} · ${esc(state.settings.location||'')}</div></div>
      <div class="top-actions"><button class="btn btn-gold" data-act="go-pos">+ Nouvelle vente</button></div>
    </div>
    <div style="padding:30px 34px 60px 34px;">
      <div class="hero-row">
        <div class="hero-card"><div class="label">Chiffre d'affaires du jour</div><div class="num">${fmt(caToday)}</div><div class="delta">${delta>=0?'↑':'↓'} ${Math.abs(delta)}% vs hier</div></div>
        <div class="stat-card"><div class="label">Ventes du jour</div><div class="num">${salesToday.length}</div><div class="delta up">${state.sales.length} au total</div></div>
        <div class="stat-card"><div class="label">Réparations en cours</div><div class="num">${repairsActive.length}</div><div class="delta ${lowStock.length?'down':'up'}">${lowStock.length} article(s) en stock critique</div></div>
      </div>
      <div class="grid-2">
        <div class="panel card-pad"><div class="card-head"><h3>Ventes des 7 derniers jours</h3></div>
          <div class="bars">${days.map(d=>`<div class="bar ${d.total===maxDay && maxDay>0 ?'peak':''}" style="height:${maxDay>0 ? Math.max(4,(d.total/maxDay)*100):2}%;"><span class="bar-lbl">${esc(d.label)}</span></div>`).join('')}</div>
        </div>
        <div class="panel card-pad"><div class="card-head"><h3>Réparations à suivre</h3></div>
          <div class="repair-list">
            ${repairsActive.length ? repairsActive.slice(0,4).map(r=>`
              <div class="repair-item"><div><div class="who">${esc(r.clientName)} — ${esc(r.device)}</div><div class="what">${esc(r.issue)}</div></div>${repairStatusPill(r.status)}</div>`).join('') : '<div class="empty-state">Aucune réparation en cours</div>'}
          </div>
        </div>
      </div>
      <div class="panel card-pad" style="margin-top:16px;">
        <div class="card-head"><h3>Dernières ventes</h3><button class="link" data-act="go-pos">Nouvelle vente →</button></div>
        <div class="table-wrap"><table><thead><tr><th>Client</th><th>Articles</th><th>Montant</th><th>Paiement</th><th>Vendeur</th></tr></thead>
          <tbody>${lastSales.length ? lastSales.map(s=>`<tr><td>${esc(s.clientName||'Client passage')}</td><td>${esc((s.items||[]).map(i=>i.name+(i.qty>1?' x'+i.qty:'')).join(', '))}</td><td>${fmt(s.total)}</td><td>${esc(s.paymentMethod)}</td><td>${esc(s.soldBy||'')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Aucune vente enregistrée</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>
  </div>`;
}
function repairStatusPill(status){
  const map = { recu:['warn','Reçu'], en_reparation:['warn','En cours'], pret:['ok','Prêt / Livré'] };
  const [cls,label] = map[status] || ['warn', status];
  return `<span class="pill ${cls}"><span class="pill-dot"></span>${label}</span>`;
}

/* ======================================================================
   POS
   ====================================================================== */
function renderPOS(){
  const cats = ['Tous', ...new Set(state.products.map(p=>p.category))];
  const filtered = state.products.filter(p=> posFilter==='Tous' || p.category===posFilter);
  const total = cart.reduce((a,c)=>a+c.price*c.qty,0);
  return `
  <div class="screen active">
    <div class="topbar"><div><h1>Point de vente</h1><div class="stamp">${esc(currentUser.name)} · ${esc(state.settings.location||'')}</div></div></div>
    <div style="padding:30px 34px 60px 34px;">
      <div class="pos-layout">
        <div>
          <div class="filters" id="pos-filters">${cats.map(c=>`<div class="chip ${c===posFilter?'active':''}" data-cat="${esc(c)}">${esc(c)}</div>`).join('')}</div>
          <div class="pos-grid" id="pos-grid">
            ${filtered.length ? filtered.map(p=>`
              <button class="pos-item" data-id="${p.id}" ${p.stock<=0?'disabled':''}>
                <div class="sq"><div class="phone-glyph"></div></div>
                <div class="nm">${esc(p.name)}</div><div class="pr">${fmt(p.price)} · ${p.stock<=0?'Rupture':p.stock+' en stock'}</div>
              </button>`).join('') : '<div class="empty-state">Aucun article dans cette catégorie</div>'}
          </div>
        </div>
        <div class="cart-panel">
          <h3>Vente en cours</h3>
          <div id="cart-lines">
            ${cart.length ? cart.map((c,i)=>`<div class="cart-line"><div><div class="cl-name">${esc(c.name)}</div><div class="cl-meta">Qté ${c.qty}</div></div><div style="display:flex;align-items:center;gap:8px;">${fmt(c.price*c.qty)}<button class="cl-rm" data-i="${i}">×</button></div></div>`).join('') : '<div class="cart-empty">Cliquez sur un article pour l\'ajouter</div>'}
          </div>
          <select class="cart-select" id="cart-client">
            <option value="">Client de passage</option>
            ${state.clients.map(c=>`<option value="${c.id}" ${selectedClientForSale===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
          </select>
          <div class="cart-total"><span class="lbl">Total</span><span>${fmt(total)}</span></div>
          <div class="pay-methods" id="pay-methods">${['Espèces','Mobile Money','Crédit'].map(m=>`<div class="pm ${selectedPaymentMethod===m?'sel':''}" data-pm="${m}">${m}</div>`).join('')}</div>
          <button class="btn btn-gold cart-cta" id="checkout-btn" ${!cart.length?'disabled':''}>Encaisser</button>
        </div>
      </div>
    </div>
  </div>`;
}
function posHandlers(){
  document.querySelectorAll('#pos-filters .chip').forEach(el=> el.addEventListener('click', ()=>{ posFilter = el.dataset.cat; renderScreen(); }));
  document.querySelectorAll('#pos-grid .pos-item').forEach(el=>{
    el.addEventListener('click', ()=>{
      const p = state.products.find(x=>x.id===el.dataset.id);
      if(!p || p.stock<=0) return;
      const existing = cart.find(c=>c.productId===p.id);
      const inCartQty = existing ? existing.qty : 0;
      if(inCartQty+1 > p.stock){ toast('Stock insuffisant pour ' + p.name, true); return; }
      if(existing) existing.qty++; else cart.push({productId:p.id, name:p.name, price:p.price, qty:1});
      renderScreen();
    });
  });
  document.querySelectorAll('.cl-rm').forEach(el=> el.addEventListener('click', ()=>{ cart.splice(Number(el.dataset.i),1); renderScreen(); }));
  document.querySelectorAll('#pay-methods .pm').forEach(el=> el.addEventListener('click', ()=>{ selectedPaymentMethod = el.dataset.pm; renderScreen(); }));
  const clientSel = document.getElementById('cart-client');
  if(clientSel) clientSel.addEventListener('change', e=>{ selectedClientForSale = e.target.value; });
  const checkoutBtn = document.getElementById('checkout-btn');
  if(checkoutBtn) checkoutBtn.addEventListener('click', checkout);
}
async function checkout(){
  if(!cart.length) return;
  const btn = document.getElementById('checkout-btn');
  btn.disabled = true; btn.textContent = 'Encaissement…';
  try{
    const sale = await api('POST', '/sales', {
      items: cart.map(c=>({productId:c.productId, qty:c.qty})),
      paymentMethod: selectedPaymentMethod,
      clientId: selectedClientForSale || null
    });
    cart = []; selectedClientForSale = ''; selectedPaymentMethod = 'Espèces';
    toast('Vente encaissée : ' + fmt(sale.total));
    await refreshAll();
  }catch(e){
    toast(e.message || 'Erreur lors de l\'encaissement', true);
    btn.disabled = false; btn.textContent = 'Encaisser';
  }
}

/* ======================================================================
   INVENTORY
   ====================================================================== */
function renderInventory(){
  const cats = ['Tous', ...new Set(state.products.map(p=>p.category))];
  const low = state.products.filter(p=>p.stock<=(state.settings.lowStockThreshold||5));
  let list = state.products;
  if(inventoryFilter==='Stock critique') list = low;
  else if(inventoryFilter!=='Tous') list = list.filter(p=>p.category===inventoryFilter);
  return `
  <div class="screen active">
    <div class="topbar">
      <div><h1>Inventaire</h1><div class="stamp">${state.products.length} article(s) référencé(s) · ${low.length} en stock critique</div></div>
      <div class="top-actions"><button class="btn btn-primary" id="add-product-btn">+ Ajouter un article</button></div>
    </div>
    <div style="padding:30px 34px 60px 34px;">
      <div class="filters">${[...cats,'Stock critique'].filter((v,i,a)=>a.indexOf(v)===i).map(c=>`<div class="chip ${c===inventoryFilter?'active':''}" data-cat="${esc(c)}">${esc(c)}</div>`).join('')}</div>
      <div class="prod-grid">
        ${list.length ? list.map(p=>`
          <div class="prod-card">
            <div class="prod-img"><div class="phone-glyph"></div><span class="stock-tag ${p.stock<=(state.settings.lowStockThreshold||5)?'low':''}">${p.stock} en stock</span></div>
            <div class="prod-body">
              <div class="brand-lbl">${esc((p.brand||'').toUpperCase())}</div>
              <div class="p-name">${esc(p.name)}</div>
              ${(p.color||p.storage||p.ram) ? `<div class="qty" style="margin-top:2px;">${[p.color,p.storage,p.ram].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
              <div class="p-foot"><span class="price">${fmt(p.price)}</span><span class="qty">${esc(p.category)}</span></div>
              <div class="prod-actions">
                <button class="btn btn-ghost btn-sm" data-edit="${p.id}">Modifier</button>
                ${isOwner()?`<button class="btn btn-danger btn-sm" data-del="${p.id}">Suppr.</button>`:''}
              </div>
            </div>
          </div>`).join('') : '<div class="empty-state">Aucun article. Ajoutez votre premier article.</div>'}
      </div>
    </div>
  </div>`;
}
function productForm(existing){
  const p = existing || {brand:'',name:'',category:'Téléphones',condition:'Neuf',color:'',storage:'',ram:'',imei:'',price:'',cost:'',stock:''};
  const modelOptions = PHONE_MODELS[p.brand] || PHONE_MODELS["Autre"];
  return `
    <h3>${existing?'Modifier l\'article':'Ajouter un article'}</h3>
    <div class="field-row">
      ${selectWithOther('f-brand', 'Marque', PHONE_BRANDS, p.brand)}
      <div class="field">
        <label>Modèle</label>
        <select id="f-model-select">
          <option value="">—</option>
          ${modelOptions.map(m=>`<option value="${esc(m)}" ${p.name===m?'selected':''}>${esc(m)}</option>`).join('')}
        </select>
        <input id="f-name" placeholder="Précisez le modèle" style="margin-top:8px;${(p.name && modelOptions.includes(p.name) && p.name!=='Autre')?'display:none;':''}" value="${esc(p.name)}">
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Catégorie</label><select id="f-category">${['Téléphones','Accessoires','Pièces de réparation','Occasion / Reprise'].map(c=>`<option ${p.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>État</label><select id="f-condition">${['Neuf','Excellent','Bon','Moyen'].map(c=>`<option ${p.condition===c?'selected':''}>${c}</option>`).join('')}</select></div>
    </div>
    <div class="field-row">
      ${selectWithOther('f-color', 'Couleur', PHONE_COLORS, p.color)}
      ${selectWithOther('f-storage', 'Capacité', PHONE_STORAGE, p.storage)}
    </div>
    <div class="field-row">
      ${selectWithOther('f-ram', 'RAM', PHONE_RAM, p.ram)}
      <div class="field"><label>IMEI (optionnel)</label><input id="f-imei" value="${esc(p.imei||'')}" placeholder="35 892 601 xxxxxx"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Prix de vente (${CURRENCY})</label><input id="f-price" type="number" value="${p.price}"></div>
      <div class="field"><label>Coût d'achat (${CURRENCY})</label><input id="f-cost" type="number" value="${p.cost||''}"></div>
    </div>
    <div class="field"><label>Quantité en stock</label><input id="f-stock" type="number" value="${p.stock}"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="modal-cancel">Annuler</button><button class="btn btn-primary" id="modal-save">${existing?'Enregistrer':'Ajouter'}</button></div>`;
}
function wireProductForm(existing){
  wireSelectWithOther('f-brand');
  wireSelectWithOther('f-color');
  wireSelectWithOther('f-storage');
  wireSelectWithOther('f-ram');
  const brandSel = document.getElementById('f-brand');
  const modelSel = document.getElementById('f-model-select');
  const modelInput = document.getElementById('f-name');
  function refreshModels(){
    const brand = brandSel.value === 'Autre' ? (document.getElementById('f-brand-other').value.trim() || 'Autre') : brandSel.value;
    const options = PHONE_MODELS[brand] || PHONE_MODELS["Autre"];
    modelSel.innerHTML = '<option value="">—</option>' + options.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  }
  brandSel.addEventListener('change', refreshModels);
  modelSel.addEventListener('change', ()=>{
    if(modelSel.value === 'Autre' || modelSel.value === ''){
      modelInput.style.display = 'block';
      if(modelSel.value === '') modelInput.value = '';
    } else {
      modelInput.style.display = 'none';
      modelInput.value = modelSel.value;
    }
  });
  // Pré-sélectionne le modèle existant s'il correspond à une valeur connue
  if(existing && existing.name){
    const opts = Array.from(modelSel.options).map(o=>o.value);
    if(opts.includes(existing.name)) modelSel.value = existing.name;
    else if(modelSel.querySelector('option[value="Autre"]')) modelSel.value = 'Autre';
  }
}
function inventoryHandlers(){
  document.querySelectorAll('.filters .chip').forEach(el=> el.addEventListener('click', ()=>{ inventoryFilter = el.dataset.cat; renderScreen(); }));
  const addBtn = document.getElementById('add-product-btn');
  if(addBtn) addBtn.addEventListener('click', ()=>{
    openModal(productForm(null));
    wireProductForm(null);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', ()=>saveProduct(null));
  });
  document.querySelectorAll('[data-edit]').forEach(el=> el.addEventListener('click', ()=>{
    const p = state.products.find(x=>x.id===el.dataset.edit);
    openModal(productForm(p));
    wireProductForm(p);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', ()=>saveProduct(p.id));
  }));
  document.querySelectorAll('[data-del]').forEach(el=> el.addEventListener('click', async ()=>{
    if(!confirm('Supprimer cet article ?')) return;
    try{ await api('DELETE', '/products/'+el.dataset.del); toast('Article supprimé'); await refreshAll(); }
    catch(e){ toast(e.message, true); }
  }));
}
async function saveProduct(existingId){
  const payload = {
    brand: readSelectWithOther('f-brand'),
    name: document.getElementById('f-name').value.trim(),
    category: document.getElementById('f-category').value,
    condition: document.getElementById('f-condition').value,
    color: readSelectWithOther('f-color'),
    storage: readSelectWithOther('f-storage'),
    ram: readSelectWithOther('f-ram'),
    imei: document.getElementById('f-imei').value.trim(),
    price: Number(document.getElementById('f-price').value)||0,
    cost: Number(document.getElementById('f-cost').value)||0,
    stock: Number(document.getElementById('f-stock').value)||0
  };
  if(!payload.name || payload.price<=0){ toast('Merci de renseigner au moins le modèle et un prix valide', true); return; }
  try{
    if(existingId) await api('PATCH', '/products/'+existingId, payload);
    else await api('POST', '/products', payload);
    closeModal(); toast(existingId?'Article mis à jour':'Article ajouté'); await refreshAll();
  }catch(e){ toast(e.message, true); }
}

/* ======================================================================
   CLIENTS
   ====================================================================== */
function renderClients(){
  return `
  <div class="screen active">
    <div class="topbar"><div><h1>Clients</h1><div class="stamp">${state.clients.length} client(s) enregistré(s)</div></div>
      <div class="top-actions"><button class="btn btn-primary" id="add-client-btn">+ Nouveau client</button></div>
    </div>
    <div style="padding:30px 34px 60px 34px;">
      <div class="panel card-pad"><div class="table-wrap"><table>
        <thead><tr><th>Client</th><th>Téléphone</th><th>Total dépensé</th><th>Dernier achat</th><th></th></tr></thead>
        <tbody>${state.clients.length ? state.clients.map(c=>`
          <tr><td><div class="flex-name"><div class="client-row-avatar">${initials(c.name)}</div>${esc(c.name)}</div></td>
          <td>${esc(c.phone||'—')}</td><td>${fmt(c.totalSpent||0)}</td>
          <td>${c.lastPurchase ? new Date(c.lastPurchase).toLocaleDateString('fr-FR') : 'Jamais'}</td>
          <td><button class="btn btn-ghost btn-sm" data-edit="${c.id}">Modifier</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Aucun client enregistré</td></tr>'}</tbody>
      </table></div></div>
    </div>
  </div>`;
}
function clientForm(existing){
  const c = existing || {name:'',phone:'',notes:''};
  return `
    <h3>${existing?'Modifier le client':'Nouveau client'}</h3>
    <div class="field"><label>Nom complet</label><input id="f-cname" value="${esc(c.name)}"></div>
    <div class="field"><label>Téléphone</label><input id="f-cphone" value="${esc(c.phone)}"></div>
    <div class="field"><label>Notes</label><textarea id="f-cnotes">${esc(c.notes||'')}</textarea></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="modal-cancel">Annuler</button><button class="btn btn-primary" id="modal-save">${existing?'Enregistrer':'Ajouter'}</button></div>`;
}
function clientsHandlers(){
  const addBtn = document.getElementById('add-client-btn');
  if(addBtn) addBtn.addEventListener('click', ()=>{
    openModal(clientForm(null));
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', ()=>saveClient(null));
  });
  document.querySelectorAll('[data-edit]').forEach(el=> el.addEventListener('click', ()=>{
    const c = state.clients.find(x=>x.id===el.dataset.edit);
    openModal(clientForm(c));
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', ()=>saveClient(c.id));
  }));
}
async function saveClient(existingId){
  const payload = {
    name: document.getElementById('f-cname').value.trim(),
    phone: document.getElementById('f-cphone').value.trim(),
    notes: document.getElementById('f-cnotes').value.trim()
  };
  if(!payload.name){ toast('Le nom du client est requis', true); return; }
  try{
    if(existingId) await api('PATCH', '/clients/'+existingId, payload);
    else await api('POST', '/clients', payload);
    closeModal(); toast(existingId?'Client mis à jour':'Client ajouté'); await refreshAll();
  }catch(e){ toast(e.message, true); }
}

/* ======================================================================
   REPAIRS
   ====================================================================== */
function renderRepairs(){
  const cols = [{key:'recu',title:'Reçu'},{key:'en_reparation',title:'En réparation'},{key:'pret',title:'Prêt / Livré'}];
  return `
  <div class="screen active">
    <div class="topbar"><div><h1>Réparations</h1><div class="stamp">${state.repairs.length} dossier(s)</div></div>
      <div class="top-actions"><button class="btn btn-primary" id="add-repair-btn">+ Nouveau dossier</button></div>
    </div>
    <div style="padding:30px 34px 60px 34px;">
      <div class="kanban">
        ${cols.map(col=>{
          const items = state.repairs.filter(r=>r.status===col.key);
          return `<div><div class="kcol-head"><h4>${col.title}</h4><span class="count">${items.length}</span></div>
            ${items.length ? items.map(r=>`
              <div class="kcard"><div class="kc-top"><div class="kc-device">${esc(r.device)}</div></div>
                <div class="kc-issue">${esc(r.issue)}</div>
                <div class="kc-cost">${r.cost?fmt(r.cost):'Devis à définir'}</div>
                <div class="kc-foot"><span class="kc-client">${esc(r.clientName)}</span>
                  <select data-repair="${r.id}">
                    <option value="recu" ${r.status==='recu'?'selected':''}>Reçu</option>
                    <option value="en_reparation" ${r.status==='en_reparation'?'selected':''}>En réparation</option>
                    <option value="pret" ${r.status==='pret'?'selected':''}>Prêt / Livré</option>
                  </select>
                </div>
              </div>`).join('') : '<div class="empty-state">Aucun dossier</div>'}
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}
function repairForm(){
  return `
    <h3>Nouveau dossier de réparation</h3>
    <div class="field"><label>Client</label><input id="f-rclient"></div>
    <div class="field"><label>Appareil</label><input id="f-rdevice"></div>
    <div class="field"><label>Panne / Description</label><textarea id="f-rissue"></textarea></div>
    <div class="field"><label>Coût estimé (${CURRENCY})</label><input id="f-rcost" type="number"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="modal-cancel">Annuler</button><button class="btn btn-primary" id="modal-save">Créer le dossier</button></div>`;
}
function repairsHandlers(){
  const addBtn = document.getElementById('add-repair-btn');
  if(addBtn) addBtn.addEventListener('click', ()=>{
    openModal(repairForm());
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', async ()=>{
      const payload = {
        clientName: document.getElementById('f-rclient').value.trim(),
        device: document.getElementById('f-rdevice').value.trim(),
        issue: document.getElementById('f-rissue').value.trim(),
        cost: Number(document.getElementById('f-rcost').value)||0
      };
      if(!payload.clientName || !payload.device){ toast('Client et appareil sont requis', true); return; }
      try{ await api('POST', '/repairs', payload); closeModal(); toast('Dossier créé'); await refreshAll(); }
      catch(e){ toast(e.message, true); }
    });
  });
  document.querySelectorAll('[data-repair]').forEach(el=> el.addEventListener('change', async ()=>{
    try{ await api('PATCH', '/repairs/'+el.dataset.repair, {status: el.value}); await refreshAll(); }
    catch(e){ toast(e.message, true); }
  }));
}

/* ======================================================================
   TROC
   ====================================================================== */
function renderTroc(){
  return `
  <div class="screen active">
    <div class="topbar"><div><h1>Échange / Troc</h1><div class="stamp">Reprise d'un appareil en échange d'un nouveau, avec complément</div></div></div>
    <div style="padding:30px 34px 60px 34px;">
      <div class="troc-layout">
        <div class="troc-panel in">
          <div class="tp-head"><div class="tp-icon">📥</div><div><h3>Appareil repris</h3><div class="tp-sub">L'appareil que le client apporte</div></div></div>
          <div class="field-row">
            ${selectWithOther('t-inbrand', 'Marque', PHONE_BRANDS, '')}
            <div class="field">
              <label>Modèle</label>
              <select id="t-inmodel-select"><option value="">—</option>${(PHONE_MODELS["Autre"]).map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select>
              <input id="t-inmodel" placeholder="Précisez le modèle" style="margin-top:8px;">
            </div>
          </div>
          <div class="field-row">
            ${selectWithOther('t-incolor', 'Couleur', PHONE_COLORS, '')}
            ${selectWithOther('t-instorage', 'Capacité', PHONE_STORAGE, '')}
          </div>
          <div class="field-row">
            ${selectWithOther('t-inram', 'RAM', PHONE_RAM, '')}
            <div class="field"><label>IMEI (optionnel)</label><input id="t-imei" placeholder="35 892 601 xxxxxx"></div>
          </div>
          <div class="field"><label>État de l'appareil</label><div class="cond-chips" id="t-cond">${['Excellent','Bon','Moyen','Mauvais'].map(c=>`<div class="cond-chip ${selectedTrocCondition===c?'sel':''}" data-cond="${c}">${c}</div>`).join('')}</div></div>
          <div class="field-row"><div class="field"><label>Valeur de reprise (${CURRENCY})</label><input id="t-invalue" type="number"></div><div class="field"><label>Client</label><input id="t-client"></div></div>
        </div>
        <div class="troc-panel out">
          <div class="tp-head"><div class="tp-icon">📤</div><div><h3>Nouvel appareil</h3><div class="tp-sub">L'appareil que le client repart avec</div></div></div>
          <div class="field"><label>Article sélectionné</label><select id="t-outproduct"><option value="">— Choisir un article en stock —</option>${state.products.filter(p=>p.stock>0).map(p=>`<option value="${p.id}" data-price="${p.price}">${esc(p.name)} — ${fmt(p.price)}</option>`).join('')}</select></div>
          <div class="field"><label>Prix de vente (${CURRENCY})</label><input id="t-outprice" type="number"></div>
          <div class="field"><label>Remarque</label><input id="t-note"></div>
        </div>
      </div>
      <div class="troc-summary">
        <h3>Résumé de l'échange</h3>
        <div class="ts-line"><span>Prix du nouvel appareil</span><span id="ts-price">0 F</span></div>
        <div class="ts-line"><span>Valeur de reprise</span><span class="minus" id="ts-reprise">− 0 F</span></div>
        <div class="ts-line total"><span class="lbl">Complément à payer</span><span id="ts-total">0 F</span></div>
        <div class="pay-methods" id="troc-pay">${['Espèces','Mobile Money','Crédit'].map((m,i)=>`<div class="pm ${i===0?'sel':''}" data-pm="${m}">${m}</div>`).join('')}</div>
        <button class="btn btn-gold cart-cta" id="troc-validate">Valider l'échange</button>
      </div>
    </div>
  </div>`;
}
function trocHandlers(){
  let trocPay = 'Espèces';
  document.querySelectorAll('#t-cond .cond-chip').forEach(el=> el.addEventListener('click', ()=>{ selectedTrocCondition = el.dataset.cond; renderScreen(); }));

  wireSelectWithOther('t-inbrand');
  wireSelectWithOther('t-incolor');
  wireSelectWithOther('t-instorage');
  wireSelectWithOther('t-inram');
  const inBrandSel = document.getElementById('t-inbrand');
  const inModelSel = document.getElementById('t-inmodel-select');
  const inModelInput = document.getElementById('t-inmodel');
  function refreshInModels(){
    const brand = inBrandSel.value === 'Autre' ? (document.getElementById('t-inbrand-other').value.trim() || 'Autre') : inBrandSel.value;
    const options = PHONE_MODELS[brand] || PHONE_MODELS["Autre"];
    inModelSel.innerHTML = '<option value="">—</option>' + options.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  }
  inBrandSel.addEventListener('change', refreshInModels);
  inModelSel.addEventListener('change', ()=>{
    if(inModelSel.value === 'Autre' || inModelSel.value === ''){ inModelInput.style.display = 'block'; if(inModelSel.value==='') inModelInput.value=''; }
    else { inModelInput.style.display = 'none'; inModelInput.value = inModelSel.value; }
  });

  const outSel = document.getElementById('t-outproduct');
  const outPrice = document.getElementById('t-outprice');
  function recalc(){
    const price = Number(outPrice.value)||0;
    const reprise = Number(document.getElementById('t-invalue').value)||0;
    document.getElementById('ts-price').textContent = fmt(price);
    document.getElementById('ts-reprise').textContent = '− ' + fmt(reprise);
    document.getElementById('ts-total').textContent = fmt(Math.max(0, price-reprise));
  }
  outSel.addEventListener('change', ()=>{
    const opt = outSel.selectedOptions[0];
    outPrice.value = opt && opt.dataset.price ? opt.dataset.price : '';
    recalc();
  });
  outPrice.addEventListener('input', recalc);
  document.getElementById('t-invalue').addEventListener('input', recalc);
  document.querySelectorAll('#troc-pay .pm').forEach(el=> el.addEventListener('click', ()=>{
    document.querySelectorAll('#troc-pay .pm').forEach(p=>p.classList.remove('sel'));
    el.classList.add('sel'); trocPay = el.dataset.pm;
  }));
  document.getElementById('troc-validate').addEventListener('click', async ()=>{
    const payload = {
      deviceInBrand: readSelectWithOther('t-inbrand'),
      deviceInModel: document.getElementById('t-inmodel').value.trim(),
      deviceInColor: readSelectWithOther('t-incolor'),
      deviceInStorage: readSelectWithOther('t-instorage'),
      deviceInRam: readSelectWithOther('t-inram'),
      imei: document.getElementById('t-imei').value.trim(),
      valueIn: Number(document.getElementById('t-invalue').value)||0,
      clientName: document.getElementById('t-client').value.trim(),
      outProductId: outSel.value,
      outPrice: Number(outPrice.value)||0,
      note: document.getElementById('t-note').value.trim(),
      condition: selectedTrocCondition,
      paymentMethod: trocPay
    };
    if(!payload.deviceInModel || !payload.outProductId || payload.outPrice<=0){ toast('Merci de renseigner l\'appareil repris et l\'article donné', true); return; }
    try{
      const troc = await api('POST', '/trocs', payload);
      toast('Échange validé — complément ' + fmt(troc.complement));
      await refreshAll();
    }catch(e){ toast(e.message, true); }
  });
  recalc();
}

/* ======================================================================
   SUPPLIERS
   ====================================================================== */
function renderSuppliers(){
  const totalDue = state.suppliers.reduce((a,s)=>a+(s.amountDue||0),0);
  return `
  <div class="screen active">
    <div class="topbar"><div><h1>Fournisseurs</h1><div class="stamp">${state.suppliers.length} fournisseur(s) · ${fmt(totalDue)} dû au total</div></div>
      <div class="top-actions">${isOwner()?'<button class="btn btn-primary" id="add-supplier-btn">+ Nouveau fournisseur</button>':''}</div>
    </div>
    <div style="padding:30px 34px 60px 34px;">
      <div class="panel card-pad"><div class="table-wrap"><table>
        <thead><tr><th>Fournisseur</th><th>Contact</th><th>Articles fournis</th><th>Montant dû</th><th>Statut</th>${isOwner()?'<th></th>':''}</tr></thead>
        <tbody>${state.suppliers.length ? state.suppliers.map(s=>`
          <tr><td>${esc(s.name)}</td><td>${esc(s.contact||'—')}</td><td>${esc(s.items||'—')}</td><td>${fmt(s.amountDue||0)}</td>
          <td>${(s.amountDue||0)>0 ? '<span class="pill warn"><span class="pill-dot"></span>Dû</span>' : '<span class="pill ok"><span class="pill-dot"></span>Soldé</span>'}</td>
          ${isOwner()?`<td><div style="display:flex;gap:6px;"><button class="btn btn-ghost btn-sm" data-pay="${s.id}">Payer</button><button class="btn btn-danger btn-sm" data-delsup="${s.id}">Suppr.</button></div></td>`:''}
          </tr>`).join('') : `<tr><td colspan="${isOwner()?6:5}" class="empty-state">Aucun fournisseur enregistré</td></tr>`}</tbody>
      </table></div></div>
    </div>
  </div>`;
}
function supplierForm(){
  return `
    <h3>Nouveau fournisseur</h3>
    <div class="field"><label>Nom</label><input id="f-sname"></div>
    <div class="field"><label>Contact</label><input id="f-scontact"></div>
    <div class="field"><label>Articles fournis</label><input id="f-sitems"></div>
    <div class="field"><label>Montant dû initial (${CURRENCY})</label><input id="f-sdue" type="number"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="modal-cancel">Annuler</button><button class="btn btn-primary" id="modal-save">Ajouter</button></div>`;
}
function suppliersHandlers(){
  const addBtn = document.getElementById('add-supplier-btn');
  if(addBtn) addBtn.addEventListener('click', ()=>{
    openModal(supplierForm());
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', async ()=>{
      const payload = {
        name: document.getElementById('f-sname').value.trim(),
        contact: document.getElementById('f-scontact').value.trim(),
        items: document.getElementById('f-sitems').value.trim(),
        amountDue: Number(document.getElementById('f-sdue').value)||0
      };
      if(!payload.name){ toast('Le nom du fournisseur est requis', true); return; }
      try{ await api('POST', '/suppliers', payload); closeModal(); toast('Fournisseur ajouté'); await refreshAll(); }
      catch(e){ toast(e.message, true); }
    });
  });
  document.querySelectorAll('[data-pay]').forEach(el=> el.addEventListener('click', async ()=>{
    const s = state.suppliers.find(x=>x.id===el.dataset.pay);
    const amt = prompt('Montant payé à ' + s.name + ' (' + CURRENCY + ') :', s.amountDue||0);
    if(amt===null) return;
    const paid = Number(amt)||0;
    try{ await api('PATCH', '/suppliers/'+s.id, { amountDue: Math.max(0, (s.amountDue||0)-paid) }); toast('Paiement enregistré'); await refreshAll(); }
    catch(e){ toast(e.message, true); }
  }));
  document.querySelectorAll('[data-delsup]').forEach(el=> el.addEventListener('click', async ()=>{
    if(!confirm('Supprimer ce fournisseur ?')) return;
    try{ await api('DELETE', '/suppliers/'+el.dataset.delsup); await refreshAll(); }
    catch(e){ toast(e.message, true); }
  }));
}

/* ======================================================================
   EXPENSES
   ====================================================================== */
function renderExpenses(){
  const monthKey = todayISO().slice(0,7);
  const monthExpenses = state.expenses.filter(e=>(e.date||'').slice(0,7)===monthKey);
  const total = monthExpenses.reduce((a,e)=>a+e.amount,0);
  const byCat = {};
  monthExpenses.forEach(e=> byCat[e.category] = (byCat[e.category]||0)+e.amount);
  const topCat = Object.entries(byCat).sort((a,b)=>b[1]-a[1])[0];
  const todayList = state.expenses.filter(e=>e.date===todayISO());
  return `
  <div class="screen active">
    <div class="topbar"><div><h1>Dépenses</h1><div class="stamp">${new Date().toLocaleDateString('fr-FR',{month:'long',year:'numeric'})}</div></div>
      <div class="top-actions"><button class="btn btn-primary" id="add-expense-btn">+ Enregistrer une dépense</button></div>
    </div>
    <div style="padding:30px 34px 60px 34px;">
      <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);">
        <div class="stat-card"><div class="label">Dépenses du mois</div><div class="num">${fmt(total)}</div><div class="delta">${monthExpenses.length} opération(s)</div></div>
        <div class="stat-card"><div class="label">Plus grosse catégorie</div><div class="num">${topCat?esc(topCat[0]):'—'}</div><div class="delta">${topCat?fmt(topCat[1]):''}</div></div>
        <div class="stat-card"><div class="label">Dépenses du jour</div><div class="num">${fmt(todayList.reduce((a,e)=>a+e.amount,0))}</div><div class="delta">${todayList.length} opération(s)</div></div>
      </div>
      <div class="panel card-pad"><div class="card-head"><h3>Historique des dépenses</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Catégorie</th><th>Description</th><th>Montant</th><th>Enregistré par</th>${isOwner()?'<th></th>':''}</tr></thead>
        <tbody>${state.expenses.length ? [...state.expenses].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(e=>`
          <tr><td>${e.date?new Date(e.date).toLocaleDateString('fr-FR'):''}</td><td><span class="cat-tag">${esc(e.category)}</span></td><td>${esc(e.description)}</td><td>${fmt(e.amount)}</td><td>${esc(e.recordedBy||'')}</td>
          ${isOwner()?`<td><button class="btn btn-danger btn-sm" data-delexp="${e.id}">Suppr.</button></td>`:''}</tr>`).join('') : `<tr><td colspan="${isOwner()?6:5}" class="empty-state">Aucune dépense enregistrée</td></tr>`}</tbody>
      </table></div></div>
    </div>
  </div>`;
}
function expenseForm(){
  return `
    <h3>Enregistrer une dépense</h3>
    <div class="field"><label>Date</label><input id="f-edate" type="date" value="${todayISO()}"></div>
    <div class="field"><label>Catégorie</label><select id="f-ecat">${['Loyer','Transport','Fournitures','Électricité','Réparation matériel','Salaires','Autre'].map(c=>`<option>${c}</option>`).join('')}</select></div>
    <div class="field"><label>Description</label><input id="f-edesc"></div>
    <div class="field"><label>Montant (${CURRENCY})</label><input id="f-eamount" type="number"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="modal-cancel">Annuler</button><button class="btn btn-primary" id="modal-save">Enregistrer</button></div>`;
}
function expensesHandlers(){
  const addBtn = document.getElementById('add-expense-btn');
  if(addBtn) addBtn.addEventListener('click', ()=>{
    openModal(expenseForm());
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', async ()=>{
      const payload = {
        date: document.getElementById('f-edate').value || todayISO(),
        category: document.getElementById('f-ecat').value,
        description: document.getElementById('f-edesc').value.trim(),
        amount: Number(document.getElementById('f-eamount').value)||0
      };
      if(payload.amount<=0){ toast('Montant invalide', true); return; }
      try{ await api('POST', '/expenses', payload); closeModal(); toast('Dépense enregistrée'); await refreshAll(); }
      catch(e){ toast(e.message, true); }
    });
  });
  document.querySelectorAll('[data-delexp]').forEach(el=> el.addEventListener('click', async ()=>{
    if(!confirm('Supprimer cette dépense ?')) return;
    try{ await api('DELETE', '/expenses/'+el.dataset.delexp); await refreshAll(); }
    catch(e){ toast(e.message, true); }
  }));
}

/* ======================================================================
   REPORTS (owner only)
   ====================================================================== */
let reportSummaryCache = null;
function renderReports(){
  // Le calcul est fait côté serveur (source de vérité) ; on l'affiche
  // une fois reçu et on montre un état de chargement avant.
  if(!reportSummaryCache){
    api('GET', '/reports/summary').then(s=>{ reportSummaryCache = s; if(currentScreen==='reports') renderScreen(); });
    return `<div class="screen active"><div class="empty-state">Calcul des rapports…</div></div>`;
  }
  const s = reportSummaryCache;
  const colors = ['#E3A73E','#38C6AE','#272C52','#E2574C','#8B8E9C'];
  const catEntries = Object.entries(s.revenueByCategory||{});
  const catTotal = catEntries.reduce((a,[,v])=>a+v,0) || 1;
  return `
  <div class="screen active">
    <div class="topbar"><div><h1>Rapports</h1><div class="stamp">${new Date().toLocaleDateString('fr-FR',{month:'long',year:'numeric'})}</div></div>
      <div class="top-actions"><button class="btn btn-ghost" id="export-report-btn">Exporter en CSV</button></div>
    </div>
    <div style="padding:30px 34px 60px 34px;">
      <div class="kpi-row">
        <div class="stat-card"><div class="label">Chiffre d'affaires</div><div class="num">${fmt(s.revenue)}</div><div class="delta up">${s.salesCount} vente(s)</div></div>
        <div class="stat-card"><div class="label">Marge brute</div><div class="num">${fmt(s.grossMargin)}</div><div class="delta">Coût marchandises : ${fmt(s.cogs)}</div></div>
        <div class="stat-card"><div class="label">Résultat net (approx.)</div><div class="num">${fmt(s.netProfit)}</div><div class="delta ${s.netProfit>=0?'up':'down'}">Après ${fmt(s.expensesTotal)} de dépenses</div></div>
        <div class="stat-card"><div class="label">Panier moyen</div><div class="num">${fmt(s.averageBasket)}</div></div>
      </div>
      <div class="panel card-pad">
        <div class="card-head"><h3>Répartition des ventes</h3></div>
        ${catEntries.length ? catEntries.map(([cat,v],i)=>`<div class="legend-row"><span class="legend-dot" style="background:${colors[i%colors.length]};"></span>${esc(cat)} — ${Math.round(v/catTotal*100)}%</div>`).join('') : '<div class="empty-state">Pas encore de ventes ce mois-ci</div>'}
      </div>
    </div>
  </div>`;
}
function reportsHandlers(){
  const btn = document.getElementById('export-report-btn');
  if(!btn) return;
  btn.addEventListener('click', async ()=>{
    try{
      const res = await fetch('/api/reports/export.csv', { headers: { Authorization: 'Bearer ' + token } });
      if(!res.ok) throw new Error('Échec de l\'export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'empire229-ventes.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }catch(e){ toast(e.message || 'Erreur export', true); }
  });
}

/* ======================================================================
   EMPLOYEES (owner only)
   ====================================================================== */
function renderEmployees(){
  const gerants = (state.users||[]).filter(u=>u.role==='gerant');
  return `
  <div class="screen active">
    <div class="topbar"><div><h1>Équipe</h1><div class="stamp">${gerants.length} gérant(s)</div></div>
      <div class="top-actions"><button class="btn btn-primary" id="add-employee-btn">+ Nouveau gérant</button></div>
    </div>
    <div style="padding:30px 34px 60px 34px;">
      <div class="panel card-pad"><div class="table-wrap"><table>
        <thead><tr><th>Nom</th><th>Identifiant</th><th>Statut</th><th></th></tr></thead>
        <tbody>${gerants.length ? gerants.map(u=>`
          <tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td>
          <td><label class="switch"><input type="checkbox" data-toggle="${u.username}" ${u.active!==false?'checked':''}><span class="slider-tog"></span></label></td>
          <td><div style="display:flex;gap:6px;"><button class="btn btn-ghost btn-sm" data-reset="${u.username}">Réinit. mdp</button><button class="btn btn-danger btn-sm" data-deluser="${u.username}">Suppr.</button></div></td>
          </tr>`).join('') : '<tr><td colspan="4" class="empty-state">Aucun gérant. Ajoutez un compte pour votre employé.</td></tr>'}</tbody>
      </table></div></div>
    </div>
  </div>`;
}
function employeeForm(){
  return `
    <h3>Nouveau compte gérant</h3>
    <div class="modal-sub">Ce compte pourra utiliser la caisse, l'inventaire, les clients et les réparations, mais pas les rapports financiers ni la gestion de l'équipe.</div>
    <div class="field"><label>Nom complet</label><input id="f-uname"></div>
    <div class="field"><label>Identifiant de connexion</label><input id="f-uid"></div>
    <div class="field"><label>Mot de passe temporaire</label><input id="f-upass"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="modal-cancel">Annuler</button><button class="btn btn-primary" id="modal-save">Créer le compte</button></div>`;
}
function employeesHandlers(){
  const addBtn = document.getElementById('add-employee-btn');
  if(addBtn) addBtn.addEventListener('click', ()=>{
    openModal(employeeForm());
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', async ()=>{
      const payload = {
        name: document.getElementById('f-uname').value.trim(),
        username: document.getElementById('f-uid').value.trim(),
        password: document.getElementById('f-upass').value
      };
      if(!payload.name || !payload.username || !payload.password){ toast('Tous les champs sont requis', true); return; }
      try{ await api('POST', '/users', payload); closeModal(); toast('Compte gérant créé'); await refreshAll(); }
      catch(e){ toast(e.message, true); }
    });
  });
  document.querySelectorAll('[data-toggle]').forEach(el=> el.addEventListener('change', async ()=>{
    try{ await api('PATCH', '/users/'+el.dataset.toggle, { active: el.checked }); }
    catch(e){ toast(e.message, true); await refreshAll(); }
  }));
  document.querySelectorAll('[data-reset]').forEach(el=> el.addEventListener('click', async ()=>{
    const np = prompt('Nouveau mot de passe pour ' + el.dataset.reset + ' :');
    if(!np) return;
    try{ await api('POST', '/users/'+el.dataset.reset+'/reset-password', { password: np }); toast('Mot de passe réinitialisé'); }
    catch(e){ toast(e.message, true); }
  }));
  document.querySelectorAll('[data-deluser]').forEach(el=> el.addEventListener('click', async ()=>{
    if(!confirm('Supprimer ce compte gérant ?')) return;
    try{ await api('DELETE', '/users/'+el.dataset.deluser); await refreshAll(); }
    catch(e){ toast(e.message, true); }
  }));
}

/* ======================================================================
   SETTINGS (owner only)
   ====================================================================== */
function renderSettings(){
  return `
  <div class="screen active">
    <div class="topbar"><div><h1>Paramètres</h1><div class="stamp">Configuration de la boutique</div></div></div>
    <div style="padding:30px 34px 60px 34px;max-width:520px;">
      <div class="panel card-pad"><div class="card-head"><h3>Boutique</h3></div>
        <div class="field"><label>Nom de la boutique</label><input id="s-shopname" value="${esc(state.settings.shopName)}"></div>
        <div class="field"><label>Emplacement</label><input id="s-location" value="${esc(state.settings.location)}"></div>
        <div class="field"><label>Seuil de stock critique</label><input id="s-lowstock" type="number" value="${state.settings.lowStockThreshold}"></div>
        <button class="btn btn-primary" id="save-settings-btn">Enregistrer</button>
      </div>
      <div class="panel card-pad" style="margin-top:16px;"><div class="card-head"><h3>Mon mot de passe</h3></div>
        <div class="field"><label>Nouveau mot de passe</label><input id="s-mypass" type="password"></div>
        <button class="btn btn-ghost" id="change-pass-btn">Changer mon mot de passe</button>
      </div>
    </div>
  </div>`;
}
function settingsHandlers(){
  const save = document.getElementById('save-settings-btn');
  if(save) save.addEventListener('click', async ()=>{
    const payload = {
      shopName: document.getElementById('s-shopname').value.trim(),
      location: document.getElementById('s-location').value.trim(),
      lowStockThreshold: Number(document.getElementById('s-lowstock').value)||5
    };
    try{ await api('PATCH', '/settings', payload); toast('Paramètres enregistrés'); await refreshAll(); }
    catch(e){ toast(e.message, true); }
  });
  const chg = document.getElementById('change-pass-btn');
  if(chg) chg.addEventListener('click', async ()=>{
    const np = document.getElementById('s-mypass').value;
    if(!np || np.length<6){ toast('Le mot de passe doit contenir au moins 6 caractères', true); return; }
    try{ await api('POST', '/auth/change-password', { newPassword: np }); toast('Mot de passe mis à jour'); document.getElementById('s-mypass').value=''; }
    catch(e){ toast(e.message, true); }
  });
}

/* ---------------- global click delegation ---------------- */
document.addEventListener('click', e=>{
  if(e.target.closest('[data-act="go-pos"]')) goTo('pos');
});

function attachScreenHandlers(screen){
  reportSummaryCache = screen === 'reports' ? reportSummaryCache : null;
  const map = {
    pos: posHandlers, inventory: inventoryHandlers, clients: clientsHandlers,
    repairs: repairsHandlers, troc: trocHandlers, suppliers: suppliersHandlers,
    expenses: expensesHandlers, reports: reportsHandlers, employees: employeesHandlers,
    settings: settingsHandlers
  };
  if(map[screen]) map[screen]();
}
