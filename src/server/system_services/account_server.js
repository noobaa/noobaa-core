/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const _ = require('lodash');
const net = require('net');
const chance = require('chance')();
const GoogleStorage = require('../../util/google_storage_wrap');
const server_rpc = require('../server_rpc');

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const { RpcError } = require('../../rpc');
const Dispatcher = require('../notifications/dispatcher');
const SensitiveString = require('../../util/sensitive_string');
const cloud_utils = require('../../util/cloud_utils');
const system_store = require('../system_services/system_store').get_instance();
const azure_storage = require('../../util/azure_storage_wrap');
const NetStorage = require('../../util/NetStorageKit-Node-master/lib/netstorage');
const usage_aggregator = require('../bg_services/usage_aggregator');
const { OP_NAME_TO_ACTION } = require('../../endpoint/sts/sts_rest');
const { Durations, LogsQueryClient } = require('@azure/monitor-query-logs');
const { ClientSecretCredential } = require("@azure/identity");
const noobaa_s3_client = require('../../sdk/noobaa_s3_client/noobaa_s3_client');
const account_util = require('./../../util/account_util');
const iam_utils = require('../../endpoint/iam/iam_utils');
const { IAM_ACTIONS, IAM_DEFAULT_PATH, ACCESS_KEY_STATUS_ENUM,
     MAX_TAGS } = require('../../endpoint/iam/iam_constants');


const check_connection_timeout = 15 * 1000;
const check_new_azure_connection_timeout = 20 * 1000;

/**
 *
 * CREATE_ACCOUNT
 *
 */
async function create_account(req) {
    const action = IAM_ACTIONS.CREATE_USER;
    let iam_arn;
    if (req.rpc_params.owner) {
        const user_name = account_util.get_iam_username(req.rpc_params.email.unwrap());
        account_util._check_if_requesting_account_is_root_account(action, req.account,
                { username: user_name, path: req.rpc_params.iam_path });
        account_util._check_username_already_exists(action, req.rpc_params.email, user_name);
        iam_arn = iam_utils.create_arn_for_user(req.account._id.toString(), user_name,
                                    req.rpc_params.iam_path || IAM_DEFAULT_PATH);
    } else {
        account_util.validate_create_account_permissions(req);
        account_util.validate_create_account_params(req);
    }
    const {id, token, access_keys} = await account_util.create_account(req);

    iam_arn = iam_arn || iam_utils.create_arn_for_root(id);
    return {
        id,
        arn: iam_arn,
        token,
        access_keys
    };
}

function validate_assume_role_policy(policy) {
    const all_op_names = Object.values(OP_NAME_TO_ACTION);
    for (const statement of policy.statement) {
        for (const principal of statement.principal) {
            if (principal.unwrap() !== '*') {
                const account = system_store.get_account_by_email(principal);
                if (!account) {
                    throw new RpcError('MALFORMED_POLICY', 'Invalid principal in policy', { detail: principal });
                }
            }
        }
        for (const action of statement.action) {
            if (action !== 'sts:*' && !all_op_names.includes(action)) {
                throw new RpcError('MALFORMED_POLICY', 'Policy has invalid action', { detail: action });
            }
        }
    }
}

function create_external_user_account(req) {
    const {
        HOST: hostPools = [],
        CLOUD: cloudResource = [],
        INTERNAL: internalStorage = []
    } = _.groupBy(system_store.data.pools, pool => pool.resource_type);

    const default_resource =
        cloudResource[0] ||
        hostPools[0] ||
        internalStorage[0];

    // TODO: check if need here to add namespace resource as default resource
    Object.assign(req.rpc_params, {
        is_external: true,
        password: new SensitiveString(chance.string({ length: 16 })),
        must_change_password: false,
        has_login: true,
        s3_access: true,
        allow_bucket_creation: true,
        default_resource: default_resource.name
    });

    return create_account(req);
}

/**
 *
 * READ_ACCOUNT
 *
 */
function read_account(req) {
    const email = req.rpc_params.email || req.account.email;

    const account = system_store.get_account_by_email(email);
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + email);
    }

    const is_self = req.account === account;
    const self_roles = req.account.roles_by_system[req.system._id];
    const is_operator = self_roles && self_roles.includes('operator');

    return get_account_info(
        account,
        is_self || is_operator
    );
}


function read_account_by_access_key(req) {
    const { access_key } = req.rpc_params;
    const account = _.find(system_store.data.accounts, acc =>
        acc.access_keys && acc.access_keys.length > 0 && acc.access_keys[0].access_key.unwrap() === access_key.unwrap()
    );

    if (!account) throw new RpcError('NO_SUCH_ACCOUNT', 'No such account with credentials: ' + access_key);

    return get_account_info(account);
}

/**
 *
 * GENERATE_ACCOUNT_KEYS
 *
 */
async function generate_account_keys(req) {
    return await account_util.generate_account_keys(req);
}

/**
 *
 * UPDATE_ACCOUNT_KEYS
 *
 */
async function update_account_keys(req) {
    const account = system_store.get_account_by_email(req.rpc_params.email);
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    if (req.system && req.account) {
        if (!is_support_or_admin_or_me(req.system, req.account, account)) {
            throw new RpcError('UNAUTHORIZED', 'Cannot update account');
        }
    }
    if (account.is_support) {
        throw new RpcError('FORBIDDEN', 'Cannot update support account');
    }
    const access_keys = req.rpc_params.access_keys;

    if (!_.isUndefined(system_store.get_account_by_access_key(access_keys.access_key))) {
        throw new RpcError('ACCESS_KEY_DUPLICATION', 'Duplicate access key is found, each access_key must be unique');
    }

    access_keys.secret_key = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
        access_keys.secret_key, account.master_key_id._id);

    await system_store.make_changes({
        update: {
            accounts: [{
                _id: account._id,
                access_keys: [
                    access_keys
                ]
            }]
        }
    });

    Dispatcher.instance().activity({
        event: 'account.update_credentials',
        level: 'info',
        system: req.system && req.system._id,
        actor: req.account && req.account._id,
        account: account._id,
        desc: `Credentials for ${account.email.unwrap()} were updated ${req.account && 'by ' + req.account.email.unwrap()}`,
    });
}

/**
 *
 * update_account_s3_access
 *
 */
function update_account_s3_access(req) {
    const account = _.cloneDeep(system_store.get_account_by_email(req.rpc_params.email));
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }

    let system = req.system;
    if (req.system && req.account) {
        if (!is_support_or_admin_or_me(req.system, req.account, account)) {
            throw new RpcError('UNAUTHORIZED', 'Cannot update account');
        }
    } else if (!req.system) {
        system = system_store.data.systems_by_name[req.rpc_params.name];
    }
    if (account.is_support) {
        throw new RpcError('FORBIDDEN', 'Cannot update support account');
    }

    const update = {
        _id: account._id
    };

    //If s3_access is on, update allowed buckets, default_resource and force_md5_etag
    if (req.rpc_params.s3_access) {
        if (!req.rpc_params.default_resource) {
            const pools = _.filter(req.system.pools_by_name, p => !p.is_default_pool);
            if (pools.length) { // has resources which is not internal - must supply resource
                throw new RpcError('BAD_REQUEST', 'Enabling S3 requires providing default_resource');
            }
        }

        if (req.rpc_params.default_resource) {
            const resource = system.pools_by_name[req.rpc_params.default_resource] ||
                (system.namespace_resources_by_name &&
                    system.namespace_resources_by_name[req.rpc_params.default_resource]);
            if (!resource) throw new RpcError('BAD_REQUEST', 'default resource doesn\'t exist');
            update.default_resource = resource._id;
        } else {
            update.default_resource = (Object.values(req.system.pools_by_name)[0])._id;
        }

        if (!_.isUndefined(req.rpc_params.allow_bucket_creation)) {
            update.allow_bucket_creation = req.rpc_params.allow_bucket_creation;
        }

        if (!_.isUndefined(req.rpc_params.force_md5_etag)) {
            update.force_md5_etag = req.rpc_params.force_md5_etag;
        }

        if (req.rpc_params.nsfs_account_config) {
            if (_.isUndefined(req.rpc_params.nsfs_account_config.distinguished_name) &&
                _.isUndefined(req.rpc_params.nsfs_account_config.uid) &&
                _.isUndefined(req.rpc_params.nsfs_account_config.gid) && !req.rpc_params.nsfs_account_config.new_buckets_path &&
                _.isUndefined(req.rpc_params.nsfs_account_config.nsfs_only)) {
                throw new RpcError('FORBIDDEN', 'Invalid nsfs_account_config');
            }

            update.nsfs_account_config = {
                ...account.nsfs_account_config,
                ...req.rpc_params.nsfs_account_config
            };
        }
    } else {
        update.$unset = {
            default_resource: true,
            allow_bucket_creation: true,
            force_md5_etag: true
        };
    }

    return system_store.make_changes({
            update: {
                accounts: [update]
            }
        })
        .then(() => {
            const pool = system.pools_by_name[req.rpc_params.default_resource] ||
                (system.namespace_resources_by_name && system.namespace_resources_by_name[req.rpc_params.default_resource]);
            const original_pool = pool && pool.name;
            const desc_string = [];
            const added_buckets = [];
            const removed_buckets = [];
            desc_string.push(`${account.email.unwrap()} S3 access was updated by ${req.account && req.account.email.unwrap()}`);
            if (req.rpc_params.s3_access) {
                if (original_pool !== req.rpc_params.default_resource) {
                    desc_string.push(`default pool changed to`, req.rpc_params.default_resource ? req.rpc_params.default_resource : `None`);
                }
                if (added_buckets.length) {
                    desc_string.push(`added buckets: ${added_buckets}`);
                }
                if (removed_buckets.length) {
                    desc_string.push(`removed buckets: ${removed_buckets}`);
                }
                if (account.allow_bucket_creation !== req.rpc_params.allow_bucket_creation) {
                    if (req.rpc_params.allow_bucket_creation) {
                        desc_string.push('future bucket creation was enabled');
                    } else {
                        desc_string.push('future bucket creation was disabled');
                    }
                }
            } else {
                desc_string.push(`S3 permissions was changed to disabled`);
            }
            Dispatcher.instance().activity({
                event: 'account.s3_access_updated',
                level: 'info',
                system: req.system && req.system._id,
                actor: req.account && req.account._id,
                account: account._id,
                desc: desc_string.join('\n'),
            });
        });
}




/**
 *
 * UPDATE_ACCOUNT
 *
 */
function update_account(req) {
    const params = req.rpc_params;
    const account = system_store.get_account_by_email(req.rpc_params.email);

    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + params.email);
    }
    if (!is_support_or_admin_or_me(req.system, req.account, account)) {
        throw new RpcError('UNAUTHORIZED', 'Cannot update account');
    }
    if (account.is_support) {
        throw new RpcError('FORBIDDEN', 'Cannot update support account');
    }
    if (params.ips && !_.every(params.ips, ip_range => (net.isIP(ip_range.start) && net.isIP(ip_range.end)))) {
        throw new RpcError('FORBIDDEN', 'Non valid IPs');
    }
    const updates = {
        name: params.name,
        email: params.new_email,
        next_password_change: params.must_change_password === true ? new Date() : undefined,
        allowed_ips: (!_.isUndefined(params.ips) && params.ips !== null) ? params.ips : undefined,
        preferences: _.isUndefined(params.preferences) ? undefined : params.preferences,
    };

    if (req.rpc_params.role_config) {
        validate_assume_role_policy(req.rpc_params.role_config.assume_role_policy);
        updates.role_config = req.rpc_params.role_config;
    }

    const removals = {
        next_password_change: params.must_change_password === false ? true : undefined,
        allowed_ips: params.ips === null ? true : undefined,
        role_config: params.remove_role_config,
    };

    //Create the event description according to the changes performed
    let event_desc = '';
    if (params.new_email && params.new_email !== params.email) {
        event_desc += `Email address changed from ${params.email} to ${params.new_email}. `;
    }
    if (!_.isUndefined(params.ips) && account.allowed_ips !== params.ips) {
        if (params.ips === null) {
            event_desc += `Restriction for IPs were removed`;
        } else {
            event_desc += `Allowed IPs were changed to ` + params.ips.map(ip_range => ip_range.start + ' - ' + ip_range.end).join(', ');
        }
    }

    return system_store.make_changes({
            update: {
                accounts: [{
                    _id: account._id,
                    $set: _.omitBy(updates, _.isUndefined),
                    $unset: _.omitBy(removals, _.isUndefined)
                }]
            }
        })
        .then(() => Dispatcher.instance().activity({
            event: 'account.update',
            level: 'info',
            system: req.system && req.system._id,
            actor: req.account && req.account._id,
            account: account._id,
            desc: `${account.email.unwrap()} was updated by ${req.account && req.account.email.unwrap()}` +
                (event_desc ? '. ' + event_desc : ''),
        }));
}

async function get_account_usage(req) {
    const { since, till, accounts, endpoint_groups } = req.rpc_params;

    const account_ids = accounts && accounts.map(acc =>
        _.get(system_store.data.accounts_by_email[acc.unwrap()], '_id')
    );

    return usage_aggregator.get_accounts_bandwidth_usage({
        accounts: account_ids,
        endpoint_groups,
        since,
        till
    });
}

/**
 *
 * DELETE_ACCOUNT
 *
 */
function delete_account(req) {
    const account_to_delete = system_store.get_account_by_email(req.rpc_params.email);
    _verify_can_delete_account(req, account_to_delete);
    return account_util.delete_account(req, account_to_delete);
}


/**
 *
 * DELETE_ACCOUNT BY PROPERTY
 *
 */
function delete_account_by_property(req) {
    let roles_to_delete = [];
    const accounts_to_delete = system_store.get_accounts_by_nsfs_account_config(req.rpc_params.nsfs_account_config)
        .map(account_to_delete => {
            _verify_can_delete_account(req, account_to_delete);
            roles_to_delete = roles_to_delete.concat(system_store.data.roles
                .filter(
                    role => String(role.account._id) === String(account_to_delete._id)
                )
                .map(
                    role => role._id
                ));
            return account_to_delete._id;
        });

    if (!accounts_to_delete.length) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No account with provided uid/gid: ' +
            req.rpc_params.nsfs_account_config.uid + '/' + req.rpc_params.nsfs_account_config.gid);
    }
    return system_store.make_changes({
        remove: {
            accounts: accounts_to_delete,
            roles: roles_to_delete
        }
    });
}

/**
 *
 * LIST_ACCOUNTS
 *
 */
function list_accounts(req) {
    // list system accounts is supported only for  admin / operator / support
    const is_support = req.account.is_support;
    const roles = !is_support && req.account.roles_by_system[req.system._id];
    if (!is_support && roles && !roles.includes('admin') && !roles.includes('operator')) {
        throw new RpcError('UNAUTHORIZED', 'Must be system admin or operator');
    }

    const accounts = system_store.data.accounts
        // for support account - list all accounts
        .filter(account => is_support || !account.is_support)
        // filter list, UID and GID together
        .filter(account => !req.rpc_params.filter ||
            (req.rpc_params.filter &&
                req.rpc_params.filter.fs_identity &&
                _.isEqual(req.rpc_params.filter.fs_identity.distinguished_name,
                    account.nsfs_account_config && account.nsfs_account_config.distinguished_name) &&
                req.rpc_params.filter.fs_identity.uid === (account.nsfs_account_config && account.nsfs_account_config.uid) &&
                req.rpc_params.filter.fs_identity.gid === (account.nsfs_account_config && account.nsfs_account_config.gid))
        )
        .map(account => get_account_info(account, req.account === account));

    return { accounts };
}

/**
 *
 * ACCOUNTS_STATUS
 *
 */
function accounts_status(req) {
    const any_non_support_account = _.find(system_store.data.accounts, function(account) {
        return !account.is_support;
    });
    return {
        has_accounts: Boolean(any_non_support_account)
    };
}

// called only from stats_aggregator,
// we can remove here and access directly from there
function get_system_roles(req) {
    return req.system.roles_by_account;
}

/**
 *
 * manage account external connections cache.
 *
 */

async function add_external_connection(req) {
    dbg.log0('add_external_connection:', req.rpc_params);
    const res = await server_rpc.client.account.check_external_connection(req.rpc_params, {
        auth_token: req.auth_token
    });
    if (res.status !== 'SUCCESS') {
        throw new RpcError(res.error.code, res.error.message);
    }

    let info = _.pick(req.rpc_params, 'name', 'endpoint', 'endpoint_type', 'aws_sts_arn', 'region');
    if (!info.endpoint_type) info.endpoint_type = 'AWS';
    info.access_key = req.rpc_params.identity;
    info.secret_key = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
        req.rpc_params.secret, req.account.master_key_id._id);

    if (req.rpc_params.azure_log_access_keys) {
        info.azure_log_access_keys = {
            azure_tenant_id: req.rpc_params.azure_log_access_keys.azure_tenant_id,
            azure_client_id: req.rpc_params.azure_log_access_keys.azure_client_id,
            azure_client_secret: system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
                req.rpc_params.azure_log_access_keys.azure_client_secret, req.account.master_key_id._id),
            azure_logs_analytics_workspace_id: req.rpc_params.azure_log_access_keys.azure_logs_analytics_workspace_id,
        };
    }

    info.cp_code = req.rpc_params.cp_code || undefined;
    info.auth_method = req.rpc_params.auth_method || config.DEFAULT_S3_AUTH_METHOD[info.endpoint_type] || undefined;
    info = _.omitBy(info, _.isUndefined);
    if ((info.endpoint_type === 'AWS' || info.endpoint_type === 'AWSSTS' || info.endpoint_type === 'S3_COMPATIBLE') &&
        (!info.endpoint.startsWith('http://') && !info.endpoint.startsWith('https://'))) {
        info.endpoint = 'http://' + info.endpoint;
    }

    // TODO: Maybe we should check differently regarding NET_STORAGE connections
    //Verify the exact connection does not exist
    const conn = _.find(req.account.sync_credentials_cache, function(cred) {
        return cred.endpoint === info.endpoint &&
            cred.endpoint_type === info.endpoint_type &&
            cred.access_key.unwrap() === info.access_key.unwrap();
    });
    if (conn) {
        throw new RpcError('External Connection Already Exists');
    }

    await system_store.make_changes({
        update: {
            accounts: [{
                _id: req.account._id,
                $push: { sync_credentials_cache: info }
            }]
        }
    });

    Dispatcher.instance().activity({
        event: 'account.connection_create',
        level: 'info',
        system: req.system && req.system._id,
        actor: req.account && req.account._id,
        account: req.account && req.account._id,
        desc: `Connection "${info.name}" was created by ${req.account && req.account.email.unwrap()}.
            \nEndpoint: ${req.rpc_params.endpoint}
            \nAccess key: ${req.rpc_params.identity}`,
    });
}

async function update_external_connection(req) {
    const connection = cloud_utils.find_cloud_connection(req.account, req.rpc_params.name);
    const name = req.rpc_params.name;
    const identity = req.rpc_params.identity || connection.access_key;
    const secret = req.rpc_params.secret;
    const azure_log_access_keys = req.rpc_params.azure_log_access_keys;
    const region = req.rpc_params.region || connection.region;

    const encrypted_secret = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
        secret, req.account.master_key_id._id);

    let check_failed = false;
    try {
        const { status } = await _check_external_connection_internal({
            name,
            identity,
            secret,
            endpoint_type: connection.endpoint_type,
            endpoint: connection.endpoint,
            region: region,
            cp_code: connection.cp_code,
            auth_method: connection.auth_method,
            azure_log_access_keys: azure_log_access_keys,
        });
        check_failed = status !== 'SUCCESS';

    } catch (error) {
        dbg.error('update_external_connection: _check_external_connection_internal had error', error);
        check_failed = true;
    }

    if (check_failed) {
        throw new RpcError('INVALID_CREDENTIALS', `Credentials are not valid ${name}`);
    }

    const acc_update_set_obj = {
        "sync_credentials_cache.$.access_key": identity,
        "sync_credentials_cache.$.secret_key": encrypted_secret,
    };
    const ns_resource_update_map_obj = {
        'connection.access_key': identity,
        'connection.secret_key': encrypted_secret
    };

    if (azure_log_access_keys) {
        const encrypted_azure_client_secret = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
            azure_log_access_keys.azure_client_secret, req.account.master_key_id._id
        );
        const azure_creds_obj = {
            "azure_tenant_id": azure_log_access_keys.azure_tenant_id,
            "azure_client_id": azure_log_access_keys.azure_client_id,
            "azure_client_secret": encrypted_azure_client_secret,
            "azure_logs_analytics_workspace_id": azure_log_access_keys.azure_logs_analytics_workspace_id
        };
        acc_update_set_obj["sync_credentials_cache.$.azure_log_access_keys"] = azure_creds_obj;
        ns_resource_update_map_obj["connection.azure_log_access_keys"] = azure_creds_obj;
    }

    const accounts_updates = [{
        $find: {
            _id: req.account._id,
            "sync_credentials_cache.name": name
        },
        $set: acc_update_set_obj
    }];

    const pools_updates = system_store.data.pools
        .filter(pool =>
            pool.cloud_pool_info &&
            pool.cloud_pool_info.endpoint_type === connection.endpoint_type &&
            pool.cloud_pool_info.endpoint === connection.endpoint &&
            pool.cloud_pool_info.access_keys.account_id._id.toString() === req.account._id.toString() &&
            pool.cloud_pool_info.access_keys.access_key.unwrap() === connection.access_key.unwrap()
        )
        .map(pool => ({
            _id: pool._id,
            'cloud_pool_info.access_keys.access_key': identity,
            'cloud_pool_info.access_keys.secret_key': encrypted_secret,
        }));

    const ns_resources_updates = system_store.data.namespace_resources
        .filter(ns_resource =>
            ns_resource.connection &&
            ns_resource.connection.endpoint_type === connection.endpoint_type &&
            ns_resource.connection.endpoint === connection.endpoint &&
            ns_resource.account._id.toString() === req.account._id.toString() &&
            ns_resource.connection.access_key.unwrap() === connection.access_key.unwrap()
        )
        .map(ns_resource => ({
            _id: ns_resource._id,
            ...ns_resource_update_map_obj
        }));

    await system_store.make_changes({
        update: {
            accounts: accounts_updates,
            pools: pools_updates,
            namespace_resources: ns_resources_updates
        }
    });

    if (pools_updates.length > 0) {
        await server_rpc.client.hosted_agents.update_credentials({
            pool_ids: pools_updates.map(update => String(update._id)),
            credentials: {
                access_key: identity.unwrap(),
                secret_key: secret.unwrap(),
            }
        }, {
            auth_token: req.auth_token
        });
    }
}

async function check_external_connection(req) {
    dbg.log0('check_external_connection:', req.rpc_params);
    const params = req.rpc_params;
    const account = req.account;

    const connection = req.rpc_params.name && _.find(account.sync_credentials_cache, sync_conn =>
        sync_conn.name === req.rpc_params.name);
    if (connection && !req.rpc_params.ignore_name_already_exist) {
        throw new RpcError('CONNECTION_ALREADY_EXIST', 'Connection name already exists: ' + req.rpc_params.name);
    }

    return _check_external_connection_internal(params);
}

async function _check_external_connection_internal(connection) {
    const { endpoint_type } = connection;
    switch (endpoint_type) {
        case 'AZURE': {
            return check_azure_connection(connection);
        }
        case 'AWSSTS': {
            return check_aws_sts_connection(connection);
        }
        case 'AWS':
        case 'S3_COMPATIBLE':
        case 'FLASHBLADE':
        case 'IBM_COS': {
            return check_aws_connection(connection);
        }

        case 'NET_STORAGE': {
            return check_net_storage_connection(connection);
        }
        case 'GOOGLE': {
            return check_google_connection(connection);
        }

        default: {
            throw new Error('Unknown endpoint type');
        }
    }
}

async function check_azure_connection(params) {
    try {
        // set a timeout for the entire flow
        const res = await P.timeout(
            check_new_azure_connection_timeout,
            _check_azure_connection_internal(params),
            () => new Error('TIMEOUT')
        );
        return res;
    } catch (err) {
        dbg.warn(`check_azure_connection: params`, _.omit(params, 'secret'), ` error: ${err}`);
        return {
            status: err.message,
            error: {
                code: err.err_code,
                message: err.err_message
            }
        };
    }
}

async function _check_azure_connection_internal(params) {

    const conn_str = cloud_utils.get_azure_new_connection_string({
        endpoint: params.endpoint,
        access_key: params.identity,
        secret_key: params.secret
    });

    function err_to_status(err, status) {
        return Object.assign(new Error(status), {
            err_code: err.code || 'Error',
            err_message: err.message || 'Unknown Error',
        });
    }

    /** @type {azure_storage.BlobServiceClient} */
    let blob;
    try {
        blob = azure_storage.BlobServiceClient.fromConnectionString(conn_str);
    } catch (err) {
        dbg.warn(`got error on BlobServiceClient.fromConnectionString with params`, _.omit(params, 'secret'), ` error: ${err}`);
        throw err_to_status(err, 'INVALID_CONNECTION_STRING');
    }

    try {
        const iterator = blob.listContainers().byPage({ maxPageSize: 100 });
        const response = (await iterator.next()).value;
        dbg.log1('_check_azure_connection_internal: got response: ', response);
    } catch (err) {
        dbg.warn(`got error on listContainers with params`, _.omit(params, 'secret'), ` error: ${err}`);
        if (err.code === 'AuthenticationFailed' &&
            err.authenticationerrordetail && err.authenticationerrordetail.indexOf('Request date header too old') > -1) {
            throw err_to_status(err, 'TIME_SKEW');
        } else if (err.code === 'ENOTFOUND') {
            throw err_to_status(err, 'UNKNOWN_FAILURE');
        } else {
            throw err_to_status(err, err.code === 'AuthenticationFailed' ? 'INVALID_CREDENTIALS' : 'INVALID_ENDPOINT');
        }
    }

    let service_properties;
    try {
        service_properties = await blob.getProperties();
    } catch (err) {
        dbg.warn(`got error on getServiceProperties with params`, _.omit(params, 'secret'), ` error: ${err}`);
        err.code = err.code || (err.details && err.details.errorCode);
        throw err_to_status(err, 'NOT_SUPPORTED');
    }

    if (!service_properties.blobAnalyticsLogging) {
        dbg.warn(`Error - connection for Premium account with params`, _.omit(params, 'secret'));
        throw err_to_status({}, 'NOT_SUPPORTED');
    }
    // Check the initialization of a LogsQueryClient if the appropriate credentials are given
    if (params.azure_log_access_keys) {
        try {
            const azure_token_credential = new ClientSecretCredential(
                params.azure_log_access_keys.azure_tenant_id.unwrap(),
                params.azure_log_access_keys.azure_client_id.unwrap(),
                params.azure_log_access_keys.azure_client_secret.unwrap()
            );
            const logs_query_client = new LogsQueryClient(azure_token_credential);
            await logs_query_client.queryWorkspace(
                params.azure_log_access_keys.azure_logs_analytics_workspace_id.unwrap(),
                "StorageBlobLogs",
                { duration: Durations.oneHour },
                {serverTimeoutInSeconds: 300}
                );
        } catch (err) {
            dbg.warn('got error on LogsQueryClient init with params', _.omit(
                params, ['secret', 'azure_log_access_keys.azure_client_secret']
            ), ` error: ${err}`);
            throw err_to_status(err, 'INVALID_CREDENTIALS');
        }
    }
    return { status: 'SUCCESS' };
}

const aws_error_mapping = Object.freeze({
    OperationTimeout: 'TIMEOUT',
    UnknownEndpoint: 'INVALID_ENDPOINT',
    NetworkingError: 'INVALID_ENDPOINT',
    XMLParserError: 'INVALID_ENDPOINT',
    InvalidAccessKeyId: 'INVALID_CREDENTIALS',
    SignatureDoesNotMatch: 'INVALID_CREDENTIALS',
    RequestTimeTooSkewed: 'TIME_SKEW'
});

const net_storage_error_mapping = Object.freeze({
    OperationTimeout: 'TIMEOUT',
    UnknownEndpoint: 'INVALID_ENDPOINT',
    NetworkingError: 'INVALID_ENDPOINT',
    XMLParserError: 'INVALID_ENDPOINT',
    InvalidAccessKeyId: 'INVALID_CREDENTIALS',
    SignatureDoesNotMatch: 'INVALID_CREDENTIALS',
    RequestTimeTooSkewed: 'TIME_SKEW'
});

async function check_google_connection(params) {
    try {
        const key_file = JSON.parse(params.secret.unwrap());
        const credentials = _.pick(key_file, 'client_email', 'private_key');
        const storage = new GoogleStorage({ credentials, projectId: key_file.project_id });
        await storage.getBuckets();
        return { status: 'SUCCESS' };
    } catch (err) {
        // Currently we treat all errors as invalid credentials errors,
        // because all information should exists in the keys file.
        return {
            status: 'INVALID_CREDENTIALS',
            error: {
                code: String(err.code),
                message: String(err.message)
            }
        };
    }
}

async function check_aws_sts_connection(params) {
    const creds = await cloud_utils.generate_aws_sdkv3_sts_creds(params, "check_aws_sts_sessions");
    params.identity = new SensitiveString(creds.accessKeyId);
    params.secret = new SensitiveString(creds.secretAccessKey);
    params.sessionToken = creds.sessionToken;
    return check_aws_connection(params);
}
async function check_aws_connection(params) {
    if (!params.endpoint.startsWith('http://') && !params.endpoint.startsWith('https://')) {
        params.endpoint = 'http://' + params.endpoint;
    }
    const s3_params = {
        endpoint: params.endpoint,
        credentials: {
            accessKeyId: params.identity.unwrap(),
            secretAccessKey: params.secret.unwrap(),
            sessionToken: params.sessionToken,
        },
        signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(params.endpoint, params.auth_method),
        requestHandler: noobaa_s3_client.get_requestHandler_with_suitable_agent(params.endpoint),
        region: params.region || config.DEFAULT_REGION
    };
    const s3 = noobaa_s3_client.get_s3_client_v3_params(s3_params);
    const timeoutError = Object.assign(
        new Error('Operation timeout'), { code: 'OperationTimeout' }
    );

    try {
        await P.timeout(check_connection_timeout, s3.listBuckets({}), () => timeoutError);
        return { status: 'SUCCESS' };
    } catch (err) {
        const error_code = err.Code || err.code;
        dbg.warn(`got error on listBuckets with params`, _.omit(params, 'secret'),
            ` error: ${err}, code: ${error_code}, message: ${err.message}`
        );
        const status = aws_error_mapping[error_code] || 'UNKNOWN_FAILURE';
        return {
            status,
            error: {
                code: error_code,
                message: err.message || 'Unknown Error'
            }
        };
    }
}

function check_net_storage_connection(params) {
    const ns = new NetStorage({
        hostname: params.endpoint,
        keyName: params.identity.unwrap(),
        key: params.secret.unwrap(),
        cpCode: params.cp_code,
        // Just used that in order to not handle certificate mess
        // TODO: Should I use SSL with HTTPS instead of HTTP?
        ssl: false
    });

    const timeoutError = Object.assign(
        new Error('Operation timeout'), { code: 'OperationTimeout' }
    );

    // TODO: Shall I use any other method istead of listing the root cpCode dir?
    return P.timeout(
            check_connection_timeout,
            P.fromCallback(callback => ns.dir(params.cp_code, callback)),
            () => timeoutError
        )
        .then(
            ret => ({ status: 'SUCCESS' }),
            err => {
                dbg.warn(`got error on dir with params`, _.omit(params, 'secret'), ` error: ${err}`, err.message);
                const status = net_storage_error_mapping[err.code] || 'UNKNOWN_FAILURE';
                return {
                    status,
                    error: {
                        code: err.code || '',
                        message: err.message
                    }
                };
            }
        );
}

function delete_external_connection(req) {
    const params = _.pick(req.rpc_params, 'connection_name');
    const account = req.account;

    const connection_to_delete = cloud_utils.find_cloud_connection(account, params.connection_name);

    if (_.find(system_store.data.pools, pool => (
            pool.cloud_pool_info &&
            pool.cloud_pool_info.endpoint_type === connection_to_delete.endpoint_type &&
            pool.cloud_pool_info.endpoint === connection_to_delete.endpoint &&
            pool.cloud_pool_info.access_keys.account_id._id === account._id &&
            pool.cloud_pool_info.access_keys.access_key.unwrap() === connection_to_delete.access_key.unwrap()
        ))) {
        throw new RpcError('IN_USE', 'Cannot delete connection as it is being used for a cloud pool');
    }

    return system_store.make_changes({
            update: {
                accounts: [{
                    _id: account._id,
                    $pull: { sync_credentials_cache: { name: params.connection_name } }
                }]
            }
        })
        .then(
            val => {
                Dispatcher.instance().activity({
                    event: 'account.connection_delete',
                    level: 'info',
                    system: req.system && req.system._id,
                    actor: req.account && req.account._id,
                    account: account._id,
                    desc: `Connection "${connection_to_delete.name}" was deleted by ${req.account && req.account.email.unwrap()}`,
                });
                return val;
            }
        );
}

// UTILS //////////////////////////////////////////////////////////

function get_account_info(account, include_connection_cache) {
    const info = _.pick(account,
        'name',
        'email',
        'is_external',
        'access_keys',
        'has_login',
        'allowed_ips',
    );
    info._id = account._id.toString();
    if (account.is_support) {
        info.is_support = true;
        info.has_login = true;
        //Support does not have access_keys nor do we want to really create a pair, return a mock in order to stay with the schema
        info.access_keys = [{
            access_key: 'Not Accesible',
            secret_key: 'Not Accesible'
        }];
    }
    if (account.owner) {
        info.owner = account.owner._id.toString();
    }
    info.iam_path = account.iam_path;
    if (account.next_password_change) {
        info.next_password_change = account.next_password_change.getTime();
    }

    info.has_s3_access = Boolean(account.default_resource);
    if (info.has_s3_access) {
        info.default_resource = account.default_resource.name;
        info.can_create_buckets = account.allow_bucket_creation;
        if (account.bucket_claim_owner) {
            info.bucket_claim_owner = account.bucket_claim_owner.name;
        }
    }

    info.nsfs_account_config = account.nsfs_account_config;
    info.systems = _.compact(_.map(account.roles_by_system, function(roles, system_id) {
        const system = system_store.data.get_by_id(system_id);
        if (!system) {
            return null;
        }
        return {
            name: system.name,
            roles: roles
        };
    }));

    const credentials_cache = account.sync_credentials_cache || [];
    const external_connections = {
        count: credentials_cache.length
    };

    if (!_.isUndefined(include_connection_cache) && include_connection_cache) {
        external_connections.connections = credentials_cache.map(credentials => (_.omitBy({
            name: credentials.name,
            endpoint: credentials.endpoint,
            identity: credentials.access_key,
            auth_method: credentials.auth_method,
            cp_code: credentials.cp_code || undefined,
            endpoint_type: credentials.endpoint_type,
            usage: _list_connection_usage(account, credentials)
        }, _.isUndefined)));
    } else {
        external_connections.connections = [];
    }
    info.external_connections = external_connections;
    info.preferences = {
        ...config.DEFAULT_ACCOUNT_PREFERENCES,
        ...account.preferences
    };
    info.role_config = account.role_config;
    info.force_md5_etag = account.force_md5_etag;

    if (account.iam_user_policies) {
        info.iam_user_policies = account.iam_user_policies;
    }
    if (account.owner) {
        info.owner = account.owner._id.toString();
    }

    return info;
}


/**
 *
 *
 *
 */
function ensure_support_account() {
    return system_store.refresh()
        .then(function() {
            const existing_support_account = _.find(system_store.data.accounts, function(account) {
                return Boolean(account.is_support);
            });
            if (existing_support_account) {
                return;
            }

            console.log('CREATING SUPPORT ACCOUNT...');
            const support_account = {
                _id: system_store.new_system_store_id(),
                name: new SensitiveString('Support'),
                email: new SensitiveString('support@noobaa.com'),
                has_login: false,
                is_support: true,
            };

            return system_store.make_changes({
                insert: {
                    accounts: [support_account]
                }
            }).then(() => console.log('SUPPORT ACCOUNT CREATED'));
        })
        .catch(function(err) {
            console.error('FAILED CREATE SUPPORT ACCOUNT', err);
        });
}

function is_support_or_admin_or_me(system, account, target_account) {
    return account.is_support ||
        (target_account && String(target_account._id) === String(account._id)) ||
        (
            system && account.roles_by_system[system._id].some(
                role => role === 'admin' || role === 'operator'
            )
        );
}

async function verify_authorized_account(req) {
    //operator connects by token and doesn't have the password property.
    if (req.role === 'operator') {
        return true;
    }
    return false;
}

function _list_connection_usage(account, credentials) {

    const cloud_pool_usage = _.map(
        _.filter(system_store.data.pools, pool => (
            pool.cloud_pool_info &&
            !pool.cloud_pool_info.pending_delete &&
            pool.cloud_pool_info.endpoint_type === credentials.endpoint_type &&
            pool.cloud_pool_info.endpoint === credentials.endpoint &&
            pool.cloud_pool_info.access_keys.account_id._id === account._id &&
            pool.cloud_pool_info.access_keys.access_key.unwrap() === credentials.access_key
        )), pool => ({
            usage_type: 'CLOUD_RESOURCE',
            entity: pool.name,
            external_entity: pool.cloud_pool_info.target_bucket
        }));
        const namespace_resource_usage = _.map(
        _.filter(system_store.data.namespace_resources, ns => (
            ns.connection &&
            ns.connection.endpoint_type === credentials.endpoint_type &&
            ns.connection.endpoint === credentials.endpoint &&
            ns.account._id === account._id &&
            ns.connection.access_key === credentials.access_key
        )), ns_rec => ({
            usage_type: 'NAMESPACE_RESOURCE',
            entity: ns_rec.name,
            external_entity: ns_rec.connection.target_bucket
        }));
    return _.concat(cloud_pool_usage, namespace_resource_usage);
}

function _verify_can_delete_account(req, account_to_delete) {
    if (!account_to_delete) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    if (account_to_delete.is_support) {
        throw new RpcError('BAD_REQUEST', 'Cannot delete support account');
    }
    if (String(account_to_delete._id) === String(req.system.owner._id)) {
        throw new RpcError('BAD_REQUEST', 'Cannot delete system owner account');
    }
    if (!is_support_or_admin_or_me(req.system, req.account, account_to_delete)) {
        throw new RpcError('UNAUTHORIZED', 'Cannot delete account');
    }
    for (const bucket of system_store.data.buckets) {
        if (system_store.has_same_id(bucket.owner_account, account_to_delete)) {
            dbg.log2('bucket', bucket.name.unwrap(), 'id is equal to the account id');
            throw new RpcError('FORBIDDEN', 'Cannot delete account that is owner of buckets');
        }
    }
}

/**
 *
 * IAM APIs methods 
 *
 */

async function create_user(req) {
    return await create_account(req);
}

async function get_user(req) {

    const action = IAM_ACTIONS.GET_USER;
    const requesting_account = req.account;
    const requested_account = account_util.validate_and_return_requested_account(req.rpc_params, action, requesting_account);
    const username = account_util.get_iam_username(req.rpc_params.username || requested_account.name.unwrap());
    const iam_arn = iam_utils.create_arn_for_user(requesting_account._id.toString(), username,
                                requested_account.iam_path || IAM_DEFAULT_PATH);
    return {
        user_id: requested_account._id.toString(),
        iam_path: requested_account.iam_path || IAM_DEFAULT_PATH,
        username: username,
        arn: iam_arn,
        // TODO: GAP Need to save created date
        create_date: Date.now(),
        // TODO: Dates missing : GAP
        password_last_used: Date.now(),
    };
}

async function update_user(req) {

    const action = IAM_ACTIONS.UPDATE_USER;
    const requesting_account = system_store.get_account_by_email(req.account.email);
    const old_username = account_util.get_account_name_from_username(req.rpc_params.username, requesting_account._id.toString());
    account_util._check_if_requesting_account_is_root_account(action, requesting_account,
            { username: req.rpc_params.username, iam_path: req.rpc_params.new_iam_path });
    account_util._check_if_account_exists(action, old_username);
    const requested_account = system_store.get_account_by_email(old_username);
    let iam_path = requested_account.iam_path;
    let user_name = account_util.get_iam_username(requested_account.name.unwrap());
    // Change to complete user name
    const new_username = account_util.get_account_name_from_username(req.rpc_params.new_username, requesting_account._id.toString());
    account_util._check_username_already_exists(action, new_username, req.rpc_params.new_username);
    account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
    account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
    if (req.rpc_params.new_iam_path) iam_path = req.rpc_params.new_iam_path;
    if (req.rpc_params.new_username) user_name = req.rpc_params.new_username;
    const iam_arn = iam_utils.create_arn_for_user(requesting_account._id.toString(), user_name, iam_path);
    const new_account_name = account_util.get_account_name_from_username(user_name, requesting_account._id.toString());
    const updates = {
        name: new_account_name,
        email: new_account_name,
        iam_path: iam_path,
    };
    await system_store.make_changes({
        update: {
            accounts: [{
                _id: requested_account._id,
                $set: _.omitBy(updates, _.isUndefined),
            }]
        }
    });

    return {
        iam_path: iam_path || IAM_DEFAULT_PATH,
        username: user_name,
        user_id: requested_account._id.toString(),
        arn: iam_arn
    };
}

async function delete_user(req) {

    const action = IAM_ACTIONS.DELETE_USER;
    const requesting_account = req.account;
    const username = account_util.get_account_name_from_username(req.rpc_params.username, requesting_account._id.toString());
    account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: req.rpc_params.username });
    account_util._check_if_account_exists(action, username);
    const requested_account = system_store.get_account_by_email(username);
    account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
    account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
    account_util._check_if_user_does_not_have_resources_before_deletion(action, requested_account);
    const delete_user_info = {
        system: system_store.data.systems[0],
        account: requested_account,
    };
    return account_util.delete_account(delete_user_info, requested_account);
}

async function list_users(req) {
    const action = IAM_ACTIONS.LIST_USERS;
    const requesting_account = req.account;
    account_util._check_if_requesting_account_is_root_account(action, requesting_account, { });
    const is_truncated = false; // GAP - no pagination at this point

    const requesting_account_iam_users = _.filter(system_store.data.accounts, function(account) {
        // Check IAM user owner is same as requesting_account id
        return account.owner?._id.toString() === requesting_account._id.toString();
    });
    let members = _.map(requesting_account_iam_users, function(iam_user) {
        const iam_username = account_util.get_iam_username(iam_user.name.unwrap());
        const iam_path = iam_user.iam_path || IAM_DEFAULT_PATH;
        let member;
        // Check the iam_path_prefix and add only those satify the iam_path if exists
        if (req.rpc_params.iam_path_prefix) {
            if (iam_path.toUpperCase() === req.rpc_params.iam_path_prefix.toUpperCase()) {
                member = account_util.return_list_member(iam_user, iam_path, iam_username);
            }
        } else {
            member = account_util.return_list_member(iam_user, iam_path, iam_username);
        }
        return member;
    }).filter(Boolean);
    members = members.sort((a, b) => a.username.localeCompare(b.username));
    return { members, is_truncated };
}

async function create_access_key(req) {
    const action = IAM_ACTIONS.CREATE_ACCESS_KEY;
    const requesting_account = req.account;
    const requested_account = account_util.validate_and_return_requested_account(req.rpc_params, action, requesting_account);
    account_util._check_number_of_access_key_array(action, requested_account);
    const account_req = {
        rpc_params: {
            email: requested_account.email,
            is_iam: true,
            owner: requesting_account._id.toString(),
        },
        account: requesting_account,
    };
    let iam_access_key;
    try {
        iam_access_key = await account_util.generate_account_keys(account_req);
    } catch (err) {
        dbg.error(`AccountSpaceNB.${action} error: `, err);
        const message_with_details = `Create accesskey failed for the user with name ${account_util.get_iam_username(requested_account.email.unwrap())}.`;
        throw new RpcError('INTERNAL_FAILURE', message_with_details, 500);
    }

    return {
        username: account_util.get_iam_username(requested_account.name.unwrap()),
        access_key: iam_access_key.access_key.unwrap(),
        create_date: iam_access_key.creation_date,
        status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
        secret_key: iam_access_key.secret_key.unwrap(),
    };
}

async function list_access_keys(req) {
    const action = IAM_ACTIONS.LIST_ACCESS_KEYS;
    const requesting_account = req.account;
    const requested_account = account_util.validate_and_return_requested_account(req.rpc_params, action, requesting_account);
    const is_truncated = false; // // GAP - no pagination at this point
    let members = account_util._list_access_keys_from_account(requesting_account, requested_account, false);
        members = members.sort((a, b) => a.access_key.localeCompare(b.access_key));
        return { members, is_truncated,
            username: account_util._returned_username(requesting_account, requested_account.name.unwrap(), false) };
}


async function update_access_key(req) {
    const action = IAM_ACTIONS.UPDATE_ACCESS_KEY;
    const access_key_id = req.rpc_params.access_key;
    const requesting_account = req.account;
    const requested_account = account_util.validate_and_return_requested_account(req.rpc_params, action, requesting_account);
    account_util._check_access_key_belongs_to_account(action, requested_account, access_key_id);

    const updating_access_key_obj = _.find(requested_account.access_keys,
        access_key => access_key.access_key.unwrap() === access_key_id);
    if (account_util._get_access_key_status(updating_access_key_obj.deactivated) === req.rpc_params.status) {
        dbg.log0(`AccountSpaceNB.${action} status was not change, not updating the database`);
        return;
    }
    const filtered_access_keys = account_util.get_non_updating_access_key(requested_account, access_key_id);
    updating_access_key_obj.deactivated = account_util._check_access_key_is_deactivated(req.rpc_params.status);
    updating_access_key_obj.secret_key = system_store.master_key_manager
        .encrypt_sensitive_string_with_master_key_id(updating_access_key_obj.secret_key, requested_account.master_key_id._id);
    filtered_access_keys.push(updating_access_key_obj);

    await system_store.make_changes({
        update: {
            accounts: [{
                _id: requested_account._id,
                $set: { access_keys: filtered_access_keys }
            }]
        }
    });
}

async function get_access_key_last_used(req) {
    const action = IAM_ACTIONS.GET_ACCESS_KEY_LAST_USED;
    const requesting_account = req.account;
    const dummy_region = 'us-west-2';
    const dummy_service_name = 's3';
    account_util._check_access_key_belongs_to_account(action, requesting_account, req.rpc_params.access_key);
    // TODO: Need to return valid last_used_date date, Low priority.
    const username = account_util._returned_username(requesting_account, requesting_account.name.unwrap(), false);
    return {
        region: dummy_region, // GAP
        last_used_date: Date.now(), // GAP
        service_name: dummy_service_name, // GAP
        username: username ? account_util.get_iam_username(username) : undefined,
    };
}

async function delete_access_key(req) {
    const action = IAM_ACTIONS.DELETE_ACCESS_KEY;
    const access_key_id = req.rpc_params.access_key;
    const requesting_account = req.account;

    const requested_account = account_util.validate_and_return_requested_account(req.rpc_params, action, requesting_account);
    account_util._check_access_key_belongs_to_account(action, requested_account, access_key_id);
    // Filter out the deleting access key from the access key list and save remaining accesskey.
    const filtered_access_keys = account_util.get_non_updating_access_key(requested_account, access_key_id);
    const updates = {
        access_keys: filtered_access_keys,
    };
    await system_store.make_changes({
        update: {
            accounts: [{
                _id: requested_account._id,
                $set: _.omitBy(updates, _.isUndefined),
            }]
        }
    });
}

async function tag_user(req) {
    const action = IAM_ACTIONS.TAG_USER;
    const requesting_account = req.account;
    const username = account_util.get_account_name_from_username(req.rpc_params.username, requesting_account._id.toString());

    account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: req.rpc_params.username });
    account_util._check_if_account_exists(action, username);

    const requested_account = system_store.get_account_by_email(username);
    account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
    account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);

    const existing_tags = requested_account.tagging || [];

    const tags_map = new Map();
    for (const tag of existing_tags) {
        tags_map.set(tag.key, tag.value);
    }
    for (const tag of req.rpc_params.tags) {
        tags_map.set(tag.key, tag.value);
    }

    // enforce AWS tag limit after merging
    if (tags_map.size > MAX_TAGS) {
        const message_with_details = `Failed to tag user. User cannot have more than ${MAX_TAGS} tags.`;
        throw new RpcError('LIMIT_EXCEEDED', message_with_details, 409);
    }

    const updated_tags = Array.from(tags_map.entries()).map(([key, value]) => ({ key, value }));

    await system_store.make_changes({
        update: {
            accounts: [{
                _id: requested_account._id,
                $set: { tagging: updated_tags }
            }]
        }
    });

    dbg.log1('AccountSpaceNB.tag_user: successfully tagged user', req.rpc_params.username, 'with', req.rpc_params.tags.length, 'tags');
}

async function untag_user(req) {
    const action = IAM_ACTIONS.UNTAG_USER;
    const requesting_account = req.account;
    const username = account_util.get_account_name_from_username(req.rpc_params.username, requesting_account._id.toString());

    account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: req.rpc_params.username });
    account_util._check_if_account_exists(action, username);

    const requested_account = system_store.get_account_by_email(username);
    account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
    account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);

    const existing_tags = requested_account.tagging || [];

    const tag_keys_set = new Set(req.rpc_params.tag_keys);
    const updated_tags = existing_tags.filter(tag => !tag_keys_set.has(tag.key));

    await system_store.make_changes({
        update: {
            accounts: [{
                _id: requested_account._id,
                $set: { tagging: updated_tags }
            }]
        }
    });

    dbg.log1('AccountSpaceNB.untag_user: successfully removed', req.rpc_params.tag_keys.length, 'tags from user', req.rpc_params.username);
}

async function list_user_tags(req) {
    const action = IAM_ACTIONS.LIST_USER_TAGS;
    const requesting_account = req.account;
    const username = account_util.get_account_name_from_username(req.rpc_params.username, requesting_account._id.toString());

    account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: req.rpc_params.username });
    account_util._check_if_account_exists(action, username);

    const requested_account = system_store.get_account_by_email(username);
    account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
    account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);

    // TODO: Pagination not supported - currently returns all tags, ignoring marker and max_items params
    const all_tags = requested_account.tagging || [];
    const sorted_tags = all_tags.sort((a, b) => a.key.localeCompare(b.key));

    const tags = sorted_tags.length > 0 ? sorted_tags.map(tag => ({
        member: {
            Key: tag.key,
            Value: tag.value
        }
    })) : [];
    dbg.log0('AccountSpaceNB.list_user_tags: returning', tags, 'tags for user', req.rpc_params.username);

    return {
        tags: tags,
        is_truncated: false
    };
}

async function put_user_policy(req) {
    const action = IAM_ACTIONS.PUT_USER_POLICY;
    const requesting_account = req.account;
    dbg.log1(`AccountSpaceNB.${action}`, req.rpc_params);
    const requested_account = account_util.validate_and_return_requested_account(req.rpc_params, action, requesting_account);
    const iam_user_policies = requested_account.iam_user_policies || [];
    const index_of_iam_user_policy = account_util._get_iam_user_policy_index(iam_user_policies, req.rpc_params.policy_name);
    const iam_user_policy_to_add = {
        policy_name: req.rpc_params.policy_name,
        policy_document: req.rpc_params.policy_document,
    };
    if (index_of_iam_user_policy === -1) {
        iam_user_policies.push(iam_user_policy_to_add);
    } else {
        iam_user_policies[index_of_iam_user_policy] = iam_user_policy_to_add;
    }

    account_util._check_total_policy_size(iam_user_policies, req.rpc_params.username);
    await system_store.make_changes({
        update: {
            accounts: [{
                _id: requested_account._id,
                $set: { iam_user_policies },
            }]
        }
    });
}

async function get_user_policy(req) {
    const action = IAM_ACTIONS.GET_USER_POLICY;
    dbg.log1(`AccountSpaceNB.${action}`, req.rpc_params);
    const requesting_account = req.account;
    const requested_account = account_util.validate_and_return_requested_account(req.rpc_params, action, requesting_account);
    const iam_user_policies = requested_account.iam_user_policies || [];
    const iam_user_policy_index = account_util._check_user_policy_exists(action, iam_user_policies, req.rpc_params.policy_name);
    return {
        username: req.rpc_params.username,
        policy_name: req.rpc_params.policy_name,
        policy_document: JSON.stringify(iam_user_policies[iam_user_policy_index].policy_document),
    };
}

async function delete_user_policy(req) {
    const action = IAM_ACTIONS.DELETE_USER_POLICY;
    dbg.log1(`AccountSpaceNB.${action}`, req.rpc_params);
    const requesting_account = req.account;
    const requested_account = account_util.validate_and_return_requested_account(req.rpc_params, action, requesting_account);
    const iam_user_policies = requested_account.iam_user_policies || [];
    const iam_user_policy_index = account_util._check_user_policy_exists(action, iam_user_policies, req.rpc_params.policy_name);
    iam_user_policies.splice(iam_user_policy_index, 1);

    await system_store.make_changes({
        update: {
            accounts: [{
                _id: requested_account._id,
                $set: { iam_user_policies },
            }]
        }
    });
}

async function list_user_policies(req) {
    const action = IAM_ACTIONS.LIST_USER_POLICIES;
    dbg.log1(`AccountSpaceNB.${action}`, req.rpc_params);
     const requesting_account = req.account;
    const requested_account = account_util.validate_and_return_requested_account(req.rpc_params, action, requesting_account);
    const is_truncated = false; // GAP - no pagination at this point
    let members = _.map(requested_account.iam_user_policies || [], iam_user_policy => iam_user_policy.policy_name);
    members = members.sort((a, b) => a.localeCompare(b));
    return {
        is_truncated,
        members
    };
}

// EXPORTS
exports.create_account = create_account;
exports.create_external_user_account = create_external_user_account;
exports.read_account = read_account;
exports.update_account = update_account;
exports.delete_account = delete_account;
exports.delete_account_by_property = delete_account_by_property;
exports.generate_account_keys = generate_account_keys;
exports.update_account_keys = update_account_keys;
exports.update_account_s3_access = update_account_s3_access;
exports.list_accounts = list_accounts;
exports.accounts_status = accounts_status;
exports.get_system_roles = get_system_roles;
exports.add_external_connection = add_external_connection;
exports.update_external_connection = update_external_connection;
exports.check_external_connection = check_external_connection;
exports.delete_external_connection = delete_external_connection;
exports.get_account_info = get_account_info;
// utility to create the support account from bg_workers
exports.ensure_support_account = ensure_support_account;
exports.verify_authorized_account = verify_authorized_account;
exports.get_account_usage = get_account_usage;
exports.read_account_by_access_key = read_account_by_access_key;
exports.create_user = create_user;
exports.get_user = get_user;
exports.update_user = update_user;
exports.delete_user = delete_user;
exports.list_users = list_users;
exports.create_access_key = create_access_key;
exports.update_access_key = update_access_key;
exports.delete_access_key = delete_access_key;
exports.tag_user = tag_user;
exports.untag_user = untag_user;
exports.list_user_tags = list_user_tags;
exports.list_access_keys = list_access_keys;
exports.put_user_policy = put_user_policy;
exports.get_user_policy = get_user_policy;
exports.delete_user_policy = delete_user_policy;
exports.list_user_policies = list_user_policies;
exports.get_access_key_last_used = get_access_key_last_used;
