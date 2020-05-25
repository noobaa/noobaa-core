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
const promise_utils = require('../../util/promise_utils');
const config = require('../../../config');

mocha.describe('system_servers', function() {

    const { rpc_client, SYSTEM, EMAIL, PASSWORD, POOL_LIST } = coretest;
    const DEFAULT_POOL_NAME = POOL_LIST[0].name;
    const PREFIX = 'system-servers';
    const TIER = `${PREFIX}-tier`;
    const TIERING_POLICY = `${PREFIX}-tiering-policy`;
    const BUCKET = `${PREFIX}-bucket`;
    const NAMESPACE_BUCKET = `${PREFIX}-namespace-bucket`;
    const SYS1 = `${PREFIX}-${SYSTEM}-1`;
    const EMAIL1 = `${PREFIX}-${EMAIL}`;
    const NAMESPACE_RESOURCE_CONNECTION = 'Majestic Namespace Sloth';
    const NAMESPACE_RESOURCE_NAME = `${PREFIX}-namespace-resource`;
    ///////////////
    //  ACCOUNT  //
    ///////////////

    mocha.it('account allowed buckets & allowed_bucket_creation', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        const accounts_status = await rpc_client.account.accounts_status();
        await assert(accounts_status.has_accounts, 'has_accounts');

        try {
            await rpc_client.account.create_account({
                name: EMAIL1,
                email: EMAIL1,
                has_login: false,
                s3_access: true,
                allow_bucket_creation: false
            });
        } catch (err) {
            if (err.rpc_code !== 'BAD_REQUEST') {
                throw err;
            }
        }

        await rpc_client.account.create_account({
            name: EMAIL1,
            email: EMAIL1,
            has_login: false,
            s3_access: true,
            allow_bucket_creation: true
        });

        await rpc_client.system.read_system();
        await rpc_client.account.delete_account({ email: EMAIL1 });
        await rpc_client.system.read_system();

        await rpc_client.account.create_account({
            name: EMAIL1,
            email: EMAIL1,
            has_login: false,
            s3_access: true,
            allow_bucket_creation: false,
            allowed_buckets: {
                full_permission: true,
                permission_list: ['first.bucket']
            },
        });

        await rpc_client.system.read_system();
        await rpc_client.account.delete_account({ email: EMAIL1 });
        await rpc_client.system.read_system();


    });
    mocha.it('setting up pools works', async function() {
        this.timeout(300000); // eslint-disable-line no-invalid-this
        await coretest.setup_pools(coretest.POOL_LIST);
    });
    mocha.it('account works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        const accounts_status = await rpc_client.account.accounts_status();
        await assert(accounts_status.has_accounts, 'has_accounts');
        await rpc_client.account.read_account({ email: EMAIL });
        await rpc_client.account.list_accounts();
        await rpc_client.system.read_system();
        await rpc_client.account.update_account({
            email: EMAIL,
            name: EMAIL1,
        });
        await rpc_client.system.read_system();
        await rpc_client.account.update_account({
            email: EMAIL,
            name: EMAIL,
        });
        await rpc_client.account.create_account({
            name: EMAIL1,
            email: EMAIL1,
            has_login: false,
            s3_access: true,
            allowed_buckets: {
                full_permission: false,
                permission_list: []
            },
            default_pool: DEFAULT_POOL_NAME
        });
        await rpc_client.system.read_system();
        await rpc_client.system.add_role({
            email: EMAIL1,
            role: 'admin',
        });
        await rpc_client.system.read_system();
        await rpc_client.system.remove_role({
            email: EMAIL1,
            role: 'admin',
        });
        await rpc_client.system.read_system();
        await rpc_client.account.delete_account({ email: EMAIL1 });
        await rpc_client.system.read_system();
        await rpc_client.system.list_systems();
        await rpc_client.events.read_activity_log({ limit: 2016 });
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
                access_key: res.owner.access_keys[0].access_key.unwrap(),
                string_to_sign: '',
                signature: new S3Auth().sign(res.owner.access_keys[0].secret_key.unwrap(), '')
            }).then(() => res))
            .then(res => rpc_client.auth.create_access_key_auth({
                access_key: res.owner.access_keys[0].access_key.unwrap(),
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

    mocha.it('system works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        await rpc_client.system.update_system({ name: SYS1 });
        await rpc_client.create_auth_token({
            email: EMAIL,
            password: PASSWORD,
            system: SYS1,
        });
        await rpc_client.system.update_system({ name: SYSTEM });
    });

    ////////////
    //  POOL  //
    ////////////

    mocha.it('pool works', async function() {
        this.timeout(10 * 60 * 1000); // eslint-disable-line no-invalid-this
        const pool_name = 'test-pool';
        await rpc_client.pool.create_hosts_pool({
            is_managed: true,
            name: pool_name,
            host_count: 1
        });
        await rpc_client.pool.scale_hosts_pool({
            name: pool_name,
            host_count: 3
        });
        await rpc_client.system.read_system();
        await rpc_client.pool.delete_pool({ name: pool_name });

        // Need to wait or the test will not finish.
        await promise_utils.wait_until(async () => {
            const system = await rpc_client.system.read_system();
            return !system.pools.find(pool => pool.name === pool_name);
        }, 10 * 60 * 1000, 2500);
    });

    ////////////
    //  TIER  //
    ////////////

    mocha.it('tier works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        await rpc_client.tier.create_tier({
            name: TIER,
            attached_pools: [DEFAULT_POOL_NAME],
            data_placement: 'SPREAD',
        });
        await rpc_client.tier.read_tier({
            name: TIER,
        });
        await rpc_client.tier.update_tier({
            name: TIER,
            data_placement: 'MIRROR',
        });
        await rpc_client.system.read_system();
    });

    //////////////////////
    //  TIERING_POLICY  //
    //////////////////////

    mocha.it('tiering policy works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        await rpc_client.tiering_policy.create_policy({
            name: TIERING_POLICY,
            tiers: [{
                order: 0,
                tier: TIER,
                spillover: false,
                disabled: false
            }]
        });
        await rpc_client.tiering_policy.read_policy({ name: TIERING_POLICY });
        await rpc_client.tiering_policy.update_policy({
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
        });
        await rpc_client.tiering_policy.get_policy_pools({ name: TIERING_POLICY });
        await rpc_client.system.read_system();
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

    mocha.it('lambda triggers works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        const zipfile = await zip_utils.zip_from_files([{
            path: 'main.js',
            data: `
                    /* Copyright (C) 2016 NooBaa */
                    'use strict';
                    exports.handler = function(event, context, callback) {
                    coretest.log('func event', event);
                    callback();
                    };
                    `
        }]);
        const zipbuffer = await zip_utils.zip_to_buffer(zipfile);
        await rpc_client.func.create_func({
            config: {
                name: 'func1',
                version: '$LATEST',
                handler: 'main.handler'
            },
            code: { zipfile_b64: zipbuffer.toString('base64') }
        });
        await rpc_client.bucket.add_bucket_lambda_trigger({
            bucket_name: BUCKET,
            event_name: 'ObjectCreated',
            func_name: 'func1',
            object_prefix: '/bla/'
        });
        const bucket = await rpc_client.bucket.read_bucket({ name: BUCKET });
        await rpc_client.bucket.update_bucket_lambda_trigger({
            bucket_name: BUCKET,
            id: bucket.triggers[0].id,
            enabled: false
        });
        await rpc_client.bucket.delete_bucket_lambda_trigger({
            bucket_name: BUCKET,
            id: bucket.triggers[0].id,
        });
        await rpc_client.func.delete_func({
            name: 'func1',
            version: '$LATEST'
        });
    });

    mocha.it('namespace works', async function() {
        if (config.SKIP_EXTERNAL_TESTS) this.skip(); // eslint-disable-line no-invalid-this
        this.timeout(90000); // eslint-disable-line no-invalid-this
        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            coretest.log('No AWS credentials found in env. Skipping test');
            this.skip(); // eslint-disable-line no-invalid-this
        }

        await rpc_client.account.add_external_connection({
            name: NAMESPACE_RESOURCE_CONNECTION,
            endpoint: 'https://s3.amazonaws.com',
            endpoint_type: 'AWS',
            identity: process.env.AWS_ACCESS_KEY_ID,
            secret: process.env.AWS_SECRET_ACCESS_KEY
        });
        await rpc_client.pool.create_namespace_resource({
            name: NAMESPACE_RESOURCE_NAME,
            connection: NAMESPACE_RESOURCE_CONNECTION,
            target_bucket: BUCKET
        });
        await rpc_client.bucket.create_bucket({
            name: NAMESPACE_BUCKET,
            namespace: {
                read_resources: [NAMESPACE_RESOURCE_NAME],
                write_resource: NAMESPACE_RESOURCE_NAME
            },
        });
        await rpc_client.bucket.delete_bucket({ name: NAMESPACE_BUCKET });
        await rpc_client.pool.delete_namespace_resource({ name: NAMESPACE_RESOURCE_NAME });
        await rpc_client.account.delete_external_connection({ connection_name: NAMESPACE_RESOURCE_CONNECTION });
    });

    /////////////
    //  STATS  //
    /////////////

    mocha.it('stats works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        await rpc_client.stats.get_systems_stats({});
        await rpc_client.stats.get_nodes_stats({});
        await rpc_client.stats.get_ops_stats({});
        await rpc_client.stats.get_all_stats({});
    });

    ////////////
    //  MISC  //
    ////////////

    mocha.it('misc works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        await rpc_client.debug.set_debug_level({
            module: 'rpc',
            level: coretest.get_dbg_level()
        });
    });

    /////////////////
    //  DELETIONS  //
    /////////////////

    mocha.it('deletions works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        await rpc_client.bucket.delete_bucket({
            name: BUCKET,
        });
        try {
            await rpc_client.tiering_policy.delete_policy({ name: TIERING_POLICY });
            throw new Error('TIERING_POLICY: ' + TIERING_POLICY + ' should have been deleted by now');
        } catch (err) {
            if (err.rpc_code !== 'NO_SUCH_TIERING_POLICY') throw err;
        }
        try {
            await rpc_client.tier.delete_tier({ name: TIER });
            throw new Error('TIER: ' + TIER + ' should have been deleted by now');
        } catch (err) {
            if (err.rpc_code !== 'NO_SUCH_TIER') throw err;
        }
        await rpc_client.system.read_system();
        // .then(() => rpc_client.system.delete_system());
    });
});
