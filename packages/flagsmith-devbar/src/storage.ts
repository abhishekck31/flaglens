import type { ChaosConfig, OverrideMap, StorageLike } from "./types.ts";

export function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

export function resolveSessionStorage(custom?: StorageLike): StorageLike {
  if (custom) return custom;
  if (typeof window !== "undefined") {
    try {
      if (window.sessionStorage) {
        return window.sessionStorage;
      }
    } catch {
      // Fall back to in-memory storage if sessionStorage is restricted.
    }
  }
  return createMemoryStorage();
}

export function readOverrides(storage: StorageLike, key: string): OverrideMap {
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as OverrideMap) : {};
  } catch {
    return {};
  }
}

export function writeOverrides(storage: StorageLike, key: string, overrides: OverrideMap): void {
  if (Object.keys(overrides).length === 0) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify(overrides));
}

export function readChaos(storage: StorageLike, key: string): ChaosConfig {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { latencyMs: 0, offline503: false };
    const parsed = JSON.parse(raw) as Partial<ChaosConfig>;
    return {
      latencyMs: typeof parsed.latencyMs === "number" ? Math.max(0, Math.min(3000, parsed.latencyMs)) : 0,
      offline503: Boolean(parsed.offline503),
    };
  } catch {
    return { latencyMs: 0, offline503: false };
  }
}

export function writeChaos(storage: StorageLike, key: string, chaos: ChaosConfig): void {
  if (chaos.latencyMs === 0 && !chaos.offline503) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify(chaos));
}
