/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const HistoryDataStore = require('../analytic_services/history_data_store').HistoryDataStore;

function collect_all_stats() {
    dbg.log0('STATS_COLLECTOR:', 'BEGIN');
    return collect_system_stats()
        .then(() => dbg.log0('STATS_COLLECTOR:', 'END'));
}

function collect_system_stats() {
    const support_account = _.find(system_store.data.accounts, account => account.is_support);
    if (!support_account) {
        dbg.warn('collect_system_stats: no support account yet');
        return;
    }
    const system = system_store.data.systems[0];
    if (!system) {
        dbg.warn('collect_system_stats: no system yet');
        return;
    }
    return P.resolve()
        .then(() => server_rpc.client.system.read_system({}, {
            auth_token: auth_server.make_auth_token({
                system_id: system._id,
                role: 'admin',
                account_id: support_account._id
            })
        }))
        .then(system_data => HistoryDataStore.instance().insert(system_data))
        .catch(err => dbg.error('collect_system_stats: failed to collect system stats into history store,', err));
}

exports.collect_all_stats = collect_all_stats;
exports.collect_system_stats = collect_system_stats;
