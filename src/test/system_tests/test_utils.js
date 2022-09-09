/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('../../util/promise');
var _ = require('lodash');

/**
 * 
 * @param {*} need_to_exist 
 * @param {*} pool_id 
 * @param {*} bucket_name 
 * @param {*} blocks 
 * @param {AWS.S3} s3 
 */
function blocks_exist_on_cloud(need_to_exist, pool_id, bucket_name, blocks, s3) {
    console.log('blocks_exist_on_cloud::', need_to_exist, pool_id, bucket_name);
    var isDone = true;
    // Time in seconds to wait, notice that it will only check once a second.
    // This is done in order to lower the amount of checking requests.
    var MAX_RETRIES = 10 * 60;
    var wait_counter = 1;

    return P.pwhile(
            () => isDone,
            () => Promise.allSettled(_.map(blocks, block => {
                console.log(`noobaa_blocks/${pool_id}/blocks_tree/${block.slice(block.length - 3)}.blocks/${block}`);
                return s3.headObject({
                    Bucket: bucket_name,
                    Key: `noobaa_blocks/${pool_id}/blocks_tree/${block.slice(block.length - 3)}.blocks/${block}`
                }).promise();
            }))
            .then(response => {
                let condition_correct;
                if (need_to_exist) {
                    condition_correct = true;
                    _.forEach(response, promise_result => {
                        if (promise_result.status === 'rejected') {
                            condition_correct = false;
                        }
                    });

                    if (condition_correct) {
                        isDone = false;
                    } else {
                        wait_counter += 1;
                        if (wait_counter >= MAX_RETRIES) {
                            throw new Error('Blocks do not exist');
                        }
                        return P.delay(1000);
                    }
                } else {
                    condition_correct = true;
                    _.forEach(response, promise_result => {
                        if (promise_result.status === 'fulfilled') {
                            condition_correct = false;
                        }
                    });

                    if (condition_correct) {
                        isDone = false;
                    } else {
                        wait_counter += 1;
                        if (wait_counter >= MAX_RETRIES) {
                            throw new Error('Blocks still exist');
                        }
                        return P.delay(1000);
                    }
                }
            })
        )
        .then(() => true)
        .catch(err => {
            console.error('blocks_exist_on_cloud::Final Error', err);
            throw err;
        });
}

async function create_hosts_pool(
    rpc_client,
    pool_name,
    host_count = 3,
    timeout_ms = 5 * 60 * 1000 // 5min
) {
    console.log(`test_utils::create_hosts_pool: creating new pool '${pool_name} with ${host_count} agents'`);
    await rpc_client.pool.create_hosts_pool({
        is_managed: true,
        name: pool_name,
        host_count: host_count
    });

    console.log(`test_utils::create_hosts_pool: waiting for ${pool_name} hosts (${host_count}) to be in optimal state`);
    await P.timeout(timeout_ms, (
        async () => {
            let all_hosts_ready = false;
            while (!all_hosts_ready) {
                const res = await rpc_client.host.list_hosts({
                    query: {
                        pools: [pool_name],
                        mode: ['OPTIMAL'],
                    }
                });

                await P.delay(2500);
                all_hosts_ready = res.hosts.length === host_count;
            }
        }
    )());
    console.log(`test_utils::create_hosts_pool: all ${pool_name} hosts (${host_count}) are in optimal state`);
}

async function delete_hosts_pool(
    rpc_client,
    pool_name,
    timeout_ms = 10 * 60 * 1000 // 10min
) {
    console.log(`test_utils::delete_hosts_pool: Initiate deletion of ${pool_name}`);
    await rpc_client.pool.delete_pool({ name: pool_name });

    console.log(`test_utils::delete_hosts_pool: Waiting for ${pool_name} to be evacuated and delete`);
    await P.timeout(timeout_ms, (
        async () => {
            let pool_exists = true;
            while (pool_exists) {
                await P.delay(30 * 1000); // 30sec
                const system = await rpc_client.system.read_system({});
                pool_exists = system.pools.find(pool => pool.name === pool_name);
            }
        }
    )());
    console.log(`test_utils::delete_hosts_pool: ${pool_name} was evacuated and deleted`);
}

async function empty_and_delete_buckets(rpc_client, bucket_names) {
    if (!bucket_names) {
        const { buckets } = await rpc_client.bucket.list_buckets();
        bucket_names = buckets.map(bucket => bucket.name);
    }

    await Promise.all(
        bucket_names.map(async bucket => {
            const { objects } = await rpc_client.object.list_objects({ bucket });
            await rpc_client.object.delete_multiple_objects({
                bucket: bucket,
                objects: objects.map(obj => _.pick(obj, ['key', 'version_id']))
            });
            await rpc_client.bucket.delete_bucket({ name: bucket });
        })
    );
}

async function disable_accounts_s3_access(rpc_client, accounts_emails) {
    if (!accounts_emails) {
        const { accounts } = await rpc_client.account.list_accounts({});
        accounts_emails = accounts.map(account => account.email);
    }

    await Promise.all(accounts_emails.map(email =>
        rpc_client.account.update_account_s3_access({
            email: email,
            s3_access: false
        })
    ));
}

/**
 * generate_s3_policy generates S3 buket policy for the given principal
 * 
 * @param {string} principal - The principal to grant access to.
 * @param {string} bucket - The bucket to grant access to.
 * @param {Array<string>} action - The action to grant access to.
 * @returns {{ 
 *  policy: Record<string, any>,
 *  params: { bucket: string, action: Array<string>, principal: string } 
 * }}
 */
function generate_s3_policy(principal, bucket, action) {
    return {
        policy: {
            version: '2012-10-17',
            statement: [
                {
                    effect: 'allow',
                    principal: [principal],
                    action: action,
                    resource: [
                        `arn:aws:s3:::${bucket}/*`,
                        `arn:aws:s3:::${bucket}`
                    ]
                }
            ]
        },
        params: {
            bucket,
            action,
            principal,
        }
    };
}

exports.blocks_exist_on_cloud = blocks_exist_on_cloud;
exports.create_hosts_pool = create_hosts_pool;
exports.delete_hosts_pool = delete_hosts_pool;
exports.empty_and_delete_buckets = empty_and_delete_buckets;
exports.disable_accounts_s3_access = disable_accounts_s3_access;
exports.generate_s3_policy = generate_s3_policy;
