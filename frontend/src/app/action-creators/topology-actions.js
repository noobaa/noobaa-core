import {
    UPDATE_SERVER_ADDRESS,
    COMPLETE_UPDATE_SERVER_ADDRESS,
    FAIL_UPDATE_SERVER_ADDRESS,
    ATTACH_SERVER_TO_CLUSTER,
    COMPLETE_ATTACH_SERVER_TO_CLUSTER,
    FAIL_ATTACH_SERVER_TO_CLUSTER,
    SET_SERVER_DEBUG_MODE,
    COMPLETE_SET_SERVER_DEBUG_MODE,
    FAIL_SET_SERVER_DEBUG_MODE,
    COLLECT_SERVER_DIAGNOSTICS,
    COMPLETE_COLLECT_SERVER_DIAGNOSTICS,
    FAIL_COLLECT_SERVER_DIAGNOSTICS
} from 'action-types';

export function updateServerAddress(secret, newAddress, hostname) {
    return {
        type: UPDATE_SERVER_ADDRESS,
        payload: { secret, newAddress, hostname }
    };
}

export function completeUpdateServerAddress(secret, hostname) {
    return {
        type: COMPLETE_UPDATE_SERVER_ADDRESS,
        payload: { secret, hostname }
    };
}

export function failUpdateServerAddress(secret, hostname, error) {
    return {
        type: FAIL_UPDATE_SERVER_ADDRESS,
        payload: { secret, hostname, error }
    };
}

export function attachServerToCluster(secret, address, hostname, location) {

    return {
        type: ATTACH_SERVER_TO_CLUSTER,
        payload: { secret, address, hostname, location }
    };
}

export function completeAttachServerToCluster(secret, hostname) {
    return {
        type: COMPLETE_ATTACH_SERVER_TO_CLUSTER,
        payload: { secret, hostname }
    };
}

export function failAttachServerToCluster(secret, hostname, error) {
    return {
        type: FAIL_ATTACH_SERVER_TO_CLUSTER,
        payload: { secret, hostname, error }
    };
}

export function setServerDebugMode(secret, hostname, on) {
    return {
        type: SET_SERVER_DEBUG_MODE,
        payload: { secret, hostname, on }
    };
}

export function completeSetServerDebugMode(secret, hostname, on) {
    return {
        type: COMPLETE_SET_SERVER_DEBUG_MODE,
        payload: { secret, hostname, on }
    };
}

export function failSetServerDebugMode(secret, hostname, on, error) {
    return {
        type: FAIL_SET_SERVER_DEBUG_MODE,
        payload: { secret, hostname, on, error }
    };
}

export function collectServerDiagnostics(secret, hostname) {
    return {
        type: COLLECT_SERVER_DIAGNOSTICS,
        payload: { secret, hostname }
    };
}

export function completeCollectServerDiagnostics(secret, packageUri) {
    return {
        type: COMPLETE_COLLECT_SERVER_DIAGNOSTICS,
        payload: { secret, packageUri }
    };
}

export function failCollectServerDiagnostics(secret, hostname, error) {
    return {
        type: FAIL_COLLECT_SERVER_DIAGNOSTICS,
        payload: { secret, hostname, error }
    };
}
