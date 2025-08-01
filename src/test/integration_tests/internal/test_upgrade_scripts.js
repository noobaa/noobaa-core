/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
const { rpc_client, EMAIL } = coretest;
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const http = require('http');
const system_store = require('../../../server/system_services/system_store').get_instance();
const upgrade_bucket_policy = require('../../../upgrade/upgrade_scripts/5.15.6/upgrade_bucket_policy');
const upgrade_bucket_cors = require('../../../upgrade/upgrade_scripts/5.19.0/upgrade_bucket_cors');
const remove_mongo_pool = require('../../../upgrade/upgrade_scripts/5.20.0/remove_mongo_pool');
const dbg = require('../../../util/debug_module')(__filename);
const assert = require('assert');
const mocha = require('mocha');
const config = require('../../../../config');

const BKT = 'test-bucket';
/** @type {S3} */
let s3;

async function _clean_all_bucket_policies() {
    const buckets = system_store.data.buckets.map(bucket => ({
        _id: bucket._id,
        $unset: { s3_policy: 1 }
    }));
    await system_store.make_changes({
        update: {
            buckets
        }
    });
}

async function _clean_all_bucket_cors() {
    const buckets = system_store.data.buckets.map(bucket => ({
        _id: bucket._id,
        $unset: { cors_configuration_rules: 1 }
    }));
    await system_store.make_changes({
        update: {
            buckets
        }
    });
}

mocha.describe('test upgrade scripts', async function() {
    mocha.before(async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        await system_store.load();

        const account_info = await rpc_client.account.read_account({ email: EMAIL, });
        s3 = new S3({
            endpoint: coretest.get_http_address(),
            credentials: {
                accessKeyId: account_info.access_keys[0].access_key.unwrap(),
                secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
            },
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpAgent: new http.Agent({ keepAlive: false })
            }),
        });
        await s3.createBucket({ Bucket: BKT });
    });

    mocha.it('test upgrade bucket policy to version 5.14.0', async function() {
        const old_policy = {
            version: '2012-10-17',
            statement: [{
                    sid: 'id-1',
                    effect: 'allow',
                    principal: ["*"],
                    action: ['s3:getobject', 's3:*'],
                    resource: [`arn:aws:s3:::*`]
                },
                {
                    effect: 'deny',
                    principal: ["*"],
                    action: ['s3:putobject'],
                    resource: [`arn:aws:s3:::*`]
                },
            ]
        };
        // clean all leftover bucket policies as upgrade script doesn't work on updated policies 
        await _clean_all_bucket_policies();

        const bucket = system_store.data.buckets.find(bucket_obj => bucket_obj.name.unwrap() === BKT);
        await system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    s3_policy: old_policy
                }]
            }
        });

        await upgrade_bucket_policy.run({ dbg, system_store, system_server: null });
        const res = await s3.getBucketPolicy({ // should work - bucket policy should fit current schema
            Bucket: BKT,
        });
        const new_policy = JSON.parse(res.Policy);

        assert.strictEqual(new_policy.Statement.length, old_policy.statement.length);
        assert.strictEqual(new_policy.Version, old_policy.version);
        assert.strictEqual(new_policy.Statement[0].Sid, old_policy.statement[0].sid);
        assert.strictEqual(new_policy.Statement[0].Effect, 'Allow');
        assert.strictEqual(new_policy.Statement[0].Action[0], 's3:GetObject');
        assert.strictEqual(new_policy.Statement[0].Action[1], 's3:*');
        assert.strictEqual(new_policy.Statement[0].Resource[0], old_policy.statement[0].resource[0]);
    });

    mocha.it('test upgrade bucket cors to version 5.19.0', async function() {

        // clean all leftover bucket CORS configurations
        await _clean_all_bucket_cors();

        await upgrade_bucket_cors.run({ dbg, system_store });
        const cors = await s3.getBucketCors({
            Bucket: BKT,
        });

        dbg.log0('cors:', cors);

        assert.deepEqual(cors.CORSRules[0].AllowedHeaders, config.S3_CORS_ALLOW_HEADERS);
        assert.deepEqual(cors.CORSRules[0].AllowedMethods, config.S3_CORS_ALLOW_METHODS);
        assert.deepEqual(cors.CORSRules[0].AllowedOrigins, config.S3_CORS_ALLOW_ORIGIN);
        assert.deepEqual(cors.CORSRules[0].ExposeHeaders, config.S3_CORS_EXPOSE_HEADERS);
    });

    mocha.it('test remove mongo_pool to version 5.20.0', async function() {
        const system = system_store.data.systems[0];
        const base = config.INTERNAL_STORAGE_POOL_NAME || config.DEFAULT_POOL_NAME || 'system-internal-storage-pool';
        const internal_name = `${base}-${system._id}`;

        // Seed an internal mongo pool entry
        await system_store.make_changes({
            insert: {
                pools: [{
                    _id: system_store.new_system_store_id(),
                    system: system._id,
                    name: internal_name,
                    resource_type: 'INTERNAL',
                    owner_id: '6899822e9045e9dc216ef812',
                }]
            }
        });

        const before_names = system_store.data.pools.map(e => e.name);
        dbg.info("Start : List all the pools in system: ", before_names);
        await remove_mongo_pool.run({ dbg, system_store });
        const afte_names = system_store.data.pools.map(e => e.name);
        dbg.info("End : List all the pools in system: ", afte_names);

        // Assert exact seeded name was removed, and no prefixed internal pools remain
        const exact_removed = system_store.data.pools.find(pool => pool.name === internal_name);
        const prefix_exists = system_store.data.pools.find(pool => pool.name.startsWith(base));
        assert.strictEqual(exact_removed, undefined);
        assert.strictEqual(prefix_exists, undefined);
    });

    mocha.after(async function() {
        await s3.deleteBucket({ Bucket: BKT });
    });
});
