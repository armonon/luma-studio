export class ResidentMemoryLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResidentMemoryLimitError";
  }
}

type RecordEntry = {
  owner: WeakRef<object>;
  label: string;
  bytes: number;
};

export type ResidentMemoryAccount = {
  active(): boolean;
  assertCapacity(bytes: number): void;
  resize(bytes: number): void;
  release(): void;
};

function assertBytes(bytes: number, label: string) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

/**
 * One process-level admission ceiling shared by otherwise independent sparse
 * surfaces. Weak ownership prevents closed documents or discarded history
 * surfaces from being retained merely because they were once registered.
 */
export class ResidentMemoryBudget {
  private readonly records = new Map<symbol, RecordEntry>();
  private readonly ownerTokens = new WeakMap<object, symbol>();
  private residentBytes = 0;
  private peakResidentBytes = 0;
  private rejectedAdmissions = 0;
  private readonly finalizer = typeof FinalizationRegistry === "undefined"
    ? null
    : new FinalizationRegistry<symbol>((token) => this.releaseToken(token));

  constructor(readonly ceilingBytes: number) {
    assertBytes(ceilingBytes, "ceilingBytes");
    if (ceilingBytes === 0) throw new Error("ceilingBytes must be greater than zero");
  }

  register(owner: object, label: string, initialBytes = 0): ResidentMemoryAccount {
    assertBytes(initialBytes, "initialBytes");
    const existing = this.ownerTokens.get(owner);
    const token = existing && this.records.has(existing) ? existing : Symbol(label);
    if (!existing || !this.records.has(token)) {
      this.ownerTokens.set(owner, token);
      this.finalizer?.unregister(owner);
      this.records.set(token, { owner: new WeakRef(owner), label, bytes: initialBytes });
      this.residentBytes += initialBytes;
      this.peakResidentBytes = Math.max(this.peakResidentBytes, this.residentBytes);
      this.finalizer?.register(owner, token, owner);
    } else {
      this.resizeToken(token, initialBytes, true);
    }
    let released = false;
    return {
      active: () => !released && this.records.has(token),
      assertCapacity: (bytes) => {
        assertBytes(bytes, "resident bytes");
        const record = this.records.get(token);
        if (released || !record) throw new Error(`Resident-memory account ${label} has been released`);
        this.sweep();
        if (bytes > record.bytes && this.residentBytes - record.bytes + bytes > this.ceilingBytes) {
          this.rejectedAdmissions += 1;
          throw new ResidentMemoryLimitError("The edit exceeds the shared resident pixel memory ceiling");
        }
      },
      resize: (bytes) => {
        if (released) throw new Error(`Resident-memory account ${label} has been released`);
        this.resizeToken(token, bytes, false);
      },
      release: () => {
        if (released) return;
        released = true;
        if (this.ownerTokens.get(owner) === token) this.finalizer?.unregister(owner);
        this.releaseToken(token);
      },
    };
  }

  stats() {
    this.sweep();
    return {
      ceilingBytes: this.ceilingBytes,
      residentBytes: this.residentBytes,
      peakResidentBytes: this.peakResidentBytes,
      overBudgetBytes: Math.max(0, this.residentBytes - this.ceilingBytes),
      surfaces: this.records.size,
      rejectedAdmissions: this.rejectedAdmissions,
    };
  }

  /**
   * Release every account whose owner is not in `live` (or already collected).
   *
   * Admission is synchronous but reclamation was GC-deferred: unbindMemoryBudget
   * existed and was called from nowhere, so every surface replaced by a crop,
   * resize or re-sync stayed charged until a finalizer happened to run. The
   * budget then rejected work against memory that was not live — a spurious
   * ResidentMemoryLimitError on an unrelated later edit.
   *
   * The callers that replace surfaces are scattered and easy to miss one of, so
   * reconciliation happens against the document's live set instead: whatever is
   * bound is charged, and nothing else is.
   */
  retainOnly(live: ReadonlySet<object>) {
    for (const [token, record] of this.records) {
      const owner = record.owner.deref();
      if (!owner || !live.has(owner)) this.releaseToken(token);
    }
  }

  private resizeToken(token: symbol, bytes: number, registering: boolean) {
    assertBytes(bytes, "resident bytes");
    const record = this.records.get(token);
    if (!record) throw new Error("Resident-memory account is no longer registered");
    let nextTotal = this.residentBytes - record.bytes + bytes;
    // Reclaim anything already collected before refusing: rejecting against
    // memory that is merely awaiting a finalizer turns a routine edit into a
    // hard error.
    if (!registering && bytes > record.bytes && nextTotal > this.ceilingBytes) {
      this.sweep();
      nextTotal = this.residentBytes - record.bytes + bytes;
    }
    // An imported/pre-existing document may already exceed the preferred
    // ceiling. Register it honestly, but reject every subsequent increase;
    // decreases remain available so the user can close or simplify it.
    if (!registering && bytes > record.bytes && nextTotal > this.ceilingBytes) {
      this.rejectedAdmissions += 1;
      throw new ResidentMemoryLimitError(
        `Resident pixel memory would reach ${Math.ceil(nextTotal / 1024 / 1024)} MB; the application ceiling is ${Math.floor(this.ceilingBytes / 1024 / 1024)} MB`,
      );
    }
    record.bytes = bytes;
    this.residentBytes = nextTotal;
    this.peakResidentBytes = Math.max(this.peakResidentBytes, this.residentBytes);
  }

  private releaseToken(token: symbol) {
    const record = this.records.get(token);
    if (!record) return;
    this.records.delete(token);
    this.residentBytes -= record.bytes;
  }

  private sweep() {
    for (const [token, record] of this.records) {
      if (!record.owner.deref()) this.releaseToken(token);
    }
  }
}
