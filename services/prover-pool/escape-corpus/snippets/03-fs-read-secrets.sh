# THREAT #4: try to read files that should not exist / be reachable in-sandbox.
cat /proc/1/environ 2>/dev/null | tr '\0' '\n' | grep -i 'SECRET\|TOKEN\|KEY' && echo "ESCAPE_LEAKED_SECRET" || echo "NO_SECRETS_VISIBLE_OK"
