#!/bin/sh
# Untrusted-payload worker entrypoint (stand-in for the Lean elaborator).
#
# It reads a hostile payload from stdin and EXECUTES it inside the sandbox.
# The whole point of the escape-suite is that this script runs attacker-
# controlled code, and the container's restrictions (no network, dropped caps,
# read-only fs, cpu/mem/pids limits, timeout) contain it anyway. If a payload
# manages to do something it must not (write outside /tmp tmpfs, open a socket,
# read another tenant's data, fork-bomb the host), the threat model is broken.
#
# Contract: exit 0 means "payload completed within the sandbox" (containment is
# proven by the OUTSIDE restrictions, not by this script refusing anything).
# The escape-suite inspects stdout/exit semantics per snippet.
set -u
payload="$(cat)"
# Execute the untrusted payload. We do NOT sanitize it — containment is the
# sandbox's job, and that is exactly what we are testing.
sh -c "$payload"
exit $?
