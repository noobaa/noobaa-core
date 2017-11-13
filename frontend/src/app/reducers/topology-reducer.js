/* Copyright (C) 2016 NooBaa */

import { keyByProperty, flatMap, pick } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { mapApiStorage } from 'utils/state-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    const { cluster } = payload;

    const serverList = flatMap(
        cluster.shards,
        shard => shard.servers.map(server =>
            _mapServer(cluster.master_secret, server)
        )
    );

    const servers = keyByProperty(serverList, 'secret');
    const serverMinRequirements = _mapMinRequirements(cluster.min_requirements);

    const supportHighAvailability = serverList.length >= 3;
    const isHighlyAvailable = supportHighAvailability && cluster.shards[0].high_availabilty;

    return {
        servers,
        serverMinRequirements,
        supportHighAvailability,
        isHighlyAvailable
    };
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapServer(masterSecret, server) {
    const {
        dns_servers: dnsCheck,
        dns_name_resolution: nameResolutionCheck,
        phonehome_server: phonehomeCheck,
        phonehome_proxy: proxyCheck,
        ntp_server: ntpCheck,
        remote_syslog: syslogCheck,
        cluster_communication: connectivityCheck
    } = server.services_status;

    return {
        hostname: server.hostname,
        secret: server.secret,
        mode: server.status,
        version: server.version,
        addresses: server.addresses,
        timezone: server.timezone,
        locationTag: server.location,
        storage: mapApiStorage(server.storage),
        memory: pick(server.memory, ['total', 'used']),
        cpus: pick(server.cpus, ['count', 'usage']),
        time: server.time_epoch * 1000,
        ntp: server.ntp_server && {
            server: server.ntp_server,
            status: ntpCheck
        },
        dns: {
            nameResolution: nameResolutionCheck && {
                status: nameResolutionCheck
            },
            servers: {
                list: server.dns_servers,
                status: dnsCheck
            },
            searchDomains: server.search_domains
        },
        proxy: proxyCheck && {
            status: proxyCheck.status
        },
        phonehome: {
            status: phonehomeCheck.status,
            lastStatusCheck: phonehomeCheck.test_time
        },
        remoteSyslog: syslogCheck && {
            status: syslogCheck.status,
            lastStatusCheck: syslogCheck.test_time
        },
        clusterConnectivity: keyByProperty(
            connectivityCheck.results || {},
            'secret',
            result => result.status
        ),
        debugMode: Boolean(server.debug_level),
        isMaster: server.secret === masterSecret
    };
}

function _mapMinRequirements(requirements) {
    const { storage, ram: memory, cpu_count: cpus } = requirements;
    return { storage, memory, cpus };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
