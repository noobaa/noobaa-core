/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 490]*/
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const S3Auth = require('aws-sdk/lib/signers/s3');

const P = require('../../util/promise');
const zip_utils = require('../../util/zip_utils');
const config = require('../../../config');

mocha.describe('system_servers', function() {

    const { rpc_client, SYSTEM, EMAIL, PASSWORD } = coretest;
    const PREFIX = 'system-servers';
    const POOL = `${PREFIX}-pool`;
    const TIER = `${PREFIX}-tier`;
    const TIERING_POLICY = `${PREFIX}-tiering-policy`;
    const BUCKET = `${PREFIX}-bucket`;
    const NAMESPACE_BUCKET = `${PREFIX}-namespace-bucket`;
    const SYS1 = `${PREFIX}-${SYSTEM}-1`;
    const EMAIL1 = `${PREFIX}-${EMAIL}`;
    const NAMESPACE_RESOURCE_CONNECTION = 'Majestic Namespace Sloth';
    const NAMESPACE_RESOURCE_NAME = `${PREFIX}-namespace-resource`;
    const SERVER_RESTART_DELAY = 10000;
    let server_secret = '';
    let nodes_list;

    ///////////////
    //  ACCOUNT  //
    ///////////////

    mocha.it('account works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.account.accounts_status())
            .then(res => assert(res.has_accounts, 'has_accounts'))
            .then(() => rpc_client.account.read_account({
                email: EMAIL
            }))
            .then(() => rpc_client.account.list_accounts())
            .then(() => rpc_client.system.read_system())
            .then(() => rpc_client.account.update_account({
                email: EMAIL,
                name: EMAIL1,
            }))
            .then(() => rpc_client.system.read_system())
            .then(() => rpc_client.account.update_account({
                email: EMAIL,
                name: EMAIL,
            }))
            .then(() => rpc_client.account.create_account({
                name: EMAIL1,
                email: EMAIL1,
                password: EMAIL1,
                has_login: true,
                s3_access: true,
                allowed_buckets: {
                    full_permission: false,
                    permission_list: []
                },
                default_pool: config.NEW_SYSTEM_POOL_NAME
            }))
            .then(() => rpc_client.system.read_system())
            .then(() => rpc_client.system.add_role({
                email: EMAIL1,
                role: 'admin',
            }))
            .then(() => rpc_client.system.read_system())
            .then(() => rpc_client.system.remove_role({
                email: EMAIL1,
                role: 'admin',
            }))
            .then(() => rpc_client.system.read_system())
            .then(() => rpc_client.account.delete_account({
                email: EMAIL1
            }))
            .then(() => rpc_client.system.read_system())
            .then(res => {
                server_secret = res.cluster.master_secret;
                return rpc_client.system.list_systems();
            })
            .then(() => rpc_client.events.read_activity_log({
                limit: 2016
            }));
    });

    ////////////
    //  AUTH  //
    ////////////

    mocha.it('auth works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.auth.read_auth())
            .then(() => rpc_client.auth.create_auth({
                system: SYSTEM,
                email: EMAIL,
                password: PASSWORD,
            }))
            .then(() => rpc_client.system.read_system())
            .then(res => rpc_client.auth.create_access_key_auth({
                access_key: res.owner.access_keys[0].access_key,
                string_to_sign: '',
                signature: new S3Auth().sign(res.owner.access_keys[0].secret_key, '')
            }).then(() => res))
            .then(res => rpc_client.auth.create_access_key_auth({
                access_key: res.owner.access_keys[0].access_key,
                string_to_sign: 'blabla',
                signature: 'blibli'
            }))
            .then(
                () => assert.ifError('should fail with UNAUTHORIZED'),
                err => assert.deepEqual(err.rpc_code, 'UNAUTHORIZED')
            );
    });


    //////////////
    //  SYSTEM  //
    //////////////

    mocha.it('system works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.system.update_base_address({
                base_address: 'fcall://fcall'
            }))
            .then(() => rpc_client.system.update_n2n_config({
                config: {}
            }))
            //.then(() => rpc_client.system.start_debug({level:0}))
            .then(() => rpc_client.cluster_server.update_time_config({
                epoch: Math.round(Date.now() / 1000),
                target_secret: server_secret,
                timezone: "Asia/Jerusalem"
            }))
            .then(() => rpc_client.cluster_server.update_dns_servers({
                target_secret: server_secret,
                dns_servers: ['8.8.8.8']
            }))
            .delay(SERVER_RESTART_DELAY)
            .then(() => rpc_client.cluster_server.update_dns_servers({
                target_secret: server_secret,
                dns_servers: ['8.8.8.8', '8.8.4.4']
            }))
            .delay(SERVER_RESTART_DELAY)
            .then(() => rpc_client.cluster_server.update_time_config({
                timezone: "Asia/Jerusalem",
                target_secret: server_secret,
                ntp_server: 'time.windows.com'
            }))
            .then(() => rpc_client.cluster_server.update_dns_servers({
                target_secret: server_secret,
                dns_servers: ['8.8.8.8', '8.8.4.4'],
                search_domains: ['noobaa']
            }))
            .delay(SERVER_RESTART_DELAY)
            .then(() => rpc_client.cluster_server.diagnose_system({}))
            .then(() => rpc_client.cluster_server.diagnose_system({
                target_secret: server_secret,
            }))
            .then(() => rpc_client.system.update_system({
                name: SYS1,
            }))
            .then(() => rpc_client.create_auth_token({
                email: EMAIL,
                password: PASSWORD,
                system: SYS1,
            }))
            .then(() => rpc_client.system.update_system({
                name: SYSTEM,
            }));
    });

    ////////////
    //  POOL  //
    ////////////

    mocha.it('pool works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.node.list_nodes({}))
            .then(res => {
                nodes_list = res.nodes;
                console.log('nodes_list', _.map(nodes_list, 'name'));
                assert(nodes_list.length >= 6, `${nodes_list.length} >= 6`);
            })
            .then(() => rpc_client.pool.create_nodes_pool({
                name: POOL,
                nodes: _.map(nodes_list.slice(0, 3),
                    node => _.pick(node, 'name')),
            }))
            .then(() => rpc_client.pool.read_pool({
                name: POOL,
            }))
            .then(() => rpc_client.pool.assign_nodes_to_pool({
                name: POOL,
                nodes: _.map(nodes_list.slice(3, 6),
                    node => _.pick(node, 'name')),
            }))
            .then(() => rpc_client.pool.assign_nodes_to_pool({
                name: config.NEW_SYSTEM_POOL_NAME,
                nodes: _.map([nodes_list[1], nodes_list[3], nodes_list[5]],
                    node => _.pick(node, 'name')),
            }))
            .then(() => rpc_client.system.read_system())
            .then(() => rpc_client.pool.list_pool_nodes({
                name: POOL
            }))
            .then(() => rpc_client.pool.get_associated_buckets({
                name: POOL
            }));
    });

    ////////////
    //  TIER  //
    ////////////

    mocha.it('tier works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.tier.create_tier({
                name: TIER,
                attached_pools: [POOL],
                data_placement: 'SPREAD',
            }))
            .then(() => rpc_client.tier.read_tier({
                name: TIER,
            }))
            .then(() => rpc_client.tier.update_tier({
                name: TIER,
                data_placement: 'MIRROR',
            }))
            .then(() => rpc_client.system.read_system());
    });

    //////////////////////
    //  TIERING_POLICY  //
    //////////////////////

    mocha.it('tiering policy works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.tiering_policy.create_policy({
                name: TIERING_POLICY,
                tiers: [{
                    order: 0,
                    tier: TIER,
                    spillover: false,
                    disabled: false
                }]
            }))
            .then(() => rpc_client.tiering_policy.read_policy({
                name: TIERING_POLICY
            }))
            .then(() => rpc_client.tiering_policy.update_policy({
                name: TIERING_POLICY,
                chunk_split_config: {
                    avg_chunk: 999,
                    delta_chunk: 22,
                },
                tiers: [{
                    order: 0,
                    tier: TIER,
                    spillover: false,
                    disabled: false
                }, {
                    order: 1,
                    tier: TIER,
                    spillover: true,
                    disabled: false
                }]
            }))
            .then(() => rpc_client.tiering_policy.get_policy_pools({
                name: TIERING_POLICY
            }))
            .then(() => rpc_client.system.read_system());
    });

    //////////////
    //  BUCKET  //
    //////////////

    mocha.it('bucket works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.bucket.create_bucket({
                name: BUCKET,
                tiering: TIERING_POLICY,
            }))
            .then(() => rpc_client.bucket.read_bucket({
                name: BUCKET,
            }))
            .then(() => rpc_client.bucket.list_buckets())
            .then(() => rpc_client.bucket.update_bucket({
                name: BUCKET,
                new_name: BUCKET + 1,
                tiering: TIERING_POLICY //'default_tiering',
            }))
            .then(() => rpc_client.bucket.read_bucket({
                name: BUCKET + 1,
            }))
            .then(() => rpc_client.bucket.update_bucket({
                name: BUCKET + 1,
                new_name: BUCKET,
            }))
            .then(() => rpc_client.bucket.update_bucket({
                name: BUCKET,
                quota: {
                    size: 10,
                    unit: 'TERABYTE'
                }
            }))
            .then(() => rpc_client.bucket.read_bucket({
                name: BUCKET,
            }))
            .then(info => assert(info.quota && info.quota.size === 10 && info.quota.unit === 'TERABYTE'))
            .then(() => rpc_client.bucket.update_bucket({
                name: BUCKET,
                quota: null
            }))
            .then(() => rpc_client.bucket.read_bucket({
                name: BUCKET,
            }))
            .then(info => assert(_.isUndefined(info.quota)))
            .then(() => rpc_client.bucket.update_bucket({
                    name: BUCKET,
                    quota: {
                        size: 0,
                        unit: 'GIGABYTE'
                    }
                })
                .then(() => {
                        throw new Error('update bucket with 0 quota should fail');
                    },
                    () => _.noop) // update bucket with 0 quota should fail
            );
    });

    mocha.it('lambda triggers works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => zip_utils.zip_from_files([{
                path: 'main.js',
                data: `
                    /* Copyright (C) 2016 NooBaa */
                    'use strict';
                    exports.handler = function(event, context, callback) {
                    console.log('func event', event);
                    callback();
                    };
                    `
            }]))
            .then(zipfile => zip_utils.zip_to_buffer(zipfile))
            .then(zipbuffer => rpc_client.func.create_func({
                config: {
                    name: 'func1',
                    version: '$LATEST',
                    handler: 'main.handler'
                },
                code: { zipfile_b64: zipbuffer.toString('base64') }
            }))
            .then(() => rpc_client.bucket.add_bucket_lambda_trigger({
                bucket_name: BUCKET,
                event_name: 'ObjectCreated',
                func_name: 'func1',
                object_prefix: '/bla/'
            }))
            .then(() => rpc_client.bucket.read_bucket({
                name: BUCKET,
            }))
            .tap(bucket => rpc_client.bucket.update_bucket_lambda_trigger({
                bucket_name: BUCKET,
                id: bucket.triggers[0].id,
                enabled: false
            }))
            .then(bucket => rpc_client.bucket.delete_bucket_lambda_trigger({
                bucket_name: BUCKET,
                id: bucket.triggers[0].id,
            }))
            .then(() => rpc_client.func.delete_func({
                name: 'func1',
                version: '$LATEST'
            }));
    });

    mocha.it('namespace works', function() {
        if (config.SKIP_EXTERNAL_TESTS) this.skip(); // eslint-disable-line no-invalid-this
        this.timeout(90000); // eslint-disable-line no-invalid-this
        if (!process.env.AWS_ACCESS_KEY_ID ||
            !process.env.AWS_SECRET_ACCESS_KEY) {
            throw new Error('No valid AWS credentials in env - ' +
                'AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY are required ' +
                'for testing account.add_external_connection()');
        }
        return P.resolve()
            .then(() => rpc_client.account.add_external_connection({
                name: NAMESPACE_RESOURCE_CONNECTION,
                endpoint: 'https://s3.amazonaws.com',
                endpoint_type: 'AWS',
                identity: process.env.AWS_ACCESS_KEY_ID,
                secret: process.env.AWS_SECRET_ACCESS_KEY
            }))
            .then(() => rpc_client.pool.create_namespace_resource({
                name: NAMESPACE_RESOURCE_NAME,
                connection: NAMESPACE_RESOURCE_CONNECTION,
                target_bucket: BUCKET
            }))
            .then(() => rpc_client.bucket.create_bucket({
                name: NAMESPACE_BUCKET,
                namespace: {
                    read_resources: [NAMESPACE_RESOURCE_NAME],
                    write_resource: NAMESPACE_RESOURCE_NAME
                },
            }))
            .then(() => rpc_client.bucket.delete_bucket({
                name: NAMESPACE_BUCKET,
            }))
            .then(() => rpc_client.pool.delete_namespace_resource({
                name: NAMESPACE_RESOURCE_NAME,
            }))
            .then(() => rpc_client.account.delete_external_connection({
                connection_name: NAMESPACE_RESOURCE_CONNECTION,
            }));
    });

    /////////////
    //  STATS  //
    /////////////

    mocha.it('stats works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.stats.get_systems_stats({}))
            .then(() => rpc_client.stats.get_nodes_stats({}))
            .then(() => rpc_client.stats.get_ops_stats({}))
            .then(() => rpc_client.stats.get_all_stats({}));
    });

    ////////////
    //  MISC  //
    ////////////

    mocha.it('misc works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.debug.set_debug_level({
                module: 'rpc',
                level: 0
            }));
    });

    /////////////////
    //  DELETIONS  //
    /////////////////

    mocha.it('deletions works', function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.bucket.delete_bucket({
                name: BUCKET,
            }))
            .then(() => rpc_client.tiering_policy.delete_policy({
                    name: TIERING_POLICY,
                })
                .then(res => {
                    throw new Error('TIERING_POLICY: ' + TIERING_POLICY +
                        ' should have been deleted by now');
                })
                .catch(err => {
                    if (err.rpc_code !== 'NO_SUCH_TIERING_POLICY') throw err;
                })
            )
            .then(() => rpc_client.tier.delete_tier({
                    name: TIER,
                })
                .then(() => {
                    throw new Error('TIER: ' + TIER +
                        ' should have been deleted by now');
                })
                .catch(err => {
                    if (err.rpc_code !== 'NO_SUCH_TIER') throw err;
                })
            )
            .then(() => rpc_client.pool.assign_nodes_to_pool({
                name: config.NEW_SYSTEM_POOL_NAME,
                nodes: _.map(nodes_list, node => _.pick(node, 'name')),
            }))
            .then(() => rpc_client.pool.delete_pool({
                name: POOL,
            }))
            .then(() => rpc_client.system.read_system());
        // .then(() => coretest.clear_test_nodes())
        // .then(() => rpc_client.system.delete_system());
    });
});
