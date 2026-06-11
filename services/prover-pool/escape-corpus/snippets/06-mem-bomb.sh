# THREAT #3: allocate in-RAM until the memory cgroup OOM-kills us. Writing into
# an env var balloons resident memory fast (no tmpfs size escape hatch). If the
# 256m cgroup contains it, this process is killed (safe failure); if we somehow
# survive and print, that is still contained (no ESCAPE_ marker).
x="."
i=0
while [ $i -lt 40 ]; do
  x="$x$x$x$x$x$x$x$x"   # ~8x per step → blows past 256m within a few steps
  i=$((i+1))
done
echo "MEMBOMB_SURVIVED len=${#x}"
