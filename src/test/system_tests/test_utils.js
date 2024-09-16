/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const _ = require('lodash');
const http = require('http');
const P = require('../../util/promise');
const os_utils = require('../../util/os_utils');
const nb_native = require('../../util/nb_native');
const native_fs_utils = require('../../util/native_fs_utils');
const config = require('../../../config');
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const path = require('path');
const { CONFIG_TYPES } = require('../../sdk/config_fs');

/**
 * TMP_PATH is a path to the tmp path based on the process platform
 * in contrast to linux, /tmp/ path on mac is a symlink to /private/tmp/
 */
const TMP_PATH = os_utils.IS_MAC ? '/private/tmp/' : '/tmp/';

/**
 * is_nc_coretest returns true when the test runs on NC env
 */
const is_nc_coretest = process.env.NC_CORETEST === 'true';

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
    let isDone = true;
    // Time in seconds to wait, notice that it will only check once a second.
    // This is done in order to lower the amount of checking requests.
    const MAX_RETRIES = 10 * 60;
    let wait_counter = 1;

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
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: [principal] },
                    Action: action,
                    Resource: [
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

function invalid_nsfs_root_permissions() {
    if (process.getuid() !== 0 || process.getgid() !== 0) {
        console.log('No Root permissions found in env. Skipping test');
        return true;
    }
    return false;
}

/**
 * get_coretest_path returns coretest path according to process.env.NC_CORETEST value
 * @returns {string} 
 */
function get_coretest_path() {
    return process.env.NC_CORETEST ? './nc_coretest' : './coretest';
}

/**
 * exec_manage_cli runs the manage_nsfs cli
 * @param {string} type
 * @param {string} action
 * @param {object} options
 * @returns {Promise<string | Error>}
 */
async function exec_manage_cli(type, action, options, is_silent, env) {
    let flags = ``;
    for (const key in options) {
        if (options[key] !== undefined) {
            let value = options[key];
            if (typeof options[key] === 'boolean') {
                flags += `--${key} `;
                continue;
            }
            if (key === 'distinguished_name') {
                flags += `--user ${options[key]} `;
                continue;
            }
            if (key === 'bucket_policy') {
                value = typeof options[key] === 'string' ? `'${options[key]}'` : `'${JSON.stringify(options[key])}'`;
            } else if (key === 'fs_backend' || key === 'ips') {
                value = `'${options[key]}'`;
            }
            flags += `--${key} ${value} `;
        }
    }
    flags = flags.trim();

    const command = `node src/cmd/manage_nsfs ${type} ${action} ${flags}`;
    try {
        const res = await os_utils.exec(command, {
            return_stdout: true,
            env,
        });
        return res;
    } catch (err) {
        console.error('test_utils.exec_manage_cli error', err);
        if (is_silent) return err;
        throw err;
    }
}

/**
 * create_fs_user_by_platform creates a file system user by platform
 * @param {string} new_user
 * @param {string} new_password
 * @param {number} uid
 * @param {number} gid
 */
async function create_fs_user_by_platform(new_user, new_password, uid, gid) {
    if (process.platform === 'darwin') {
        const create_user_cmd = `sudo dscl . -create /Users/${new_user} UserShell /bin/bash`;
        const create_user_realname_cmd = `sudo dscl . -create /Users/${new_user} RealName ${new_user}`;
        const create_user_uid_cmd = `sudo dscl . -create /Users/${new_user} UniqueID ${uid}`;
        const create_user_gid_cmd = `sudo dscl . -create /Users/${new_user} PrimaryGroupID ${gid}`;
        await os_utils.exec(create_user_cmd, { return_stdout: true });
        await os_utils.exec(create_user_realname_cmd, { return_stdout: true });
        await os_utils.exec(create_user_uid_cmd, { return_stdout: true });
        await os_utils.exec(create_user_gid_cmd, { return_stdout: true });
    } else {
        const create_group_cmd = `groupadd -g ${gid} ${new_user}`;
        await os_utils.exec(create_group_cmd, { return_stdout: true });
        const create_user_cmd = `useradd -c ${new_user} -m ${new_user} -p $(openssl passwd -1 ${new_password}) -u ${uid} -g ${gid} `;
        await os_utils.exec(create_user_cmd, { return_stdout: true });
    }
}

/**
 * delete_fs_user_by_platform deletes a file system user by platform
 * @param {string} name
 */
async function delete_fs_user_by_platform(name) {
    if (process.platform === 'darwin') {
        const delete_user_cmd = `sudo dscl . -delete /Users/${name}`;
        const delete_user_home_cmd = `sudo rm -rf /Users/${name}`;
        await os_utils.exec(delete_user_cmd, { return_stdout: true });
        await os_utils.exec(delete_user_home_cmd, { return_stdout: true });
    } else {
        const delete_user_cmd = `userdel -r ${name}`;
        await os_utils.exec(delete_user_cmd, { return_stdout: true });
    }
}

/** 
 * set_path_permissions_and_owner sets path permissions and owner and group
 * @param {string} p
 * @param {object} owner_options
 * @param {number} permissions
 */
async function set_path_permissions_and_owner(p, owner_options, permissions = 0o700) {
    if (owner_options.uid !== undefined && owner_options.gid !== undefined) {
        await fs.promises.chown(p, owner_options.uid, owner_options.gid);
    } else {
        const { uid, gid } = await native_fs_utils.get_user_by_distinguished_name({ distinguished_name: owner_options.user });
        await fs.promises.chown(owner_options.new_buckets_path, uid, gid);
    }
    await fs.promises.chmod(p, permissions);
}

/** 
 * set_nc_config_dir_in_config sets given config_root to be config.NSFS_NC_CONF_DIR
 * @param {string} config_root
 */
function set_nc_config_dir_in_config(config_root) {
    config.NSFS_NC_CONF_DIR = config_root;
}

function generate_anon_s3_client(endpoint) {
    return new S3({
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        signer: { sign: async request => request },
        requestHandler: new NodeHttpHandler({
            httpAgent: new http.Agent({ keepAlive: false })
        }),
        endpoint,
        credentials: {
            accessKeyId: '',
            secretAccessKey: '',
        },
    });
}

function generate_s3_client(access_key, secret_key, endpoint) {
    return new S3({
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        requestHandler: new NodeHttpHandler({
            httpAgent: new http.Agent({ keepAlive: false })
        }),
        credentials: {
            accessKeyId: access_key,
            secretAccessKey: secret_key,
        },
        endpoint
    });
}
/**
 * generate_nsfs_account generate an nsfs account and returns its credentials
 * if the admin flag is received (in the options object) the function will not create 
 * the account (it was already created in the system) and only return the credentials.
 * @param {nb.APIClient} rpc_client 
 * @param {String} EMAIL 
 * @param {String} default_new_buckets_path 
 * @param {Object} options 
 * @returns {Promise<Object>}
 */
async function generate_nsfs_account(rpc_client, EMAIL, default_new_buckets_path, options = {}) {
    const { uid, gid, new_buckets_path, nsfs_only, admin, default_resource, account_name } = options;
    if (admin) {
        const account = await rpc_client.account.read_account({
            email: EMAIL,
        });
        return {
            access_key: account.access_keys[0].access_key.unwrap(),
            secret_key: account.access_keys[0].secret_key.unwrap()
        };
    }
    const random_name = account_name || (Math.random() + 1).toString(36).substring(7);
    const nsfs_account_config = {
        uid: uid || process.getuid(),
        gid: gid || process.getgid(),
        new_buckets_path: new_buckets_path || default_new_buckets_path,
        nsfs_only: nsfs_only || false
    };

    const account = await rpc_client.account.create_account({
        has_login: false,
        s3_access: true,
        email: `${random_name}@noobaa.com`,
        name: random_name,
        nsfs_account_config,
        default_resource
    });
    return {
        access_key: account.access_keys[0].access_key.unwrap(),
        secret_key: account.access_keys[0].secret_key.unwrap(),
        email: `${random_name}@noobaa.com`
    };
}

/**
 * get_new_buckets_path_by_test_env returns new_buckets_path value
 * on NC - new_buckets_path is full absolute path
 * on Containerized - new_buckets_path is the directory
 * Example - 
 * On NC - /private/tmp/new_buckets_path/
 * On Continerized - new_buckets_path/
 * @param {string} new_buckets_full_path 
 * @param {string} new_buckets_dir 
 * @returns {string}
 */
function get_new_buckets_path_by_test_env(new_buckets_full_path, new_buckets_dir) {
    return is_nc_coretest ? path.join(new_buckets_full_path, new_buckets_dir) : new_buckets_dir;
}

/**
 * write_manual_config_file writes config file directly to the file system without using config FS
 * used for creating backward compatibility tests, invalid config files etc
 * @param {String} type 
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} config_data 
 * @param {String} [invalid_str]
 * @returns {Promise<Void>}
 */
async function write_manual_config_file(type, config_fs, config_data, invalid_str = '') {
    const config_path = type === CONFIG_TYPES.BUCKET ?
        config_fs.get_bucket_path_by_name(config_data.name) :
        config_fs.get_identity_path_by_id(config_data._id);
    if (type === CONFIG_TYPES.ACCOUNT) {
        const dir_path = config_fs.get_identity_dir_path_by_id(config_data._id);
        await nb_native().fs.mkdir(config_fs.fs_context, dir_path, native_fs_utils.get_umasked_mode(config.BASE_MODE_DIR));
    }
    await nb_native().fs.writeFile(
        config_fs.fs_context,
        config_path,
        Buffer.from(JSON.stringify(config_data) + invalid_str),
        {
            mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE)
        }
    );

    if (type === CONFIG_TYPES.ACCOUNT) {
        const id_relative_path = config_fs.get_account_relative_path_by_id(config_data._id);
        const name_symlink_path = config_fs.get_account_or_user_path_by_name(config_data.name);
        await nb_native().fs.symlink(config_fs.fs_context, id_relative_path, name_symlink_path);
    }
}


/**
 * write_manual_old_account_config_file writes account config file directly to the old file system account path without using config FS
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} config_data 
 * @returns {Promise<Void>}
 */
async function write_manual_old_account_config_file(config_fs, config_data) {
    const config_path = config_fs._get_old_account_path_by_name(config_data.name);
    await nb_native().fs.writeFile(
        config_fs.fs_context,
        config_path,
        Buffer.from(JSON.stringify(config_data)),
        {
            mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE)
        }
    );
}

/**
 * delete_manual_config_file deletes config file directly from the file system without using config FS
 * used for deleting invalid config files etc
 * @param {String} type 
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} config_data 
 * @returns {Promise<Void>}
 */
async function delete_manual_config_file(type, config_fs, config_data) {
    if (type === CONFIG_TYPES.ACCOUNT) {
        const name_symlink_path = config_fs.get_account_or_user_path_by_name(config_data.name);
        await nb_native().fs.unlink(config_fs.fs_context, name_symlink_path);
    }

    const config_path = type === CONFIG_TYPES.BUCKET ?
        config_fs.get_bucket_path_by_name(config_data.name) :
        config_fs.get_identity_path_by_id(config_data._id);

    await nb_native().fs.unlink(config_fs.fs_context, config_path);

    if (type === CONFIG_TYPES.ACCOUNT) {
        const dir_path = config_fs.get_identity_dir_path_by_id(config_data._id);
        await nb_native().fs.rmdir(config_fs.fs_context, dir_path);
    }
}

exports.blocks_exist_on_cloud = blocks_exist_on_cloud;
exports.create_hosts_pool = create_hosts_pool;
exports.delete_hosts_pool = delete_hosts_pool;
exports.empty_and_delete_buckets = empty_and_delete_buckets;
exports.disable_accounts_s3_access = disable_accounts_s3_access;
exports.generate_s3_policy = generate_s3_policy;
exports.generate_s3_client = generate_s3_client;
exports.invalid_nsfs_root_permissions = invalid_nsfs_root_permissions;
exports.get_coretest_path = get_coretest_path;
exports.exec_manage_cli = exec_manage_cli;
exports.create_fs_user_by_platform = create_fs_user_by_platform;
exports.delete_fs_user_by_platform = delete_fs_user_by_platform;
exports.set_path_permissions_and_owner = set_path_permissions_and_owner;
exports.set_nc_config_dir_in_config = set_nc_config_dir_in_config;
exports.generate_anon_s3_client = generate_anon_s3_client;
exports.TMP_PATH = TMP_PATH;
exports.is_nc_coretest = is_nc_coretest;
exports.generate_nsfs_account = generate_nsfs_account;
exports.get_new_buckets_path_by_test_env = get_new_buckets_path_by_test_env;
exports.write_manual_config_file = write_manual_config_file;
exports.write_manual_old_account_config_file = write_manual_old_account_config_file;
exports.delete_manual_config_file = delete_manual_config_file;

