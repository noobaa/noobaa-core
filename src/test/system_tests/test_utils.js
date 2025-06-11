/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const _ = require('lodash');
const path = require('path');
const http = require('http');
const https = require('https');
const P = require('../../util/promise');
const config = require('../../../config');
const { S3 } = require('@aws-sdk/client-s3');
const { IAMClient } = require('@aws-sdk/client-iam');
const os_utils = require('../../util/os_utils');
const fs_utils = require('../../util/fs_utils');
const nb_native = require('../../util/nb_native');
const { CONFIG_TYPES } = require('../../sdk/config_fs');
const native_fs_utils = require('../../util/native_fs_utils');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const sinon = require('sinon');

const GPFS_ROOT_PATH = process.env.GPFS_ROOT_PATH;
const IS_GPFS = !_.isUndefined(GPFS_ROOT_PATH);
const TMP_PATH = get_tmp_path();
const TEST_TIMEOUT = 60 * 1000;

// NC CLI Constants
const CLI_UNSET_EMPTY_STRING = "''";

/**
 * TMP_PATH is a path to the tmp path based on the process platform
 * in contrast to linux, /tmp/ path on mac is a symlink to /private/tmp/
 * on gpfs should point to GPFS file system. should create tmp dir on file system and pass it as process.env.GPFS_ROOT_PATH
 */
function get_tmp_path() {
    if (os_utils.IS_MAC) {
        return '/private/tmp/';
    } else if (IS_GPFS) {
        return GPFS_ROOT_PATH;
    } else {
        return '/tmp/';
    }
}


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
async function blocks_exist_on_cloud(need_to_exist, pool_id, bucket_name, blocks, s3) {
    console.log('blocks_exist_on_cloud::', need_to_exist, pool_id, bucket_name);
    let isDone = true;
    // Time in seconds to wait, notice that it will only check once a second.
    // This is done in order to lower the amount of checking requests.
    const MAX_RETRIES = 10 * 60;
    let wait_counter = 1;

    try {
        while (isDone) {
            const response = Promise.allSettled(_.map(blocks, block => {
                console.log(`noobaa_blocks/${pool_id}/blocks_tree/${block.slice(block.length - 3)}.blocks/${block}`);
                return s3.headObject({
                    Bucket: bucket_name,
                    Key: `noobaa_blocks/${pool_id}/blocks_tree/${block.slice(block.length - 3)}.blocks/${block}`
                }).promise();
            }));

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
                    await P.delay(1000);
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
                    await P.delay(1000);
                }
            }

        }
    } catch (err) {
        console.error('blocks_exist_on_cloud::Final Error', err);
        throw err;
    }

    return true;
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
 * generate_s3_policy generates S3 buket policy for the given principal ppp
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
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: [principal] },
                Action: action,
                Resource: [
                    `arn:aws:s3:::${bucket}/*`,
                    `arn:aws:s3:::${bucket}`
                ]
            }]
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
 * creates a new file system group. if user_name is define add it to the group
 * @param {string} group_name
 * @param {number} gid
 * @param {string} [user_name]
 */
async function create_fs_group_by_platform(group_name, gid, user_name) {
    if (process.platform === 'darwin') {
        const create_group_cmd = `sudo dscl . create /Groups/${group_name} UserShell /bin/bash`;
        const create_group_realname_cmd = `sudo dscl . create /Groups/${group_name} RealName ${group_name}`;
        const create_group_gid_cmd = `sudo dscl . create /Groups/${group_name} gid ${gid}`;
        await os_utils.exec(create_group_cmd, { return_stdout: true });
        await os_utils.exec(create_group_realname_cmd, { return_stdout: true });
        await os_utils.exec(create_group_gid_cmd, { return_stdout: true });
        if (user_name) {
            const add_user_to_group_cmd = `sudo dscl . append /Groups/${group_name} GroupMembership ${user_name}`;
            await os_utils.exec(add_user_to_group_cmd, { return_stdout: true });
        }

    } else {
        const create_group_cmd = `groupadd -g ${gid} ${group_name}`;
        await os_utils.exec(create_group_cmd, { return_stdout: true });
        if (user_name) {
            const add_user_to_group_cmd = `usermod -a -G ${group_name} ${user_name}`;
            await os_utils.exec(add_user_to_group_cmd, { return_stdout: true });
        }
    }
}

/**
 * deletes a file system group. if force is true, delete the group even if its the primary group of a user
 * @param {string} group_name
 * @param {boolean} [force]
 */
async function delete_fs_group_by_platform(group_name, force = false) {
    if (process.platform === 'darwin') {
        const delete_group_cmd = `sudo dscl . -delete /Groups/${group_name}`;
        const delete_group_home_cmd = `sudo rm -rf /Groups/${group_name}`;
        await os_utils.exec(delete_group_cmd, { return_stdout: true });
        await os_utils.exec(delete_group_home_cmd, { return_stdout: true });
    } else {
        const flags = force ? '-f' : '';
        const delete_group_cmd = `groupdel ${flags} ${group_name}`;
        await os_utils.exec(delete_group_cmd, { return_stdout: true });
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


///////////////////////////////
///     REDIRECT FILE      ////
///////////////////////////////


/**
 * create_redirect_file will create the redirect file inside the default config directory,
 * its content is a path to a custom config directory
 * @returns {Promise<Void>}
 */
async function create_redirect_file(config_fs, custom_config_root_path) {
    const redirect_file_path = path.join(config.NSFS_NC_DEFAULT_CONF_DIR, config.NSFS_NC_CONF_DIR_REDIRECT_FILE);
    await nb_native().fs.writeFile(config_fs.fs_context, redirect_file_path, Buffer.from(custom_config_root_path));
}

/**
 * delete_redirect_file will delete the redirect file inside the default config directory,
 * WARNING - this will cause loosing of contact to the existing custom config directory
 * @returns {Promise<Void>}
 */
async function delete_redirect_file(config_fs) {
    const redirect_file_path = path.join(config.NSFS_NC_DEFAULT_CONF_DIR, config.NSFS_NC_CONF_DIR_REDIRECT_FILE);
    await fs_utils.file_delete(redirect_file_path);
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

function generate_iam_client(access_key, secret_key, endpoint) {
    const httpsAgent = new https.Agent({ rejectUnauthorized: false }); // disable SSL certificate validation
    return new IAMClient({
        region: config.DEFAULT_REGION,
        credentials: {
            accessKeyId: access_key,
            secretAccessKey: secret_key,
        },
        endpoint,
        requestHandler: new NodeHttpHandler({ httpsAgent }),
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
 * 1. if it's account -
 *    1.1. create identity directory /{config_dir_path}/identities/{id}/
 * 2. create the config file -
 *    2.1. if it's a bucket - create it in /{config_dir_path}/buckets/{bucket_name}.json
 *    2.2. if it's an account - create it in /{config_dir_path}/identities/{id}/identity.json
 * 3. if it's an account and symlink_name is true - create /{config_dir_path}/accounts_by_name/{account_name}.symlink -> /{config_dir_path}/identities/{id}/identity.json
 * 4. if it's an account and symlink_access_key is true and there is access key in the account config - create /{config_dir_path}/access_keys/{access_key}.symlink -> /{config_dir_path}/identities/{id}/identity.json
 * @param {String} type
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} config_data
 * @param {String} [invalid_str]
 * @param {{symlink_name?: Boolean, symlink_access_key?: Boolean}} [options]
 * @returns {Promise<Void>}
 */
async function write_manual_config_file(type, config_fs, config_data, invalid_str = '', { symlink_name, symlink_access_key } = { symlink_name: true, symlink_access_key: true }) {
    const config_path = type === CONFIG_TYPES.BUCKET ?
        config_fs.get_bucket_path_by_name(config_data.name) :
        config_fs.get_identity_path_by_id(config_data._id);
    if (type === CONFIG_TYPES.ACCOUNT) {
        await create_identity_dir_if_missing(config_fs, config_data._id);
    }
    await nb_native().fs.writeFile(
        config_fs.fs_context,
        config_path,
        Buffer.from(JSON.stringify(config_data) + invalid_str), {
            mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE)
        }
    );
    const id_relative_path = config_fs.get_account_relative_path_by_id(config_data._id);

    if (type === CONFIG_TYPES.ACCOUNT && symlink_name) {
        await symlink_account_name(config_fs, config_data.name, id_relative_path);
    }

    if (type === CONFIG_TYPES.ACCOUNT && symlink_access_key && config_data.access_keys &&
        Object.keys(config_data.access_keys).length > 0) {
        await symlink_account_access_keys(config_fs, config_data.access_keys, id_relative_path);
    }
}

/**
 * symlink_account_name symlinks the account's name path to the target link path
 * used for manual creation of the account name symlink
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {String} account_name
 * @param {String} link_target
 */
async function symlink_account_name(config_fs, account_name, link_target) {
    const name_symlink_path = config_fs.get_account_or_user_path_by_name(account_name);
    await nb_native().fs.symlink(config_fs.fs_context, link_target, name_symlink_path);
}

/**
 * symlink_account_access_keys symlinks the account's access key path to the target link path
 * used for manual creation of the account access key symlink
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} access_keys
 * @param {String} link_target
 */
async function symlink_account_access_keys(config_fs, access_keys, link_target) {
    for (const { access_key } of access_keys) {
        const access_key_symlink_path = config_fs.get_account_or_user_path_by_access_key(access_key);
        await nb_native().fs.symlink(config_fs.fs_context, link_target, access_key_symlink_path);
    }
}

/**
 * create_identity_dir_if_missing created the identity directory if missing
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {String} _id
 * @returns {Promise<Void>}
 */
async function create_identity_dir_if_missing(config_fs, _id) {
    const dir_path = config_fs.get_identity_dir_path_by_id(_id);
    try {
        await nb_native().fs.mkdir(config_fs.fs_context, dir_path, native_fs_utils.get_umasked_mode(config.BASE_MODE_DIR));
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
}

/**
 * write_manual_old_account_config_file writes account config file directly to the old file system account path without using config FS
 * 1. create old json file in /config_dir_path/accounts/account.json
 * 2. if symlink_access_key is true - create old access key symlink /config_dir_path/access_keys/{access_key}.symlink -> /config_dir_path/accounts/account.json
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} config_data
 * @param {{symlink_access_key?: Boolean}} [options]
 * @returns {Promise<Void>}
 */
async function write_manual_old_account_config_file(config_fs, config_data, { symlink_access_key } = { symlink_access_key: false }) {
    const config_path = config_fs._get_old_account_path_by_name(config_data.name);
    await nb_native().fs.writeFile(
        config_fs.fs_context,
        config_path,
        Buffer.from(JSON.stringify(config_data)), {
            mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE)
        }
    );

    const account_name_relative_path = config_fs.get_old_account_relative_path_by_name(config_data.name);
    if (symlink_access_key) {
        const access_key_symlink_path = config_fs.get_account_or_user_path_by_access_key(config_data.access_keys[0].access_key);
        await nb_native().fs.symlink(config_fs.fs_context, account_name_relative_path, access_key_symlink_path);
    }
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


/**
 * @param {any} test_name
 * @param {import('../../sdk/config_fs').ConfigFS} [config_fs]
 */
async function fail_test_if_default_config_dir_exists(test_name, config_fs) {
    const fs_context = config_fs?.fs_context || native_fs_utils.get_process_fs_context();
    const config_dir_exists = await native_fs_utils.is_path_exists(fs_context, config.NSFS_NC_DEFAULT_CONF_DIR);
    const msg = `${test_name} found an existing default config directory ${config.NSFS_NC_DEFAULT_CONF_DIR},` +
        `this test needs to test the creation of the config directory elements, therefore make sure ` +
        `the content of the config directory is not needed and remove it for ensuring a used config directory will not get deleted`;
    if (config_dir_exists) {
        console.error(msg);
        process.exit(1);
    }
}


/**
 * create_config_dir will create the config directory on the file system
 * @param {String} config_dir
 * @returns {Promise<Void>}
 */
async function create_config_dir(config_dir) {
    await fs_utils.create_fresh_path(config_dir);
}


/**
 * clean_config_dir cleans the config directory
 * custom_config_dir_path is created in some tests that are not using the default /etc/noobaa.conf.d/
 * config directory path
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {String} [custom_config_dir_path]
 * @returns {Promise<Void>}
 */
async function clean_config_dir(config_fs, custom_config_dir_path) {
    const buckets_dir_name = '/buckets/';
    const identities_dir_name = '/identities/';
    const accounts_by_name = '/accounts_by_name/';
    const access_keys_dir_name = '/access_keys/';
    const system_json = '/system.json';
    for (const dir of [buckets_dir_name, identities_dir_name, access_keys_dir_name, accounts_by_name, config.NSFS_TEMP_CONF_DIR_NAME]) {
        const default_path = path.join(config.NSFS_NC_DEFAULT_CONF_DIR, dir);
        await fs_utils.folder_delete_skip_enoent(default_path);
        if (custom_config_dir_path) {
            const custom_path = path.join(custom_config_dir_path, dir);
            await fs_utils.folder_delete_skip_enoent(custom_path);
        }
    }

    await delete_redirect_file(config_fs);
    await fs_utils.file_delete(system_json);
    await fs_utils.folder_delete_skip_enoent(config.NSFS_NC_DEFAULT_CONF_DIR);
    await fs_utils.folder_delete_skip_enoent(custom_config_dir_path);
}

/**
 * create_file creates a file in the file system
 * @param {nb.NativeFSContext} fs_context
 * @param {String} file_path
 * @param {Object} file_data
 * @param {{stringify_json?: Boolean}} [options={}]
 */
async function create_file(fs_context, file_path, file_data, options = {}) {
    const buf = Buffer.from(options?.stringify_json ? JSON.stringify(file_data) : file_data);
    await nb_native().fs.writeFile(
        fs_context,
        file_path,
        buf,
        {
            mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE)
        }
    );
}

/**
 * create_system_json creates the system.json file
 * if mock_config_dir_version it sets it before creating the file
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {String} [mock_config_dir_version]
 * @returns {Promise<Void>}
 */
async function create_system_json(config_fs, mock_config_dir_version) {
    const system_data = await config_fs._get_new_system_json_data();
    if (mock_config_dir_version) system_data.config_directory.config_dir_version = mock_config_dir_version;
    await config_fs.create_system_config_file(JSON.stringify(system_data));
}

/**
 * update_system_json updates the system.json file
 * if mock_config_dir_version it sets it before creating the file
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {String} [mock_config_dir_version]
 * @returns {Promise<Void>}
 */
async function update_system_json(config_fs, mock_config_dir_version) {
    const system_data = await config_fs.get_system_config_file();
    if (mock_config_dir_version) system_data.config_directory.config_dir_version = mock_config_dir_version;
    await config_fs.update_system_config_file(JSON.stringify(system_data));
}

/**
 * run_or_skip_test checks -
 * 1. if cond condition evaluated to true - run test
 * 2. else - skip test
 * @param {*} cond
 * @returns {*}
 */
const run_or_skip_test = cond => {
    if (cond) {
        return it;
    } else return it.skip;
};

/**
 * update_file_mtime updates the mtime of the target path
 * Warnings:
 *  - This operation would change the mtime of the file to 5 days ago - which means that it changes the etag / obj_id of the object
 *  - Please do not use on versioned objects (version_id will not be changed, but the mtime will be changed) - might cause issues.
 * @param {String} target_path
 * @returns {Promise<Void>}
 */
async function update_file_mtime(target_path) {
    const update_file_mtime_cmp = os_utils.IS_MAC ? `touch -t $(date -v -5d +"%Y%m%d%H%M.%S") ${target_path}` : `touch -d "5 days ago" ${target_path}`;
    await os_utils.exec(update_file_mtime_cmp, { return_stdout: true });
}

/////////////////////////////////
//////  LIFECYCLE UTILS   ///////
/////////////////////////////////

/**
 * generate_lifecycle_rule generate an S3 lifecycle rule with optional filters and expiration currently (can be extend to support more lifecycle rule params)
 *
 * @param {number} expiration_days
 * @param {string} id
 * @param {string} [prefix]
 * @param {Array<Object>} [tags]
 * @param {number} [size_gt]
 * @param {number} [size_lt]
 * @returns {Object}
 */
function generate_lifecycle_rule(expiration_days, id, prefix, tags, size_gt, size_lt) {
    const filters = {};
    if (prefix) filters.Prefix = prefix;
    if (Array.isArray(tags) && tags.length) filters.Tags = tags;
    if (size_gt !== undefined) filters.ObjectSizeGreaterThan = size_gt;
    if (size_lt !== undefined) filters.ObjectSizeLessThan = size_lt;

    const filter = Object.keys(filters).length > 1 ? { And: filters } : filters;

    return {
        ID: id,
        Status: 'Enabled',
        Filter: filter,
        Expiration: { Days: expiration_days },
    };
}

/**
 * validate_expiration_header validates the `x-amz-expiration` header against the object creation time, expected rule ID and expiration days
 *
 * The header is expected to have the format:
 *   expiry-date="YYYY-MM-DDTHH:MM:SS.SSSZ", rule-id="RULE_ID"
 *
 * @param {string} expiration_header - expiration header value
 * @param {string|Date} start_time - start/create time (string or Date) of the object
 * @param {string} expected_rule_id - expected rule ID to match in the header
 * @param {number} delta_days - expected number of days between start_time and expiry-date
 * @returns {boolean} true if the header is valid and matches the expected_rule_id and delta_days otherwise false
 */
function validate_expiration_header(expiration_header, start_time, expected_rule_id, delta_days) {
    const match = expiration_header.match(/expiry-date="(.+)", rule-id="(.+)"/);
    if (!match) return false;

    const [, expiry_str, rule_id] = match;
    const expiration = new Date(expiry_str);
    const start = new Date(start_time);
    start.setUTCHours(0, 0, 0, 0); // adjusting to midnight UTC otherwise the tests will fail - fix for ceph-s3 tests

    const days_diff = Math.floor((expiration.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));

    return days_diff === delta_days && rule_id === expected_rule_id;
}

/**
 * set_mock_functions sets mock functions used by the health script
 * the second param is an object having the name of the mock functions as the keys and
 * the value is an array of responses by the order of their call
 * @param {Object} Health
 * @param {{get_endpoint_response?: Object[], get_service_state?: Object[],
 * get_system_config_file?: Object[], get_service_memory_usage?: Object[],
 * get_lifecycle_health_status?: Object, get_latest_lifecycle_run_status?: Object}} mock_function_responses
 */
function set_health_mock_functions(Health, mock_function_responses) {
    for (const mock_function_name of Object.keys(mock_function_responses)) {
        const mock_function_responses_arr = mock_function_responses[mock_function_name];
        const obj_to_stub = mock_function_name === 'get_system_config_file' ? Health.config_fs : Health;

        if (obj_to_stub[mock_function_name]?.restore) obj_to_stub[mock_function_name]?.restore();
        const stub = sinon.stub(obj_to_stub, mock_function_name);
        for (let i = 0; i < mock_function_responses_arr.length; i++) {
            stub.onCall(i).returns(Promise.resolve(mock_function_responses_arr[i]));
        }
    }
}


exports.update_file_mtime = update_file_mtime;
exports.generate_lifecycle_rule = generate_lifecycle_rule;
exports.validate_expiration_header = validate_expiration_header;
exports.run_or_skip_test = run_or_skip_test;
exports.blocks_exist_on_cloud = blocks_exist_on_cloud;
exports.create_hosts_pool = create_hosts_pool;
exports.delete_hosts_pool = delete_hosts_pool;
exports.empty_and_delete_buckets = empty_and_delete_buckets;
exports.disable_accounts_s3_access = disable_accounts_s3_access;
exports.generate_s3_policy = generate_s3_policy;
exports.generate_s3_client = generate_s3_client;
exports.generate_iam_client = generate_iam_client;
exports.invalid_nsfs_root_permissions = invalid_nsfs_root_permissions;
exports.get_coretest_path = get_coretest_path;
exports.exec_manage_cli = exec_manage_cli;
exports.create_fs_user_by_platform = create_fs_user_by_platform;
exports.delete_fs_user_by_platform = delete_fs_user_by_platform;
exports.create_fs_group_by_platform = create_fs_group_by_platform;
exports.delete_fs_group_by_platform = delete_fs_group_by_platform;
exports.set_path_permissions_and_owner = set_path_permissions_and_owner;
exports.set_nc_config_dir_in_config = set_nc_config_dir_in_config;
exports.generate_anon_s3_client = generate_anon_s3_client;
exports.TMP_PATH = TMP_PATH;
exports.IS_GPFS = IS_GPFS;
exports.is_nc_coretest = is_nc_coretest;
exports.TEST_TIMEOUT = TEST_TIMEOUT;
exports.generate_nsfs_account = generate_nsfs_account;
exports.get_new_buckets_path_by_test_env = get_new_buckets_path_by_test_env;
exports.write_manual_config_file = write_manual_config_file;
exports.write_manual_old_account_config_file = write_manual_old_account_config_file;
exports.delete_manual_config_file = delete_manual_config_file;
exports.create_identity_dir_if_missing = create_identity_dir_if_missing;
exports.symlink_account_name = symlink_account_name;
exports.symlink_account_access_keys = symlink_account_access_keys;
exports.create_file = create_file;
exports.create_redirect_file = create_redirect_file;
exports.delete_redirect_file = delete_redirect_file;
exports.create_system_json = create_system_json;
exports.update_system_json = update_system_json;
exports.fail_test_if_default_config_dir_exists = fail_test_if_default_config_dir_exists;
exports.create_config_dir = create_config_dir;
exports.clean_config_dir = clean_config_dir;
exports.CLI_UNSET_EMPTY_STRING = CLI_UNSET_EMPTY_STRING;
exports.set_health_mock_functions = set_health_mock_functions;
