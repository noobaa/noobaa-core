/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { echo, mapValues, keyByProperty, createCompareFunc, hashCode, averageBy } from 'utils/core-utils';
import { paginationPageSize } from 'config';
import {
    FETCH_HOSTS,
    COMPLETE_FETCH_HOSTS,
    FAIL_FETCH_HOSTS,
    COLLECT_HOST_DIAGNOSTICS,
    COMPLETE_COLLECT_HOST_DIAGNOSTICS,
    FAIL_COLLECT_HOST_DIAGNOSTICS,
    COMPLETE_SET_HOST_DEBUG_MODE,
    DROP_HOSTS_VIEW
} from 'action-types';

const maxNumberOfHostsInMemory = paginationPageSize * 10;
const gatewayUsageStatsTimeSpan = 7 * 24 * 60 * 60 * 1000; /* 7 days in miliseconds */

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
    const queryKey = _generateQueryKey(query);

    return {
        ...state,
        queries: {
            ...state.queries,
            [queryKey]: {
                ...(state.queries[queryKey] || {}),
                key: queryKey,
                timestamp: timestamp,
                fetching: true,
                error: false
            }
        },
        views: {
            ...state.views,
            [view]: queryKey
        }
    };
}

function onCompleteFetchHosts(state, { payload }) {
    const { hosts, counters } = payload.response;

    const queryKey = _generateQueryKey(payload.query);
    const query = state.queries[queryKey];
    const itemUpdates = keyByProperty(
        hosts,
        'name',
        data => _mapDataToHost(state.items[data.name], data, query.timestamp)
    );
    const items = {
        ...state.items,
        ...itemUpdates
    };

    const queries = {
        ...state.queries,
        [queryKey]: {
            query,
            fetching: false,
            result: {
                items: Object.keys(itemUpdates),
                counters: {
                    nonPaginated: counters.non_paginated,
                    byMode: counters.by_mode,
                }
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

    // Use mapValues to omit undefined keys.
    return {
        ...state,
        items: mapValues(items, echo),
        queries: mapValues(queries, echo),
        overallocated
    };
}

function onFailFetchHosts(state, { payload }) {
    const queryKey = _generateQueryKey(payload.query);

    return {
        ...state,
        queries: {
            ...state.queries,
            [queryKey]: {
                ...state.queries[queryKey],
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

function onCompleteSetHostDebugMode(state, { payload }) {
    const debugMode = payload.on;
    return _updateHost(state, payload.host, { debugMode });
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

function _mapDataToHost(host = {}, data, fetchTime) {
    const { storage_nodes_info, s3_nodes_info, os_info, port_range, debug } = data;
    const { diagnostics = initialHostDiagnosticsState } = host;

    const activities = (storage_nodes_info.data_activities || [])
        .map(activity => ({
            type: activity.reason,
            nodeCount: activity.count,
            progress: activity.progress,
            eta: activity.time.end
        }));

    return {
        name: data.name,
        hostname: os_info.hostname,
        pool: data.pool,
        suggestedPool: data.suggested_pool,
        mode: data.mode,
        version: data.version,
        ip: data.ip,
        ports: port_range && {
            min: port_range.min || port_range.port,
            max: port_range.max || port_range.port,
        },
        protocol: data.connectivity,
        endpoint: data.base_address,
        rpcAddress: data.rpc_address,
        lastCommunication: data.last_communication,
        rtt: averageBy(data.latency_to_server),
        storage: data.storage,
        trusted: data.trusted,
        activities: activities,
        services: {
            storage: _mapStorageService(storage_nodes_info),
            gateway: _mapGatewayService(s3_nodes_info, fetchTime)
        },
        upTime: os_info.uptime,
        os: os_info.ostype,
        cpus: {
            units: os_info.cpus,
            usage: os_info.cpu_usage
        },
        memory: {
            total: os_info.totalmem,
            used: os_info.totalmem - os_info.freemem
        },
        debugMode: debug.level > 0 ? debug.time_left : 0,
        diagnostics: diagnostics
    };
}

function _mapStorageService({ mode, enabled, nodes }) {
    return {
        mode,
        enabled: Boolean(enabled),
        nodes: nodes.map(node => {
            const { mode, drive, latency_of_disk_read, storage,
                latency_of_disk_write, data_activity } = node;

            const activity = data_activity && {
                type: data_activity.reason,
                progress: data_activity.progress,
                stage: data_activity.stage.name
            };

            return {
                mode,
                storage,
                drive: drive.drive_id,
                mount: drive.mount,
                readLatency: averageBy(latency_of_disk_read),
                writeLatency: averageBy(latency_of_disk_write),
                activity
            };
        })
    };
}

function _mapGatewayService(gatewayData, fetchTime) {
    const { mode, enabled, stats } = gatewayData;
    const serviceState = {
        mode,
        enabled: Boolean(enabled)
    };

    if (stats) {
        const sevenDaysAgo  = fetchTime - gatewayUsageStatsTimeSpan;
        const last7Days = stats.daily_stats
            .filter(record => record.time >= sevenDaysAgo)
            .reduce(
                (sum, record) => {
                    sum.bytesRead += record.read_bytes;
                    sum.bytesWritten += record.write_bytes;
                    return sum;
                },
                { bytesWritten: 0, bytesRead: 0 }
            );

        serviceState.usage = {
            lastRead: stats.last_read,
            lastWrite: stats.last_write,
            last7Days
        };
    }

    return serviceState;
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
    [COMPLETE_COLLECT_HOST_DIAGNOSTICS]: onCompleteCollectHostDiagnostics,
    [FAIL_COLLECT_HOST_DIAGNOSTICS]: onFailCollectHostDiagnostics,
    [COMPLETE_SET_HOST_DEBUG_MODE]: onCompleteSetHostDebugMode,
    [DROP_HOSTS_VIEW]: onDropHostsView
});
