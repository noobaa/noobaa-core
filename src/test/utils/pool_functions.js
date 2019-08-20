/* Copyright (C) 2016 NooBaa */
'use strict';

const test_utils = require('../system_tests/test_utils');

class PoolFunctions {

    constructor(client) {
        this._client = client;
    }

    //Wrapping the create_hosts_pool into this pool functions.
    async create_pool(pool_name, agent_number) {
        try {
            await test_utils.create_hosts_pool(this._client, pool_name, agent_number);
        } catch (e) {
            console.error(`failed to create pool`);
            throw e;
        }
    }

    //Wrapping the delete_hosts_pool into this pool functions.
    async delete_pool(pool_name) {
        try {
            await test_utils.delete_hosts_pool(this._client, pool_name);
        } catch (e) {
            console.error(`failed to delete pool`);
            throw e;
        }
    }

    _verify_data_placement(data_placement) {
        if (data_placement !== 'SPREAD' && data_placement !== 'MIRROR') {
            throw new Error(`data_placement must be SPREAD or MIRROR, got ${data_placement}`);
        }
    }

    async change_tier(pool_name, bucket, data_placement) {
        if (data_placement !== 'INTERNAL') {
            this._verify_data_placement(data_placement);
            const read_bucket = await this._client.bucket.read_bucket({ name: bucket });
            console.log(`Setting ${pool_name} as the pool for bucket: ${bucket}`);
            await this._client.tier.update_tier({
                name: read_bucket.tiering.tiers[0].tier,
                attached_pools: [pool_name],
                data_placement
            });
        }
    }

}

exports.PoolFunctions = PoolFunctions;
