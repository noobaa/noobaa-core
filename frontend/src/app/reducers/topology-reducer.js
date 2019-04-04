
/* Copyright (C) 2016 NooBaa */

import { keyByProperty, flatMap, pick, omitUndefined, get } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { mapApiStorage } from 'utils/state-utils';
import {
    COMPLETE_FETCH_SYSTEM_INFO,
    UPLOAD_UPGRADE_PACKAGE,
    UPDATE_UPGRADE_PACKAGE_UPLOAD,
    ABORT_UPGRADE_PACKAGE_UPLOAD
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

function onUploadUpgradePackage(state) {
    const master = Object.values(state.servers)
        .find(server => server.isMaster);

    const { package: pkg } = master.upgrade || {};
    if (pkg && (pkg.state === 'TESTING' || pkg.state === 'UPLOADING')) {
        return state;
    }

    const upgrade = {
        package: {
            state: 'UPLOADING',
            progress: 0
        }
    };

    return {
        ...state,
        servers: {
            ...state.servers,
            [master.secret]: {
                ...master,
                upgrade
            }
        }
    };
}

function onUpdateUpgradePackageUpload(state, { payload }) {
    const master = Object.values(state.servers)
        .find(server => server.isMaster);

    const { package: pkg } = master.upgrade || {};
    if (!pkg || pkg.state !== 'UPLOADING') {
        return state;
    }

    const upgrade = {
        package: {
            state: 'UPLOADING',
            progress: payload.progress
        }
    };

    return {
        ...state,
        servers: {
            ...state.servers,
            [master.secret]: {
                ...master,
                upgrade
            }
        }
    };
}

function onAbortUpgradePackageUpload(state) {
    const master = Object.values(state.servers)
        .find(server => server.isMaster);

    const { package: pkg } = master.upgrade || {};
    if (!pkg || pkg.state !== 'UPLOADING') {
        return state;
    }

    return {
        ...state,
        servers: {
            ...state.servers,
            [master.secret]: {
                ...master,
                upgrade: {}
            }
        }
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
        addresses: _mapAddresss(update),
        timezone: update.timezone,
        locationTag: update.location,
        storage: mapApiStorage(update.storage),
        memory: pick(update.memory, ['total', 'used']),
        cpus: pick(update.cpus, ['count', 'usage']),
        clockSkew: timestamp - (update.time_epoch * 1000),
        ntp: _mapNTP(update),
        dns: _mapDNS(update),
        proxy: _mapProxy(update),
        phonehome: _mapPhonehome(update),
        remoteSyslog: _mapRemoteSyslog(update),
        clusterConnectivity: _mapClusterConnectivity(update),
        debugMode: Boolean(update.debug_level),
        isMaster: update.secret === masterSecret,
        upgrade: _mapUpgradeState(serverState.upgrade, update.upgrade)
    };
}

function _mapAddresss(update) {
    const { addresses, ip_collision = [] } = update;
    return addresses.map(addr => ({
        ip: addr,
        collision: ip_collision.includes(addr)
    }));
}

function _mapMinRequirements(requirements) {
    const { storage, ram: memory, cpu_count: cpus } = requirements;
    return { storage, memory, cpus };
}

function _mapNTP(server) {
    if (!server.ntp_server) return;

    return {
        server: server.ntp_server,
        status: server.services_status.ntp_server
    };
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
        },
        searchDomains: server.search_domains
    };
}

function _mapProxy(server) {
    const { phonehome_proxy } = server.services_status;
    if (!phonehome_proxy) return;

    return {
        status: phonehome_proxy
    };
}

function _mapPhonehome(server) {
    const { phonehome_server } = server.services_status;
    return {
        status: phonehome_server.status,
        lastStatusCheck: phonehome_server.test_time * 1000
    };
}

function _mapRemoteSyslog(server) {
    const { remote_syslog } = server.services_status;
    if (!remote_syslog) return;

    return {
        status: remote_syslog.status,
        lastStatusCheck: remote_syslog.test_time * 1000
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

function _mapUpgradeState(state, upgrade) {
    const { status, staged_package, tested_date, error } = upgrade;
    const testedPkg = omitUndefined({
        state: 'TESTED',
        testedAt: tested_date,
        version: staged_package
    });

    switch (status) {
        case 'COMPLETED': {
            const pkgState = get(state, ['package', 'state']);
            return pkgState === 'UPLOADING' ?
                state :
                {};
        }
        case 'PENDING': {
            return {
                package: {
                    state: 'TESTING'
                }
            };
        }
        case 'FAILED': {
            return {
                package: {
                    ...testedPkg,
                    error: {
                        message: error.message,
                        reportInfo: error.report_info
                    }
                }
            };
        }
        case 'CAN_UPGRADE': {
            return {
                package: testedPkg
            };
        }
        case 'PRE_UPGRADE_PENDING': {
            return {
                progress: 0,
                package: testedPkg
            };
        }
        case 'PRE_UPGRADE_READY': {
            return {
                progress: .5,
                package: testedPkg
            };
        }
        case 'UPGRADING': {
            return {
                progress: .5,
                package: testedPkg
            };
        }
        case 'UPGRADE_FAILED': {
            return {
                package: testedPkg,
                error: error.message
            };
        }
        default: {
            return state;
        }
    }
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [UPLOAD_UPGRADE_PACKAGE]: onUploadUpgradePackage,
    [UPDATE_UPGRADE_PACKAGE_UPLOAD]: onUpdateUpgradePackageUpload,
    [ABORT_UPGRADE_PACKAGE_UPLOAD]: onAbortUpgradePackageUpload
});
