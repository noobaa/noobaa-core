/* Copyright (C) 2016 NooBaa */

import {
    CREATE_SYSTEM,
    COMPLETE_CREATE_SYSTEM,
    FAIL_CREATE_SYSTEM,
    FETCH_SYSTEM_INFO,
    COMPLETE_FETCH_SYSTEM_INFO,
    FAIL_FETCH_SYSTEM_INFO,
    FETCH_NODE_INSTALLATION_COMMANDS,
    COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS,
    FAIL_FETCH_NODE_INSTALLATION_COMMANDS,
    FETCH_SYSTEM_STORAGE_HISTORY,
    COMPLETE_FETCH_SYSTEM_STORAGE_HISTORY,
    FAIL_FETCH_SYSTEM_STORAGE_HISTORY,
    INVOKE_UPGRADE_SYSTEM,
    COMPLETE_INVOKE_UPGRADE_SYSTEM,
    FAIL_INVOKE_UPGRADE_SYSTEM,
    UPGRADE_SYSTEM,
    COMPLETE_UPGRADE_SYSTEM,
    FAIL_UPGRADE_SYSTEM,
    UPLOAD_UPGRADE_PACKAGE,
    UPDATE_UPGRADE_PACKAGE_UPLOAD,
    ABORT_UPGRADE_PACKAGE_UPLOAD,
    RUN_UPGRADE_PACKAGE_TESTS,
    FETCH_VERSION_RELEASE_NOTES,
    COMPLETE_FETCH_VERSION_RELEASE_NOTES,
    FAIL_FETCH_VERSION_RELEASE_NOTES,
    UPDATE_REMOTE_SYSLOG,
    COMPLETE_UPDATE_REMOTE_SYSLOG,
    FAIL_UPDATE_REMOTE_SYSLOG,
    ENTER_MAINTENANCE_MODE,
    COMPLETE_ENTER_MAINTENANCE_MODE,
    FAIL_ENTER_MAINTENANCE_MODE,
    LEAVE_MAINTENANCE_MODE,
    COMPLETE_LEAVE_MAINTENANCE_MODE,
    FAIL_LEAVE_MAINTENANCE_MODE,
    INSTALL_VM_TOOLS,
    COMPLETE_INSTALL_VM_TOOLS,
    FAIL_INSTALL_VM_TOOLS,
    UPDATE_P2P_SETTINGS,
    COMPLETE_UPDATE_P2P_SETTINGS,
    FAIL_UPDATE_P2P_SETTINGS,
    RESEND_ACTIVATION_CODE,
    UPDATE_PROXY_SERVER_SETTINGS,
    COMPLETE_UPDATE_PROXY_SERVER_SETTINGS,
    FAIL_UPDATE_PROXY_SERVER_SETTINGS,
    SET_SYSTEM_DEBUG_LEVEL,
    COMPLETE_SET_SYSTEM_DEBUG_LEVEL,
    FAIL_SET_SYSTEM_DEBUG_LEVEL,
    COLLECT_SYSTEM_DIAGNOSTICS,
    COMPLETE_COLLECT_SYSTEM_DIAGNOSTICS,
    FAIL_COLLECT_SYSTEM_DIAGNOSTICS
} from 'action-types';

export function createSystem(
    ownerEmail,
    password,
    systemName,
    dnsName,
    dnsServers,
    timeConfig
) {
    return {
        type: CREATE_SYSTEM,
        payload: {
            ownerEmail,
            password,
            systemName,
            dnsName,
            dnsServers,
            timeConfig
        }
    };
}

export function completeCreateSystem(systemName, ownerEmail, token, uiTheme) {
    return {
        type: COMPLETE_CREATE_SYSTEM,
        payload: {
            token: token,
            user: ownerEmail,
            system: systemName,
            passwordExpired: false,
            persistent: false,
            uiTheme
        }
    };
}

export function failCreateSystem(error) {
    return {
        type: FAIL_CREATE_SYSTEM,
        payload: { error }
    };
}

export function fetchSystemInfo() {
    return { type: FETCH_SYSTEM_INFO };
}

export function completeFetchSystemInfo(info) {
    return {
        type: COMPLETE_FETCH_SYSTEM_INFO,
        payload: info
    };
}

export function failFetchSystemInfo(error) {
    return {
        type: FAIL_FETCH_SYSTEM_INFO,
        payload: error
    };
}

export function fetchNodeInstallationCommands(targetPool, excludedDrives) {
    return {
        type: FETCH_NODE_INSTALLATION_COMMANDS,
        payload: { targetPool, excludedDrives }
    };
}

export function completeFetchNodeInstallationCommands(targetPool, excludedDrives, commands) {
    return {
        type: COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS,
        payload: { targetPool, excludedDrives, commands }
    };
}

export function failFetchNodeInstallationCommands(error) {
    return {
        type: FAIL_FETCH_NODE_INSTALLATION_COMMANDS,
        payload: { error }
    };
}

export function fetchSystemStorageHistory() {
    return { type: FETCH_SYSTEM_STORAGE_HISTORY };
}

export function completeFetchSystemStorageHistory(history) {
    return {
        type: COMPLETE_FETCH_SYSTEM_STORAGE_HISTORY,
        payload: { history }
    };
}

export function failFetchSystemStorageHistory(error) {
    return {
        type: FAIL_FETCH_SYSTEM_STORAGE_HISTORY,
        payload: { error }
    };
}

export function invokeUpgradeSystem() {
    return { type: INVOKE_UPGRADE_SYSTEM };
}

export function completeInvokeUpgradeSystem() {
    return { type: COMPLETE_INVOKE_UPGRADE_SYSTEM };
}

export function failInvokeUpgradeSystem(error) {
    return {
        type: FAIL_INVOKE_UPGRADE_SYSTEM,
        payload: { error }
    };
}

export function upgradeSystem(system) {
    return {
        type: UPGRADE_SYSTEM,
        payload: { system }
    };
}

export function completeUpgradeSystem(system, version) {
    return {
        type: COMPLETE_UPGRADE_SYSTEM,
        payload: { system, version }
    };
}

export function failUpgradeSystem(system) {
    return {
        type: FAIL_UPGRADE_SYSTEM,
        payload: { system }
    };
}

export function uploadUpgradePackage(packageFile) {
    return {
        type: UPLOAD_UPGRADE_PACKAGE,
        payload: { packageFile }
    };
}

export function updateUpgradePackageUpload(progress) {
    return {
        type: UPDATE_UPGRADE_PACKAGE_UPLOAD,
        payload: { progress }
    };
}

export function abortUpgradePackageUpload() {
    return { type: ABORT_UPGRADE_PACKAGE_UPLOAD };
}

export function runUpgradePackageTests() {
    return { type: RUN_UPGRADE_PACKAGE_TESTS };
}

export function fetchVersionReleaseNotes(version) {
    return {
        type: FETCH_VERSION_RELEASE_NOTES,
        payload: { version }
    };
}

export function completeFetchVersionReleaseNotes(version, notes) {
    return {
        type: COMPLETE_FETCH_VERSION_RELEASE_NOTES,
        payload: { version, notes }
    };
}

export function failFetchVersionReleaseNotes(version, error) {
    return {
        type: FAIL_FETCH_VERSION_RELEASE_NOTES,
        payload: { version, error }
    };
}

export function setRemoteSyslog(protocol, address, port) {
    return {
        type: UPDATE_REMOTE_SYSLOG,
        payload: {
            enabled: true,
            protocol,
            address,
            port
        }
    };
}

export function unsetRemoteSyslog() {
    return {
        type: UPDATE_REMOTE_SYSLOG,
        payload: { enabled: false }
    };
}

export function completeUpdateRemoteSyslog(enabled) {
    return {
        type: COMPLETE_UPDATE_REMOTE_SYSLOG,
        payload: { enabled }
    };
}

export function failUpdateRemoteSyslog(enabled, error) {
    return {
        type: FAIL_UPDATE_REMOTE_SYSLOG,
        payload: { enabled, error }
    };
}

export function enterMaintenanceMode(duration) {
    return {
        type: ENTER_MAINTENANCE_MODE,
        payload: { duration }
    };
}

export function completeEnterMaintenanceMode() {
    return { type: COMPLETE_ENTER_MAINTENANCE_MODE };
}

export function failEnterMaintenanceMode(error) {
    return {
        type: FAIL_ENTER_MAINTENANCE_MODE,
        payload: { error }
    };
}

export function leaveMaintenanceMode() {
    return { type: LEAVE_MAINTENANCE_MODE };
}

export function completeLeaveMaintenanceMode() {
    return { type: COMPLETE_LEAVE_MAINTENANCE_MODE };
}

export function failLeaveMaintenanceMode(error) {
    return {
        type: FAIL_LEAVE_MAINTENANCE_MODE,
        payload: { error }
    };
}

export function installVMTools() {
    return { type: INSTALL_VM_TOOLS };
}

export function completeInstallVMTools() {
    return { type: COMPLETE_INSTALL_VM_TOOLS };
}

export function failInstallVMTools(error) {
    return {
        type: FAIL_INSTALL_VM_TOOLS,
        payload: { error }
    };
}

export function updateP2PSettings(tcpPortRange) {
    return {
        type: UPDATE_P2P_SETTINGS,
        payload: { tcpPortRange }
    };
}

export function completeUpdateP2PSettings() {
    return { type: COMPLETE_UPDATE_P2P_SETTINGS };
}

export function failUpdateP2PSettings(error) {
    return {
        type: FAIL_UPDATE_P2P_SETTINGS,
        payload: { error }
    };
}

export function resendActivationCode(email) {
    return {
        type: RESEND_ACTIVATION_CODE,
        payload: { email }
    };
}

export function updateProxyServerSettings(address) {
    return {
        type: UPDATE_PROXY_SERVER_SETTINGS,
        payload: { address }
    };
}
export function completeUpdateProxyServerSettings() {
    return { type: COMPLETE_UPDATE_PROXY_SERVER_SETTINGS };
}

export function failUpdateProxyServerSettings(error) {
    return {
        type: FAIL_UPDATE_PROXY_SERVER_SETTINGS,
        payload: { error }
    };
}

export function setSystemDebugLevel(level) {
    return {
        type: SET_SYSTEM_DEBUG_LEVEL,
        payload: { level }
    };
}

export function completeSetSystemDebugLevel(level) {
    return {
        type: COMPLETE_SET_SYSTEM_DEBUG_LEVEL,
        payload: { level }
    };
}

export function failSetSystemDebugLevel(level, error) {
    return {
        type: FAIL_SET_SYSTEM_DEBUG_LEVEL,
        payload: { level, error }
    };
}

export function collectSystemDiagnostics() {
    return { type: COLLECT_SYSTEM_DIAGNOSTICS };
}
export function completeCollectSystemDiagnostics(packageUri) {
    return {
        type: COMPLETE_COLLECT_SYSTEM_DIAGNOSTICS,
        payload: { packageUri }
    };
}

export function failCollectSystemDiagnostics(error) {
    return {
        type: FAIL_COLLECT_SYSTEM_DIAGNOSTICS,
        payload: { error }
    };
}
