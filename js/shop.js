/* ---------------------------------------------------------------------
   Applied Concepts — Shop
   360°-productviewer (fotoreeks, sleep om te draaien + auto-rotatie) en
   een WhatsApp-bestelformulier (wa.me deep link — geen eigen server nodig,
   de klant verstuurt het vooringevulde bericht zelf in WhatsApp).
--------------------------------------------------------------------- */

const SHOP_FRAMES = Array.from({length:56}, (_,i) => `assets/shop/custom-grip-360-nobg/frame-${String(i+1).padStart(2,'0')}.png`);

const SHOP_WHATSAPP_NUMBER = '31657302106'; // 0657302106 in internationaal formaat, zonder + of voorloopnul — het definitieve nummer, ter vervanging van het testnummer

let acShopInited = false;
let acShopRotate = { frame: 0, dir: 1, dragging: false, dragStartX: 0, dragStartFrame: 0, rafId: null, lastTs: null, ready: false };

// Milliseconds per frame-step during auto-rotate. Driven by requestAnimationFrame
// with a real elapsed-time check (instead of setInterval) so playback doesn't
// drift or stutter when the tab is busy — a dropped tick just catches up on the
// next paint rather than firing a burst of steps.
const SHOP_ROTATE_STEP_MS = 70;

function acShopFmtFrame(i){
  const total = SHOP_FRAMES.length;
  const idx = ((i % total) + total) % total;
  return SHOP_FRAMES[idx];
}

function acShopShowFrame(){
  const img = document.getElementById('shopViewerImg');
  if(!img || SHOP_FRAMES.length === 0) return;
  img.src = acShopFmtFrame(acShopRotate.frame);
}

function acShopNormalizeFrame(){
  // Dragging can push acShopRotate.frame outside [0, total-1] (it only wraps
  // visually via the modulo in acShopFmtFrame). Fold it back into range before
  // auto-rotate resumes, otherwise the first bounce-clamp would snap the frame
  // and read as a jump/restart.
  const total = SHOP_FRAMES.length;
  acShopRotate.frame = ((acShopRotate.frame % total) + total) % total;
}

function acShopAutoStep(ts){
  if(acShopRotate.lastTs == null) acShopRotate.lastTs = ts;
  const elapsed = ts - acShopRotate.lastTs;
  if(elapsed >= SHOP_ROTATE_STEP_MS){
    acShopRotate.lastTs = ts;
    const total = SHOP_FRAMES.length;
    let next = acShopRotate.frame + acShopRotate.dir;
    // Bounce instead of wrapping: the 56 hand-shot photos don't line back up
    // perfectly at the seam, so wrapping 56→1 reads as a jarring restart.
    // Reversing direction at the ends keeps the motion visually continuous.
    if(next >= total - 1){ next = total - 1; acShopRotate.dir = -1; }
    else if(next <= 0){ next = 0; acShopRotate.dir = 1; }
    acShopRotate.frame = next;
    acShopShowFrame();
  }
  acShopRotate.rafId = requestAnimationFrame(acShopAutoStep);
}

function acShopStartAutoRotate(){
  if(acShopRotate.rafId != null || SHOP_FRAMES.length === 0) return;
  acShopRotate.lastTs = null;
  acShopRotate.rafId = requestAnimationFrame(acShopAutoStep);
}

function acShopStopAutoRotate(){
  if(acShopRotate.rafId != null){ cancelAnimationFrame(acShopRotate.rafId); acShopRotate.rafId = null; }
}

function acShopScheduleResume(){
  // Resume immediately (no idle pause) so the rotation reads as one
  // continuous motion rather than stopping and restarting after a drag.
  acShopNormalizeFrame();
  acShopStartAutoRotate();
}

function acShopPreloadAll(){
  // Wait for every frame to be downloaded *and* decoded before auto-rotate
  // starts, otherwise the first lap stutters on whichever frames are still
  // loading when the interval reaches them.
  return Promise.all(SHOP_FRAMES.map(src => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { if(img.decode) img.decode().then(resolve, resolve); else resolve(); };
    img.onerror = resolve;
    img.src = src;
  })));
}

function acShopInitViewer(){
  const viewer = document.getElementById('shopViewer');
  const img = document.getElementById('shopViewerImg');
  const placeholder = document.getElementById('shopViewerPlaceholder');
  if(!viewer) return;

  if(SHOP_FRAMES.length === 0){
    // No photo sequence yet — keep the placeholder visible, nothing to rotate.
    if(placeholder) placeholder.hidden = false;
    if(img) img.hidden = true;
    return;
  }
  if(placeholder) placeholder.hidden = true;
  if(img) img.hidden = false;
  acShopShowFrame();

  // Auto-rotate only starts once every frame is downloaded and decoded, so
  // the first lap plays at a steady pace instead of stuttering on whichever
  // frame is still loading when the animation reaches it.
  acShopPreloadAll().then(()=>{
    acShopRotate.ready = true;
    if(!acShopRotate.dragging) acShopStartAutoRotate();
  });

  const onDown = (clientX) => {
    acShopRotate.dragging = true;
    acShopRotate.dragStartX = clientX;
    acShopRotate.dragStartFrame = acShopRotate.frame;
    acShopStopAutoRotate();
  };
  const onMove = (clientX) => {
    if(!acShopRotate.dragging) return;
    const dx = clientX - acShopRotate.dragStartX;
    const framesMoved = Math.round(dx / 6); // ~6px per frame-step, feels natural for 24-36 frames
    acShopRotate.frame = acShopRotate.dragStartFrame - framesMoved;
    acShopShowFrame();
  };
  const onUp = () => {
    if(!acShopRotate.dragging) return;
    acShopRotate.dragging = false;
    acShopScheduleResume();
  };

  viewer.addEventListener('mousedown', (e)=>{ onDown(e.clientX); e.preventDefault(); });
  window.addEventListener('mousemove', (e)=>onMove(e.clientX));
  window.addEventListener('mouseup', onUp);

  viewer.addEventListener('touchstart', (e)=>onDown(e.touches[0].clientX), {passive:true});
  viewer.addEventListener('touchmove', (e)=>onMove(e.touches[0].clientX), {passive:true});
  viewer.addEventListener('touchend', onUp);

  viewer.style.cursor = 'grab';
}

function acShopInitOrderForm(){
  const orderBtn = document.getElementById('shopOrderBtn');
  if(!orderBtn) return;

  // No 06-nummer field: WhatsApp already reveals the sender's own number
  // the moment they open the chat, so asking for it again here was a
  // redundant extra step before the send.
  orderBtn.addEventListener('click', ()=>{
    const message = 'Bestelling Custom AR Grip\nHoi, ik wil graag een Custom AR Grip bestellen.';
    const url = `https://wa.me/${SHOP_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener');
  });
}

function acShopInitStayUp(){
  const btn = document.getElementById('shopStayUpBtn');
  if(!btn) return;
  btn.addEventListener('click', ()=>{
    const message = 'Hoi, hou me op de hoogte van nieuwe Applied Concepts items via WhatsApp.';
    const url = `https://wa.me/${SHOP_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener');
  });
}

// Shop is the only tab with more than one "page" — a plain view switch
// inside the tabpanel (show one .shop-view, hide the rest) rather than a
// real router, since it's just this one browse -> detail -> science flow.
// Scrolls the panel back to top on every switch so it reads as a real
// page change instead of jumping to wherever the old scroll position was.
function acShopShowView(name){
  document.querySelectorAll('.shop-view').forEach(el=>{
    el.classList.toggle('active', el.id === `shopView${name}`);
  });
  const panel = document.getElementById('panel-shop');
  if(panel) panel.scrollTop = 0;
}

// Resets to the landing view every time the Shop tab is (re-)opened, so
// leaving mid-flow and coming back doesn't strand you on the detail or
// science page.
function acShopResetView(){
  acShopShowView('Landing');
}

function acShopInitNav(){
  const buildBtn = document.getElementById('shopBuildBtn');
  if(buildBtn) buildBtn.addEventListener('click', ()=>acShopShowView('Detail'));

  const detailBack = document.getElementById('shopDetailBack');
  if(detailBack) detailBack.addEventListener('click', ()=>acShopShowView('Landing'));
}

// "De techniek" starts collapsed on the product page — the CSS expand/
// collapse is driven purely by the button's own aria-expanded attribute
// (see .shop-science-toggle[aria-expanded="true"] + .shop-science-body in
// css/styles.css), so toggling it here is the only JS this needs.
function acShopInitScienceToggle(){
  const toggle = document.getElementById('shopScienceToggle');
  if(!toggle) return;
  toggle.addEventListener('click', ()=>{
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
  });
}

function initShop(){
  if(acShopInited) return;
  acShopInited = true;
  acShopInitViewer();
  acShopInitNav();
  acShopInitScienceToggle();
  acShopInitOrderForm();
  acShopInitStayUp();
}

window.AppliedConceptsShop = { init: initShop, resetView: acShopResetView };
