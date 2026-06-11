/**
 * Minimal Prometheus-style counters/gauges. No deps — just enough to expose
 * the metrics the runbook and README reference (worker_recycles_total etc.)
 * via a /metrics text exposition.
 */
class Counter {
  private value = 0;
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(by = 1) {
    this.value += by;
  }
  get(): number {
    return this.value;
  }
}

class Gauge {
  private value = 0;
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  set(v: number) {
    this.value = v;
  }
  get(): number {
    return this.value;
  }
}

export const metrics = {
  worker_recycles_total: new Counter(
    "worker_recycles_total",
    "Workers recycled after anomaly/timeout/OOM",
  ),
  leases_granted_total: new Counter(
    "leases_granted_total",
    "Leases successfully granted",
  ),
  leases_rejected_total: new Counter(
    "leases_rejected_total",
    "Leases rejected by backpressure (pool saturated)",
  ),
  checks_total: new Counter("checks_total", "Proof checks executed"),
  pool_size: new Gauge("pool_size", "Total workers in the pool"),
  pool_busy: new Gauge("pool_busy", "Workers currently leased"),
  queue_depth: new Gauge("queue_depth", "Pending lease waiters"),
};

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const m of Object.values(metrics)) {
    const type = m instanceof Counter ? "counter" : "gauge";
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${type}`);
    lines.push(`${m.name} ${m.get()}`);
  }
  return lines.join("\n") + "\n";
}
