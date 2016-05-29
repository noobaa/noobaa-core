/**
 *
 * ACCOUNT_SERVER
 *
 */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const https = require('https');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
const RpcError = require('../../rpc/rpc_error');
const server_rpc = require('../server_rpc');
const ActivityLog = require('../analytic_services/activity_log');
const system_store = require('../system_services/system_store').get_instance();
const system_server = require('./system_server');

system_store.on('load', ensure_support_account);

/**
 *
 * CREATE_ACCOUNT
 *
 */
function create_account(req) {
    var account = _.pick(req.rpc_params, 'name', 'email', 'password');
    account.access_keys = [req.rpc_params.access_keys];

    account._id = system_store.generate_id();
    return P.fcall(function() {
            return bcrypt_password(account);
        })
        .then(function() {
            if (req.system) {
                if (req.rpc_params.allowed_buckets) {
                    account.allowed_buckets = _.map(req.rpc_params.allowed_buckets,
                        bucket => req.system.buckets_by_name[bucket]._id);
                }
                return {
                    insert: {
                        accounts: [account],
                        roles: [{
                            _id: system_store.generate_id(),
                            account: account._id,
                            system: req.system._id,
                            role: 'admin',
                        }]
                    }
                };
            }
            return system_server.new_system_changes(account.name, account)
                .then(changes => {
                    account.allowed_buckets = [changes.insert.buckets[0]._id];
                    changes.insert.accounts = [account];
                    return changes;
                });
        })
        .then(changes => {
            create_activity_log_entry(req, 'create', account,
                `${account.email} was created ${req.account && 'by ' + req.account.email}`);
            return system_store.make_changes(changes);
        })
        .then(function() {
            var created_account = system_store.data.get_by_id(account._id);
            var auth = {
                account_id: created_account._id
            };
            if (!req.system) {
                // since we created the first system for this account
                // we expect just one system, but use _.each to get it from the map
                _.each(created_account.roles_by_system, (roles, system_id) => {
                    auth.system_id = system_id;
                    auth.role = roles[0];
                });
            }
            return {
                token: req.make_auth_token(auth),
            };
        })
        .then(token => {
            if (process.env.LOCAL_AGENTS_ENABLED !== 'true') {
                return token;
            }
            if (!req.system) {
                return server_rpc.client.hosted_agents.create_agent({
                        name: req.rpc_params.name,
                        access_keys: req.rpc_params.access_keys,
                        scale: 3,
                        storage_limit: 100 * 1024 * 1024,
                    })
                    .then(() => token);
            }

        });
}



/**
 *
 * READ_ACCOUNT
 *
 */
function read_account(req) {
    let email = req.rpc_params.email;

    let account = system_store.data.accounts_by_email[email];
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
    let account = system_store.data.accounts_by_email[req.rpc_params.email];
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
    let new_access_keys = [{
        access_key: crypto.randomBytes(16).toString('hex'),
        secret_key: crypto.randomBytes(32).toString('hex')
    }];

    updates.access_keys = new_access_keys;
    return system_store.make_changes({
            update: {
                accounts: [updates]
            }
        })
        .then(() => {
            //create_activity_log_entry(req, 'update', account);
            return new_access_keys;
        });
}


/**
 *
 * update_buckets_permissions
 *
 */
function update_account_s3_acl(req) {
    var system = req.system;
    let account = _.cloneDeep(system_store.data.accounts_by_email[req.rpc_params.email]);
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
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

    let allowed_buckets = null;
    if (req.rpc_params.access_control) {
        allowed_buckets = req.rpc_params.access_control
            .reduce(
                (list, record) => {
                    let bucket = system.buckets_by_name[record.bucket_name];
                    return record.is_allowed ?
                        _.unionWith(list, [bucket], system_store.has_same_id) :
                        _.differenceWith(list, [bucket], system_store.has_same_id);
                },
                account.allowed_buckets
            );
    }

    return system_store.make_changes({
            update: {
                accounts: [{
                    _id: account._id,
                    allowed_buckets: allowed_buckets && allowed_buckets.map(
                        bucket => bucket._id
                    )
                }]
            }
        })
        .then(() => {
            let new_allowed_buckets = allowed_buckets && allowed_buckets.map(bucket => bucket.name);
            let origin_allowed_buckets = account.allowed_buckets && account.allowed_buckets.map(bucket => bucket.name);
            let desc_string = [];
            let added_buckets = [];
            let removed_buckets = [];
            desc_string.push(`${account.email} S3 access was updated by ${req.account && req.account.email}`);
            if (req.rpc_params.access_control) {
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
            return create_activity_log_entry(req, 's3_access_updated', account, desc_string.join('\n'));
        })
        .return();
}

/**
 *
 * UPDATE_ACCOUNT
 *
 */
function update_account(req) {
    let account = system_store.data.accounts_by_email[req.rpc_params.email];
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    if (!is_support_or_admin_or_me(req.system, req.account, account)) {
        throw new RpcError('UNAUTHORIZED', 'Cannot update account');
    }
    if (account.is_support) {
        throw new RpcError('FORBIDDEN', 'Cannot update support account');
    }
    let updates = _.pick(req.rpc_params, 'name', 'password');
    updates._id = account._id;
    if (req.rpc_params.new_email) {
        updates.email = req.rpc_params.new_email;
    }
    return bcrypt_password(updates)
        .then(() => {
            return system_store.make_changes({
                update: {
                    accounts: [updates]
                }
            });
        })
        .then(() => create_activity_log_entry(req, 'update', account, `${account.email} was updated by ${req.account && req.account.email}: reset password`))
        .return();
}



/**
 *
 * DELETE_ACCOUNT
 *
 */
function delete_account(req) {
    let account_to_delete = system_store.data.accounts_by_email[req.rpc_params.email];
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
                create_activity_log_entry(req, 'delete', account_to_delete, `${account_to_delete.email} was deleted by ${req.account && req.account.email}`);
                return val;
            },
            err => {
                create_activity_log_entry(req, 'delete', account_to_delete, 'Error', 'alert');
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
            roles && roles.length ? account_id : null);

        accounts = _.compact(
            _.map(
                account_ids,
                account_id => system_store.data.get_by_id(account_id)
            )
        );
    }

    return {
        accounts: _.map(accounts, get_account_info)
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
 * UPDATE_ACCOUNT with keys
 *
 */
function get_account_sync_credentials_cache(req) {
    return (req.account.sync_credentials_cache || []).map(
        // The defaults are used for backword compatibility.
        credentials => {
            return {
                name: credentials.name || credentials.access_key,
                endpoint: credentials.endpoint || 'https://s3.amazonaws.com',
                access_key: credentials.access_key
            };
        }
    );
}

/**
 *
 * UPDATE_ACCOUNT with keys
 *
 */

function add_account_sync_credentials_cache(req) {
    var info = _.pick(req.rpc_params, 'name', 'endpoint', 'access_key', 'secret_key');
    var updates = {
        _id: req.account._id,
        sync_credentials_cache: req.account.sync_credentials_cache || []
    };
    updates.sync_credentials_cache.push(info);
    return system_store.make_changes({
        update: {
            accounts: [updates]
        }
    }).return();
}

function check_account_sync_credentials(req) {
    var params = _.pick(req.rpc_params, 'endpoint', 'access_key', 'secret_key');

    return P.fcall(function() {
        var s3 = new AWS.S3({
            endpoint: params.endpoint,
            accessKeyId: params.access_key,
            secretAccessKey: params.secret_key,
            httpOptions: {
                agent: new https.Agent({
                    rejectUnauthorized: false,
                })
            }
        });

        return P.ninvoke(s3, "listBuckets");
    }).then(
        () => true,
        () => false
    );
}


/**
 *
 * get_buckets_permissions
 *
 */
function list_account_s3_acl(req) {
    let account = system_store.data.accounts_by_email[req.rpc_params.email];
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    if (req.system && req.account) {
        if (!is_support_or_admin_or_me(req.system, req.account, account)) {
            throw new RpcError('UNAUTHORIZED', 'No permission to get allowed buckets');
        }
    } else if (!req.system) {
        req.system = system_store.data.get_by_id(req.auth && req.auth.system_id);
    }
    if (account.is_support) {
        throw new RpcError('FORBIDDEN', 'No allowed buckets for support account');
    }
    let reply = [];
    reply = _.map(system_store.data.buckets,
        bucket => ({
            bucket_name: bucket.name,
            is_allowed: Boolean(_.find(account.allowed_buckets,
                allowed_bucket => (allowed_bucket === bucket)))
        }));

    return reply;
}

// UTILS //////////////////////////////////////////////////////////



function get_account_info(account) {
    var info = _.pick(account, 'name', 'email');
    if (account.is_support) {
        info.is_support = true;
    }
    if (account.access_keys) {
        info.access_keys = account.access_keys;
    }

    info.has_s3_access = Boolean(account.allowed_buckets);

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
            support_account = {
                _id: system_store.generate_id(),
                name: 'Support',
                email: 'support@noobaa.com',
                password: process.env.SUPPORT_DEFAULT_PASSWORD || 'help',
                is_support: true
            };
            return bcrypt_password(support_account)
                .then(() => system_store.make_changes({
                    insert: {
                        accounts: [support_account]
                    }
                }))
                .then(() => console.log('SUPPORT ACCOUNT CREATED'));
        })
        .catch(function(err) {
            console.error('FAILED CREATE SUPPORT ACCOUNT', err);
        });
}


function bcrypt_password(account) {
    if (!account.password) {
        return P.resolve();
    }
    return P.fcall(function() {
            return P.nfcall(bcrypt.genSalt, 10);
        })
        .then(function(salt) {
            return P.nfcall(bcrypt.hash, account.password, salt);
        })
        .then(function(password_hash) {
            account.password = password_hash;
        });
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

function create_activity_log_entry(req, event, account, description, level) {
    ActivityLog.create({
        event: 'account.' + event,
        level: level || 'info',
        system: req.system ? req.system._id : undefined,
        actor: req.account ? req.account._id : undefined,
        account: account._id,
        desc: description,
    });
}


// EXPORTS
exports.create_account = create_account;
exports.read_account = read_account;
exports.update_account = update_account;
exports.delete_account = delete_account;
exports.generate_account_keys = generate_account_keys;
exports.list_account_s3_acl = list_account_s3_acl;
exports.update_account_s3_acl = update_account_s3_acl;
exports.list_accounts = list_accounts;
exports.accounts_status = accounts_status;
exports.get_system_roles = get_system_roles;
exports.add_account_sync_credentials_cache = add_account_sync_credentials_cache;
exports.get_account_sync_credentials_cache = get_account_sync_credentials_cache;
exports.check_account_sync_credentials = check_account_sync_credentials;
exports.get_account_info = get_account_info;
// utility to create the support account from bg_workers
exports.ensure_support_account = ensure_support_account;
