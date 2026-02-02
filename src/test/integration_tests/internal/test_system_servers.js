/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 700]*/
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
coretest.setup();

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const S3Auth = require('aws-sdk/lib/signers/s3');

const P = require('../../../util/promise');
const config = require('../../../../config');
const { make_auth_token } = require('../../../server/common_services/auth_server');

const check_deletion_ownership = require('../../../server/system_services/pool_server').check_deletion_ownership;

mocha.describe('system_servers', function() {

    const { rpc_client, SYSTEM, EMAIL, POOL_LIST } = coretest;
    const DEFAULT_POOL_NAME = POOL_LIST[1].name;
    const PREFIX = 'system-servers';
    const TIER = `${PREFIX}-tier`;
    const TIERING_POLICY = `${PREFIX}-tiering-policy`;
    const BUCKET = `${PREFIX}-bucket`;
    const MD5_BUCKET = `${PREFIX}-md5-bucket`;
    const NAMESPACE_BUCKET = `${PREFIX}-namespace-bucket`;
    const NAMESPACE_BUCKET_SINGLE_NO_WR = `${PREFIX}-namespace-bucket-single-no-wr`;
    const NAMESPACE_BUCKET_MERGE_NO_WR = `${PREFIX}-namespace-bucket-merge-no-wr`;
    const SYS1 = `${PREFIX}-${SYSTEM}-1`;
    const EMAIL1 = `${PREFIX}-${EMAIL}`;
    const EMAIL2 = `${PREFIX}-${EMAIL}2`;
    const EMAIL3 = `${PREFIX}-${EMAIL}3`;
    const EMAIL4 = `${PREFIX}-${EMAIL}4`;
    const NAMESPACE_RESOURCE_CONNECTION = 'Majestic Namespace Sloth';
    const NAMESPACE_RESOURCE_NAME = `${PREFIX}-namespace-resource`;
    const NAMESPACE_RESOURCE_NAME_2 = `${PREFIX}-namespace-resource-2`;
    ///////////////
    //  ACCOUNT  //
    ///////////////

    mocha.it('account allowed buckets & allowed_bucket_creation', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        const accounts_status = await rpc_client.account.accounts_status();
        await assert(accounts_status.has_accounts, 'has_accounts');

        // We expect this to work now, because it is completely reasonable to
        // have an account with no buckets.
        // try {
        //     await rpc_client.account.create_account({
        //         name: EMAIL1,
        //         email: EMAIL1,
        //         has_login: false,
        //         s3_access: true,
        //         allow_bucket_creation: false
        //     });
        // } catch (err) {
        //     if (err.rpc_code !== 'BAD_REQUEST') {
        //         throw err;
        //     }
        // }

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
        await rpc_client.account.list_accounts({});
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
            default_resource: DEFAULT_POOL_NAME
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
    mocha.it('account list with filters works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        const UID = 70;
        const GID = 80;
        const accounts_status = await rpc_client.account.accounts_status();
        await assert(accounts_status.has_accounts, 'has_accounts');
        await rpc_client.account.create_account({
            name: EMAIL1,
            email: EMAIL1,
            has_login: false,
            s3_access: true,
            default_resource: DEFAULT_POOL_NAME,
            nsfs_account_config: {
                uid: UID,
                gid: GID,
                new_buckets_path: '/test',
                nsfs_only: false
            }
        });
        await rpc_client.account.create_account({
            name: EMAIL2,
            email: EMAIL2,
            has_login: false,
            s3_access: true,
            default_resource: DEFAULT_POOL_NAME,
            nsfs_account_config: {
                uid: UID + 1,
                gid: GID + 1,
                new_buckets_path: '/test1',
                nsfs_only: false
            }
        });
        await rpc_client.account.create_account({
            name: EMAIL4,
            email: EMAIL4,
            has_login: false,
            s3_access: true,
            default_resource: DEFAULT_POOL_NAME,
            nsfs_account_config: {
                distinguished_name: 'rami11',
                new_buckets_path: '/test1',
                nsfs_only: false
            }
        });
        const account_params = {
            name: EMAIL3,
            email: EMAIL3,
            has_login: false,
            s3_access: true,
            default_resource: DEFAULT_POOL_NAME,
        };
        try {
            const dummy_resource_account_params = { ...account_params, default_resource: 'dummy_resource' };
            await rpc_client.account.create_account(dummy_resource_account_params);
            assert.fail('should not be able to create account with not existing default resource');
        } catch (err) {
            assert.ok(err.rpc_code === 'BAD_REQUEST');
        }
        await rpc_client.account.create_account(account_params);
        try {
            const dummy_resource_account_params = {
                ...account_params,
                name: undefined,
                has_login: undefined,
                default_resource: 'dummy_resource'
            };
            await rpc_client.account.update_account_s3_access(_.omitBy(dummy_resource_account_params, _.isUndefined));
            assert.fail('should not be able to update account with not existing default resource');
        } catch (err) {
            assert.ok(err.rpc_code === 'BAD_REQUEST');
        }
        await rpc_client.system.read_system();
        const accountlistnofilter = await rpc_client.account.list_accounts({});
        await assert(accountlistnofilter.accounts.length === 6, 'should return 6 accounts');
        const accountlistfilter = await rpc_client.account.list_accounts({
            filter: {
                fs_identity: {
                    uid: UID,
                    gid: GID
                }
            }
        });
        await assert(accountlistfilter.accounts.length === 1, 'should return 1 account');
        const accountlistfilter2 = await rpc_client.account.list_accounts({
            filter: {
                fs_identity: {
                    distinguished_name: 'rami11',
                }
            }
        });
        await assert(accountlistfilter2.accounts.length === 1, 'should return 1 account');
        await rpc_client.account.delete_account({ email: EMAIL1 });
        await rpc_client.account.delete_account({ email: EMAIL2 });
        await rpc_client.account.delete_account({ email: EMAIL3 });
        await rpc_client.account.delete_account({ email: EMAIL4 });
        await rpc_client.events.read_activity_log({ limit: 2016 });
    });

    mocha.it('Calculate md5_etag for account works', async function() {
        await rpc_client.account.create_account({
            name: EMAIL1,
            email: EMAIL1,
            has_login: false,
            s3_access: true,
            force_md5_etag: true,
        });
        let info = await rpc_client.account.read_account({
            email: EMAIL1,
        });
        assert(info.force_md5_etag === true);

        await rpc_client.account.update_account_s3_access({
            email: EMAIL1,
            s3_access: true,
            force_md5_etag: false,
            default_resource: DEFAULT_POOL_NAME,
        });
        info = await rpc_client.account.read_account({
            email: EMAIL1,
        });
        assert(info.force_md5_etag === false);

        await rpc_client.account.delete_account({
            email: EMAIL1,
        });
    });

    ////////////
    //  AUTH  //
    ////////////

    mocha.it('auth works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        try {
            await rpc_client.auth.read_auth();
            rpc_client.options.auth_token = make_auth_token({
                system: SYSTEM,
                email: EMAIL,
                role: 'admin',
            });
            const res = await rpc_client.system.read_system();
            await rpc_client.auth.create_access_key_auth({
                access_key: res.owner.access_keys[0].access_key.unwrap(),
                string_to_sign: '',
                signature: new S3Auth().sign(res.owner.access_keys[0].secret_key.unwrap(), '')
            });
            await rpc_client.auth.create_access_key_auth({
                access_key: res.owner.access_keys[0].access_key.unwrap(),
                string_to_sign: 'blabla',
                signature: 'blibli'
            });
            assert.ifError('should fail with UNAUTHORIZED');
        } catch (err) {
            assert.strictEqual(err.rpc_code, 'UNAUTHORIZED');
        }
    });


    //////////////
    //  SYSTEM  //
    //////////////

    mocha.it('system works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        await rpc_client.system.update_system({ name: SYS1 });
        const prev_token = rpc_client.options.auth_token;
        rpc_client.options.auth_token = make_auth_token({
            email: EMAIL,
            system: SYS1,
            role: 'admin'
        });
        await rpc_client.system.update_system({ name: SYSTEM });
        rpc_client.options.auth_token = prev_token;
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
        await P.wait_until(async () => {
            const system = await rpc_client.system.read_system();
            return !system.pools.find(pool => pool.name === pool_name);
        }, 10 * 60 * 1000, 2500);
    });

    mocha.it('Deletion ownership check works for system owner', async function() {
        config.RESTRICT_RESOURCE_DELETION = true;
        this.timeout(90000); // eslint-disable-line no-invalid-this
        check_deletion_ownership({
            account: {
                _id: 'owner'
            },
            system: {
                owner: {
                    _id: 'owner'
                }
            }
        }, 'resourceowner');
        config.RESTRICT_RESOURCE_DELETION = false;
    });

    mocha.it('Deletion ownership check works for resource owner', async function() {
        config.RESTRICT_RESOURCE_DELETION = true;
        this.timeout(90000); // eslint-disable-line no-invalid-this
        check_deletion_ownership({
            account: {
                _id: 'resourceowner'
            },
            system: {
                owner: {
                    _id: 'owner'
                }
            }
        }, 'resourceowner');
        config.RESTRICT_RESOURCE_DELETION = false;
    });

    mocha.it('Deletion ownership check fails for non-owner', async function() {
        config.RESTRICT_RESOURCE_DELETION = true;
        this.timeout(90000); // eslint-disable-line no-invalid-this
        try {
            check_deletion_ownership({
                account: {
                    _id: 'notowner'
                },
                system: {
                    owner: {
                        _id: 'owner'
                    }
                }
            }, 'resourceowner');
            assert.fail('should fail with UNAUTHORIZED');
        } catch (err) {
            assert.strictEqual(err.rpc_code, 'UNAUTHORIZED');
        } finally {
            config.RESTRICT_RESOURCE_DELETION = false;
        }
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

    mocha.it('bucket works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        try {
            await rpc_client.bucket.create_bucket({
                name: BUCKET,
                tiering: TIERING_POLICY,
            });
            await rpc_client.bucket.read_bucket({
                name: BUCKET,
            });
            await rpc_client.bucket.list_buckets({});
            await rpc_client.bucket.update_bucket({
                name: BUCKET,
                new_name: BUCKET + 1,
                tiering: TIERING_POLICY //'default_tiering',
            });
            await rpc_client.bucket.read_bucket({
                name: BUCKET + 1,
            });
            await rpc_client.bucket.update_bucket({
                name: BUCKET + 1,
                new_name: BUCKET,
            });
            await rpc_client.bucket.update_bucket({
                name: BUCKET,
                quota: {
                    size: {
                        value: 10,
                        unit: 'T'
                    },
                    quantity: {
                        value: 50
                    }
                }
            });
            const info = await rpc_client.bucket.read_bucket({
                name: BUCKET,
            });
            assert(info.quota && info.quota.size &&
                info.quota.size.value === 10 && info.quota.size.unit === 'T' &&
                info.quota.quantity && info.quota.quantity.value === 50);

            await rpc_client.bucket.update_bucket({
                name: BUCKET,
                quota: null
            });

            const info_after = await rpc_client.bucket.read_bucket({
                name: BUCKET,
            });

            assert(_.isUndefined(info_after.quota));
            try {
                await rpc_client.bucket.update_bucket({
                    name: BUCKET,
                    quota: {
                        size: 0,
                        unit: 'GIGABYTE'
                    }
                });
                throw new Error('update bucket with 0 quota should fail');
            } catch {
                //nothing to do here, expected error
            }
        } catch (err) {
            assert.fail('should not fail with ' + err);
        }
    });

    mocha.it('Calculate md5_etag for bucket works', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this

        await rpc_client.bucket.create_bucket({
            name: MD5_BUCKET,
            force_md5_etag: true,
        });
        let info = await rpc_client.bucket.read_bucket({
            name: MD5_BUCKET,
        });
        assert(info.force_md5_etag === true);

        await rpc_client.bucket.update_bucket({
            name: MD5_BUCKET,
            force_md5_etag: false,
        });
        info = await rpc_client.bucket.read_bucket({
            name: MD5_BUCKET,
        });
        assert(info.force_md5_etag === false);

        await rpc_client.bucket.delete_bucket({ name: MD5_BUCKET });
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
        const nsr = { resource: NAMESPACE_RESOURCE_NAME };
        const nsr2 = { resource: NAMESPACE_RESOURCE_NAME_2 };
        await rpc_client.bucket.create_bucket({
            name: NAMESPACE_BUCKET,
            namespace: {
                read_resources: [nsr],
                write_resource: nsr
            },
        });
        await rpc_client.bucket.create_bucket({
            name: NAMESPACE_BUCKET_SINGLE_NO_WR,
            namespace: {
                read_resources: [nsr]
            },
        });
        await rpc_client.bucket.create_bucket({
            name: NAMESPACE_BUCKET_MERGE_NO_WR,
            namespace: {
                read_resources: [nsr, nsr2]
            },
        });
        await rpc_client.bucket.delete_bucket({ name: NAMESPACE_BUCKET });
        await rpc_client.bucket.delete_bucket({ name: NAMESPACE_BUCKET_SINGLE_NO_WR });
        await rpc_client.bucket.delete_bucket({ name: NAMESPACE_BUCKET_MERGE_NO_WR });
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
