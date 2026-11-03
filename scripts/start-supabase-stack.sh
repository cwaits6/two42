#!/usr/bin/env bash
# Starts the e2e job's ephemeral Supabase stack, retrying once if a host port
# is taken. Arguments pass through to `supabase start`. CI only: the stop below
# would take down the shared local stack.
set -euo pipefail

PORT_BIND_ERROR='failed to bind host port|port is already allocated|bind: address already in use'

log=$(mktemp)
trap 'rm -f "$log"' EXIT

start_stack() {
  npx supabase start "$@" 2>&1 | tee "$log"
  return "${PIPESTATUS[0]}"
}

# Runs while the failure is fresh, but an outgoing connection may already have
# closed: an empty listing does not clear the port.
log_port_holders() {
  local port
  port=$(grep -E "$PORT_BIND_ERROR" "$log" | grep -Eo ':[0-9]+' | head -n 1 | tr -d : || true)
  echo "Port ${port:-unknown} failed to bind. Listeners:"
  sudo ss -ltnp || true
  echo "TCP sockets using port ${port:-unknown}, in any state:"
  sudo ss -tanp ${port:+"( sport = :$port or dport = :$port )"} || true
}

status=0
start_stack "$@" || status=$?
if [ "$status" -eq 0 ] || ! grep -Eq "$PORT_BIND_ERROR" "$log"; then
  exit "$status"
fi

echo "::warning::supabase start failed on a port bind; retrying once"
log_port_holders
npx supabase stop --no-backup || true

status=0
start_stack "$@" || status=$?
if [ "$status" -ne 0 ] && grep -Eq "$PORT_BIND_ERROR" "$log"; then
  log_port_holders
fi
exit "$status"
