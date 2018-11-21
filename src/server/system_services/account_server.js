/* Copyright (C) 2016 NooBaa */
/**
 *
 * ACCOUNT_SERVER
 *
 */
'use strict';
const P = require('../../util/promise');

const _ = require('lodash');
const net = require('net');
const url = require('url');
const AWS = require('aws-sdk');
const GoogleStorage = require('../../util/google_storage_wrap');
const bcrypt = require('bcrypt');
const { StorageError } = require('azure-storage/lib/common/errors/errors');

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const { RpcError } = require('../../rpc');
const Dispatcher = require('../notifications/dispatcher');
const http_utils = require('../../util/http_utils');
const cloud_utils = require('../../util/cloud_utils');
const auth_server = require('../common_services/auth_server');
const mongo_utils = require('../../util/mongo_utils');
const string_utils = require('../../util/string_utils');
const system_store = require('../system_services/system_store').get_instance();
const bucket_server = require('../system_services/bucket_server');
const azure_storage = require('../../util/azure_storage_wrap');
const NetStorage = require('../../util/NetStorageKit-Node-master/lib/netstorage');
const usage_aggregator = require('../bg_services/usage_aggregator');


const demo_access_keys = Object.freeze({
    access_key: '123',
    secret_key: 'abc'
});

const check_connection_timeout = 15 * 1000;

/**
 *
 * CREATE_ACCOUNT
 *
 */
function create_account(req) {
    var account = _.pick(req.rpc_params, 'name', 'email', 'has_login');
    validate_create_account_params(req);

    if (account.name === 'demo' && account.email === 'demo@noobaa.com') {
        account.access_keys = [demo_access_keys];
    } else {
        account.access_keys = [generate_access_keys()];
    }

    if (req.rpc_params.must_change_password) {
        account.next_password_change = new Date();
    }

    let sys_id = req.rpc_params.new_system_parameters ?
        mongo_utils.make_object_id(req.rpc_params.new_system_parameters.new_system_id) :
        req.system._id;

    if (req.rpc_params.new_system_parameters) {
        account._id = mongo_utils.make_object_id(req.rpc_params.new_system_parameters.account_id);
    } else {
        account._id = system_store.generate_id();
    }

    return P.resolve()
        .then(() => {
            if (req.rpc_params.has_login) {
                account.password = req.rpc_params.password;
                return bcrypt_password(account.password)
                    .then(password_hash => {
                        account.password = password_hash;
                    });
            }
        })
        .then(() => {
            if (req.rpc_params.s3_access) {
                if (req.rpc_params.allowed_buckets) {
                    const full_permission = Boolean(req.rpc_params.allowed_buckets.full_permission);
                    const permission_list = req.rpc_params.allowed_buckets.permission_list;
                    const allowed_buckets = {
                        full_permission: full_permission
                    };
                    if (!full_permission) {
                        if (!permission_list) {
                            throw new RpcError('Cannot configure without permission_list when explicit permissions');
                        }
                        allowed_buckets.permission_list = _.map(permission_list, bucket =>
                            req.system.buckets_by_name[bucket]._id);
                    }
                    account.allowed_buckets = allowed_buckets;
                }

                account.allow_bucket_creation = _.isUndefined(req.rpc_params.allow_bucket_creation) ?
                    true : req.rpc_params.allow_bucket_creation;

                if (req.rpc_params.new_system_parameters) {
                    const full_permission = Boolean(req.rpc_params.new_system_parameters.allowed_buckets.full_permission);
                    const permission_list = req.rpc_params.new_system_parameters.allowed_buckets.permission_list;
                    const allowed_buckets = {
                        full_permission: full_permission
                    };
                    if (!full_permission) {
                        if (!permission_list) {
                            throw new RpcError('Cannot configure without permission_list when explicit permissions');
                        }
                        allowed_buckets.permission_list = _.map(permission_list, bucket =>
                            mongo_utils.make_object_id(bucket));
                    }
                    account.allowed_buckets = allowed_buckets;
                    account.default_pool = mongo_utils.make_object_id(req.rpc_params.new_system_parameters.default_pool);
                } else {
                    if (req.system.pools_by_name === 0) {
                        throw new RpcError('No resources in the system - Can\'t create accounts');
                    }
                    const pools = _.filter(req.system.pools_by_name, p => (!_.get(p, 'mongo_pool_info'))); // find none-internal pools
                    if (pools.length) { // has resources which is not internal - must supply resource
                        throw new RpcError('Cannot configure without supplying default pool');
                    }
                    account.default_pool = req.rpc_params.default_pool ?
                        req.system.pools_by_name[req.rpc_params.default_pool]._id :
                        req.system.pools_by_name[0]._id; // only pool is internal
                }
            }

            Dispatcher.instance().activity({
                event: 'account.create',
                level: 'info',
                system: (req.system && req.system._id) || sys_id,
                actor: req.account && req.account._id,
                account: account._id,
                desc: `${account.email} was created ` + (req.account ? `by ${req.account.email}` : ``),
            });

            return system_store.make_changes({
                insert: {
                    accounts: [account],
                    roles: [{
                        _id: system_store.generate_id(),
                        account: account._id,
                        system: sys_id,
                        role: 'admin',
                    }]
                }
            });
        })
        .then(function() {
            var created_account = system_store.data.get_by_id(account._id);
            var auth = {
                account_id: created_account._id
            };
            if (req.rpc_params.new_system_parameters) {
                // since we created the first system for this account
                // we expect just one system, but use _.each to get it from the map
                var current_system = (req.system && req.system._id) || sys_id;
                _.each(created_account.roles_by_system, (roles, system_id) => {
                    //we cannot assume only one system.
                    if (current_system.toString() === system_id) {
                        auth.system_id = system_id;
                        auth.role = roles[0];
                    }
                });
            }
            return {
                token: auth_server.make_auth_token(auth),
            };
        });
}



/**
 *
 * READ_ACCOUNT
 *
 */
function read_account(req) {
    let email = req.rpc_params.email;

    let account = system_store.get_account_by_email(email);
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + email);
    }

    return get_account_info(account);
}


/**
 *
 * GENERATE_ACCOUNT_KEYS
 *
 */
function generate_account_keys(req) {
    let account = system_store.get_account_by_email(req.rpc_params.email);
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
    let updates = _.pick(account, '_id');

    return verify_authorized_account(req)
        .then(res => {
            if (!res) throw new RpcError('UNAUTHORIZED', 'Invalid verification password');
        })
        .then(() => {
            updates.access_keys = [generate_access_keys()];
            return system_store.make_changes({
                update: {
                    accounts: [updates]
                }
            });
        })
        .then(() => {
            Dispatcher.instance().activity({
                event: 'account.generate_credentials',
                level: 'info',
                system: req.system && req.system._id,
                actor: req.account && req.account._id,
                account: account._id,
                desc: `Credentials for ${account.email} were regenerated ${req.account && 'by ' + req.account.email}`,
            });
        })
        .return();
}


/**
 *
 * update_account_s3_access
 *
 */
function update_account_s3_access(req) {
    let account = _.cloneDeep(system_store.get_account_by_email(req.rpc_params.email));
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

    //If s3_access is on, update allowed buckets and default_pool
    if (req.rpc_params.s3_access) {
        if (!req.rpc_params.allowed_buckets ||
            !req.rpc_params.default_pool) {
            throw new RpcError('Enabling S3 requires providing allowed_buckets/default_pool');
        }

        const full_permission = Boolean(req.rpc_params.allowed_buckets.full_permission);
        const permission_list = req.rpc_params.allowed_buckets.permission_list;
        const allowed_buckets = {
            full_permission: full_permission
        };
        if (!full_permission) {
            if (!permission_list) {
                throw new RpcError('Cannot configure without permission_list when explicit permissions');
            }
            allowed_buckets.permission_list = _.map(permission_list, bucket =>
                system.buckets_by_name[bucket]._id);
        }
        update.allowed_buckets = allowed_buckets;
        update.default_pool = system.pools_by_name[req.rpc_params.default_pool]._id;
        if (!_.isUndefined(req.rpc_params.allow_bucket_creation)) {
            update.allow_bucket_creation = req.rpc_params.allow_bucket_creation;
        }
    } else {
        update.$unset = {
            allowed_buckets: true,
            default_pool: true,
            allow_bucket_creation: true
        };
    }

    return system_store.make_changes({
            update: {
                accounts: [update]
            }
        })
        .then(() => {
            const origin_allowed_buckets = ((account.allowed_buckets &&
                    account.allowed_buckets.permission_list) || [])
                .map(bucket => bucket.name);
            const pool = system.pools_by_name[req.rpc_params.default_pool];
            const original_pool = pool && pool.name;
            let desc_string = [];
            let added_buckets = [];
            let removed_buckets = [];
            desc_string.push(`${account.email} S3 access was updated by ${req.account && req.account.email}`);
            if (req.rpc_params.s3_access) {
                if (original_pool !== req.rpc_params.default_pool) {
                    desc_string.push(`default pool changed to`, req.rpc_params.default_pool ? req.rpc_params.default_pool : `None`);
                }
                if (req.rpc_params.allowed_buckets) {
                    if (req.rpc_params.allowed_buckets.full_permission) {
                        desc_string.push(`permissions were changed to full`);
                    } else {
                        const new_allowed_buckets = (req.rpc_params.allowed_buckets &&
                            req.rpc_params.allowed_buckets.permission_list) || [];
                        added_buckets = _.difference(new_allowed_buckets, origin_allowed_buckets);
                        removed_buckets = _.difference(origin_allowed_buckets, new_allowed_buckets);
                    }
                } else {
                    // Should be dead code since we should not get s3_access without allowed_buckets structure
                    desc_string.push(`permissions were changed to none`);
                    removed_buckets = _.difference(origin_allowed_buckets, []);
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
            if (removed_buckets.length) {
                _.forEach(removed_buckets, bucket_name => {
                    const bucket = req.system.buckets_by_name[bucket_name];
                    bucket_server.check_for_lambda_permission_issue(req, bucket, [account]);
                });
            }
        })
        .return();
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

    let updates = {
        name: params.name,
        email: params.new_email,
        next_password_change: params.must_change_password === true ? new Date() : undefined,
        allowed_ips: (!_.isUndefined(params.ips) && params.ips !== null) ? params.ips : undefined
    };

    let removals = {
        next_password_change: params.must_change_password === false ? true : undefined,
        allowed_ips: params.ips === null ? true : undefined
    };

    //Create the event description according to the changes performed
    let event_desc = '';
    if (params.new_email && params.new_email !== params.email) {
        event_desc += `Email address changed from ${params.email} to ${params.new_email}. `;
    }
    if (account.allowed_ips !== params.ips) {
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
            desc: `${account.email} was updated by ${req.account && req.account.email}` +
                (event_desc ? '. ' + event_desc : ''),
        }))
        .return();
}

/**
 *
 * RESET PASSWORD
 *
 */
function reset_password(req) {
    let account = system_store.data.accounts_by_email[req.rpc_params.email];
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    if (!is_support_or_admin_or_me(req.system, req.account, account)) {
        throw new RpcError('UNAUTHORIZED', 'Cannot change password');
    }
    if (account.is_support) {
        throw new RpcError('FORBIDDEN', 'Cannot change support password');
    }
    if (!account.has_login) {
        throw new RpcError('FORBIDDEN', 'Cannot change non management password');
    }

    const params = req.rpc_params;
    return verify_authorized_account(req)
        .then(res => {
            if (!res) throw new RpcError('UNAUTHORIZED', 'Invalid verification password');
        })
        .then(() => bcrypt_password(params.password))
        .then(password => {
            const changes = {
                password: password,
                next_password_change: params.must_change_password === true ? new Date() : undefined
            };
            const removals = {
                next_password_change: params.must_change_password === false ? true : undefined
            };

            return system_store.make_changes({
                update: {
                    accounts: [{
                        _id: account._id,
                        $set: _.omitBy(changes, _.isUndefined),
                        $unset: _.omitBy(removals, _.isUndefined)
                    }]
                }
            });
        })
        .then(() => Dispatcher.instance().activity({
            event: 'account.update',
            level: 'info',
            system: req.system && req.system._id,
            actor: req.account && req.account._id,
            account: account._id,
            desc: `${account.email} was updated by ${req.account.email}: reset password`,
        }))
        .return();

}


async function get_account_usage(req) {
    const { since, till, accounts } = req.rpc_params;
    return usage_aggregator.get_accounts_report({
        accounts: accounts.map(acc => _.get(system_store.data.accounts_by_email[acc], '_id')),
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
    let account_to_delete = system_store.get_account_by_email(req.rpc_params.email);
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

    let roles_to_delete = system_store.data.roles
        .filter(
            role => String(role.account._id) === String(account_to_delete._id)
        )
        .map(
            role => role._id
        );

    return system_store.make_changes({
            remove: {
                accounts: [account_to_delete._id],
                roles: roles_to_delete
            }
        })
        .then(
            val => {
                Dispatcher.instance().activity({
                    event: 'account.delete',
                    level: 'info',
                    system: req.system && req.system._id,
                    actor: req.account && req.account._id,
                    account: account_to_delete._id,
                    desc: `${account_to_delete.email} was deleted by ${req.account && req.account.email}`,
                });
                return val;
            },
            err => {
                Dispatcher.instance().activity({
                    event: 'account.delete',
                    level: 'alert',
                    system: req.system && req.system._id,
                    actor: req.account && req.account._id,
                    account: account_to_delete._id,
                    desc: `Error: ${account_to_delete.email} failed to delete by ${req.account && req.account.email}`,
                });
                throw err;
            }
        )
        .return();
}

/**
 *
 * LIST_ACCOUNTS
 *
 */
function list_accounts(req) {
    let accounts;
    if (req.account.is_support) {
        // for support account - list all accounts
        accounts = system_store.data.accounts;
    } else if (req.account) {
        // list system accounts - system admin can see all the system accounts
        if (!_.includes(req.account.roles_by_system[req.system._id], 'admin')) {
            throw new RpcError('UNAUTHORIZED', 'Must be system admin');
        }

        let account_ids = _.map(req.system.roles_by_account, (roles, account_id) =>
            (roles && roles.length ? account_id : null)
        );

        accounts = _.compact(
            _.map(
                account_ids,
                account_id => system_store.data.get_by_id(account_id)
            )
        );
    }

    return {
        accounts: _.map(
            accounts,
            account => get_account_info(account, req.account === account)
        )
    };
}


/**
 *
 * ACCOUNTS_STATUS
 *
 */
function accounts_status(req) {
    var any_non_support_account = _.find(system_store.data.accounts, function(account) {
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
    const res = await check_external_connection(req);
    if (res.status !== 'SUCCESS') {
        throw new RpcError(res.error.code, res.error.message);
    }

    var info = _.pick(req.rpc_params, 'name', 'endpoint', 'endpoint_type');
    if (!info.endpoint_type) info.endpoint_type = 'AWS';
    info.access_key = req.rpc_params.identity;
    info.secret_key = req.rpc_params.secret;
    info.cp_code = req.rpc_params.cp_code || undefined;
    info.auth_method = req.rpc_params.auth_method || config.DEFAULT_S3_AUTH_METHOD[info.endpoint_type] || undefined;
    info = _.omitBy(info, _.isUndefined);
    if ((info.endpoint_type === 'AWS' || info.endpoint_type === 'S3_COMPATIBLE') &&
        (!info.endpoint.startsWith('http://') && !info.endpoint.startsWith('https://'))) {
        info.endpoint = 'http://' + info.endpoint;
    }

    // TODO: Maybe we should check differently regarding NET_STORAGE connections
    //Verify the exact connection does not exist
    const conn = _.find(req.account.sync_credentials_cache, function(cred) {
        return cred.endpoint === info.endpoint &&
            cred.endpoint_type === info.endpoint_type &&
            cred.access_key === info.access_key;
    });
    if (conn) {
        throw new RpcError('External Connection Already Exists');
    }

    var updates = {
        _id: req.account._id,
        sync_credentials_cache: req.account.sync_credentials_cache || []
    };
    updates.sync_credentials_cache.push(info);

    await system_store.make_changes({
        update: {
            accounts: [updates]
        }
    });

    Dispatcher.instance().activity({
        event: 'account.connection_create',
        level: 'info',
        system: req.system && req.system._id,
        actor: req.account && req.account._id,
        account: req.account._id,
        desc: `Connection "${info.name}" was created by ${req.account && req.account.email}.
            \nEndpoint: ${req.rpc_params.endpoint}
            \nAccess key: ${req.rpc_params.identity}`,
    });
}

function check_external_connection(req) {
    dbg.log0('check_external_connection:', req.rpc_params);
    const { endpoint_type } = req.rpc_params;
    const params = req.rpc_params;
    const system = req.system;
    const proxy = system.phone_home_proxy_address;
    params.proxy = proxy;
    const account = req.account;

    const connection = req.rpc_params.name && _.find(account.sync_credentials_cache, sync_conn =>
        sync_conn.name === req.rpc_params.name);
    if (connection) {
        throw new RpcError('CONNECTION_ALREADY_EXIST', 'Connection name already exists: ' + req.rpc_params.name);
    }

    return P.resolve()
        .then(() => {
            switch (endpoint_type) {
                case 'AZURE':
                    {
                        return check_azure_connection(params);
                    }

                case 'AWS':
                case 'S3_COMPATIBLE':
                case 'FLASHBLADE':
                    {
                        return check_aws_connection(params);
                    }

                case 'NET_STORAGE':
                    {
                        return check_net_storage_connection(params);
                    }
                case 'GOOGLE':
                    {
                        return check_google_connection(params);
                    }

                default:
                    {
                        throw new Error('Unknown endpoint type');
                    }
            }
        });
}

function check_azure_connection(params) {
    const conn_str = cloud_utils.get_azure_connection_string({
        endpoint: params.endpoint,
        access_key: params.identity,
        secret_key: params.secret
    });

    function err_to_status(err, status) {
        const ret_error = new Error(status);
        ret_error.err_code = err.code || 'Error';
        ret_error.err_message = err.message || 'Unknown Error';
        return ret_error;
    }

    return P.resolve()
        .then(() => P.resolve()
            .then(() => {
                let blob = azure_storage.createBlobService(conn_str);
                blob.setProxy(params.proxy ? url.parse(params.proxy) : null);
                return blob;
            })
            .catch(err => {
                dbg.warn(`got error on createBlobService with params`, _.omit(params, 'secret'), ` error: ${err}`);
                throw err_to_status(err, err instanceof SyntaxError ? 'INVALID_CREDENTIALS' : 'UNKNOWN_FAILURE');
            })
        )
        .then(blob_svc => P.fromCallback(callback => blob_svc.listContainersSegmented(null, callback))
            .then(() => blob_svc)
            .catch(err => {
                dbg.warn(`got error on listContainersSegmented with params`, _.omit(params, 'secret'), ` error: ${err}`);
                if (err.code === 'AuthenticationFailed' &&
                    err.authenticationerrordetail && err.authenticationerrordetail.indexOf('Request date header too old') > -1) {
                    throw err_to_status(err, 'TIME_SKEW');
                }
                throw err_to_status(err, err instanceof StorageError ? 'INVALID_CREDENTIALS' : 'INVALID_ENDPOINT');
            })
        )
        .then(blob_svc => P.fromCallback(callback => blob_svc.getServiceProperties(callback))
            .catch(err => {
                dbg.warn(`got error on getServiceProperties with params`, _.omit(params, 'secret'), ` error: ${err}`);
                throw err_to_status(err, 'NOT_SUPPORTED');
            })
        )
        .timeout(check_connection_timeout, new Error('TIMEOUT'))
        .then(service => {
            if (!service.Logging) {
                dbg.warn(`Error - connection for Premium account with params`, _.omit(params, 'secret'));
                throw err_to_status({}, 'NOT_SUPPORTED');
            }
        })
        .then(
            () => ({ status: 'SUCCESS' }),
            err => ({
                status: err.message,
                error: {
                    code: err.err_code,
                    message: err.err_message
                }
            })
        );
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
        const key_file = JSON.parse(params.secret);
        const credentials = _.pick(key_file, 'client_email', 'private_key');
        const storage = new GoogleStorage({ credentials, projectId: key_file.project_id });
        await storage.getBuckets();
        return { status: 'SUCCESS' };
    } catch (err) {
        // Currently we treat all errors as invalid credientials errors,
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



function check_aws_connection(params) {
    if (!params.endpoint.startsWith('http://') && !params.endpoint.startsWith('https://')) {
        params.endpoint = 'http://' + params.endpoint;
    }
    const s3 = new AWS.S3({
        endpoint: params.endpoint,
        accessKeyId: params.identity,
        secretAccessKey: params.secret,
        signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(params.endpoint, params.auth_method),
        s3DisableBodySigning: cloud_utils.disable_s3_compatible_bodysigning(params.endpoint),
        httpOptions: {
            agent: http_utils.get_unsecured_http_agent(params.endpoint, params.proxy)
        }
    });

    const timeoutError = Object.assign(
        new Error('Operation timeout'), { code: 'OperationTimeout' }
    );

    return P.fromCallback(callback => s3.listBuckets(callback))
        .timeout(check_connection_timeout, timeoutError)
        .then(
            ret => ({ status: 'SUCCESS' }),
            err => {
                dbg.warn(`got error on listBuckets with params`, _.omit(params, 'secret'), ` error: ${err}, code: ${err.code}, message: ${err.message}`);
                const status = aws_error_mapping[err.code] || 'UNKNOWN_FAILURE';
                return {
                    status,
                    error: {
                        code: err.code,
                        message: err.message || 'Unkown Error'
                    }
                };
            }
        );
}

function check_net_storage_connection(params) {
    const ns = new NetStorage({
        hostname: params.endpoint,
        keyName: params.identity,
        key: params.secret,
        cpCode: params.cp_code,
        // Just used that in order to not handle certificate mess
        // TODO: Should I use SSL with HTTPS instead of HTTP?
        ssl: false
    });

    const timeoutError = Object.assign(
        new Error('Operation timeout'), { code: 'OperationTimeout' }
    );

    // TODO: Shall I use any other method istead of listing the root cpCode dir?
    return P.fromCallback(callback => ns.dir(params.cp_code, callback))
        .timeout(check_connection_timeout, timeoutError)
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
    var params = _.pick(req.rpc_params, 'connection_name');
    let account = req.account;

    let connection_to_delete = cloud_utils.find_cloud_connection(account, params.connection_name);

    if (_.find(system_store.data.pools, pool => (
            pool.cloud_pool_info &&
            pool.cloud_pool_info.endpoint === connection_to_delete.endpoint &&
            pool.cloud_pool_info.account_id === account._id &&
            pool.cloud_pool_info.access_key === connection_to_delete.access_key
        ))) {
        throw new Error('Cannot delete connection as it is being used for a cloud pool');
    }

    return system_store.make_changes({
            update: {
                accounts: [{
                    _id: account._id,
                    sync_credentials_cache: _.filter(account.sync_credentials_cache,
                        connection => (connection.name !== params.connection_name))
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
                    desc: `Connection "${connection_to_delete.name}" was deleted by ${req.account && req.account.email}`,
                });
                return val;
            }
        )
        .return();
}

// UTILS //////////////////////////////////////////////////////////

function get_account_info(account, include_connection_cache) {
    var info = _.pick(account, 'name', 'email', 'access_keys');

    info.has_login = account.has_login;
    info.allowed_ips = account.allowed_ips;

    if (account.is_support) {
        info.is_support = true;
        info.has_login = true;
        //Support does not have access_keys nor do we want to really create a pair, return a mock in order to stay with the schema
        info.access_keys = [{
            access_key: 'Not Accesible',
            secret_key: 'Not Accesible'
        }];
    }

    if (account.next_password_change) {
        info.next_password_change = account.next_password_change.getTime();
    }

    info.has_s3_access = Boolean(account.allowed_buckets);
    if (info.has_s3_access) {
        const full_permission = Boolean(account.allowed_buckets.full_permission);
        const permission_list = account.allowed_buckets.permission_list;
        const allowed_buckets = {
            full_permission: full_permission
        };
        if (!full_permission) {
            if (!permission_list) {
                throw new RpcError('Cannot configure without permission_list when explicit permissions');
            }
            allowed_buckets.permission_list = _.map(permission_list, bucket => bucket.name);
        }
        info.allowed_buckets = allowed_buckets;
        info.default_pool = account.default_pool.name;
        info.can_create_buckets = account.allow_bucket_creation;
    }

    info.systems = _.compact(_.map(account.roles_by_system, function(roles, system_id) {
        var system = system_store.data.get_by_id(system_id);
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
            var existing_support_account = _.find(system_store.data.accounts, function(account) {
                return Boolean(account.is_support);
            });
            if (existing_support_account) {
                return;
            }

            console.log('CREATING SUPPORT ACCOUNT...');
            return bcrypt_password(system_store.get_server_secret())
                .then(password => {
                    let support_account = {
                        _id: system_store.generate_id(),
                        name: 'Support',
                        email: 'support@noobaa.com',
                        password: password,
                        has_login: true,
                        is_support: true,
                    };

                    return system_store.make_changes({
                        insert: {
                            accounts: [support_account]
                        }
                    });
                })
                .then(() => console.log('SUPPORT ACCOUNT CREATED'));
        })
        .catch(function(err) {
            console.error('FAILED CREATE SUPPORT ACCOUNT', err);
        });
}

function bcrypt_password(password) {
    return P.resolve()
        .then(() => password && bcrypt.hash(password, 10));
}

function is_support_or_admin_or_me(system, account, target_account) {
    return account.is_support ||
        (target_account && String(target_account._id) === String(account._id)) ||
        (
            system && account.roles_by_system[system._id].some(
                role => role === 'admin'
            )
        );
}

function validate_create_account_params(req) {
    if (req.rpc_params.name !== req.rpc_params.name.trim()) {
        throw new RpcError('BAD_REQUEST', 'system name must not contain leading or trailing spaces');
    }

    if (system_store.get_account_by_email(req.rpc_params.email)) {
        throw new RpcError('BAD_REQUEST', 'email address already registered');
    }

    if (req.rpc_params.s3_access) {
        if (!req.rpc_params.new_system_parameters &&
            (!req.rpc_params.allowed_buckets || !req.rpc_params.default_pool)) {
            throw new RpcError('BAD_REQUEST', 'Enabling S3 requires providing allowed_buckets/default_pool');
        }

        if (req.rpc_params.new_system_parameters &&
            (!req.rpc_params.new_system_parameters.allowed_buckets || !req.rpc_params.new_system_parameters.default_pool)) {
            throw new RpcError('BAD_REQUEST',
                'Creating new system with enabled S3 access for owner requires providing allowed_buckets/default_pool');
        }
    }

    if (req.rpc_params.has_login) {
        if (!req.rpc_params.password) {
            throw new RpcError('BAD_REQUEST', 'Password is missing');
        }
    } else if (req.rpc_params.password) {
        throw new RpcError('BAD_REQUEST', 'Password should not be sent');
    }
}

function generate_access_keys() {
    return {
        access_key: string_utils.crypto_random_string(20, string_utils.ALPHA_NUMERIC_CHARSET),
        secret_key: string_utils.crypto_random_string(40, string_utils.ALPHA_NUMERIC_CHARSET + '+/'),
    };
}

function verify_authorized_account(req) {
    return P.resolve()
        .then(() => bcrypt.compare(req.rpc_params.verification_password, req.account.password))
        .then(match => {
            if (!match) return false;
            return true;
        });
}

function _list_connection_usage(account, credentials) {
    let cloud_pool_usage = _.map(
        _.filter(system_store.data.pools, pool => (
            pool.cloud_pool_info &&
            !pool.cloud_pool_info.pending_delete &&
            pool.cloud_pool_info.endpoint_type === credentials.endpoint_type &&
            pool.cloud_pool_info.endpoint === credentials.endpoint &&
            pool.cloud_pool_info.access_keys.account_id._id === account._id &&
            pool.cloud_pool_info.access_keys.access_key === credentials.access_key
        )), pool => ({
            usage_type: 'CLOUD_RESOURCE',
            entity: pool.name,
            external_entity: pool.cloud_pool_info.target_bucket
        }));
    let namespace_resource_usage = _.map(
        _.filter(system_store.data.namespace_resources, ns => (
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


// EXPORTS
exports.create_account = create_account;
exports.read_account = read_account;
exports.update_account = update_account;
exports.reset_password = reset_password;
exports.delete_account = delete_account;
exports.generate_account_keys = generate_account_keys;
exports.update_account_s3_access = update_account_s3_access;
exports.list_accounts = list_accounts;
exports.accounts_status = accounts_status;
exports.get_system_roles = get_system_roles;
exports.add_external_connection = add_external_connection;
exports.check_external_connection = check_external_connection;
exports.delete_external_connection = delete_external_connection;
exports.get_account_info = get_account_info;
// utility to create the support account from bg_workers
exports.ensure_support_account = ensure_support_account;
exports.verify_authorized_account = verify_authorized_account;
exports.get_account_usage = get_account_usage;
