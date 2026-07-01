/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const _ = require('lodash');
const coretest = require('../../utils/coretest/coretest');
const { rpc_client, EMAIL, POOL_LIST } = coretest;
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const http = require('http');
const SensitiveString = require('../../../util/sensitive_string');
const system_store = require('../../../server/system_services/system_store').get_instance();
const upgrade_bucket_policy = require('../../../upgrade/upgrade_scripts/5.15.6/upgrade_bucket_policy');
const upgrade_bucket_policy_principal = require('../../../upgrade/upgrade_scripts/5.21.0/upgrade_bucket_policy_principal');
const upgrade_bucket_cors = require('../../../upgrade/upgrade_scripts/5.19.0/upgrade_bucket_cors');
const remove_mongo_pool = require('../../../upgrade/upgrade_scripts/5.20.0/remove_mongo_pool');
const upgrade_iam_role = require('../../../upgrade/upgrade_scripts/5.23.0/upgrade_iam_roles');
const { DEFAULT_MAX_SESSION_DURATION_SECS } = require('../../../endpoint/iam/iam_constants');
const dbg = require('../../../util/debug_module')(__filename);
const assert = require('assert');
const mocha = require('mocha');
const config = require('../../../../config');

const BKT = 'test-bucket';
const BKT1 = 'test-bucket1';
const iam_username = 'iam_username';
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
        await s3.createBucket({ Bucket: BKT1 });
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
        const internal_storage_pool_name = config.INTERNAL_STORAGE_POOL_NAME || 'system-internal-storage-pool';
        const internal_name = `${internal_storage_pool_name}-${system._id}`;
        const default_pool_name = config.DEFAULT_POOL_NAME;
        let internal_pool_id = "";
        const before_names = system_store.data.pools.map(e => {
            if (e.name.startsWith(internal_storage_pool_name)) internal_pool_id = e._id;
            return e.name;
        });
        try {
            await remove_mongo_pool.run({ dbg, system_store });
        } catch (err) {
             assert(!err, 'There shouldnt be an error when there is no mongo_pool');
        }

        if (!before_names.includes(internal_name)) {
            internal_pool_id = system_store.new_system_store_id();
            await system_store.make_changes({
                insert: {
                    pools: [{
                        _id: internal_pool_id,
                        system: system._id,
                        name: internal_name,
                        resource_type: 'INTERNAL',
                        owner_id: '6899822e9045e9dc216ef812',
                        storage_stats: {
                            blocks_size: 0,
                            last_update: 1756876067377
                        },
                        pool_node_type: 'BLOCK_STORE_MONGO',
                    }]
                }
            });
        }
        // create a bucket and update its spread_pools with internal pool id
        // upgrade script will replace it with new default pool
        const updates = _.uniqBy([], '_id');
        for (const tier of system_store.data.tiers) {
            if (tier.name.unwrap().startsWith(BKT1)) {
                updates.push({
                    _id: tier._id,
                    mirrors: [{
                        _id: system_store.new_system_store_id(),
                        spread_pools: [internal_pool_id]
                    }]
                });
            }
        }
        await system_store.make_changes({
            update: {
                tiers: updates
            }
        });
        await remove_mongo_pool.run({ dbg, system_store });
        const afte_names = system_store.data.pools.map(e => e.name);
        dbg.info("End : List all the pools in system: ", afte_names);

        // Assert exact seeded name was removed, and no prefixed internal pools remain
        const exact_removed = system_store.data.pools.find(pool => pool.name === internal_name);
        const prefix_exists = system_store.data.pools.find(pool => pool.name.startsWith(internal_storage_pool_name));
        assert.strictEqual(exact_removed, undefined);
        assert.strictEqual(prefix_exists, undefined);
        const exact_added = system_store.data.pools.find(pool => pool.name === default_pool_name);
        assert.strictEqual(exact_added.name, default_pool_name);

        const updated_bucket = system_store.data.buckets.find(bucket => bucket.name.unwrap() === BKT1);
        // Bucket with internal pool replaced with new default pool
        assert.strictEqual(updated_bucket.tiering.tiers[0].tier.mirrors[0].spread_pools[0].name, default_pool_name);
    });

    mocha.it('test upgrade bucket policy to ARN version 5.21.0', async function() {
        const old_policy = {
            Version: '2012-10-17',
            Statement: [{
                    Sid: 'id-1',
                    Effect: 'Allow',
                    Principal: {
                        "AWS": [new SensitiveString(EMAIL)],
                    },
                    Action: ['s3:GetObject', 's3:*'],
                    Resource: [`arn:aws:s3:::*`]
                },
                {
                    Effect: 'Deny',
                    Principal: {
                        "AWS": [new SensitiveString(iam_username)],
                    },
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::*`]
                },
                {
                    Effect: 'Allow',
                    Principal: {
                        "AWS": new SensitiveString(iam_username),
                    },
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::*`]
                },
                {
                    Effect: 'Allow',
                    Principal: {
                        "AWS": [
                            '*',
                            new SensitiveString(iam_username),
                            new SensitiveString(iam_username)
                        ],
                    },
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::*`]
                },
                {
                    Effect: 'Allow',
                    Principal: {
                        "AWS": '*',
                    },
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::*`]
                },
                {
                    Effect: 'Allow',
                    Principal: {
                        "AWS": [new SensitiveString('invalid')],
                    },
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::*`]
                },
                {
                    Effect: 'Allow',
                    Principal: {
                        "AWS": new SensitiveString('invalid_second'),
                    },
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::*`]
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
        const account = system_store.data.accounts.find(acc => acc.email.unwrap() === EMAIL);
        const nsr = 's3_bucket_policy_nsr';
        const iam_acc = {
                name: iam_username,
                email: iam_username,
                has_login: false,
                s3_access: true,
                default_resource: process.env.NC_CORETEST ? nsr : POOL_LIST[1].name,
            };
        await rpc_client.account.create_account(iam_acc);

        const iam_account = system_store.data.accounts.find(acc => acc.email.unwrap() === iam_username);
        await system_store.make_changes({
            update: {
                accounts: [{
                    _id: iam_account._id,
                    owner: account._id.toString(),
                }]
            }
        });

        await upgrade_bucket_policy_principal.run({ dbg, system_store, system_server: null });
        const res = await s3.getBucketPolicy({ // should work - bucket policy should fit current schema
            Bucket: BKT,
        });
        const new_policy = JSON.parse(res.Policy);

        assert.strictEqual(new_policy.Statement.length, old_policy.Statement.length);
        assert.strictEqual(new_policy.Version, old_policy.Version);
        assert.strictEqual(new_policy.Statement[0].Sid, old_policy.Statement[0].Sid);
        assert.strictEqual(new_policy.Statement[0].Effect, 'Allow');
        assert.strictEqual(new_policy.Statement[0].Action[0], 's3:GetObject');
        assert.strictEqual(new_policy.Statement[0].Action[1], 's3:*');
        assert.strictEqual(new_policy.Statement[0].Resource[0], old_policy.Statement[0].Resource[0]);

        assert.strictEqual(new_policy.Statement[0].Principal.AWS[0], `arn:aws:iam::${account._id.toString()}:root`);
        assert.strictEqual(new_policy.Statement[1].Principal.AWS[0], `arn:aws:iam::${iam_account._id.toString()}:user/${iam_account.email.unwrap()}`);
        assert.strictEqual(new_policy.Statement[2].Principal.AWS, `arn:aws:iam::${iam_account._id.toString()}:user/${iam_account.email.unwrap()}`);
        assert.strictEqual(new_policy.Statement[3].Principal.AWS[0], '*');
        assert.strictEqual(new_policy.Statement[3].Principal.AWS[1], `arn:aws:iam::${iam_account._id.toString()}:user/${iam_account.email.unwrap()}`);
        assert.strictEqual(new_policy.Statement[3].Principal.AWS[2], `arn:aws:iam::${iam_account._id.toString()}:user/${iam_account.email.unwrap()}`);
        assert.strictEqual(new_policy.Statement[4].Principal.AWS, '*');
        assert.strictEqual(new_policy.Statement[5].Principal.AWS[0], 'invalid');
        assert.strictEqual(new_policy.Statement[6].Principal.AWS, 'invalid_second');
    });

    mocha.after(async function() {
        await s3.deleteBucket({ Bucket: BKT });
        await s3.deleteBucket({ Bucket: BKT1 });
        const iam_acc = {
                email: iam_username,
        };
        await rpc_client.account.delete_account(iam_acc);
    });
});

/*eslint max-lines-per-function: ["error", 500]*/
mocha.describe('test upgrade_iam_role script 5.23.0', async function() {
    // Account email addresses created specifically for this suite.
    const role_account_no_role_config = 'role_acct_no_role_config@test.com';
    const role_account_assume_role = 'role_acct_assume_role@test.com';
    const role_account_deny = 'role_acct_deny@test.com';
    const role_account_web_identity = 'role_acct_web_identity@test.com';
    const role_account_multi_stmt = 'role_acct_multi_stmt@test.com';
    const role_account_with_version = 'role_acct_with_version@test.com';
    const role_account_no_version = 'role_acct_no_version@test.com';
    const role_account_multi_actions = 'role_acct_multi_actions@test.com';
    const role_account_unset_check = 'role_acct_unset_check@test.com';
    const role_account_name_collision = 'role_acct_name_collision@test.com';

    /**
     * Create an account via rpc_client (which produces a schema-valid DB record),
     * then inject the old-schema role_config directly via system_store.make_changes
     * to simulate an account that existed before the 5.23.0 upgrade.
     * Returns the stored account object.
     */
    async function _insert_account_with_role_config(email, role_config) {
        const params = {
            name: email,
            email: email,
            has_login: false,
            s3_access: true,
            default_resource: process.env.NC_CORETEST ? 's3_bucket_policy_nsr' : POOL_LIST[1].name,
        };
        await rpc_client.account.create_account(params);
        const acc = system_store.data.accounts.find(a => a.email.unwrap() === email);
        if (role_config) {
            await system_store.make_changes({
                update: { accounts: [{ _id: acc._id, role_config }] }
            });
        }
        return system_store.data.accounts.find(a => a.email.unwrap() === email);
    }

    /** Remove an account by email and any iam_roles owned by it. */
    async function _delete_account(email) {
        try {
            await rpc_client.account.delete_account({ email });
        } catch (_err) {
            // account may already be gone
        }
    }

    mocha.before(async function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this
        await system_store.load();
    });

    mocha.after(async function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this
        for (const email of [
            role_account_no_role_config,
            role_account_assume_role,
            role_account_deny,
            role_account_web_identity,
            role_account_multi_stmt,
            role_account_with_version,
            role_account_no_version,
            role_account_multi_actions,
            role_account_unset_check,
            role_account_name_collision,
        ]) {
            await _delete_account(email);
        }
    });

    mocha.it('accounts without role_config are skipped — no iam_role is created', async function() {
        const acc = await _insert_account_with_role_config(role_account_no_role_config, undefined);
        const roles_before = (system_store.data.iam_roles || []).filter(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        );

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        const roles_after = (system_store.data.iam_roles || []).filter(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        );
        assert.strictEqual(roles_after.length, roles_before.length,
            'No iam_role should be created for an account that has no role_config');
    });

    mocha.it('sts:AssumeRole allow — iam_role created with correct base fields and Effect Allow', async function() {
        // The real-world action stored in assume_role_policy is always a STS action.
        // The upgrade script passes actions through actions_map; sts:AssumeRole is not
        // in the S3 actions_map so it maps to undefined — this is the existing script
        // behaviour that we document here.
        const acc = await _insert_account_with_role_config(role_account_assume_role, {
            role_name: 'test-role-assume',
            assume_role_policy: {
                statement: [{
                    effect: 'allow',
                    action: ['sts:AssumeRole'],
                    principal: ['user@example.com'],
                }]
            }
        });

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        const role = (system_store.data.iam_roles || []).find(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        );
        assert.ok(role, 'iam_role must be created for an account that has role_config');

        // Verify role base fields
        assert.strictEqual(role.name, 'test-role-assume');
        assert.strictEqual(role.iam_path, '/');
        assert.strictEqual(role.description, 'Migrated from account');
        assert.strictEqual(role.max_session_duration, DEFAULT_MAX_SESSION_DURATION_SECS);
        assert.deepStrictEqual(role.iam_role_policies, []);

        // Verify statement mapping
        const stmt = role.assume_role_policy_document.Statement[0];
        assert.strictEqual(stmt.Effect, 'Allow');
        assert.deepStrictEqual(stmt.Principal, { AWS: ['user@example.com'] });
        assert.strictEqual(stmt.Sid, 'RoleMigration0');
        assert.strictEqual(stmt.Action[0], "sts:AssumeRole",
            'sts:AssumeRole is not in the S3 actions_map — Action entry is undefined');
    });

    mocha.it('sts:AssumeRole deny — Effect mapped to "Deny"', async function() {
        const acc = await _insert_account_with_role_config(role_account_deny, {
            role_name: 'test-role-deny',
            assume_role_policy: {
                statement: [{
                    effect: 'deny',
                    action: ['sts:AssumeRole'],
                    principal: ['deny-user@example.com'],
                }]
            }
        });

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        const role = (system_store.data.iam_roles || []).find(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        );
        assert.ok(role, 'iam_role must be created');

        const stmt = role.assume_role_policy_document.Statement[0];
        assert.strictEqual(stmt.Effect, 'Deny',
            '"deny" (lowercase) must be normalised to "Deny"');
        assert.deepStrictEqual(stmt.Principal, { AWS: ['deny-user@example.com'] });
    });

    mocha.it('sts:AssumeRoleWithWebIdentity — migrated into iam_role with Effect Allow', async function() {
        const acc = await _insert_account_with_role_config(role_account_web_identity, {
            role_name: 'test-role-web-identity',
            assume_role_policy: {
                statement: [{
                    effect: 'allow',
                    action: ['sts:AssumeRoleWithWebIdentity'],
                    principal: ['webid-user@example.com'],
                }]
            }
        });

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        const role = (system_store.data.iam_roles || []).find(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        );
        assert.ok(role, 'iam_role must be created');

        const stmt = role.assume_role_policy_document.Statement[0];
        assert.strictEqual(stmt.Effect, 'Allow');
        assert.deepStrictEqual(stmt.Principal, { AWS: ['webid-user@example.com'] });
    });

    mocha.it('multi-statement policy with mixed STS actions — all statements migrated, Effects preserved per-statement', async function() {
        const acc = await _insert_account_with_role_config(role_account_multi_stmt, {
            role_name: 'test-role-multi',
            assume_role_policy: {
                statement: [
                    {
                        effect: 'allow',
                        action: ['sts:AssumeRole'],
                        principal: ['user-a@example.com'],
                    },
                    {
                        effect: 'deny',
                        action: ['sts:AssumeRole'],
                        principal: ['user-b@example.com'],
                    },
                    {
                        effect: 'allow',
                        action: ['sts:AssumeRoleWithWebIdentity'],
                        principal: ['user-c@example.com'],
                    },
                ]
            }
        });

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        const role = (system_store.data.iam_roles || []).find(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        );
        assert.ok(role, 'iam_role must be created');

        const stmts = role.assume_role_policy_document.Statement;
        assert.strictEqual(stmts.length, 3, 'All three statements must be preserved');

        assert.strictEqual(stmts[0].Effect, 'Allow');
        assert.deepStrictEqual(stmts[0].Principal, { AWS: ['user-a@example.com'] });

        assert.strictEqual(stmts[1].Effect, 'Deny');
        assert.deepStrictEqual(stmts[1].Principal, { AWS: ['user-b@example.com'] });

        assert.strictEqual(stmts[2].Effect, 'Allow');
        assert.deepStrictEqual(stmts[2].Principal, { AWS: ['user-c@example.com'] });
    });

    mocha.it('policy with version field — Version propagated into the new policy document', async function() {
        // The upgrade script reads role_config.version (truthy) and copies
        // role_config.assume_role_policy.version into new_policy.Version.
        const acc = await _insert_account_with_role_config(role_account_with_version, {
            role_name: 'test-role-version',
            version: '2012-10-17',
            assume_role_policy: {
                version: '2012-10-17',
                statement: [{
                    effect: 'allow',
                    action: ['sts:AssumeRole'],
                    principal: ['version-user@example.com'],
                }]
            }
        });

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        const role = (system_store.data.iam_roles || []).find(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        );
        assert.ok(role, 'iam_role must be created');
        assert.strictEqual(role.assume_role_policy_document.Version, '2012-10-17',
            'Version must be copied from assume_role_policy.version when role_config.version is set');
    });

    mocha.it('policy without version field — Version is absent from the new policy document', async function() {
        const acc = await _insert_account_with_role_config(role_account_no_version, {
            role_name: 'test-role-no-version',
            // No top-level role_config.version => the Version branch is not taken
            assume_role_policy: {
                statement: [{
                    effect: 'allow',
                    action: ['sts:AssumeRole'],
                    principal: ['no-version-user@example.com'],
                }]
            }
        });

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        const role = (system_store.data.iam_roles || []).find(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        );
        assert.ok(role, 'iam_role must be created');
        assert.strictEqual(role.assume_role_policy_document.Version, undefined,
            'Version must be absent when role_config.version is falsy');
    });

    mocha.it('multiple STS actions per statement — all actions passed through independently', async function() {
        // A statement can list several STS actions; each is looked up in actions_map
        // independently. Neither sts:AssumeRole nor sts:AssumeRoleWithWebIdentity is
        // in the S3 actions_map, so both resolve to undefined — documented behaviour.
        const acc = await _insert_account_with_role_config(role_account_multi_actions, {
            role_name: 'test-role-multi-actions',
            assume_role_policy: {
                statement: [{
                    effect: 'allow',
                    action: [
                        'sts:AssumeRole',
                        'sts:AssumeRoleWithWebIdentity',
                        'sts:AssumeRoleWithSAML',
                    ],
                    principal: ['multi-action-user@example.com'],
                }]
            }
        });

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        const role = (system_store.data.iam_roles || []).find(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        );
        assert.ok(role, 'iam_role must be created');

        // Three actions in → three entries out (each undefined because STS actions
        // are not present in the S3 actions_map used by the upgrade script)
        const actions = role.assume_role_policy_document.Statement[0].Action;
        assert.strictEqual(actions.length, 3,
            'Action array length must match the number of actions in the old policy');
        assert.strictEqual(actions[0], 'sts:AssumeRole');
        assert.strictEqual(actions[1], 'sts:AssumeRoleWithWebIdentity');
        assert.strictEqual(actions[2], 'sts:AssumeRoleWithSAML');
    });

    mocha.it('role_config is unset from account after migration', async function() {
        const acc = await _insert_account_with_role_config(role_account_unset_check, {
            role_name: 'test-role-unset-check',
            assume_role_policy: {
                statement: [{
                    effect: 'allow',
                    action: ['sts:AssumeRole'],
                    principal: ['unset-check@example.com'],
                }]
            }
        });

        // Confirm role_config is present before the migration
        assert.ok(acc.role_config, 'role_config must exist on the account before migration');

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        const acc_after = system_store.data.accounts.find(
            a => a.email.unwrap() === role_account_unset_check
        );
        assert.ok(acc_after, 'account must still exist after migration');
        assert.strictEqual(acc_after.role_config, undefined,
            'role_config must be unset from the account after a successful migration');
    });

    mocha.it('re-running the script inserts exactly one more iam_role per qualifying account', async function() {
        // The upgrade script does not guard against duplicate inserts.
        // Running it twice produces exactly one additional role per qualifying account.
        const acc = system_store.data.accounts.find(
            a => a.email.unwrap() === role_account_assume_role
        );
        assert.ok(acc, 'account should still be present from earlier test');

        const count_before = (system_store.data.iam_roles || []).filter(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        ).length;

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        const count_after = (system_store.data.iam_roles || []).filter(
            r => r.owner && r.owner._id && r.owner._id.toString() === acc._id.toString()
        ).length;
        assert.strictEqual(count_after, count_before,
            'Each run of the script inserts exactly one new iam_role per qualifying account');
    });
    mocha.it('existing iam_role with same name — migration is skipped, existing role is unchanged', async function() {
        const collision_role_name = 'test-role-collision';

        // Seed an account that has role_config pointing at collision_role_name.
        const acc = await _insert_account_with_role_config(role_account_name_collision, {
            role_name: collision_role_name,
            assume_role_policy: {
                statement: [{
                    effect: 'allow',
                    action: ['sts:AssumeRole'],
                    principal: ['collision-user@example.com'],
                }]
            }
        });

        // Pre-create an iam_role in the store with the same name so the script
        // finds a collision when it iterates over this account.
        const pre_existing_role_id = system_store.new_system_store_id();
        const sentinel_description = 'pre-existing-sentinel';
        await system_store.make_changes({
            insert: {
                iam_roles: [{
                    _id: pre_existing_role_id,
                    owner: acc._id,
                    name: collision_role_name,
                    iam_path: '/',
                    description: sentinel_description,
                    max_session_duration: DEFAULT_MAX_SESSION_DURATION_SECS,
                    assume_role_policy_document: { Statement: [] },
                    iam_role_policies: [],
                    creation_date: Date.now(),
                }]
            }
        });

        const roles_before = (system_store.data.iam_roles || []).filter(
            r => r.name === collision_role_name
        );
        assert.strictEqual(roles_before.length, 1, 'exactly one role with that name must exist before migration');

        await upgrade_iam_role.run({ dbg, system_store, system_server: null });

        // The script must not insert a second role with the same name.
        const roles_after = (system_store.data.iam_roles || []).filter(
            r => r.name === collision_role_name
        );
        assert.strictEqual(roles_after.length, 1,
            'migration must not create a duplicate role when a role with the same name already exists');

        // The pre-existing role must remain exactly as it was — sentinel description
        // is the proof that the script did not overwrite it.
        const surviving_role = roles_after[0];
        assert.strictEqual(surviving_role.description, sentinel_description,
            'pre-existing role must be left unchanged by the migration');
    });
});
