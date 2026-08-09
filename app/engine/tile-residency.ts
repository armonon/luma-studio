export type TileResidencyOptions = {
  priority?: number;
  dirty?: boolean;
  pinned?: boolean;
};

export type ResidencyEviction<T> = {
  key: string;
  value: T;
  bytes: number;
  priority: number;
};

export type ResidencyAdmission<T> = {
  accepted: boolean;
  reason?: "larger-than-budget" | "protected-working-set";
  evicted: ResidencyEviction<T>[];
};

type ResidencyRecord<T> = {
  key: string;
  value: T;
  bytes: number;
  priority: number;
  dirty: boolean;
  pinCount: number;
  lastUsed: number;
};

export type ResidencyBudgetOptions = {
  availableMemoryBytes: number;
  fraction?: number;
  reserveBytes?: number;
  minimumBytes?: number;
  maximumBytes?: number;
};

const MEBIBYTE = 1024 * 1024;

function assertByteCount(value: number, name: string, allowZero = false) {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer of at least ${minimum} bytes`);
  }
}

/** Computes a conservative, explicit tile budget without consulting browser globals. */
export function computeResidencyBudget(options: ResidencyBudgetOptions) {
  assertByteCount(options.availableMemoryBytes, "availableMemoryBytes");
  const fraction = options.fraction ?? 0.25;
  const reserveBytes = options.reserveBytes ?? 256 * MEBIBYTE;
  const minimumBytes = options.minimumBytes ?? 64 * MEBIBYTE;
  const maximumBytes = options.maximumBytes ?? 2 * 1024 * MEBIBYTE;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error("fraction must be greater than 0 and at most 1");
  }
  assertByteCount(reserveBytes, "reserveBytes", true);
  assertByteCount(minimumBytes, "minimumBytes", true);
  assertByteCount(maximumBytes, "maximumBytes");
  if (minimumBytes > maximumBytes) throw new Error("minimumBytes cannot exceed maximumBytes");
  const usable = Math.max(0, options.availableMemoryBytes - reserveBytes);
  return Math.min(maximumBytes, Math.max(minimumBytes, Math.floor(usable * fraction)));
}

/**
 * Memory-budgeted CPU/GPU tile residency. Dirty and pinned records are never
 * silently evicted; callers must persist or unpin them before retrying.
 */
export class TileResidencyCache<T> {
  private readonly records = new Map<string, ResidencyRecord<T>>();
  private budgetBytes: number;
  private residentBytes = 0;
  private clock = 0;
  private hits = 0;
  private misses = 0;
  private admissions = 0;
  private rejections = 0;
  private evictions = 0;
  private peakResidentBytes = 0;

  constructor(budgetBytes: number) {
    assertByteCount(budgetBytes, "budgetBytes");
    this.budgetBytes = budgetBytes;
  }

  has(key: string) { return this.records.has(key); }

  get(key: string) {
    const record = this.records.get(key);
    if (!record) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    record.lastUsed = ++this.clock;
    return record.value;
  }

  peek(key: string) { return this.records.get(key)?.value; }

  admit(key: string, value: T, bytes: number, options: TileResidencyOptions = {}): ResidencyAdmission<T> {
    if (!key) throw new Error("key cannot be empty");
    assertByteCount(bytes, "bytes");
    const existing = this.records.get(key);
    const incomingPriority = options.priority ?? existing?.priority ?? 0;
    if (!Number.isFinite(incomingPriority)) throw new Error("priority must be finite");
    if (bytes > this.budgetBytes) {
      this.rejections += 1;
      return { accepted: false, reason: "larger-than-budget", evicted: [] };
    }

    const required = Math.max(0, this.residentBytes - (existing?.bytes ?? 0) + bytes - this.budgetBytes);
    const selected: ResidencyRecord<T>[] = [];
    let reclaimable = 0;
    // The hot path is an admission that already fits. Avoid materializing and
    // sorting the entire resident set unless bytes genuinely need reclaiming.
    if (required > 0) {
      const candidates = [...this.records.values()]
        .filter((record) => record.key !== key && !record.dirty && record.pinCount === 0 &&
          record.priority <= incomingPriority)
        .sort((a, b) => a.priority - b.priority || a.lastUsed - b.lastUsed ||
          b.bytes - a.bytes || a.key.localeCompare(b.key));
      for (const candidate of candidates) {
        if (reclaimable >= required) break;
        selected.push(candidate);
        reclaimable += candidate.bytes;
      }
    }
    if (reclaimable < required) {
      this.rejections += 1;
      return { accepted: false, reason: "protected-working-set", evicted: [] };
    }

    const evicted = selected.map((record) => this.evictRecord(record));
    if (existing) {
      this.residentBytes -= existing.bytes;
      existing.value = value;
      existing.bytes = bytes;
      existing.priority = incomingPriority;
      existing.dirty = options.dirty ?? existing.dirty;
      if (options.pinned) existing.pinCount += 1;
      existing.lastUsed = ++this.clock;
      this.residentBytes += bytes;
    } else {
      const record: ResidencyRecord<T> = {
        key,
        value,
        bytes,
        priority: incomingPriority,
        dirty: options.dirty ?? false,
        pinCount: options.pinned ? 1 : 0,
        lastUsed: ++this.clock,
      };
      this.records.set(key, record);
      this.residentBytes += bytes;
    }
    this.admissions += 1;
    this.peakResidentBytes = Math.max(this.peakResidentBytes, this.residentBytes);
    return { accepted: true, evicted };
  }

  touch(key: string, priority?: number) {
    const record = this.require(key);
    record.lastUsed = ++this.clock;
    if (priority !== undefined) {
      if (!Number.isFinite(priority)) throw new Error("priority must be finite");
      record.priority = priority;
    }
  }

  markDirty(key: string) { this.require(key).dirty = true; }
  markPersisted(key: string) { this.require(key).dirty = false; }
  pin(key: string) { this.require(key).pinCount += 1; }

  unpin(key: string) {
    const record = this.require(key);
    if (record.pinCount === 0) throw new Error(`Tile ${key} is not pinned`);
    record.pinCount -= 1;
  }

  remove(key: string, force = false) {
    const record = this.records.get(key);
    if (!record) return null;
    if (!force && (record.dirty || record.pinCount > 0)) return null;
    return this.evictRecord(record);
  }

  setBudget(bytes: number) {
    assertByteCount(bytes, "budgetBytes");
    this.budgetBytes = bytes;
    const evicted: ResidencyEviction<T>[] = [];
    const candidates = [...this.records.values()]
      .filter((record) => !record.dirty && record.pinCount === 0)
      .sort((a, b) => a.priority - b.priority || a.lastUsed - b.lastUsed || a.key.localeCompare(b.key));
    for (const candidate of candidates) {
      if (this.residentBytes <= this.budgetBytes) break;
      evicted.push(this.evictRecord(candidate));
    }
    return { evicted, overBudgetBytes: Math.max(0, this.residentBytes - this.budgetBytes) };
  }

  entries() {
    return [...this.records.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ key, bytes, priority, dirty, pinCount, lastUsed }) => ({
        key, bytes, priority, dirty, pinCount, lastUsed,
      }));
  }

  stats() {
    let dirtyTiles = 0;
    let pinnedTiles = 0;
    for (const record of this.records.values()) {
      if (record.dirty) dirtyTiles += 1;
      if (record.pinCount > 0) pinnedTiles += 1;
    }
    return {
      budgetBytes: this.budgetBytes,
      residentBytes: this.residentBytes,
      peakResidentBytes: this.peakResidentBytes,
      overBudgetBytes: Math.max(0, this.residentBytes - this.budgetBytes),
      residentTiles: this.records.size,
      dirtyTiles,
      pinnedTiles,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses === 0 ? 0 : this.hits / (this.hits + this.misses),
      admissions: this.admissions,
      rejections: this.rejections,
      evictions: this.evictions,
    };
  }

  private require(key: string) {
    const record = this.records.get(key);
    if (!record) throw new Error(`Tile ${key} is not resident`);
    return record;
  }

  private evictRecord(record: ResidencyRecord<T>): ResidencyEviction<T> {
    this.records.delete(record.key);
    this.residentBytes -= record.bytes;
    this.evictions += 1;
    return { key: record.key, value: record.value, bytes: record.bytes, priority: record.priority };
  }
}
