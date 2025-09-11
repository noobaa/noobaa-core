#!/usr/bin/env bash
set -euxo pipefail
PS4='+ [run_warp] '
export HOME=/home/ubuntu

handle_failure() {
local msg="$1"
send_failure_notification "$msg"
}

handle_success() {
# Upload logs to S3 bucket with timestamp-based directory
local timestamp=$(date +"%Y-%m-%d_%H-%M-%S")
local log_dir="warp-test-logs-${timestamp}"
local logs_path="/home/ubuntu/tests/noobaa-core/logs/warp-test-logs"

echo "Uploading logs to IBM COS s3://${S3_LOGS_BUCKET}/${log_dir}/"
aws s3 cp "$logs_path" "s3://${S3_LOGS_BUCKET}/${log_dir}/" --recursive --no-progress --endpoint-url "${IBM_COS_ENDPOINT}"
echo "Successfully uploaded logs to IBM COS s3://${S3_LOGS_BUCKET}/${log_dir}/"
send_success_notification "s3://${S3_LOGS_BUCKET}/${log_dir}/"
}

send_failure_notification() {
local msg="$1"
node /usr/local/bin/slack_notifier.js "${SLACK_NIGHTLY_RESULTS_URL}" failure "Warp failed: $msg" || true
}

send_success_notification() {
local log_location="$1"
node /usr/local/bin/slack_notifier.js "${SLACK_NIGHTLY_RESULTS_URL}" success "Warp success - logs available at: $log_location" || true
}

shutdown_vm() {
echo "Shutting down VM..."
# TODO: Uncomment once done testing
# sudo shutdown -P now
}

trap 'handle_failure "line $LINENO exit $?"' ERR
trap 'shutdown_vm' EXIT

cd /home/ubuntu/tests/noobaa-core

echo "Building NooBaa images locally..."
make tester

echo "Creating Warp logs directory..."
mkdir -p logs/warp-test-logs
chmod 755 logs/warp-test-logs

echo "Running Warp tests..."
make test-warp -o tester

handle_success
