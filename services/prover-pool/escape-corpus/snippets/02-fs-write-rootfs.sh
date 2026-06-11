# THREAT #1/#6: try to write to the (read-only) root filesystem.
if echo pwned > /etc/proofwars_pwned 2>/dev/null; then
  echo "ESCAPE_ROOTFS_WRITABLE"
else
  echo "ROOTFS_READONLY_OK"
fi
