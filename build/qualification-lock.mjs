import { mkdirSync, openSync, writeFileSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** One heavyweight local campaign at a time. Fail closed on ambiguous owners;
 * never terminate another task or silently turn contention into timing evidence. */
export function acquireQualificationLock(label, path = "artifacts/qualification.lock") {
  mkdirSync(dirname(path), { recursive: true });
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try { fd = openSync(path, "wx"); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try { owner = JSON.parse(readFileSync(path, "utf8")); }
      catch { throw new Error(`Qualification lock is unreadable: ${path}. Inspect it before removing it.`); }
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error(`Qualification lock has an invalid owner: ${path}`);
      let alive = true;
      try { process.kill(owner.pid, 0); }
      catch (probe) { if (probe.code === "ESRCH") alive = false; else throw new Error(`Cannot verify qualification lock owner ${owner.pid}`); }
      if (alive) throw new Error(`${owner.label ?? "Another campaign"} is already running (PID ${owner.pid}). Wait before starting ${label}.`);
      // Don't auto-unlink a stale receipt: two contenders could both inspect it
      // and the second could delete the first's newly acquired lock (TOCTOU).
      throw new Error(`Stale qualification lock at ${path} (PID ${owner.pid} is no longer running). Inspect and remove this receipt before retrying.`);
    }
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token, label, startedAt: new Date().toISOString() })); }
    catch (error) { closeSync(fd); unlinkSync(path); throw error; }
    closeSync(fd);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      process.removeListener("exit", release);
      try { if (JSON.parse(readFileSync(path, "utf8")).token === token) unlinkSync(path); }
      catch (error) { if (error.code !== "ENOENT") console.warn(`Could not release qualification lock: ${error.message}`); }
    };
    process.once("exit", release);
    return release;
  }
  throw new Error("Could not acquire qualification lock; retry after the other campaign exits.");
}
