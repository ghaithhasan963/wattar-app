#!/usr/bin/env bash
# Runs ./gradlew in the current directory and retries when the Gradle plugin
# portal or a Maven repository fails to answer. The portal intermittently
# returns 429/5xx, which Gradle reports as
#   "Plugin [id: ...] was not found in any of the following sources"
# even though the plugin exists. A real build or test failure is never retried.
#
# Usage: bash scripts/gradle-with-retry.sh <gradle args...>
# Env:   GRADLE_ATTEMPTS (default 3), GRADLE_RETRY_DELAY (seconds, default 30)

set -uo pipefail

attempts="${GRADLE_ATTEMPTS:-3}"
delay="${GRADLE_RETRY_DELAY:-30}"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

is_download_failure() {
  grep -Eqi \
    -e 'could not resolve plugin artifact' \
    -e 'was not found in any of the following sources' \
    -e 'could not (resolve|get|head|download)' \
    -e 'status code 429' \
    -e 'too many requests' \
    -e 'connection (reset|refused)' \
    -e '(read|connect) timed out' \
    "$1"
}

attempt=1
while :; do
  bash ./gradlew "$@" 2>&1 | tee "$log"
  status="${PIPESTATUS[0]}"

  if [ "$status" -eq 0 ]; then
    exit 0
  fi

  if [ "$attempt" -ge "$attempts" ] || ! is_download_failure "$log"; then
    exit "$status"
  fi

  attempt=$((attempt + 1))
  echo "::warning::Gradle could not download a plugin or dependency; retrying in ${delay}s (attempt ${attempt}/${attempts})."
  sleep "$delay"
  delay=$((delay * 2))
done
