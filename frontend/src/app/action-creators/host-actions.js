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
    TOGGLE_HOST_SERVICES,
    COMPLETE_TOGGLE_HOST_SERVICES,
    FAIL_TOGGLE_HOST_SERVICES,
    TOGGLE_HOST_NODES,
    COMPLETE_TOGGLE_HOST_NODES,
    FAIL_TOGGLE_HOST_NODES,
    FETCH_HOST_OBJECTS,
    COMPLETE_FETCH_HOST_OBJECTS,
    FAIL_FETCH_HOST_OBJECTS,
    RETRUST_HOST,
    COMPLETE_RETRUST_HOST,
    FAIL_RETRUST_HOST,
    DELETE_HOST,
    COMPLETE_DELETE_HOST,
    FAIL_DELETE_HOST,
    REMOVE_HOST
} from 'action-types';


export function fetchHosts(view, query, statistics = false) {
    const timestamp = Date.now();

    return {
        type: FETCH_HOSTS,
        payload: { view, query, statistics, timestamp }
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

export function toggleHostServices(host, services) {
    return {
        type: TOGGLE_HOST_SERVICES,
        payload: { host, services }
    };
}

export function completeToggleHostServices(host, services) {
    return {
        type: COMPLETE_TOGGLE_HOST_SERVICES,
        payload: { host, services }
    };
}

export function failToggleHostServices(host, services, error) {
    return {
        type: FAIL_TOGGLE_HOST_SERVICES,
        payload: { host, services, error }
    };
}

export function toggleHostNodes(host, nodes) {
    return {
        type: TOGGLE_HOST_NODES,
        payload: { host, nodes }
    };
}

export function completeToggleHostNodes(host) {
    return {
        type: COMPLETE_TOGGLE_HOST_NODES,
        payload: { host }
    };
}

export function failToggleHostNodes(host, error) {
    return {
        type: FAIL_TOGGLE_HOST_NODES,
        payload: { host, error }
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

export function deleteHost(host) {
    return {
        type: DELETE_HOST,
        payload: { host }
    };
}

export function completeDeleteHost(host) {
    return {
        type: COMPLETE_DELETE_HOST,
        payload: { host }
    };
}

export function failDeleteHost(host, error) {
    return {
        type: FAIL_DELETE_HOST,
        payload: { host, error }
    };
}

export function removeHost(host) {
    return {
        type: REMOVE_HOST,
        payload: { host }
    };
}
