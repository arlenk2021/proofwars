# Sandboxed prover-worker image.
#
# HONEST BOUNDARY: in production this image bakes a frozen mathlib .olean cache
# and runs a Lean LSP under gVisor (runsc) — see ADR-0001. Lean is NOT installed
# here. What this image proves is the CONTAINMENT layer: an untrusted payload
# (the stand-in for a hostile Lean tactic script) is executed by the worker
# entrypoint inside a locked-down sandbox. The escape-suite (make escape-suite)
# runs every snippet in escape-corpus/ through this image with no network,
# dropped caps, read-only rootfs, and cpu/mem/pids limits — and asserts none
# escape. gVisor is the production runtime; `docker run --runtime=runsc` is the
# drop-in there; plain `docker run` is the available local stand-in for the
# same containment contract.
FROM alpine:3.20

# A non-root user; the worker never runs as root (SECURITY #2).
RUN adduser -D -u 10001 prover

# The "worker" runtime reads an untrusted payload on stdin and attempts to
# execute it — exactly as a Lean worker would elaborate an untrusted tactic.
COPY worker-entrypoint.sh /usr/local/bin/worker-entrypoint.sh
RUN chmod 0555 /usr/local/bin/worker-entrypoint.sh

USER prover
WORKDIR /home/prover
ENTRYPOINT ["/usr/local/bin/worker-entrypoint.sh"]
