#!/usr/bin/env bash
set -euxo pipefail
PS4='+ [run_warp] '
export HOME=/home/ubuntu

send_failure_notification() {
local msg="$1"
node /usr/local/bin/slack_notifier.js "${SLACK_NIGHTLY_RESULTS_URL}" failure "Warp failed: $msg" || true
}

send_success_notification() {
node /usr/local/bin/slack_notifier.js "${SLACK_NIGHTLY_RESULTS_URL}" success "Warp success" || true
}

shutdown_vm() {
echo "Shutting down VM..."
sudo shutdown -P now
}

trap 'send_failure_notification "line $LINENO exit $?"' ERR
trap 'shutdown_vm' EXIT

cd /home/ubuntu/tests/noobaa-core

echo "Building NooBaa images locally..."
make tester

echo "Creating Warp logs directory..."
mkdir -p logs/warp-test-logs
chmod 777 logs/warp-test-logs

echo "Running Warp tests..."
make test-warp -o tester

send_success_notification
