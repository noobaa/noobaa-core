'use strict';

// let _ = require('lodash');
let P = require('../util/promise');
var mocha = require('mocha');
let assert = require('assert');
let coretest = require('./coretest');
let promise_utils = require('../util/promise_utils');
var S3Auth = require('aws-sdk/lib/signers/s3');
var s3_auth = new S3Auth();
var dotenv = require('dotenv');
dotenv.load();

mocha.describe('system_servers', function() {

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
    const ACCESS_KEYS = { 
        access_key: 'ydaydayda', 
        secret_key: 'blablabla' 
    };
    const CLOUD_SYNC_CONNECTION = 'Connection 1';

    let client = coretest.new_test_client();

    mocha.it('works', function() {
        this.timeout(60000);
        return P.resolve()
            ///////////////
            //  ACCOUNT  //
            ///////////////
            .then(() => client.account.accounts_status())
            .then(res => assert(!res.has_accounts, '!has_accounts'))
            .then(() => client.account.create_account({
                name: SYS,
                email: EMAIL,
                password: PASSWORD,
                access_keys: ACCESS_KEYS
            }))
            .then(res => client.options.auth_token = res.token)
            .then(() => client.account.accounts_status())
            .then(res => assert(res.has_accounts, 'has_accounts'))
            .then(() => client.account.read_account({ email: EMAIL }))
            .then(() => client.account.list_accounts())
            .then(() => client.account.get_account_sync_credentials_cache())
            .then(() => client.system.read_system())
            .then(() => client.account.update_account({
                email: EMAIL,
                name: SYS1,
            }))
            .then(() => client.system.update_system({
                name: SYS1,
            }))
            .then(() => client.system.read_system())
            .then(() => client.system.update_system({
                name: SYS,
            }))
            .then(() => client.account.create_account({
                name: EMAIL1,
                email: EMAIL1,
                password: PASSWORD,
                access_keys: ACCESS_KEYS
            }))
            .then(() => client.system.read_system())
            .then(() => client.system.add_role({
                email: EMAIL1,
                role: 'admin',
            }))
            .then(() => client.system.read_system())
            .then(() => client.system.remove_role({
                email: EMAIL1,
                role: 'admin',
            }))
            .then(() => client.system.read_system())
            .then(() => client.account.delete_account({
                email: EMAIL1
            }))
            .then(() => client.system.read_system())
            .then(() => client.system.list_systems())
            .then(() => client.system.read_activity_log({
                limit: 2016
            }))
            ////////////
            //  AUTH  //
            ////////////
            .then(() => client.auth.read_auth())
            .then(() => client.auth.create_auth({
                email: EMAIL,
                password: PASSWORD,
                system: SYS,
            }))
            .then(() => {
                return P.resolve(client.system.read_system())
                    .then((res) => client.auth.create_access_key_auth({
                        access_key: res.owner.access_keys[0].access_key,
                        string_to_sign: '',
                        signature: s3_auth.sign(res.owner.access_keys[0].secret_key, '')
                    }));
            })
            //////////////
            //  SYSTEM  //
            //////////////
            .then(() => client.system.update_base_address({
                base_address: 'fcall://fcall'
            }))
            .then(() => client.system.update_n2n_config({
                tcp_active: true
            }))
            .then(() => client.system.update_system_certificate()
                .catch(err => assert.deepEqual(err.rpc_code, 'TODO'))
            )
            //.then(() => client.system.start_debug({level:0}))
            .then(() => client.system.diagnose())
            .then(() => client.system.create_system({
                name: SYS1
            }))
            .then(() => client.create_auth_token({
                email: EMAIL,
                password: PASSWORD,
                system: SYS1,
            }))
            .then(() => client.system.delete_system())
            .then(() => client.create_auth_token({
                email: EMAIL,
                password: PASSWORD,
                system: SYS,
            }))
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
            .then(() => client.pool.update_pool({
                name: POOL,
                new_name: POOL + 1,
            }))
            .then(() => client.pool.assign_nodes_to_pool({
                name: POOL + 1,
                nodes: ['node3', 'node4', 'node5'],
            }))
            .then(() => client.pool.update_pool({
                name: POOL + 1,
                new_name: POOL,
            }))
            .then(() => client.pool.assign_nodes_to_pool({
                name: 'default_pool',
                nodes: ['node1', 'node3', 'node5'],
            }))
            .then(() => client.system.read_system())
            .then(() => client.pool.list_pool_nodes({
                name: POOL
            }))
            .then(() => client.pool.get_associated_buckets({
                name: POOL
            }))
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
                name: TIER,
            }))
            .then(() => client.tier.update_tier({
                name: TIER,
                replicas: 980
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
            .then(() => client.tiering_policy.update_policy({
                    name: TIERING_POLICY,
                    tiers: [{
                        order: 0,
                        tier: TIER
                    }, {
                        order: 1,
                        tier: TIER
                    }]
                })
                .catch(err => assert.deepEqual(err.rpc_code, 'TODO'))
            )
            .then(() => client.tiering_policy.get_policy_pools({
                name: TIERING_POLICY
            }))
            .then(() => client.system.read_system())
            // //////////////
            // //  BUCKET  //
            // //////////////
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
                tiering: TIERING_POLICY //'default_tiering',
            }))
            .then(() => client.bucket.read_bucket({
                name: BUCKET + 1,
            }))
            .then(() => client.bucket.update_bucket({
                name: BUCKET + 1,
                new_name: BUCKET,
            }))
            .then(() => client.account.add_account_sync_credentials_cache({
                name: CLOUD_SYNC_CONNECTION,
                endpoint: 'https://s3.amazonaws.com',
                access_key: process.env.AWS_ACCESS_KEY_ID,
                secret_key: process.env.AWS_SECRET_ACCESS_KEY
            }))
            .then(() => client.bucket.set_cloud_sync({
                name: BUCKET,
                connection: CLOUD_SYNC_CONNECTION,
                policy: {
                    target_bucket: BUCKET,
                    schedule: 11
                }
            }))
            .then(() => client.bucket.get_cloud_buckets({
                connection: CLOUD_SYNC_CONNECTION
            }))
            .then(() => client.system.read_system())
            .then(() => client.bucket.get_cloud_sync_policy({
                name: BUCKET,
            }))
            .then(() => client.bucket.delete_cloud_sync({
                name: BUCKET,
            }))
            .then(() => client.bucket.get_all_cloud_sync_policies())
            .then(() => client.system.read_system())
            // /////////////
            // //  STATS  //
            // /////////////
            .then(() => client.stats.get_systems_stats())
            .then(() => client.stats.get_nodes_stats())
            .then(() => client.stats.get_ops_stats())
            .then(() => client.stats.get_all_stats())
            ////////////
            //  MISC  //
            ////////////
            .then(() => client.cluster_server.get_cluster_id())
            .then(() => client.debug.set_debug_level({
                module: 'rpc',
                level: 0
            }))
            /////////////////
            //  deletions  //
            /////////////////
            .then(() => client.bucket.delete_bucket({
                name: BUCKET,
            }))
            .then(() => client.tiering_policy.delete_policy({
                name: TIERING_POLICY,
            }))
            .then(res => {
                    throw new Error('TIERING_POLICY: ' + TIERING_POLICY +
                        ' should have been deleted by now');
                },
                err => {
                    if (err.rpc_code && err.rpc_code.indexOf('NO_SUCH_TIERING_POLICY') > -1) {
                        return;
                    } else {
                        throw new Error(err);
                    }
                }
            )
            .then(() => client.tier.delete_tier({
                name: TIER,
            }))
            .then(() => {
                    throw new Error('TIER: ' + TIER +
                        ' should have been deleted by now');
                },
                err => {
                    if (err.rpc_code && err.rpc_code.indexOf('NO_SUCH_TIER') > -1) {
                        return;
                    } else {
                        throw new Error(err);
                    }
                }
            )
            .then(() => client.pool.assign_nodes_to_pool({
                name: 'default_pool',
                nodes: ['node0', 'node2', 'node4'],
            }))
            .then(() => client.pool.delete_pool({
                name: POOL,
            }))
            .then(() => client.system.read_system())
            .then(() => client.system.delete_system());
    });
});
