/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { echo, mapValues, keyByProperty, createCompareFunc, hashCode, averageBy } from 'utils/core-utils';
import { paginationPageSize } from 'config';
import {
    FETCH_HOSTS,
    COMPLETE_FETCH_HOSTS,
    FAIL_FETCH_HOSTS,
    COLLECT_HOST_DIAGNOSTICS,
    COMPLETE_COLLLECT_HOST_DIAGNOSTICS,
    FAIL_COLLECT_HOST_DIAGNOSTICS,
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

const initialHostDiagnosticsState = {
    collecting: false,
    error: false,
    packageUri: ''
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
    const updates = keyByProperty(
        hosts,
        'host_id',
        data => _mapDataToHost(state.items[data.host_id], data)
    );

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

function onCollectHostDiagnostics(state, { payload }) {
    const diagnostics = {
        collecting: true,
        error: false,
        packageUri: ''
    };

    return _updateHost(state, payload.host, { diagnostics });
}

function onCompleteCollectHostDiagnostics(state, { payload }) {
    const diagnostics = {
        collecting: false,
        error: false,
        packageUri: payload.packageUri
    };

    return _updateHost(state, payload.host, { diagnostics });
}

function onFailCollectHostDiagnostics(state, { payload }) {
    const diagnostics = {
        collecting: false,
        error: true,
        packageUri: ''
    };

    return _updateHost(state, payload.host, { diagnostics });
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

function _mapDataToHost(host = {}, data) {
    const { storage_nodes_info, s3_nodes_info, os_info } = data;
    const { diagnostics = initialHostDiagnosticsState } = host;

    return {
        name: data.host_id,
        hostname: os_info.hostname,
        mode: data.mode,
        version: data.version,
        ip: data.ip,
        ports: {
            start: 0,
            end: 0
        },
        protocol: data.connectivity,
        rpcAddress: data.rpc_address,
        lastCommunication: data.last_communication,
        rtt: averageBy(data.latency_to_server),
        storage: data.storage,
        trusted: data.trusted,
        activities: {},
        services: {
            storage: _mapStorageNodes(storage_nodes_info),
            gateway: _mapGatewayNodes(s3_nodes_info)
        },
        uptime: os_info.uptime,
        os: os_info.ostype,
        cpus: [],
        memory: {
            total: os_info.totalmem,
            used: os_info.totalmem - os_info.freemem
        },
        diagnostics: diagnostics
    };
}

function _mapStorageNodes({ mode, nodes }) {
    return {
        mode,
        nodes: nodes.map(node => {
            const { mode, drives, latency_of_disk_read, storage,
                latency_of_disk_write, data_activity, debug_level } = node;

            const activity = data_activity && {
                type: data_activity.reason,
                progress: data_activity.progress,
                stage: data_activity.stage.name
            };

            return {
                mode,
                storage,
                drive: drives[0].drive_id,
                mount: drives[0].mount,
                readLatency: averageBy(latency_of_disk_read),
                writeLatency: averageBy(latency_of_disk_write),
                debugMode: debug_level > 0,
                activity
            };
        })
    };
}

function _mapGatewayNodes({ mode }) {
    return { mode };
}


function _updateHost(state, host, updates) {
    const item = state.items[host];
    if (!item) return state;


    return {
        ...state,
        items: {
            ...state.items,
            [host]: {
                ...item,
                ...updates
            }
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
    [COLLECT_HOST_DIAGNOSTICS]: onCollectHostDiagnostics,
    [COMPLETE_COLLLECT_HOST_DIAGNOSTICS]: onCompleteCollectHostDiagnostics,
    [FAIL_COLLECT_HOST_DIAGNOSTICS]: onFailCollectHostDiagnostics,
    [DROP_HOSTS_VIEW]: onDropHostsView
});
