/**
 * Warm prover-worker pool + lease manager.  REAL, testable infrastructure
 * (independent of Lean — see verifier.ts for the honest stub boundary).
 *
 * Per ADR-0002: pre-warm N long-lived workers per environment hash, lease one
 * to a match for its duration, send only the proof delta to check, and RECYCLE
 * (never reuse) a worker after any anomaly — timeout, OOM, or check error
 * spike (SECURITY threats #3 and #6, paranoid recycle policy). Exposes queue
 * depth + backpressure so the game server can show a "high traffic" banner
 * rather than silently queue (ADR-0002 consequence).
 */
import { Verifier, VerifyRequest, VerifyResult } from "./verifier.js";
import { metrics } from "./metrics.js";

export interface PoolOptions {
  envHash: string;
  /** Warm workers to keep ready. Runbook floor is 8 in prod; tests use less. */
  size: number;
  /** Wall-clock kill for a single check (SECURITY #3). */
  checkTimeoutMs?: number;
  /** Max waiters before we reject with backpressure (queue is bounded). */
  maxQueue?: number;
  /** Recycle a worker after this many checks regardless (hygiene). */
  recycleAfterChecks?: number;
  /** Factory for a fresh verifier-backed worker (one per warm slot). */
  makeVerifier: () => Verifier;
}

interface Worker {
  id: number;
  verifier: Verifier;
  checksServed: number;
  busy: boolean;
  /** Generation bumps on recycle — proves "recycled, not reused". */
  generation: number;
}

type Waiter = {
  resolve: (w: Worker) => void;
  reject: (e: Error) => void;
};

export class WorkerError extends Error {}
export class TimeoutError extends WorkerError {}
export class BackpressureError extends WorkerError {
  readonly backpressure = true;
}

let WORKER_SEQ = 0;

export class ProverPool {
  private readonly opts: Required<Omit<PoolOptions, "makeVerifier">> &
    Pick<PoolOptions, "makeVerifier">;
  private workers: Worker[] = [];
  private waiters: Waiter[] = [];
  private draining = false;

  constructor(options: PoolOptions) {
    this.opts = {
      checkTimeoutMs: 10_000,
      maxQueue: 64,
      recycleAfterChecks: 500,
      ...options,
    };
    for (let i = 0; i < this.opts.size; i++) this.workers.push(this.spawn());
    this.publishGauges();
  }

  private spawn(): Worker {
    return {
      id: WORKER_SEQ++,
      verifier: this.opts.makeVerifier(),
      checksServed: 0,
      busy: false,
      generation: 0,
    };
  }

  /** Replace a worker in-place with a fresh one (recycle, do not reuse). */
  private recycle(w: Worker, reason: string): void {
    metrics.worker_recycles_total.inc();
    const idx = this.workers.indexOf(w);
    const fresh = this.spawn();
    fresh.generation = w.generation + 1;
    if (idx >= 0) this.workers[idx] = fresh;
    void reason; // (would be logged/labelled in prod)
    this.publishGauges();
    // A freed slot may unblock a waiter.
    this.dispatch();
  }

  private publishGauges(): void {
    metrics.pool_size.set(this.workers.length);
    metrics.pool_busy.set(this.workers.filter((w) => w.busy).length);
    metrics.queue_depth.set(this.waiters.length);
  }

  /** Current backpressure signal for the game server / UI banner. */
  get queueDepth(): number {
    return this.waiters.length;
  }
  get busyCount(): number {
    return this.workers.filter((w) => w.busy).length;
  }
  get utilization(): number {
    return this.workers.length === 0 ? 0 : this.busyCount / this.workers.length;
  }

  private idle(): Worker | undefined {
    return this.workers.find((w) => !w.busy);
  }

  /** Hand a freed worker to the next waiter, if any. */
  private dispatch(): void {
    while (this.waiters.length > 0) {
      const w = this.idle();
      if (!w) break;
      const waiter = this.waiters.shift()!;
      w.busy = true;
      this.publishGauges();
      waiter.resolve(w);
    }
    this.publishGauges();
  }

  /** Acquire a worker lease. Rejects with backpressure if the queue is full. */
  private acquire(): Promise<Worker> {
    if (this.draining) return Promise.reject(new WorkerError("pool draining"));
    const free = this.idle();
    if (free) {
      free.busy = true;
      metrics.leases_granted_total.inc();
      this.publishGauges();
      return Promise.resolve(free);
    }
    if (this.waiters.length >= this.opts.maxQueue) {
      metrics.leases_rejected_total.inc();
      return Promise.reject(
        new BackpressureError("pool saturated — high traffic"),
      );
    }
    return new Promise<Worker>((resolve, reject) => {
      this.waiters.push({
        resolve: (w) => {
          metrics.leases_granted_total.inc();
          resolve(w);
        },
        reject,
      });
      this.publishGauges();
    });
  }

  private release(w: Worker): void {
    w.busy = false;
    this.publishGauges();
    this.dispatch();
  }

  /**
   * Lease a worker, run one check under a wall-clock timeout, release or
   * recycle, and return the result. This is the single public entry point a
   * match uses. Server-authoritative: the caller cannot influence validity.
   */
  async check(req: VerifyRequest): Promise<VerifyResult> {
    const w = await this.acquire();
    try {
      const result = await this.withTimeout(
        w.verifier.verify(req),
        this.opts.checkTimeoutMs,
      );
      metrics.checks_total.inc();
      w.checksServed++;
      if (w.checksServed >= this.opts.recycleAfterChecks) {
        this.recycle(w, "hygiene-quota");
      } else {
        this.release(w);
      }
      return result;
    } catch (err) {
      // Any anomaly → recycle the worker, never reuse it (SECURITY #3/#6).
      this.recycle(w, err instanceof TimeoutError ? "timeout" : "anomaly");
      throw err;
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new TimeoutError(`check exceeded ${ms}ms`)),
        ms,
      );
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e instanceof Error ? e : new WorkerError(String(e)));
        },
      );
    });
  }

  /** Test/observability hook: snapshot of worker generations. */
  generations(): number[] {
    return this.workers.map((w) => w.generation);
  }

  async drain(): Promise<void> {
    this.draining = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(new WorkerError("pool draining"));
    }
    this.publishGauges();
  }
}
