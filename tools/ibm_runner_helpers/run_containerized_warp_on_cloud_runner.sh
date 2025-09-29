#!/usr/bin/env bash
set -euxo pipefail
set -a
. /etc/warp.env
set +a
PS4='+ [run_warp] '
export HOME=/home/ubuntu

# Global variables for log directory naming
timestamp=$(date +"%Y-%m-%d-%H-%M-%S")
log_dir="warp-test-logs-${timestamp}"
test_logs_path="/home/ubuntu/tests/noobaa-core/logs/warp-test-logs"

send_failure_notification() {
    local msg="$1"
    node /usr/local/bin/slack_notifier.js "${SLACK_NIGHTLY_RESULTS_URL}" failure "Warp failed: ${msg}" || true
}

send_success_notification() {
    local log_location="$1"
    node /usr/local/bin/slack_notifier.js "${SLACK_NIGHTLY_RESULTS_URL}" success "Warp success - logs available at: ${log_location}" || true
}

handle_success() {
    echo "Uploading logs to IBM COS s3://${WARP_LOGS_BUCKET}/${log_dir}/"
    aws s3 cp "${test_logs_path}" "s3://${WARP_LOGS_BUCKET}/${log_dir}/" --recursive --no-progress --endpoint-url "${IBM_COS_ENDPOINT}"
    echo "Successfully uploaded logs to IBM COS s3://${WARP_LOGS_BUCKET}/${log_dir}/"
    send_success_notification "s3://${WARP_LOGS_BUCKET}/${log_dir}/"
}

handle_failure() {
    echo "Uploading cloud-init logs to IBM COS s3://${WARP_LOGS_BUCKET}/${log_dir}/"
    aws s3 cp "/var/log/cloud-init-output.log" "s3://${WARP_LOGS_BUCKET}/${log_dir}/" --no-progress --endpoint-url "${IBM_COS_ENDPOINT}"
    echo "Successfully uploaded cloud-init logs to IBM COS s3://${WARP_LOGS_BUCKET}/${log_dir}/"
    send_failure_notification "Run failed, logs available at s3://${WARP_LOGS_BUCKET}/${log_dir}/"
}

shutdown_vm() {
    echo "Shutting down VM..."
    sudo shutdown -P now
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
make test-warp -o tester WARP_ARGS="--duration 3h --obj-size 10m --obj-randsize"

handle_success
