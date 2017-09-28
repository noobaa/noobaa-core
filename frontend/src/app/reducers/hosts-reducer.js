/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { echo, mapValues, keyByProperty, createCompareFunc, hashCode, averageBy,
    flatMap, deepFreeze, groupBy } from 'utils/core-utils';
import { mapApiStorage } from 'utils/state-utils';
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

const inMemoryQueryLimit = 10;
const inMemoryHostLimit = paginationPageSize * inMemoryQueryLimit;
const gatewayUsageStatsTimeSpan = 7 * 24 * 60 * 60 * 1000; /* 7 days in miliseconds */
const eventToReasonCode = deepFreeze({
    permission_event: 'TEMPERING',
    data_event: 'CORRUPTION'
});

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    items: {},
    queries: {},
    views: {}
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

    const newState = {
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

    return _clearOverallocated(
        newState,
        inMemoryQueryLimit,
        inMemoryHostLimit
    );
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
            ...query,
            fetching: false,
            result: {
                items: Object.keys(itemUpdates),
                counters: {
                    nonPaginated: counters.non_paginated,
                    byMode: counters.by_mode
                }
            }
        }
    };

    const newState = {
        ...state,
        items: mapValues(items, echo),
        queries: mapValues(queries, echo)
    };

    return _clearOverallocated(
        newState,
        inMemoryQueryLimit,
        inMemoryHostLimit
    );
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
    const debugMode = {
        state: payload.on,
        timeLeft: undefined
    };

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
    const { storage_nodes_info, s3_nodes_info, os_info, ports, debug } = data;
    const { diagnostics = initialHostDiagnosticsState } = host;

    const reasonByMount = groupBy(
        data.untrusted_reasons || [],
        reason => reason.drive.drive_id,
        reason => Object.entries(reason.events)
            .map(pair => {
                const [event, time] = pair;
                const reason = eventToReasonCode[event];
                return { reason, time };
            })
    );

    const activities = (storage_nodes_info.data_activities || [])
        .map(activity => ({
            kind: activity.reason,
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
        ports: ports && {
            min: ports.range.min || ports.range.port,
            max: ports.range.max || ports.range.port
        },
        protocol: data.connectivity,
        endpoint: data.base_address,
        rpcAddress: data.rpc_address,
        lastCommunication: data.last_communication,
        rtt: averageBy(data.latency_to_server),
        storage: mapApiStorage(data.storage),
        trusted: data.trusted,
        activities: activities,
        services: {
            storage: _mapStorageService(storage_nodes_info, reasonByMount),
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
        debugMode: {
            state: Boolean(debug.level),
            timeLeft: debug.time_left
        },
        diagnostics: diagnostics
    };
}

function _mapStorageService({ mode, enabled, nodes }, reasonByMount) {
    return {
        mode,
        enabled: Boolean(enabled),
        nodes: nodes.map(node => {
            const { name, mode, drive, latency_of_disk_read, storage,
                latency_of_disk_write, data_activity } = node;
            const activity = data_activity && {
                kind: data_activity.reason,
                progress: data_activity.progress,
                stage: data_activity.stage.name
            };

            return {
                name,
                mode,
                storage: mapApiStorage(storage),
                drive: drive.drive_id,
                mount: drive.mount,
                readLatency: averageBy(latency_of_disk_read),
                writeLatency: averageBy(latency_of_disk_write),
                activity,
                untrusted: reasonByMount[drive.drive_id] || []
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

function _clearOverallocated(state, queryLimit, hostLimit) {
    let overallocatedQueries = Math.max(0, Object.keys(state.queries).length - queryLimit);
    let overallocatedHosts = Math.max(0, Object.keys(state.items).length - hostLimit);

    if (overallocatedQueries > 0 || overallocatedHosts > 0) {
        const lockedQueries = new Set(Object.values(state.views));
        const cadidateQueries =  Object.values(state.queries)
            .filter(query => !lockedQueries.has(query.key) && !query.fetching)
            .sort(createCompareFunc(query => query.timestamp));

        // Remove queries or items
        const queries = { ...state.queries };
        const items = { ...state.items };
        for (const query of cadidateQueries) {
            queries[query.key] = undefined;
            --overallocatedQueries;

            const lockedHosts = new Set(flatMap(
                Object.values(queries),
                query => (query && !query.fetching) ? query.result.items : []
            ));

            for (const host of query.result.items) {
                if (!lockedHosts.has(host)) {
                    items[host] = undefined;
                    --overallocatedHosts;
                }
            }

            if (overallocatedQueries === 0 && overallocatedHosts <= 0) {
                break;
            }
        }

        // Use mapValues to omit undefined keys.
        return {
            ...state,
            queries: mapValues(queries, echo),
            items: mapValues(items, echo)
        };

    } else {
        return state;
    }
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
