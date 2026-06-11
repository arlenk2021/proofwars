# THREAT #2: confirm we are non-root and capabilities are dropped. Try a
# privileged op (mount) — must fail.
echo "uid=$(id -u)"
if [ "$(id -u)" = "0" ]; then echo "ESCAPE_RUNNING_AS_ROOT"; fi
mount -t tmpfs none /mnt 2>/dev/null && echo "ESCAPE_MOUNT_ALLOWED" || echo "MOUNT_DENIED_OK"
