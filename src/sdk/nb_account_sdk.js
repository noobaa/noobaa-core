/* Copyright (C) 2016 NooBaa */
'use strict';

const AccountSDK = require('../sdk/account_sdk');
const BucketSpaceNB = require('./bucketspace_nb');
const AccountSpaceNB = require('../sdk/accountspace_nb');

// NBAccountSDK was based on AccountSDK
class NBAccountSDK extends AccountSDK {
     /**
     * @param {{
     *      rpc_client: nb.APIClient;
     *      internal_rpc_client: nb.APIClient;
     *      stats: import("../sdk/endpoint_stats_collector").EndpointStatsCollector;
     * }} args
     */
    constructor({rpc_client, internal_rpc_client, stats}) {
        const bucketspace = new BucketSpaceNB({ rpc_client, internal_rpc_client });
        const accountspace = new AccountSpaceNB({ rpc_client, internal_rpc_client });

        super({
            rpc_client: rpc_client,
            internal_rpc_client: internal_rpc_client,
            bucketspace: bucketspace,
            accountspace: accountspace,
            stats
        });
    }
}

module.exports = NBAccountSDK;
