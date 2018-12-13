/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { pick } from 'utils/core-utils';
import {
    COMPLETE_FETCH_SYSTEM_INFO,
    FETCH_VERSION_RELEASE_NOTES,
    COMPLETE_FETCH_VERSION_RELEASE_NOTES,
    FAIL_FETCH_VERSION_RELEASE_NOTES
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload, timestamp }) {
    const {
        version,
        upgrade,
        dns_name,
        ip_address,
        has_ssl_cert,
        remote_syslog_config,
        maintenance_mode
    } = payload;

    const { releaseNotes } = state || {};

    return {
        version,
        dnsName: dns_name,
        ipAddress: ip_address,
        sslCert: has_ssl_cert ? {} : undefined,
        upgrade: _mapUpgrade(upgrade),
        remoteSyslog: _mapRemoteSyslog(remote_syslog_config),
        releaseNotes,
        vmTools: _mapVMTools(payload),
        p2pSettings: _mapP2PSettings(payload),
        maintenanceMode: {
            till:  maintenance_mode.state ? timestamp + maintenance_mode.time_left : 0
        }
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

// ------------------------------
// Local util functions
// ------------------------------
function _mapUpgrade(upgradeInfo) {
    const { last_upgrade, can_upload_upgrade_package } = upgradeInfo;

    return {
        lastUpgrade: last_upgrade && {
            time:last_upgrade.timestamp,
            initiator: last_upgrade.last_initiator_email
        },
        preconditionFailure: can_upload_upgrade_package
    };
}

function _mapRemoteSyslog(config) {
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

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [FETCH_VERSION_RELEASE_NOTES]: onFetchVersionReleaseNotes,
    [COMPLETE_FETCH_VERSION_RELEASE_NOTES]: onCompleteFetchVersionReleaseNotes,
    [FAIL_FETCH_VERSION_RELEASE_NOTES]: onFailFetchVersionReleaseNotes
});
