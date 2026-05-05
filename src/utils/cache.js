class ReportCache {
  constructor() {
    this.store = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 5 minutes
  }

  generateKey(prefix, params) {
    return prefix + ':' + JSON.stringify(params || {});
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.data;
  }

  set(key, data, ttlMs = this.defaultTTL) {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  invalidate(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear() {
    this.store.clear();
  }
}

export const reportCache = new ReportCache();
