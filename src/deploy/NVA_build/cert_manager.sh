#!/bin/bash

# Certificate Manager for NooBaa
# =============================
#
# This script manages certificate bundling and hot-reloading for NooBaa core and endpoint pods.
# It monitors certificate files for changes and automatically updates the Node.js
# certificate bundle when changes are detected.
# Note that system certificates are not bundled, since they are already in the Node.js trust store.
#
# Features:
# - Bundles certificates from multiple sources:
#   * Service account CA certificate
#   * OpenShift injected CA bundle
# - Hot-reloads certificates using polling
# - Automatically restarts Node.js processes when certificates change
# - Supports both core (supervisord) and endpoint pods
# - Cleans up resources on exit
#
# Manual usage:
#   ./cert_manager.sh start  # Start the certificate manager
#   ./cert_manager.sh stop   # Stop the certificate manager
#
# Certificate Paths:
#   - Service CA: /var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt
#   - OCP CA Bundle: /etc/ocp-injected-ca-bundle/ca-bundle.crt
#   - Output Bundle: /tmp/ca-bundle.crt
#
# Environment Variables:
#   - NODE_EXTRA_CA_CERTS: Set to the bundled certificate path
#
# Integration:
# - Core pods: Managed by supervisord (see noobaa_supervisor.conf)
# - Endpoint pods: Started by noobaa_init.sh
#
# Dependencies:
# - md5sum: For monitoring certificate changes
# - supervisorctl: For restarting processes in core pods
# - pkill: For restarting processes in endpoint pods

# Certificate paths
SERVICE_CA_CERT="/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt"
OCP_USE_CA_BUNDLE="/etc/ocp-injected-ca-bundle/ca-bundle.crt"
CERT_BUNDLE="/tmp/ca-bundle.crt"
CERT_WATCH_PID=""
POLL_INTERVAL=60  # Check for changes every 60 seconds

# Function to get file MD5 hash
get_file_md5() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo "Warning - certificate file not found: $file" >&2
        echo ""
        return 1
    fi
    if [ ! -r "$file" ]; then
        echo "Error - cannot read certificate file: $file" >&2
        echo ""
        return 1
    fi
    local hash
    if ! hash=$(md5sum "$file" 2>/dev/null | cut -d' ' -f1); then
        echo "Error - failed to calculate MD5 hash for: $file" >&2
        echo ""
        return 1
    fi
    echo "$hash"
    return 0
}

# Function to bundle certificates
bundle_certificates() {
    echo "Bundling certificates"
    local cert_paths=("${SERVICE_CA_CERT}" "${OCP_USE_CA_BUNDLE}")
    local found_certs=false
    
    # Create a temporary file for the bundle
    local temp_bundle=$(mktemp)
    if [ $? -ne 0 ]; then
        echo "Error - failed to create temporary bundle file" >&2
        return 1
    fi
    
    for cert in "${cert_paths[@]}"; do
        if [ ! -f "${cert}" ]; then
            echo "Warning - certificate file not found: ${cert}" >&2
            continue
        fi
        if ! cat "${cert}" >> "${temp_bundle}"; then
            echo "Error - failed to append certificate: ${cert}" >&2
            rm -f "${temp_bundle}"
            return 1
        fi
        found_certs=true
    done
    
    if [ "${found_certs}" = false ]; then
        echo "Warning - no certificates found to bundle" >&2
        rm -f "${temp_bundle}"
        return 0
    fi
    
    # Atomically replace the bundle file
    if ! mv "${temp_bundle}" "${CERT_BUNDLE}"; then
        echo "Error - failed to create certificate bundle" >&2
        rm -f "${temp_bundle}"
        return 1
    fi
    
    export NODE_EXTRA_CA_CERTS=${CERT_BUNDLE}
    return 0
}

# Function to start certificate watcher
start_cert_watcher() {
    echo "Starting certificate watcher"
    
    # Initial check of certificate files
    if ! get_file_md5 "${SERVICE_CA_CERT}" >/dev/null || ! get_file_md5 "${OCP_USE_CA_BUNDLE}" >/dev/null; then
        echo "Error - one or more certificate files are not accessible" >&2
        return 1
    fi
    
    local service_ca_last_md5=""
    local ocp_ca_last_md5=""
    
    # Get initial hashes
    service_ca_last_md5=$(get_file_md5 "${SERVICE_CA_CERT}")
    ocp_ca_last_md5=$(get_file_md5 "${OCP_USE_CA_BUNDLE}")
    
    while true; do
        local service_ca_current_md5
        local ocp_ca_current_md5
        
        # Get current hashes atomically
        service_ca_current_md5=$(get_file_md5 "${SERVICE_CA_CERT}")
        ocp_ca_current_md5=$(get_file_md5 "${OCP_USE_CA_BUNDLE}")
        
        if [ "${service_ca_current_md5}" != "${service_ca_last_md5}" ] || 
           [ "${ocp_ca_current_md5}" != "${ocp_ca_last_md5}" ]; then
            echo "Certificate change detected"
            if bundle_certificates; then
                restart_processes
                # Update last known hashes only after successful bundling
                service_ca_last_md5=${service_ca_current_md5}
                ocp_ca_last_md5=${ocp_ca_current_md5}
            else
                echo "Error - failed to bundle certificates" >&2
            fi
        fi
        
        sleep ${POLL_INTERVAL}
    done &
    CERT_WATCH_PID=$!
}

# Function to stop certificate watcher
stop_cert_watcher() {
    if [ ! -z "${CERT_WATCH_PID}" ]; then
        echo "Stopping certificate watcher"
        if ! kill ${CERT_WATCH_PID} 2>/dev/null; then
            echo "Warning - certificate watcher process not found" >&2
        fi
        # Wait for process to terminate
        if ! wait ${CERT_WATCH_PID} 2>/dev/null; then
            echo "Warning - certificate watcher did not terminate gracefully" >&2
            kill -9 ${CERT_WATCH_PID} 2>/dev/null
        fi
    fi
}

# Function to restart processes
restart_processes() {
    local mode_file="./NOOBAA_INIT_MODE"
    local temp_file=$(mktemp)
    local original_mode=""
    
    # Store original mode if it exists
    if [ -f "${mode_file}" ]; then
        if ! original_mode=$(cat "${mode_file}"); then
            echo "Error - failed to read mode file" >&2
            return 1
        fi
    fi
    
    # Atomically set mode to auto in temporary file
    echo "auto" > "${temp_file}"
    if ! mv "${temp_file}" "${mode_file}"; then
        echo "Error - failed to update mode file" >&2
        rm -f "${temp_file}"
        return 1
    fi
    
    # Check if we're in a core pod (supervisord available) or endpoint pod
    if command -v supervisorctl >/dev/null 2>&1 && supervisorctl status >/dev/null 2>&1; then
        echo "Restarting processes using supervisorctl"
        if ! supervisorctl restart all; then
            echo "Error - failed to restart processes using supervisorctl" >&2
            return 1
        fi
    else
        echo "supervisorctl not available or not working, sending SIGTERM to Node processes"
        if ! pkill -TERM -f "node"; then
            echo "Warning - no Node processes found to restart" >&2
        fi
    fi
    
    # Wait a moment for processes to start
    sleep 2
    
    # Restore original state
    if [ -n "${original_mode}" ]; then
        echo "${original_mode}" > "${temp_file}"
        if ! mv "${temp_file}" "${mode_file}"; then
            echo "Error - failed to restore original mode" >&2
            rm -f "${temp_file}"
            return 1
        fi
    else
        rm -f "${mode_file}"
    fi
    
    return 0
}

# Cleanup function
cleanup() {
    stop_cert_watcher
    if [ -f "${CERT_BUNDLE}" ]; then
        if ! rm -f "${CERT_BUNDLE}"; then
            echo "Warning - failed to remove certificate bundle" >&2
        fi
    fi
}

# Main execution
if [ "${1}" == "start" ]; then
    # Set up cleanup on exit
    trap cleanup EXIT
    
    # Set up signal handling
    trap 'echo "Received signal, stopping..."; cleanup; exit 0' TERM INT
    
    # Bundle certificates and start watcher
    if ! bundle_certificates; then
        echo "Error - failed to bundle initial certificates" >&2
        exit 1
    fi
    
    if ! start_cert_watcher; then
        echo "Error - failed to start certificate watcher" >&2
        exit 1
    fi
    
    # Keep the script running
    while true; do
        if ! wait "${CERT_WATCH_PID}"; then
            # If wait fails, check if the process is still running
            if kill -0 "${CERT_WATCH_PID}" 2>/dev/null; then
                echo "Error - certificate watcher process failed" >&2
                exit 1
            else
                # Process terminated normally
                break
            fi
        fi
    done
elif [ "${1}" == "stop" ]; then
    cleanup
else
    echo "Usage: $0 [start|stop]"
    exit 1
fi 