#!/bin/sh
# Supervises the Acestream Engine and restarts it on crash.
# magnetikonline/acestream-server ships /start-engine as the official launcher.
set -e

while true; do
    echo "[oono-acestream] starting engine on :6878"
    /start-engine --client-console --bind-all || true
    echo "[oono-acestream] engine exited, restarting in 5s"
    sleep 5
done
