/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { pick } from 'utils/core-utils';
import {
    COMPLETE_FETCH_SYSTEM_INFO,
    FETCH_VERSION_RELEASE_NOTES,
    COMPLETE_FETCH_VERSION_RELEASE_NOTES,
    FAIL_FETCH_VERSION_RELEASE_NOTES,
    COLLECT_SYSTEM_DIAGNOSTICS,
    COMPLETE_COLLECT_SYSTEM_DIAGNOSTICS,
    FAIL_COLLECT_SYSTEM_DIAGNOSTICS
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

const diagnosticsInitialState = {
    collecting: false,
    error: false,
    packageUri: ''
};

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload, timestamp }) {
    return {
        version: payload.version,
        dnsName: payload.dns_name,
        ipAddress: payload.ip_address,
        sslCert: payload.has_ssl_cert ? {} : undefined,
        upgrade: _mapUpgrade(payload),
        remoteSyslog: _mapRemoteSyslog(payload),
        vmTools: _mapVMTools(payload),
        p2pSettings: _mapP2PSettings(payload),
        proxyServer: _mapProxyServer(payload),
        phoneHome:_mapPhoneHome(payload),
        debug: _mapDebug(payload, timestamp),
        maintenanceMode: _mapMaintenanceMode(payload, timestamp),
        releaseNotes: state && state.releaseNotes,
        diagnostics: state ? state.diagnostics : diagnosticsInitialState,
        internalStorage: _mapInternalStorage(pools.find(pool =>
            pool.resource_type === 'INTERNAL'
        ))
    };
}

function onFetchVersionReleaseNotes(state, { payload }) {
    const { version } = payload;
    const releaseNotes = {
        ...state.releaseNotes || {},
        [version]: {
            fetching: true
        }
    };

    return {
        ...state,
        releaseNotes
    };
}

function onCompleteFetchVersionReleaseNotes(state, { payload }) {
    const { version, notes } = payload;
    const releaseNotes = {
        ...state.releaseNotes,
        [version]: {
            fetching: false,
            text: notes
        }
    };

    return {
        ...state,
        releaseNotes
    };
}

function onFailFetchVersionReleaseNotes(state, { payload }) {
    const { version } = payload;
    const releaseNotes = {
        ...state.releaseNotes,
        [version]: {
            fetching: false,
            error: true
        }
    };

    return {
        ...state,
        releaseNotes
    };
}

function onCollectSystemDiagnostics(state) {
    return {
        ...state,
        diagnostics: {
            collecting: true,
            error: false,
            packageUri: ''
        }
    };
}

function onCompleteCollectSystemDiagnostics(state, { payload }) {
    return {
        ...state,
        diagnostics: {
            collecting: false,
            error: false,
            packageUri: payload.packageUri
        }
    };
}

function onFailCollectSystemDiagnostics(state) {
    return {
        ...state,
        diagnostics: {
            collecting: false,
            error: true,
            packageUri: ''
        }
    };
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapUpgrade(payload) {
    const { last_upgrade, can_upload_upgrade_package } = payload.upgrade;

    return {
        lastUpgrade: last_upgrade && {
            time:last_upgrade.timestamp,
            initiator: last_upgrade.last_initiator_email
        },
        preconditionFailure: can_upload_upgrade_package
    };
}

function _mapRemoteSyslog(payload) {
    const config = payload.remote_syslog_config;
    if (!config) return;

    return pick(config, ['protocol', 'address', 'port']);
}

function _mapVMTools(payload) {
    const { cluster } = payload;
    const { vmtools_installed } = cluster.shards
        .find(shard =>
            shard.servers.find(server =>
                server.secret === cluster.master_secret
            )
        );

    return vmtools_installed ? 'INSTALLED' : 'NOT_INSTALLED';
}

function _mapP2PSettings(payload) {
    const { port, min, max } = payload.n2n_config.tcp_permanent_passive;
    return {
        tcpPortRange: {
            start: min || port || 1,
            end: max || port || 1
        }
    };
}

function _mapProxyServer(payload) {
    const { proxy_address } = payload.phone_home_config;
    if (!proxy_address) {
        return;
    }

    const url = new URL(proxy_address);
    return {
        endpoint: url.hostname,
        port: Number(url.port) || 80
    };
}

function _mapPhoneHome(payload) {
    const reachable = !payload.phone_home_config.phone_home_unable_comm;
    return { reachable };
}

function _mapDebug(payload, timestamp) {
    const { level, time_left } = payload.debug;
    const till = time_left ?  timestamp + time_left : 0;
    return { level, till };
}

function _mapMaintenanceMode(payload, timestamp) {
    const { state, time_left } = payload.maintenance_mode;
    const till = state ? timestamp + time_left : 0;
    return { till };
}

function _mapInternalStorage(internalResource) {
    return internalResource ?
        pick(internalResource.storage, ['total', 'used']) :
        { total: 0, used: 0 };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [FETCH_VERSION_RELEASE_NOTES]: onFetchVersionReleaseNotes,
    [COMPLETE_FETCH_VERSION_RELEASE_NOTES]: onCompleteFetchVersionReleaseNotes,
    [FAIL_FETCH_VERSION_RELEASE_NOTES]: onFailFetchVersionReleaseNotes,
    [COLLECT_SYSTEM_DIAGNOSTICS]: onCollectSystemDiagnostics,
    [COMPLETE_COLLECT_SYSTEM_DIAGNOSTICS]: onCompleteCollectSystemDiagnostics,
    [FAIL_COLLECT_SYSTEM_DIAGNOSTICS]: onFailCollectSystemDiagnostics
});
