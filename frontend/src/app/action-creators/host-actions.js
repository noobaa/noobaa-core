/* Copyright (C) 2016 NooBaa */

import {
    FETCH_HOSTS,
    COMPLETE_FETCH_HOSTS,
    FAIL_FETCH_HOSTS,
    ACTIVATE_HOST,
    COMPLETE_ACTIVATE_HOST,
    FAIL_ACTIVATE_HOST,
    DEACTIVATE_HOST,
    COMPLETE_DEACTIVATE_HOST,
    FAIL_DEACTIVATE_HOST,
    DROP_HOSTS_VIEW,
    COLLECT_HOST_DIAGNOSTICS,
    COMPLETE_COLLECT_HOST_DIAGNOSTICS,
    FAIL_COLLECT_HOST_DIAGNOSTICS,
    SET_HOST_DEBUG_MODE,
    COMPLETE_SET_HOST_DEBUG_MODE,
    FAIL_SET_HOST_DEBUG_MODE
} from 'action-types';


export function fetchHosts(view, query) {
    const timestamp = Date.now();

    return {
        type: FETCH_HOSTS,
        payload: { view, query, timestamp }
    };
}

export function completeFetchHosts(query, response) {
    return {
        type: COMPLETE_FETCH_HOSTS,
        payload: { query, response }
    };
}

export function failFetchHosts(query, error) {
    return {
        type: FAIL_FETCH_HOSTS,
        payload: { query, error }
    };
}

export function dropHostsView(view) {
    return {
        type: DROP_HOSTS_VIEW,
        payload: { view }
    };
}

export function activateHost(host) {
    return {
        type: ACTIVATE_HOST,
        payload: { host }
    };
}

export function completeActivateHost(host) {
    return {
        type: COMPLETE_ACTIVATE_HOST,
        payload: { host }
    };
}

export function failActivateHost(host, error) {
    return {
        type: FAIL_ACTIVATE_HOST,
        payload: { host, error }
    };
}

export function deactivateHost(host) {
    return {
        type: DEACTIVATE_HOST,
        payload: { host }
    };
}

export function completeDeactivateHost(host) {
    return {
        type: COMPLETE_DEACTIVATE_HOST,
        payload: { host }
    };
}

export function failDeactivateHost(host, error) {
    return {
        type: FAIL_DEACTIVATE_HOST,
        payload: { host, error }
    };
}

export function collectHostDiagnostics(host) {
    return {
        type: COLLECT_HOST_DIAGNOSTICS,
        payload: { host }
    };
}

export function completeCollectHostDiagnostics(host, packageUri) {
    return {
        type: COMPLETE_COLLECT_HOST_DIAGNOSTICS,
        payload: { host, packageUri }
    };
}

export function failCollectHostDiagnostics(host, error) {
    return {
        type: FAIL_COLLECT_HOST_DIAGNOSTICS,
        payload: { host, error }
    };
}

export function setHostDebugMode(host, on) {
    return {
        type: SET_HOST_DEBUG_MODE,
        payload: { host, on }
    };
}

export function completeSetHostDebugMode(host, on) {
    return {
        type: COMPLETE_SET_HOST_DEBUG_MODE,
        payload: { host, on }
    };
}

export function failSetHostDebugMode(host, on, error) {
    return {
        type: FAIL_SET_HOST_DEBUG_MODE,
        payload: { host, on, error }
    };
}
