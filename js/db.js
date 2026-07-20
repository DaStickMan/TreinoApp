// db.js — camada de dados local em IndexedDB.
// Princípio central: SALVAMENTO IMEDIATO. Cada série registrada é persistida
// na hora (store `sets`), então trocar de app / background / fechar o navegador
// NÃO perde progresso. "Limpar cache" não apaga IndexedDB.
//
// Stores:
//   state    (keyPath: 'key')  — pares chave/valor de estado do app.
//   sessions (keyPath: 'id')   — sessões concluídas (histórico).
//   sets     (keyPath: 'id', autoInc) — cada série individual (salvamento imediato).
//              índices: por sessionId e por exercicioNome (para histórico por exercício).

const DB = (() => {
  const DB_NAME = 'treino-calistenia';
  const DB_VERSION = 1;
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('state')) {
          db.createObjectStore('state', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sets')) {
          const s = db.createObjectStore('sets', { keyPath: 'id', autoIncrement: true });
          s.createIndex('bySession', 'sessionId', { unique: false });
          s.createIndex('byExercicio', 'exercicioNome', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function db() {
    if (_db) return _db;
    _db = await open();
    return _db;
  }

  function tx(store, mode) {
    return db().then((d) => d.transaction(store, mode).objectStore(store));
  }

  function reqPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Espera a transação inteira concluir (garante flush ao disco).
  function txDone(objectStore) {
    return new Promise((resolve, reject) => {
      const t = objectStore.transaction;
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('tx abortada'));
    });
  }

  // ---------- STATE (chave/valor) ----------
  async function getState(key, fallback = null) {
    const store = await tx('state', 'readonly');
    const row = await reqPromise(store.get(key));
    return row ? row.value : fallback;
  }

  async function setState(key, value) {
    const store = await tx('state', 'readwrite');
    store.put({ key, value });
    await txDone(store);
    return value;
  }

  // ---------- SETS (salvamento imediato de cada série) ----------
  // set = { sessionId, exercicioNome, bloco, treinoTipo, faseId, serie, valor, tipoMedida, ts }
  async function addSet(set) {
    const store = await tx('sets', 'readwrite');
    const record = { ...set, ts: set.ts || Date.now() };
    const id = await reqPromise(store.add(record));
    await txDone(store); // só resolve quando gravou de fato
    return id;
  }

  // Atualiza (ou cria) a série de um exercício numa sessão — upsert por (sessionId, exercicioNome, serie).
  async function putSet(set) {
    const store = await tx('sets', 'readwrite');
    let target = null;
    if (set.id != null) {
      target = await reqPromise(store.get(set.id));
    }
    const record = { ...(target || {}), ...set, ts: Date.now() };
    const id = await reqPromise(store.put(record));
    await txDone(store);
    return id;
  }

  async function getSetsBySession(sessionId) {
    const store = await tx('sets', 'readonly');
    const idx = store.index('bySession');
    return reqPromise(idx.getAll(sessionId));
  }

  async function getSetsByExercicio(nome) {
    const store = await tx('sets', 'readonly');
    const idx = store.index('byExercicio');
    return reqPromise(idx.getAll(nome));
  }

  async function deleteSetsBySession(sessionId) {
    const store = await tx('sets', 'readwrite');
    const idx = store.index('bySession');
    const keys = await reqPromise(idx.getAllKeys(sessionId));
    keys.forEach((k) => store.delete(k));
    await txDone(store);
  }

  // ---------- SESSIONS (histórico) ----------
  async function putSession(session) {
    const store = await tx('sessions', 'readwrite');
    store.put(session);
    await txDone(store);
    return session;
  }

  async function getSession(id) {
    const store = await tx('sessions', 'readonly');
    return reqPromise(store.get(id));
  }

  async function getAllSessions() {
    const store = await tx('sessions', 'readonly');
    const all = await reqPromise(store.getAll());
    return all.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  async function deleteSession(id) {
    await deleteSetsBySession(id);
    const store = await tx('sessions', 'readwrite');
    store.delete(id);
    await txDone(store);
  }

  // ---------- EXPORT / IMPORT (base para Etapa 8) ----------
  async function exportAll() {
    const [sessions, allSets] = await Promise.all([
      getAllSessions(),
      (async () => {
        const store = await tx('sets', 'readonly');
        return reqPromise(store.getAll());
      })(),
    ]);
    const stateStore = await tx('state', 'readonly');
    const stateRows = await reqPromise(stateStore.getAll());
    return {
      app: 'treino-calistenia',
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      state: stateRows,
      sessions,
      sets: allSets,
    };
  }

  async function importAll(data, { replace = true } = {}) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(['state', 'sessions', 'sets'], 'readwrite');
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
      const sState = t.objectStore('state');
      const sSessions = t.objectStore('sessions');
      const sSets = t.objectStore('sets');
      if (replace) { sState.clear(); sSessions.clear(); sSets.clear(); }
      (data.state || []).forEach((r) => sState.put(r));
      (data.sessions || []).forEach((r) => sSessions.put(r));
      (data.sets || []).forEach((r) => {
        const copy = { ...r };
        if (replace && copy.id != null) delete copy.id; // reindexa em replace
        sSets.put(copy);
      });
    });
  }

  async function wipe() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(['state', 'sessions', 'sets'], 'readwrite');
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
      t.objectStore('state').clear();
      t.objectStore('sessions').clear();
      t.objectStore('sets').clear();
    });
  }

  // Solicita armazenamento persistente ao navegador (reduz risco de despejo).
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return await navigator.storage.persist();
      }
    } catch (_) { /* silencioso */ }
    return false;
  }

  return {
    ready: db(),
    getState, setState,
    addSet, putSet, getSetsBySession, getSetsByExercicio, deleteSetsBySession,
    putSession, getSession, getAllSessions, deleteSession,
    exportAll, importAll, wipe, requestPersistence,
  };
})();

window.DB = DB;
