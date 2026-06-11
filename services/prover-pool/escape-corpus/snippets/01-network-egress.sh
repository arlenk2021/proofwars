# THREAT #4 (data exfiltration): try to reach the network. Zero-egress sandbox
# must make this fail. We try DNS resolution and a raw TCP connect.
( wget -T 3 -q -O- http://example.com/ 2>&1 || true )
( nc -w 3 1.1.1.1 80 </dev/null 2>&1 || true )
# If we get here without having exfiltrated, containment held.
echo "NETWORK_ATTEMPT_DONE"
