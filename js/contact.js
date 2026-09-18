/* ---------------------------------------------------------------------
   Applied Concepts — Contact
   Static tab: one e-mail address, a mailto link and a copy-to-clipboard
   button. No form, no backend — this app has neither.
--------------------------------------------------------------------- */

const CONTACT_EMAIL = 'info.appliedconcepts@icloud.com';

let acContactInited = false;

function acContactCopyEmail(){
  const hint = document.getElementById('contactCopyHint');
  const done = (ok) => {
    hint.textContent = ok ? 'Gekopieerd naar klembord.' : 'Kopiëren niet gelukt — selecteer en kopieer het adres handmatig.';
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(CONTACT_EMAIL).then(()=>done(true), ()=>done(false));
  } else {
    done(false);
  }
}

function initContact(){
  if(acContactInited) return;
  acContactInited = true;
  const btn = document.getElementById('contactCopyBtn');
  if(!btn) return;
  btn.addEventListener('click', acContactCopyEmail);
}

window.AppliedConceptsContact = { init: initContact };
