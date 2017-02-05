/* Copyright (C) 2016 NooBaa */
/**
 *
 * ACCOUNT_SERVER
 *
 */
'use strict';
const P = require('../../util/promise');

const _ = require('lodash');
const AWS = require('aws-sdk');
const https = require('https');
const crypto = require('crypto');
const bcrypt = P.promisifyAll(require('bcrypt'));
const random_string = require('../../util/string_utils').random_string;

// const dbg = require('../../util/debug_module')(__filename);
const RpcError = require('../../rpc/rpc_error');
const auth_server = require('../common_services/auth_server');
const Dispatcher = require('../notifications/dispatcher');
const mongo_utils = require('../../util/mongo_utils');
const system_store = require('../system_services/system_store').get_instance();
const cloud_utils = require('../../util/cloud_utils');
const azure = require('azure-storage');

const demo_access_keys = Object.freeze({
    access_key: '123',
    secret_key: 'abc'
});

/**
 *
 * CREATE_ACCOUNT
 *
 */
function create_account(req) {
    var account = _.pick(req.rpc_params, 'name', 'email', 'password');
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
    return bcrypt_password(account.password)
        .then(password_hash => {
            account.password = password_hash;

            if (req.rpc_params.allowed_buckets) {
                account.allowed_buckets = _.map(req.rpc_params.allowed_buckets,
                    bucket => req.system.buckets_by_name[bucket]._id);
            }
            if (req.rpc_params.new_system_parameters) {
                account.allowed_buckets = _.map(req.rpc_params.new_system_parameters.allowed_buckets,
                    bucket => mongo_utils.make_object_id(bucket));
            }
            return {
                insert: {
                    accounts: [account],
                    roles: [{
                        _id: system_store.generate_id(),
                        account: account._id,
                        system: sys_id,
                        role: 'admin',
                    }]
                }
            };
        })
        .then(changes => {
            Dispatcher.instance().activity({
                event: 'account.create',
                level: 'info',
                system: req.system && req.system._id || sys_id,
                actor: req.account && req.account._id,
                account: account._id,
                desc: `${account.email} was created ${req.account && 'by ' + req.account.email}`,
            });
            return system_store.make_changes(changes);
        })
        .then(function() {
            var created_account = system_store.data.get_by_id(account._id);
            var auth = {
                account_id: created_account._id
            };
            if (req.rpc_params.new_system_parameters) {
                // since we created the first system for this account
                // we expect just one system, but use _.each to get it from the map
                var current_system = req.system && req.system._id || sys_id;
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
                desc: `Credentials for ${account.email} were regenarated ${req.account && 'by ' + req.account.email}`,
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
    if (req.rpc_params.allowed_buckets) {
        update.allowed_buckets = req.rpc_params.allowed_buckets.map(
            bucket_name => system.buckets_by_name[bucket_name]._id
        );
    } else {
        update.$unset = {
            allowed_buckets: true
        };
    }

    return system_store.make_changes({
            update: {
                accounts: [update]
            }
        })
        .then(() => {
            let new_allowed_buckets = req.rpc_params.allowed_buckets;
            let origin_allowed_buckets = account.allowed_buckets && account.allowed_buckets.map(bucket => bucket.name);
            let desc_string = [];
            let added_buckets = [];
            let removed_buckets = [];
            desc_string.push(`${account.email} S3 access was updated by ${req.account && req.account.email}`);
            if (new_allowed_buckets) {
                added_buckets = _.difference(new_allowed_buckets, origin_allowed_buckets);
                removed_buckets = _.difference(origin_allowed_buckets, new_allowed_buckets);
                // Here we need a new toggle or something instead of just null
                // In order to know that we activated and know the removed_buckets and not only added
                // Because how it works right now is that we will only know what we added and not removed
                // Since the array will be always null
                if (!origin_allowed_buckets) {
                    desc_string.push(`S3 permissions was changed to enabled`);
                }
            } else {
                desc_string.push(`S3 permissions was changed to disabled`);
            }
            if (added_buckets.length) {
                desc_string.push(`Added buckets: ${added_buckets}`);
            }
            if (removed_buckets.length) {
                desc_string.push(`Removed buckets: ${removed_buckets}`);
            }
            return Dispatcher.instance().activity({
                event: 'account.s3_access_updated',
                level: 'info',
                system: req.system && req.system._id,
                actor: req.account && req.account._id,
                account: account._id,
                desc: desc_string.join('\n'),
            });
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

    let updates = {
        name: params.name,
        email: params.new_email,
        next_password_change: params.must_change_password === true ? new Date() : undefined
    };

    let removals = {
        next_password_change: params.must_change_password === false ? true : undefined
    };

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
            desc: `${account.email} was updated by ${req.account && req.account.email}`,
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

    const params = req.rpc_params;
    return verify_authorized_account(req)
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
        let account_ids = _.map(req.system.roles_by_account, (roles, account_id) => {
            return roles && roles.length ? account_id : null;
        });

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

function add_external_connection(req) {
    var info = _.pick(req.rpc_params, 'name', 'endpoint', 'endpoint_type');
    if (!info.endpoint_type) info.endpoint_type = 'AWS';
    info.access_key = req.rpc_params.identity;
    info.secret_key = req.rpc_params.secret;
    var updates = {
        _id: req.account._id,
        sync_credentials_cache: req.account.sync_credentials_cache || []
    };
    updates.sync_credentials_cache.push(info);
    return system_store.make_changes({
            update: {
                accounts: [updates]
            }
        }).then(
            val => {
                Dispatcher.instance().activity({
                    event: 'account.connection.add',
                    level: 'info',
                    system: req.system && req.system._id,
                    actor: req.account && req.account._id,
                    account: req.account._id,
                    desc: `${info.name} was added by ${req.account && req.account.email}`,
                });
                return val;
            },
            err => {
                Dispatcher.instance().activity({
                    event: 'account.connection.add',
                    level: 'alert',
                    system: req.system && req.system._id,
                    actor: req.account && req.account._id,
                    account: req.account._id,
                    desc: `Error: ${info.name} failed to add by ${req.account && req.account.email}`,
                });
                throw err;
            }
        )
        .return();
}

function check_external_connection(req) {
    var params = _.pick(req.rpc_params, 'endpoint', 'identity', 'secret', 'endpoint_type');

    return P.fcall(function() {
        if (params.endpoint_type === 'AZURE') {
            let conn_str = cloud_utils.get_azure_connection_string({
                endpoint: params.endpoint,
                access_key: params.identity,
                secret_key: params.secret
            });
            let blob_svc = azure.createBlobService(conn_str);
            return P.ninvoke(blob_svc, 'listContainersSegmented', null, {});
        } else {
            var s3 = new AWS.S3({
                endpoint: params.endpoint,
                accessKeyId: params.identity,
                secretAccessKey: params.secret,
                httpOptions: {
                    agent: new https.Agent({
                        rejectUnauthorized: false,
                    })
                }
            });

            return P.ninvoke(s3, "listBuckets");
        }
    }).then(
        () => true,
        () => false
    );
}

function delete_external_connection(req) {
    var params = _.pick(req.rpc_params, 'connection_name');
    let account = req.account;
    let connection_to_delete = cloud_utils.find_cloud_connection(account, params.connection_name);

    if (_.find(system_store.data.buckets, bucket => (
            bucket.cloud_sync &&
            bucket.cloud_sync.endpoint === connection_to_delete.endpoint &&
            bucket.cloud_sync.access_keys.account_id === account._id &&
            bucket.cloud_sync.access_keys.access_key === connection_to_delete.access_key))) {
        throw new Error('Cannot delete connection from account as it is being used for a cloud sync');
    }
    if (_.find(system_store.data.pools, pool => (
            pool.cloud_pool_info &&
            pool.cloud_pool_info.endpoint === connection_to_delete.endpoint &&
            pool.cloud_pool_info.account_id === account._id &&
            pool.cloud_pool_info.access_key === connection_to_delete.access_key
        ))) {
        throw new Error('Cannot delete account as it is being used for a cloud sync');
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
                    event: 'account.connection.delete',
                    level: 'info',
                    system: req.system && req.system._id,
                    actor: req.account && req.account._id,
                    account: account._id,
                    desc: `${connection_to_delete.name} was deleted by ${req.account && req.account.email}`,
                });
                return val;
            },
            err => {
                Dispatcher.instance().activity({
                    event: 'account.connection.delete',
                    level: 'alert',
                    system: req.system && req.system._id,
                    actor: req.account && req.account._id,
                    account: account._id,
                    desc: `Error: ${connection_to_delete.name} failed to delete by ${req.account && req.account.email}`,
                });
                throw err;
            }
        )
        .return();
}

// UTILS //////////////////////////////////////////////////////////

function get_account_info(account, include_connection_cache) {
    var info = _.pick(account, 'name', 'email', 'access_keys');
    if (account.is_support) {
        info.is_support = true;
    }
    if (account.next_password_change) {
        info.next_password_change = account.next_password_change.getTime();
    }

    info.has_s3_access = Boolean(account.allowed_buckets);
    if (info.has_s3_access) {
        info.allowed_buckets = (account.allowed_buckets || []).map(
            bucket => bucket.name
        );
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
        external_connections.connections = credentials_cache.map(credentials => ({
            name: credentials.name,
            endpoint: credentials.endpoint,
            identity: credentials.access_key,
            endpoint_type: credentials.endpoint_type,
            usage: _list_connection_usage(account, credentials)
        }));
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
            var support_account = _.find(system_store.data.accounts, function(account) {
                return Boolean(account.is_support);
            });
            if (support_account) {
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
                        is_support: true
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
    if (!password) {
        return P.resolve();
    }

    return bcrypt.genSaltAsync(10)
        .then(salt => bcrypt.hashAsync(password, salt));
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
}

function generate_access_keys() {
    return {
        access_key: random_string(20),
        secret_key: crypto.randomBytes(40).toString('base64')
            .slice(0, 40)
    };
}

function verify_authorized_account(req) {
    return bcrypt.compareAsync(req.rpc_params.verification_password, req.account.password)
        .then(match => {
            if (!match) {
                throw new RpcError('UNAUTHORIZED', 'Invalid verification password');
            }
        });
}

function _list_connection_usage(account, credentials) {
    let cloud_sync_usage = _.map(
        _.filter(system_store.data.buckets, bucket => (
            bucket.cloud_sync &&
            bucket.cloud_sync.endpoint === credentials.endpoint &&
            bucket.cloud_sync.access_keys.account_id === account._id &&
            bucket.cloud_sync.access_keys.access_key === credentials.access_key
        )), bucket => ({
            usage_type: 'CLOUD_SYNC',
            entity: bucket.name,
            external_entity: bucket.cloud_sync.target_bucket
        })) || [];
    let cloud_pool_usage = _.map(
        _.filter(system_store.data.pools, pool => (
            pool.cloud_pool_info &&
            pool.cloud_pool_info.endpoint === credentials.endpoint &&
            pool.cloud_pool_info.account_id === account._id &&
            pool.cloud_pool_info.access_key === credentials.access_key
        )), pool => ({
            usage_type: 'CLOUD_POOL',
            entity: pool.name,
            external_entity: pool.cloud_pool_info.target_bucket
        })) || [];

    return cloud_sync_usage.concat(cloud_pool_usage);
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
