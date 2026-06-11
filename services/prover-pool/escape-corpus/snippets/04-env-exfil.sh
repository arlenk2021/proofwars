# THREAT #4: dump the environment looking for injected secrets. The worker env
# must not carry any (the launcher passes --env none equivalent).
if env | grep -iqE 'SECRET|TOKEN|PASSWORD|AWS_'; then
  echo "ESCAPE_ENV_HAS_SECRETS"
else
  echo "ENV_CLEAN_OK"
fi
