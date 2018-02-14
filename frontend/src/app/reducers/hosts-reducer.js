/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { keyByProperty, averageBy, deepFreeze, groupBy } from 'utils/core-utils';
import { paginationPageSize } from 'config';
import { mapApiStorage } from 'utils/state-utils';
import {
    initialState,
    handleFetch,
    handleFetchCompleted,
    handleFetchFailed,
    handleUpdateItem,
    handleDropView,
    handleRemoveItem
} from 'utils/item-cache-utils';
import {
    FETCH_HOSTS,
    COMPLETE_FETCH_HOSTS,
    FAIL_FETCH_HOSTS,
    COLLECT_HOST_DIAGNOSTICS,
    COMPLETE_COLLECT_HOST_DIAGNOSTICS,
    FAIL_COLLECT_HOST_DIAGNOSTICS,
    COMPLETE_SET_HOST_DEBUG_MODE,
    DROP_HOSTS_VIEW,
    REMOVE_HOST
} from 'action-types';

const inMemoryQueryLimit = 10;
const inMemoryHostLimit = paginationPageSize * inMemoryQueryLimit;
const endpointUsageStatsTimeSpan = 7 * 24 * 60 * 60 * 1000; /* 7 days in miliseconds */
const eventToReasonCode = deepFreeze({
    PERMISSION_EVENT: 'TEMPERING',
    DATA_EVENT: 'CORRUPTION'
});

// ------------------------------
// Initial State
// ------------------------------
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
    return handleFetch(
        state,
        query,
        view,
        timestamp,
        inMemoryQueryLimit,
        inMemoryHostLimit
    );
}

function onCompleteFetchHosts(state, { payload }) {
    const { query, response } = payload;

    const items = keyByProperty(
        response.hosts,
        'name',
        data => _mapDataToHost(state.items[data.name], data, query.timestamp)
    );

    const counters = {
        nonPaginated: response.counters.non_paginated,
        byMode: response.counters.by_mode
    };

    return handleFetchCompleted(
        state,
        payload.query,
        items,
        { counters },
        inMemoryQueryLimit,
        inMemoryHostLimit
    );
}

function onFailFetchHosts(state, { payload }) {
    return handleFetchFailed(state, payload.query);
}

function onCollectHostDiagnostics(state, { payload }) {
    const diagnostics = {
        collecting: true,
        error: false,
        packageUri: ''
    };

    return handleUpdateItem(
        state,
        payload.host,
        { diagnostics }
    );
}

function onCompleteCollectHostDiagnostics(state, { payload }) {
    const diagnostics = {
        collecting: false,
        error: false,
        packageUri: payload.packageUri
    };

    return handleUpdateItem(
        state,
        payload.host,
        { diagnostics }
    );
}

function onFailCollectHostDiagnostics(state, { payload }) {
    const diagnostics = {
        collecting: false,
        error: true,
        packageUri: ''
    };

    return handleUpdateItem(
        state,
        payload.host,
        { diagnostics }
    );
}

function onCompleteSetHostDebugMode(state, { payload }) {
    const debugMode = {
        state: payload.on,
        timeLeft: undefined
    };

    return handleUpdateItem(
        state,
        payload.host,
        { debugMode }
    );
}

function onDropHostsView(state, { payload }) {
    return handleDropView(state, payload.view);
}

function onRemoveHost(state, { payload } ) {
    const { host } = payload;
    return handleRemoveItem(
        state,
        host,
        extras => {
            const { nonPaginated, byMode } = extras.counters;
            const hostMode = state.items[host].mode;
            const counters = {
                nonPaginated: nonPaginated - 1,
                byMode: {
                    ...byMode,
                    [hostMode] : byMode[hostMode] ? byMode[hostMode] - 1 : 0
                }
            };
            return { counters };
        }
    );
}

// ------------------------------
// Local util functions
// ------------------------------

function _mapDataToHost(host = {}, data, fetchTime) {
    const { storage_nodes_info, s3_nodes_info, os_info, ports, debug } = data;
    const { diagnostics = initialHostDiagnosticsState } = host;

    const reasonByMount = groupBy(
        data.untrusted_reasons || [],
        reason => reason.drive.drive_id,
        reason => reason.events.map(item => {
            const { event, time } = item;
            const reason = eventToReasonCode[event];
            return { reason, time };
        })
    );

    const cpuUnits = os_info.cpus
        .map( cpu => ({
            model: cpu.model,
            speed: cpu.speed
        }));

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
            endpoint: _mapEndpointService(s3_nodes_info, fetchTime)
        },
        upTime: os_info.uptime,
        os: os_info.ostype,
        cpus: {
            units: cpuUnits,
            usedByOther: os_info.cpu_usage - data.process_cpu_usage,
            usedByNoobaa: data.process_cpu_usage
        },
        memory: {
            free: os_info.freemem,
            usedByNoobaa: data.process_mem_usage,
            usedByOther: os_info.totalmem - os_info.freemem
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

function _mapEndpointService(endpointData, fetchTime) {
    const { mode, enabled, stats } = endpointData;
    const serviceState = {
        mode,
        enabled: Boolean(enabled)
    };

    if (stats) {
        const sevenDaysAgo  = fetchTime - endpointUsageStatsTimeSpan;
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
    [DROP_HOSTS_VIEW]: onDropHostsView,
    [REMOVE_HOST]: onRemoveHost
});
