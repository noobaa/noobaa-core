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
    UPGRADE_SYSTEM,
    FETCH_SYSTEM_STORAGE_HISTORY,
    COMPLETE_FETCH_SYSTEM_STORAGE_HISTORY,
    FAIL_FETCH_SYSTEM_STORAGE_HISTORY
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

export function upgradeSystem() {
    return { type: UPGRADE_SYSTEM };
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
