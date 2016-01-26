// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

// let _ = require('lodash');
let P = require('../util/promise');
let assert = require('assert');
let coretest = require('./coretest');
let promise_utils = require('../util/promise_utils');

describe('system', function() {

    let client = coretest.new_client();
    const PREFIX = 'coretest';
    const SYS = PREFIX + '-system';
    const POOL = PREFIX + '-pool';
    const TIER = PREFIX + '-tier';
    const TIERING_POLICY = PREFIX + '-tiering-policy';
    const BUCKET = PREFIX + '-bucket';
    const SYS1 = SYS + '-1';
    const EMAIL_DOMAIN = '@coretest.coretest';
    const EMAIL = SYS + EMAIL_DOMAIN;
    const EMAIL1 = SYS1 + EMAIL_DOMAIN;
    const PASSWORD = SYS + '-password';

    it('account_api', function(done) {
        this.timeout(60000);
        P.resolve()
            ///////////////
            //  ACCOUNT  //
            ///////////////
            .then(() => client.account.accounts_status())
            .then(res => assert(!res.has_accounts, '!has_accounts'))
            .then(() => client.account.create_account({
                name: SYS,
                email: EMAIL,
                password: PASSWORD,
            }))
            .then(res => client.options.auth_token = res.token)
            .then(() => client.account.accounts_status())
            .then(res => assert(res.has_accounts, 'has_accounts'))
            .then(() => client.account.read_account())
            .then(() => client.account.list_accounts())
            .then(() => client.account.list_system_accounts())
            .then(() => client.account.get_account_sync_credentials_cache())
            .then(() => client.system.read_system())
            .then(() => client.account.update_account({
                name: SYS1,
            }))
            .then(() => client.system.update_system({
                name: SYS1,
            }))
            .then(() => client.system.read_system())
            .then(() => client.account.create_account({
                name: EMAIL1,
                email: EMAIL1,
                password: PASSWORD,
            }))
            .then(() => client.system.read_system())
            .then(() => client.system.add_role({
                email: EMAIL,
                role: 'admin',
            }))
            .then(() => client.system.read_system())
            .then(() => client.system.remove_role({
                email: EMAIL,
                role: 'admin',
            }))
            .then(() => client.system.read_system())
            .then(() => client.account.delete_account({
                email: EMAIL1
            }))
            .then(() => client.system.read_system())
            .then(() => client.system.list_systems())
            .then(() => client.system.read_activity_log())
            ////////////
            //  POOL  //
            ////////////
            .then(() => promise_utils.loop(10,
                i => client.node.create_node({
                    name: 'node' + i
                })))
            .then(() => client.pool.create_pool({
                name: POOL,
                nodes: ['node0', 'node1', 'node2'],
            }))
            .then(() => client.pool.read_pool({
                name: POOL,
            }))
            .then(() => client.pool.add_nodes_to_pool({
                name: POOL,
                nodes: ['node3', 'node4', 'node5'],
            }))
            .then(() => client.pool.remove_nodes_from_pool({
                name: POOL,
                nodes: ['node1', 'node3', 'node5'],
            }))
            .then(() => client.system.read_system())
            ////////////
            //  TIER  //
            ////////////
            .then(() => client.tier.create_tier({
                name: TIER,
                pools: [POOL],
                data_placement: 'SPREAD',
                replicas: 17,
                data_fragments: 919,
                parity_fragments: 42,
            }))
            .then(() => client.tier.read_tier({
                name: 'cloud',
                new_name: 'cloudy',
            }))
            .then(() => client.system.read_system())
            //////////////////////
            //  TIERING_POLICY  //
            //////////////////////
            .then(() => client.tiering_policy.create_policy({
                name: TIERING_POLICY,
                tiers: [{
                    order: 0,
                    tier: TIER
                }]
            }))
            .then(() => client.tiering_policy.read_policy({
                name: TIERING_POLICY
            }))
            .then(() => client.system.read_system())
            //////////////
            //  BUCKET  //
            //////////////
            .then(() => client.bucket.create_bucket({
                name: BUCKET,
                tiering: TIERING_POLICY,
            }))
            .then(() => client.bucket.read_bucket({
                name: BUCKET,
            }))
            .then(() => client.bucket.list_buckets())
            .then(() => client.bucket.update_bucket({
                name: BUCKET,
                new_name: BUCKET + 1,
                tiering: 'default_tiering',
            }))
            .then(() => client.bucket.read_bucket({
                name: BUCKET + 1,
            }))
            .then(() => client.bucket.update_bucket({
                name: BUCKET + 1,
                new_name: BUCKET,
            }))
            .then(() => client.system.read_system())
            /////////////////
            //  deletions  //
            /////////////////
            .then(() => client.bucket.delete_bucket({
                name: BUCKET,
            }))
            .then(() => client.tiering_policy.delete_policy({
                name: TIERING_POLICY,
            }))
            .then(() => client.tier.delete_tier({
                name: TIER,
            }))
            .then(() => client.pool.delete_pool({
                name: POOL,
            }))
            .then(() => client.system.read_systems())
            .then(() => client.system.delete_system())
            .nodeify(done);
    });
});
