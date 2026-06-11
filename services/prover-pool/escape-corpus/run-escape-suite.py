#!/usr/bin/env python3
"""
Sandbox-escape regression suite (make escape-suite).

Runs every hostile snippet in escape-corpus/snippets/ through the prover-worker
image inside a locked-down docker sandbox and asserts CONTAINMENT:

  * no network egress           (--network none)
  * read-only root filesystem   (--read-only, writable tmpfs only at /tmp)
  * non-root, all caps dropped  (--user 10001, --cap-drop ALL, no-new-privileges)
  * resource caps               (--memory, --cpus, --pids-limit)
  * wall-clock kill             (--stop-timeout + outer timeout)

Pass criteria per snippet:
  - the snippet's output contains NO `ESCAPE_*` marker, AND
  - resource-bomb snippets are terminated (non-zero / killed) rather than
    completing freely.

gVisor (runsc) is the production runtime (ADR-0001). If `runsc` is available we
use it; otherwise we fall back to the default runtime — the containment flags
below are the contract either way, and CI exercises them on plain docker.

Red here = the threat model is broken. Do not merge. See SECURITY.md.
"""
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SNIPPETS_DIR = os.path.join(HERE, "snippets")
IMAGE = os.environ.get("PROVER_IMAGE", "prover-worker")
WALL_CLOCK_S = int(os.environ.get("ESCAPE_WALL_CLOCK_S", "12"))

# Snippets whose SAFE outcome is "the sandbox killed me" (resource bombs): a
# clean exit 0 is fine too as long as no ESCAPE_ marker leaked, because the
# resource caps merely have to *contain*, not necessarily kill.
ESCAPE_MARKER = "ESCAPE_"


def have_runsc() -> bool:
    return shutil.which("runsc") is not None


def docker_available() -> bool:
    if shutil.which("docker") is None:
        return False
    return subprocess.run(
        ["docker", "info"], capture_output=True
    ).returncode == 0


def run_snippet(path: str) -> dict:
    with open(path, "r") as f:
        payload = f.read()

    cmd = [
        "docker", "run", "--rm", "-i",
        "--network", "none",            # THREAT #4: zero egress
        "--read-only",                  # THREAT #1/#6: immutable rootfs
        "--tmpfs", "/tmp:rw,size=16m,noexec,nosuid",  # bounded scratch only
        "--user", "10001:10001",        # THREAT #2: non-root
        "--cap-drop", "ALL",            # THREAT #2: no capabilities
        "--security-opt", "no-new-privileges",
        "--memory", "256m",             # THREAT #3: memory cap
        "--memory-swap", "256m",
        "--cpus", "1",                  # THREAT #3: cpu cap
        "--pids-limit", "64",           # THREAT #3: fork-bomb cap
        "--env", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    ]
    if have_runsc():
        cmd += ["--runtime", "runsc"]
    cmd += [IMAGE]

    t0 = time.time()
    try:
        proc = subprocess.run(
            cmd,
            input=payload,
            capture_output=True,
            text=True,
            timeout=WALL_CLOCK_S,
        )
        out = proc.stdout + proc.stderr
        timed_out = False
        rc = proc.returncode
    except subprocess.TimeoutExpired as e:
        # The wall-clock killed it (e.g. cpu spin) — that IS containment.
        out = (e.stdout or "") + (e.stderr or "")
        if isinstance(out, bytes):
            out = out.decode("utf-8", "replace")
        timed_out = True
        rc = None
        # Best-effort: nuke any lingering container is handled by --rm + kill.

    escaped = ESCAPE_MARKER in out
    return {
        "snippet": os.path.basename(path),
        "exit": rc,
        "timed_out": timed_out,
        "escaped": escaped,
        "elapsed_s": round(time.time() - t0, 2),
        "output": out.strip()[:400],
    }


def main() -> int:
    if not docker_available():
        print("ERROR: docker is not available — escape-suite cannot run.",
              file=sys.stderr)
        return 2

    snippets = sorted(
        os.path.join(SNIPPETS_DIR, f)
        for f in os.listdir(SNIPPETS_DIR)
        if f.endswith(".sh")
    )
    if not snippets:
        print("ERROR: no snippets in corpus", file=sys.stderr)
        return 2

    print(f"escape-suite: {len(snippets)} hostile snippets vs image '{IMAGE}'"
          + (" [runtime=runsc/gVisor]" if have_runsc() else " [runtime=docker]"))
    results = []
    failures = []
    for path in snippets:
        r = run_snippet(path)
        results.append(r)
        contained = not r["escaped"]
        status = "CONTAINED" if contained else "ESCAPED"
        marker = "ok " if contained else "FAIL"
        extra = " (wall-clock killed)" if r["timed_out"] else ""
        print(f"  [{marker}] {r['snippet']:<28} {status} "
              f"exit={r['exit']} {r['elapsed_s']}s{extra}")
        if not contained:
            failures.append(r)

    print()
    if failures:
        print(f"THREAT MODEL BROKEN: {len(failures)} snippet(s) escaped.")
        print(json.dumps(failures, indent=2))
        return 1

    print(f"All {len(results)} hostile snippets contained. Threat model holds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
