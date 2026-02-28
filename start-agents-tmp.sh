#!/bin/bash
source /opt/onlytrade/scripts/onlytrade-ops.sh
export ONLYTRADE_OPS_RUNTIME_API_URL="http://127.0.0.1:18080"
export ONLYTRADE_OPS_IDENTITY_TOKEN=$(grep CONTROL_API_TOKEN /opt/onlytrade/runtime-api/.env.local | cut -d '=' -f2)
agent-start t_013
agent-start t_014
