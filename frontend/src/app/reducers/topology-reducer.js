
/* Copyright (C) 2016 NooBaa */

import { keyByProperty, flatMap, pick } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { mapApiStorage } from 'utils/state-utils';
import {
    COMPLETE_FETCH_SYSTEM_INFO
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload, timestamp }) {
    const { cluster } = payload;

    const serverList = flatMap(
        cluster.shards,
        shard => shard.servers
            .map(server => {
                const { servers = {} } = state || {};
                const { [server.secret]: serverState = {} } = servers;
                return _mapServer(serverState, server, cluster.master_secret, timestamp);
            })
    );

    const servers = keyByProperty(serverList, 'secret');
    const serverMinRequirements = _mapMinRequirements(cluster.min_requirements);

    const serverCount = serverList.length;
    const disconnectedCount = serverList.filter(server => server.mode === 'DISCONNECTED').length;
    const supportHighAvailability = serverCount >= 3;
    const isHighlyAvailable = supportHighAvailability && cluster.shards[0].high_availabilty;
    const faultTolerance = Math.max(
        Math.ceil(serverCount / 2 - 1) - disconnectedCount,
        0
    );

    return {
        servers,
        serverMinRequirements,
        supportHighAvailability,
        isHighlyAvailable,
        faultTolerance
    };
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapServer(serverState, update, masterSecret, timestamp) {
    return {
        hostname: update.hostname,
        secret: update.secret,
        mode: update.status,
        version: update.version,
        addresses: _mapAddresses(update),
        timezone: update.timezone,
        locationTag: update.location,
        storage: mapApiStorage(update.storage),
        memory: pick(update.memory, ['total', 'used']),
        cpus: pick(update.cpus, ['count', 'usage']),
        clockSkew: timestamp - (update.time_epoch * 1000),
        dns: _mapDNS(update),
        phonehome: _mapPhonehome(update),
        clusterConnectivity: _mapClusterConnectivity(update),
        debugMode: Boolean(update.debug_level),
        isMaster: update.secret === masterSecret
    };
}

function _mapAddresses(update) {
    return update.addresses.map(addr => ({
        ip: addr
    }));
}

function _mapMinRequirements(requirements) {
    const { storage, ram: memory, cpu_count: cpus } = requirements;
    return { storage, memory, cpus };
}

function _mapDNS(server) {
    const { dns_name_resolution, dns_servers } = server.services_status;

    return {
        nameResolution: dns_name_resolution && {
            status: dns_name_resolution
        },
        servers: {
            list: server.dns_servers,
            status: dns_servers
        }
    };
}

function _mapPhonehome(server) {
    const { phonehome_server } = server.services_status;
    return {
        status: phonehome_server.status,
        lastStatusCheck: phonehome_server.test_time * 1000
    };
}

function _mapClusterConnectivity(server) {
    const { cluster_communication } = server.services_status;

    return keyByProperty(
        cluster_communication.results || {},
        'secret',
        result => result.status
    );
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
