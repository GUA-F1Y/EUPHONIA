/* EUPHONIA local-first persistence. All media remains in the browser's IndexedDB. */
(() => {
  'use strict';
  const DB_NAME = 'euphonia-workspace';
  const DB_VERSION = 1;
  let dbPromise;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('Browser tidak mendukung IndexedDB.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('workspace')) db.createObjectStore('workspace', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Gagal membuka penyimpanan lokal.'));
      request.onblocked = () => reject(new Error('Penyimpanan sedang dipakai tab lain. Tutup tab EUPHONIA duplikat lalu coba lagi.'));
    });
    return dbPromise;
  }

  async function requestStore(storeName, mode, operation) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try { result = operation(store); }
      catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      transaction.onerror = () => reject(transaction.error || new Error('Transaksi penyimpanan gagal.'));
      transaction.onabort = () => reject(transaction.error || new Error('Penyimpanan dibatalkan.'));
    });
  }

  function readRequest(storeName, operation) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      let request;
      try { request = operation(transaction.objectStore(storeName)); }
      catch (error) { reject(error); return; }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Gagal membaca penyimpanan lokal.'));
    }));
  }

  window.EUPHONIA_STORAGE = {
    saveAsset(record) { return requestStore('assets', 'readwrite', store => store.put(record)); },
    async keepAssets(keepIds) {
      const db = await openDB();
      const keep = new Set(keepIds || []);
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('assets', 'readwrite');
        const store = transaction.objectStore('assets');
        const request = store.getAllKeys();
        request.onsuccess = () => { for (const key of request.result) if (!keep.has(key)) store.delete(key); };
        request.onerror = () => reject(request.error || new Error('Gagal membersihkan aset lama.'));
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error || new Error('Pembersihan aset gagal.'));
        transaction.onabort = () => reject(transaction.error || new Error('Pembersihan aset dibatalkan.'));
      });
    },
    getAsset(id) { return readRequest('assets', store => store.get(id)); },
    saveWorkspace(snapshot) { return requestStore('workspace', 'readwrite', store => store.put({ ...snapshot, id: 'current' })); },
    loadWorkspace() { return readRequest('workspace', store => store.get('current')); },
    async estimate() {
      try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; }
      catch (_) { return null; }
    },
    async requestPersistence() {
      try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
      catch (_) { return false; }
    }
  };
})();