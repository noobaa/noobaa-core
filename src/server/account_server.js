// this module is written for both nodejs.
'use strict';

/**
 *
 * ACCOUNT_SERVER
 *
 */
var account_server = {
    create_account: create_account,
    read_account: read_account,
    update_account: update_account,
    generate_account_keys: generate_account_keys,
    update_buckets_permissions: update_buckets_permissions,
    get_buckets_permissions: get_buckets_permissions,
    delete_account: delete_account,
    list_accounts: list_accounts,
    accounts_status: accounts_status,
    get_system_roles: get_system_roles,
    add_account_sync_credentials_cache: add_account_sync_credentials_cache,
    get_account_sync_credentials_cache: get_account_sync_credentials_cache,
    check_account_sync_credentials: check_account_sync_credentials,
    get_account_info: get_account_info
};

module.exports = account_server;

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var bcrypt = require('bcrypt');
var system_store = require('./stores/system_store');
var system_server = require('./system_server');
var crypto = require('crypto');
var AWS = require('aws-sdk');
// var dbg = require('../util/debug_module')(__filename);


system_store.on('load', ensure_support_account);


/**
 *
 * CREATE_ACCOUNT
 *
 */
function create_account(req) {
    var account = _.pick(req.rpc_params, 'name', 'email', 'password');
    account._id = system_store.generate_id();
    return P.fcall(function() {
            return bcrypt_password(account);
        })
        .then(function() {
            var changes;
            let new_access_keys = [{
                    access_key: crypto.randomBytes(16).toString('hex'),
                    secret_key: crypto.randomBytes(32).toString('hex')
                }];

            if (req.rpc_params.name.toString() === 'demo' &&
                req.rpc_params.email.toString() === 'demo@noobaa.com') {
                new_access_keys[0].access_key = '123';
                new_access_keys[0].secret_key = 'abc';
            }
            account.access_keys = new_access_keys;
            
            if (!req.system) {
                changes = system_server.new_system_changes(account.name, account._id);
                account.allowed_buckets = [changes.insert.buckets[0]._id];
                changes.insert.accounts = [account];
            } else {
                if(req.rpc_params.allowed_buckets){
                    account.allowed_buckets = _.map(req.rpc_params.allowed_buckets, bucket => req.system.buckets_by_name[bucket]._id);                    
                }
                changes = {
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
            
            create_activity_log_entry(req, 'create', account);
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
        });
}



/**
 *
 * READ_ACCOUNT
 *
 */
function read_account(req) {
    return get_account_info(req.account);
}


/**
 *
 * GENERATE_ACCOUNT_KEYS
 *
 */
function generate_account_keys(req) {
    let account = system_store.data.accounts_by_email[req.rpc_params.email];
    if (!account) {
        throw req.rpc_error('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    if (req.system && req.account) {
        if (!is_support_or_admin_or_me(req.system, req.account, account)) {
            throw req.unauthorized('Cannot update account');
        }
    }
    if (account.is_support) {
        throw req.forbidden('Cannot update support account');
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
function update_buckets_permissions(req) {
    var system = req.system;
    let account = system_store.data.accounts_by_email[req.rpc_params.email];
    if (!account) {
        throw req.rpc_error('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    if (req.system && req.account) {
        if (!is_support_or_admin_or_me(req.system, req.account, account)) {
            throw req.unauthorized('Cannot update account');
        }
    } else {
        if (!req.system) {
            system = system_store.data.systems_by_name[req.rpc_params.name];
        }
    }
    if (account.is_support) {
        throw req.forbidden('Cannot update support account');
    }
    let updates = _.pick(account, '_id');
    updates.allowed_buckets = account.allowed_buckets;

    _.forEach(req.rpc_params.allowed_buckets, bucket => {
        if (bucket.is_allowed) {
            updates.allowed_buckets = _.unionWith(updates.allowed_buckets, [system.buckets_by_name[bucket.bucket_name]], _.isEqual);
        } else {
            _.remove(updates.allowed_buckets, remove_bucket =>
                remove_bucket.name.toString() === bucket.bucket_name.toString());
        }
    });

    updates.allowed_buckets = _.map(updates.allowed_buckets, bucket => bucket._id);

    return system_store.make_changes({
            update: {
                accounts: [updates]
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
    let account = system_store.data.accounts_by_email[req.rpc_params.email];
    if (!account) {
        throw req.rpc_error('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    if (!is_support_or_admin_or_me(req.system, req.account, account)) {
        throw req.unauthorized('Cannot update account');
    }
    if (account.is_support) {
        throw req.forbidden('Cannot update support account');
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
        .then(() => create_activity_log_entry(req, 'update', account))
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
        throw req.rpc_error('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    if (account_to_delete.is_support) {
        throw req.rpc_error('BAD_REQUEST', 'Cannot delete support account');
    }
    if (String(account_to_delete._id) === String(req.system.owner._id)) {
        throw req.rpc_error('BAD_REQUEST', 'Cannot delete system owner account');
    }
    if (!is_support_or_admin_or_me(req.system, req.account, account_to_delete)) {
        throw req.unauthorized('Cannot delete account');
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
                create_activity_log_entry(req, 'delete', account_to_delete);
                return val;
            },
            err => {
                create_activity_log_entry(req, 'delete', account_to_delete, 'alert');
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
            throw req.unauthorized('Must be system admin');
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
        has_accounts: !!any_non_support_account
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
            sslEnabled: false
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
function get_buckets_permissions(req) {
    var system = req.system;
    let account = system_store.data.accounts_by_email[req.rpc_params.email];
    if (!account) {
        throw req.rpc_error('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    if (req.system && req.account) {
        if (!is_support_or_admin_or_me(req.system, req.account, account)) {
            throw req.unauthorized('No permission to get allowed buckets');
        }
    } else {
        if (!req.system) {
            system = system_store.data.get_by_id(req.auth && req.auth.system_id);
        }
    }
    if (account.is_support) {
        throw req.forbidden('No allowed buckets for support account');
    }
    let reply = [];
    reply = _.map(system_store.data.buckets,
        bucket => ({
            bucket_name: bucket.name,
            is_allowed: _.find(account.allowed_buckets, allowed_bucket => (allowed_bucket === bucket)) ? true : false
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

    info.has_allowed_buckets = !!account.allowed_buckets;

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
            if (!process.env.create_support) {
                return;
            }

            var support_account = _.find(system_store.data.accounts, function(account) {
                return !!account.is_support;
            });
            if (support_account) {
                return;
            }
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

function create_activity_log_entry(req, event, account, level) {
    db.ActivityLog.create({
        event: 'account.' + event,
        level: level || 'info',
        system: req.system ? req.system._id : undefined,
        actor: req.account ? req.account._id : undefined,
        account: account._id,
    });
}
