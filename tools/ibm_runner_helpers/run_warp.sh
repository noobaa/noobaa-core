#!/usr/bin/env bash
set -euxo pipefail
PS4='+ [run_warp] '
export HOME=/home/ubuntu

send_failure_notification() {
local msg="$1"
node /usr/local/bin/slack_notifier.js "${SLACK_NIGHTLY_RESULTS_URL}" failure "Warp failed: $msg" || true
sudo shutdown -P now
}

send_success_notification() {
node /usr/local/bin/slack_notifier.js "${SLACK_NIGHTLY_RESULTS_URL}" success "Warp success" || true
}

trap 'send_failure_notification "line $LINENO exit $?"' ERR

cd /home/ubuntu/tests/noobaa-core

echo "Building NooBaa images locally..."
make tester

echo "Creating Warp logs directory..."
mkdir -p logs/warp-test-logs
chmod 777 logs/warp-test-logs

echo "Running Warp tests..."
make test-warp -o tester

send_success_notification
