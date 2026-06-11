# THREAT #3: pids-limit must contain a fork bomb. Classic :(){ :|:& };:
# We bound total time so a misconfigured host can't hang the suite; the
# --pids-limit makes fork() start failing almost immediately.
bomb() { bomb | bomb & }
( bomb ) 2>/dev/null
# Give it a moment to hit the pids ceiling, then report. If the cap works,
# we reach this line; if not, the host would be saturated.
sleep 2
echo "FORKBOMB_ATTEMPT_DONE"
