/* =====================================================
   PAWS FOR PEACE — Firebase Configuration
   =====================================================
   DEV_BYPASS = true  → No Firebase needed for the database.
                         Google sign-in shows a mock user.
                         All data is saved in localStorage.

   DEV_BYPASS = false → Real Firebase mode. Fill in your
                         firebaseConfig below.

   Admin login always uses the USERNAME / PASSWORD below
   (independent of Firebase — works on GitHub Pages).
   ===================================================== */

const DEV_BYPASS = true;   // ← Set to false once Firebase is ready

/* ─── ADMIN CREDENTIALS ─────────────────────────────
   Username + password for the /admin.html login form.
   Change these if you ever need to update them.
   ─────────────────────────────────────────────────── */
const ADMIN_USERNAME = "Pawforpeace";
const ADMIN_PASSWORD = "Verso@111";

/* ─── FIREBASE ADMIN EMAILS ─────────────────────────
   Only used in real Firebase mode (DEV_BYPASS = false)
   ─────────────────────────────────────────────────── */
const ADMIN_EMAILS = [
  "your-admin@gmail.com"   // ← replace with your email
];

/* ─── ADMIN SESSION HELPERS ─────────────────────────
   Keeps the admin logged in across page refreshes
   using sessionStorage (cleared when tab is closed).
   ─────────────────────────────────────────────────── */
function checkAdminCredentials(u, p) {
  return u === ADMIN_USERNAME && p === ADMIN_PASSWORD;
}
function setAdminSession()   { sessionStorage.setItem('pfp_admin_ok', '1'); }
function clearAdminSession() { sessionStorage.removeItem('pfp_admin_ok'); }
function hasAdminSession()   { return sessionStorage.getItem('pfp_admin_ok') === '1'; }

/* ─── SITE DEFAULTS ─────────────────────────────────
   Shown before Firestore content loads
   ─────────────────────────────────────────────────── */
const SITE = {
  name:       "Paws for Peace",
  tagline:    "Every paw deserves a loving home.",
  instagram:  "https://www.instagram.com/adoptme.bkk",
  phone:      "+66 XX-XXX-XXXX",
  address:    "Bangkok, Thailand",
  mapsEmbed:  "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d496049.7800967068!2d100.40479855!3d13.7248936!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x311d6032280d61f3%3A0x10100b25de24820!2sBangkok!5e0!3m2!1sen!2sth!4v1700000000000"
};

/* ─── REAL FIREBASE CONFIG ──────────────────────────
   Only used when DEV_BYPASS = false
   ─────────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY_HERE",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

/* ════════════════════════════════════════════════════
   BYPASS MODE — localStorage-backed mock database
   ════════════════════════════════════════════════════ */

let currentUser = null;
let db, auth, storage, googleProvider;

/* Declared here so they're always global regardless of which branch runs */
var signInGoogle;
var signOutUser;

if (DEV_BYPASS) {

  /* ── Shim so firebase.firestore.FieldValue.serverTimestamp() works ── */
  window.firebase = window.firebase || {};
  window.firebase.firestore = window.firebase.firestore || {};
  window.firebase.firestore.FieldValue = {
    serverTimestamp: () => ({ _isMockTimestamp: true, _date: new Date() })
  };

  /* ── Helper: read/write localStorage ── */
  const LS_PREFIX = 'pawsforpeace_';
  const _col_listeners = {};

  function lsGet(col) {
    try { return JSON.parse(localStorage.getItem(LS_PREFIX + col) || '{}'); }
    catch(e) { return {}; }
  }

  function lsSave(col, data) {
    localStorage.setItem(LS_PREFIX + col, JSON.stringify(data));
    (_col_listeners[col] || []).forEach(fn => fn());
  }

  /* ── Mock Firestore ── */
  db = {
    collection(col) {
      return {
        /* doc(id) or doc() for auto-id */
        doc(id) {
          const docId = id || ('doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
          return {
            id: docId,
            get() {
              const all  = lsGet(col);
              const item = all[docId];
              return Promise.resolve({
                exists: !!item,
                id: docId,
                data() { return item ? { ...item } : {}; }
              });
            },
            set(newData, opts) {
              const all = lsGet(col);
              all[docId] = (opts && opts.merge)
                ? { ...(all[docId] || {}), ...sanitise(newData), id: docId }
                : { ...sanitise(newData), id: docId };
              lsSave(col, all);
              return Promise.resolve({ id: docId });
            },
            update(newData) {
              const all = lsGet(col);
              all[docId] = { ...(all[docId] || {}), ...sanitise(newData) };
              lsSave(col, all);
              return Promise.resolve();
            },
            delete() {
              const all = lsGet(col);
              delete all[docId];
              lsSave(col, all);
              return Promise.resolve();
            }
          };
        },

        /* add() — auto-generate ID */
        add(newData) {
          const id  = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
          const all = lsGet(col);
          all[id]   = { ...sanitise(newData), id };
          lsSave(col, all);
          return Promise.resolve({ id });
        },

        /* orderBy(field, dir).onSnapshot(cb) */
        orderBy(field, dir = 'desc') {
          return {
            onSnapshot(cb, errCb) {
              function notify() {
                const all  = lsGet(col);
                const docs = Object.values(all).map(item => ({
                  id: item.id || 'unknown',
                  data() { return { ...item }; }
                }));
                /* sort by field */
                docs.sort((a, b) => {
                  let av = a.data()[field], bv = b.data()[field];
                  /* handle mock timestamps — _date may be a Date OR an ISO string after JSON roundtrip */
                  if (av && av._isMockTimestamp) av = new Date(av._date).getTime() || 0;
                  else if (av instanceof Date)    av = av.getTime();
                  else                             av = Number(av) || 0;
                  if (bv && bv._isMockTimestamp) bv = new Date(bv._date).getTime() || 0;
                  else if (bv instanceof Date)    bv = bv.getTime();
                  else                             bv = Number(bv) || 0;
                  return dir === 'asc' ? av - bv : bv - av;
                });
                cb({ docs });
              }

              notify();
              if (!_col_listeners[col]) _col_listeners[col] = [];
              _col_listeners[col].push(notify);
              /* return unsubscribe fn */
              return () => {
                _col_listeners[col] = _col_listeners[col].filter(fn => fn !== notify);
              };
            }
          };
        }
      };
    }
  };

  /* ── Mock Storage ──────────────────────────────────────────────────
     Images  → converted to base64 data URLs via FileReader so they
               survive localStorage round-trips and page reloads.
     Videos  → kept as temporary blob URLs (too large for base64/localStorage).
     ─────────────────────────────────────────────────────────────── */
  storage = {
    ref(path) {
      return {
        put(file) {
          const isVideo = file.type.startsWith('video/');

          /* Build a promise that resolves to a persistent URL */
          const urlPromise = isVideo
            ? Promise.resolve(URL.createObjectURL(file))           // temp blob for video
            : new Promise((resolve, reject) => {                   // base64 for images
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);   // "data:image/...;base64,..."
                reader.onerror  = () => reject(new Error('FileReader failed'));
                reader.readAsDataURL(file);
              });

          const task = {
            /* snapshot starts with a getDownloadURL that waits for the read to finish */
            snapshot: { ref: { getDownloadURL: () => urlPromise } },

            on(evt, progressCb, errorCb, successCb) {
              const self = this;
              /* simulate upload progress ticks */
              let pct = 0;
              const tick = setInterval(() => {
                pct = Math.min(pct + 30, 90);
                if (progressCb) progressCb({ bytesTransferred: pct, totalBytes: 100 });
              }, 100);

              urlPromise
                .then(url => {
                  clearInterval(tick);
                  if (progressCb) progressCb({ bytesTransferred: 100, totalBytes: 100 });
                  /* update snapshot so uploadFile can call getDownloadURL() */
                  self.snapshot = { ref: { getDownloadURL: () => Promise.resolve(url) } };
                  if (successCb) successCb();
                })
                .catch(err => {
                  clearInterval(tick);
                  if (errorCb) errorCb(err);
                });
            }
          };

          return task;
        }
      };
    }
  };

  /* ── Mock regular user (Google sign-in in DEV mode) ── */
  const MOCK_USER = {
    uid:         'dev-user-001',
    displayName: 'Test User',
    email:       'testuser@example.com',
    photoURL:    'https://ui-avatars.com/api/?name=Test+User&background=4A3728&color=fff&bold=true'
  };

  /* Notify pages once they've loaded their onAuthUpdate function */
  setTimeout(() => {
    if (typeof onAuthUpdate === 'function') onAuthUpdate(null);
  }, 0);

  /* ── Auth helpers (bypass versions) ── */
  signInGoogle = function() {
    currentUser = MOCK_USER;
    setTimeout(() => {
      if (typeof onAuthUpdate === 'function') onAuthUpdate(MOCK_USER);
    }, 0);
    return Promise.resolve({ user: MOCK_USER });
  };

  signOutUser = function() {
    currentUser = null;
    setTimeout(() => {
      if (typeof onAuthUpdate === 'function') onAuthUpdate(null);
    }, 0);
    return Promise.resolve();
  };

  /* ── sanitise: always store _date as an ISO string so JSON roundtrip is safe ── */
  function sanitise(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && v._isMockTimestamp) {
        /* convert _date to ISO string regardless of whether it's a Date or already a string */
        out[k] = { _isMockTimestamp: true, _date: new Date(v._date).toISOString() };
      } else if (v instanceof Date) {
        /* bare Date objects — store the same way */
        out[k] = { _isMockTimestamp: true, _date: v.toISOString() };
      } else {
        out[k] = v;
      }
    }
    return out;
  }

} else {

  /* ════════════════════════════════════════════════════
     REAL FIREBASE MODE
     ════════════════════════════════════════════════════ */
  firebase.initializeApp(firebaseConfig);

  db             = firebase.firestore();
  auth           = firebase.auth();
  storage        = firebase.storage();
  googleProvider = new firebase.auth.GoogleAuthProvider();

  auth.onAuthStateChanged(user => {
    currentUser = user;
    if (typeof onAuthUpdate === 'function') onAuthUpdate(user);
  });

  signInGoogle = function() { return auth.signInWithPopup(googleProvider); };
  signOutUser  = function() { return auth.signOut(); };

}

/* ════════ SHARED HELPERS (work in both modes) ════════ */

function isAdmin(user) {
  /* username/password admin session takes priority over everything */
  if (hasAdminSession()) return true;
  if (!user) return false;
  return ADMIN_EMAILS.includes(user.email);
}

function showToast(message, type = 'success') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 3500);
}

function formatDate(val) {
  if (!val) return '—';
  let d;
  if (val._isMockTimestamp)  d = new Date(val._date);
  else if (val.toDate)       d = val.toDate();
  else                        d = new Date(val);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function uploadFile(file, path, onProgress) {
  return new Promise((resolve, reject) => {
    const ref  = storage.ref(path);
    const task = ref.put(file);
    task.on('state_changed',
      snap => { if (onProgress) onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)); },
      err  => reject(err),
      ()   => task.snapshot.ref.getDownloadURL().then(resolve).catch(reject)
    );
  });
}
