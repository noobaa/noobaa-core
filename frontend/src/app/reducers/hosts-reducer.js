/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { echo, mapValues, keyByProperty, createCompareFunc, hashCode } from 'utils/core-utils';
import { paginationPageSize } from 'config';
import {
    FETCH_HOSTS,
    COMPLETE_FETCH_HOSTS,
    FAIL_FETCH_HOSTS,
    DROP_HOSTS_VIEW
} from 'action-types';

const maxNumberOfHostsInMemory = paginationPageSize * 10;

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    items: {},
    queries: {},
    views: {},
    overallocated: 0
};

// ------------------------------
// Action Handlers
// ------------------------------
function onFetchHosts(state, { payload }) {
    const { view, query, timestamp } = payload;
    const key = _generateQueryKey(query);

    return {
        ...state,
        queries: {
            ...state.queries,
            [key]: {
                ...(state.queries[key] || {}),
                key: key,
                timestamp: timestamp,
                fetching: true,
                error: false
            }
        },
        views: {
            ...state.views,
            [view]: key
        }
    };
}

function onCompleteFetchHosts(state, { payload }) {
    const { hosts, filter_counts } = payload.response;

    const updates = keyByProperty(hosts, 'host_id', _mapHost);
    const key = _generateQueryKey(payload.query);
    const items = {
        ...state.items,
        ...updates
    };

    const queries = {
        ...state.queries,
        [key]: {
            ...state.queries[key],
            fetching: false,
            result: {
                items: Object.keys(updates),
                counters: filter_counts.by_mode
            }
        }
    };

    let overallocated = Math.max(0, Object.keys(items).length - maxNumberOfHostsInMemory);
    if (overallocated > 0) {
        // Create a list of queries that are not locked be any view.
        const lockedQueries = new Set(Object.values(state.views));
        const unlockedQueries =  Object.values(state.queries)
            .filter(query => !lockedQueries.has(query.key))
            .sort(createCompareFunc(query => query.timestamp));

        // Remove items
        for (const query of unlockedQueries) {
            queries[query.key] = undefined;

            for (const host of query.hosts) {
                if (items[host]) {
                    items[host] = undefined;
                    --overallocated;
                }
            }

            if (overallocated <= 0) {
                overallocated = 0;
                break;
            }
        }
    }

    // Use mapValues to omit undefiend keys.
    return {
        ...state,
        items: mapValues(items, echo),
        queries: mapValues(queries, echo),
        overallocated
    };
}

function onFailFetchHosts(state, { payload }) {
    const key = _generateQueryKey(payload.query);

    return {
        ...state,
        queries: {
            ...state.queries,
            [key]: {
                ...state.queries[key],
                fetching: false,
                error: true
            }
        }
    };
}

function onDropHostsView(state, { payload }) {
    const { [payload.view]: _, ...views } = state.views;

    return {
        ...state,
        views
    };
}

// ------------------------------
// Local util functions
// ------------------------------
function _generateQueryKey(query) {
    return hashCode(query);
}

function _mapHost(host) {
    const { storage_nodes_info, s3_nodes_info } = host;

    return {
        name: host.host_id,
        hostname: host.name,
        mode: host.mode,
        ip: host.ip,
        storage: host.storage,
        storageService: {
            enabled: Boolean(storage_nodes_info.enabled)
        },
        gatewayService: {
            enabled: Boolean(s3_nodes_info.enabled)
        }
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_HOSTS]: onFetchHosts,
    [COMPLETE_FETCH_HOSTS]: onCompleteFetchHosts,
    [FAIL_FETCH_HOSTS]: onFailFetchHosts,
    [DROP_HOSTS_VIEW]: onDropHostsView
});
