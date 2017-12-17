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
    UPGRADE_SYSTEM,
    COMPLETE_UPGRADE_SYSTEM,
    FAIL_UPGRADE_SYSTEM,
    UPLOAD_UPGRADE_PACKAGE,
    UPDATE_UPGRADE_PACKAGE_UPLOAD,
    ABORT_UPGRADE_PACKAGE_UPLOAD,
    RUN_UPGRADE_PACKAGE_TESTS,
    FETCH_VERSION_RELEASE_NOTES,
    COMPLETE_FETCH_VERSION_RELEASE_NOTES,
    FAIL_FETCH_VERSION_RELEASE_NOTES
} from 'action-types';

export function createSystem(
    activationCode,
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
            activationCode,
            ownerEmail,
            password,
            systemName,
            dnsName,
            dnsServers,
            timeConfig
        }
    };
}

export function completeCreateSystem(systemName, ownerEmail, token) {
    return {
        type: COMPLETE_CREATE_SYSTEM,
        payload: {
            token: token,
            user: ownerEmail,
            system: systemName,
            passwordExpired: false,
            persistent: false
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

export function upgradeSystem(system) {
    return {
        type: UPGRADE_SYSTEM,
        payload: { system }
    };
}

export function completeUpgradeSystem(system) {
    return {
        type: COMPLETE_UPGRADE_SYSTEM,
        payload: { system }
    };
}

export function failUpgradeSystem() {
    return { type: FAIL_UPGRADE_SYSTEM };
}

export function updateUpgradeSystem(system) {
    return { type: UPDATE_UPGRAGE_SYSTEM };
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
