'use strict';

const _ = require('lodash');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const history_data_store = require('../analytic_services/history_data_store');

function collect_all_stats() {
    dbg.log0('STATS_COLLECTOR:', 'BEGIN');
    return collect_system_stats()
        .then(() => dbg.log0('STATS_COLLECTOR:', 'END'));
}

function collect_system_stats() {
    let stats_store = history_data_store.StatsStore.instance();
    let support_account = _.find(system_store.data.accounts, account => account.is_support);
    let system = system_store.data.systems[0];
    return server_rpc.client.system.read_system({}, {
            auth_token: auth_server.make_auth_token({
                system_id: system._id,
                role: 'admin',
                account_id: support_account._id
            })
        }).then(system_data => stats_store.insert(system_data))
        .catch(err => dbg.error('failed to collect system stats into history store,', err));
}

exports.collect_all_stats = collect_all_stats;
