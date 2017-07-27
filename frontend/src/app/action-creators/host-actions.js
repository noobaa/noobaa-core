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
