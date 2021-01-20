/* Copyright (C) 2016 NooBaa */
'use strict';

// var _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const bg_workers = require('../bg_workers');
// const server_rpc = require('../server_rpc');
// const auth_server = require('../common_services/auth_server');
const cutil = require('../utils/clustering_utils');

var is_cluster_master = false;

exports.background_worker = background_worker;

function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('System did not finish initial load');
        return;
    }

    dbg.log2(`checking cluster_master`);
    dbg.log0('no local cluster info or server is not part of a cluster. therefore will be cluster master');
    return cutil.send_master_update(true)
        .then(() => {
            if (!is_cluster_master) {
                bg_workers.run_master_workers();
                is_cluster_master = true;
            }
        })
        .catch(err => {
            dbg.error('send_master_update had an error:', err.stack || err);
        });
}