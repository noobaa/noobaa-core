/* Copyright (C) 2016 NooBaa */

import {
    FETCH_HOSTS,
    COMPLETE_FETCH_HOSTS,
    FAIL_FETCH_HOSTS,
    DROP_HOSTS_VIEW,
    COLLECT_HOST_DIAGNOSTICS,
    COMPLETE_COLLECT_HOST_DIAGNOSTICS,
    FAIL_COLLECT_HOST_DIAGNOSTICS,
    SET_HOST_DEBUG_MODE,
    COMPLETE_SET_HOST_DEBUG_MODE,
    FAIL_SET_HOST_DEBUG_MODE,
    FETCH_HOST_OBJECTS,
    COMPLETE_FETCH_HOST_OBJECTS,
    FAIL_FETCH_HOST_OBJECTS,
    RETRUST_HOST,
    COMPLETE_RETRUST_HOST,
    FAIL_RETRUST_HOST,
    REMOVE_HOST
} from 'action-types';


export function fetchHosts(view, query, statistics = false) {
    return {
        type: FETCH_HOSTS,
        payload: { view, query, statistics }
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


export function fetchHostObjects(host, skip, limit) {
    return {
        type: FETCH_HOST_OBJECTS,
        payload: { host, skip, limit }
    };
}

export function completeFetchHostObjects(host, skip, limit, response) {
    return {
        type: COMPLETE_FETCH_HOST_OBJECTS,
        payload: {
            query: { host, skip, limit},
            response
        }
    };
}

export function failFetchHostObjects(host, skip, limit, error) {
    return {
        type: FAIL_FETCH_HOST_OBJECTS,
        payload: {
            query: { host, skip, limit },
            error
        }
    };
}

export function retrustHost(host) {
    return {
        type: RETRUST_HOST,
        payload: { host }
    };
}

export function completeRetrustHost(host) {
    return {
        type: COMPLETE_RETRUST_HOST,
        payload: { host }
    };
}

export function failRetrustHost(host, error) {
    return {
        type: FAIL_RETRUST_HOST,
        payload: { host, error }
    };
}

export function removeHost(host) {
    return {
        type: REMOVE_HOST,
        payload: { host }
    };
}
