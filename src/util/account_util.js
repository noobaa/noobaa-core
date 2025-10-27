/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const Dispatcher = require('../server/notifications/dispatcher');

const dbg = require('../util/debug_module')(__filename);
const { RpcError } = require('../rpc');
const SensitiveString = require('../util/sensitive_string');
const cloud_utils = require('../util/cloud_utils');
const auth_server = require('..//server/common_services/auth_server');
const system_store = require('..//server/system_services/system_store').get_instance();
const pool_server = require('../server/system_services/pool_server');
const { OP_NAME_TO_ACTION } = require('../endpoint/sts/sts_rest');
const IamError = require('../endpoint/iam/iam_errors').IamError;
//const { account_cache } = require('./../sdk/object_sdk');
const { create_arn_for_user, get_action_message_title } = require('../endpoint/iam/iam_utils');
const { IAM_ACTIONS, IAM_DEFAULT_PATH, IAM_SPLIT_CHARACTERS } = require('../endpoint/iam/iam_constants');

const demo_access_keys = Object.freeze({
    access_key: new SensitiveString('123'),
    secret_key: new SensitiveString('abc')
});
/**
 *
 * CREATE_ACCOUNT
 *
 */
async function create_account(req) {

    const account = {
        _id: (
            req.rpc_params.new_system_parameters ?
            system_store.parse_system_store_id(req.rpc_params.new_system_parameters.account_id) :
            system_store.new_system_store_id()
        ),
        name: req.rpc_params.name,
        email: req.rpc_params.email,
        has_login: req.rpc_params.has_login,
        is_external: req.rpc_params.is_external,
        nsfs_account_config: req.rpc_params.nsfs_account_config,
        force_md5_etag: req.rpc_params.force_md5_etag
    };

    if (!req.system) {
        req.system = system_store.data.systems[0];
    }

    const { roles: account_roles = ['admin'] } = req.rpc_params;

    if (req.rpc_params.must_change_password) {
        account.next_password_change = new Date();
    }

    const sys_id = req.rpc_params.new_system_parameters ?
        system_store.parse_system_store_id(req.rpc_params.new_system_parameters.new_system_id) :
        req.system._id;

    if (req.rpc_params.s3_access) {
        if (req.rpc_params.new_system_parameters) {
            account.default_resource = system_store.parse_system_store_id(req.rpc_params.new_system_parameters.default_resource);
            account.allow_bucket_creation = true;
        } else {
            // Default pool resource is backingstores
            const resource = req.rpc_params.default_resource ?
            req.system.pools_by_name[req.rpc_params.default_resource] ||
                (req.system.namespace_resources_by_name && req.system.namespace_resources_by_name[req.rpc_params.default_resource]) :
                pool_server.get_default_pool(req.system);
            if (!resource) throw new RpcError('BAD_REQUEST', 'default resource doesn\'t exist');
            if (resource.nsfs_config && resource.nsfs_config.fs_root_path && !req.rpc_params.nsfs_account_config) {
                throw new RpcError('Invalid account configuration - must specify nsfs_account_config when default resource is a namespace resource');
            }
            account.default_resource = resource._id;
            account.allow_bucket_creation = _.isUndefined(req.rpc_params.allow_bucket_creation) ?
                true : req.rpc_params.allow_bucket_creation;

            const bucket_claim_owner = req.rpc_params.bucket_claim_owner;
            if (bucket_claim_owner) {
                const creator_roles = req.account.roles_by_system[req.system._id];
                if (creator_roles.includes('operator')) { // Not allowed to create claim owner outside of the operator
                    account.bucket_claim_owner = req.system.buckets_by_name[bucket_claim_owner.unwrap()]._id;
                } else {
                    dbg.warn('None operator user was trying to set a bucket-claim-owner for account', req.account);
                }
            }
        }
    }

    const roles = account_roles.map(role => ({
        _id: system_store.new_system_store_id(),
        account: account._id,
        system: sys_id,
        role
    }));

    // Suppress audit entry for creation of operator account.
    if (!account_roles.includes('operator')) {
        Dispatcher.instance().activity({
            event: 'account.create',
            level: 'info',
            system: (req.system && req.system._id) || sys_id,
            actor: req.account && req.account._id,
            account: account._id,
            desc: `${account.email.unwrap()} was created ` + (req.account ? `by ${req.account.email.unwrap()}` : ``),
        });
    }
    const account_access_info = create_access_key_auth(req, account, req.rpc_params.is_iam);

    if (req.rpc_params.role_config) {
        validate_assume_role_policy(req.rpc_params.role_config.assume_role_policy);
        account.role_config = req.rpc_params.role_config;
    }
    // TODO : remove rpc_params
    if (req.rpc_params.is_iam) {
        account.owner = req.rpc_params.owner;
        account.iam_arn = req.rpc_params.iam_arn;
        account.iam_path = req.rpc_params.iam_path;
    }

    await system_store.make_changes({
        insert: {
            accounts: [account],
            roles,
            master_keys: [account_access_info.account_mkey]
        }
    });

    const created_account = system_store.data.get_by_id(account._id);
    const auth = {
        account_id: created_account._id
    };
    // since we created the first system for this account
    // we expect just one system, but use _.each to get it from the map
    const current_system = (req.system && req.system._id) || sys_id;
    _.each(created_account.roles_by_system, (sys_roles, system_id) => {
        //we cannot assume only one system.
        if (current_system.toString() === system_id) {
            auth.system_id = system_id;
            auth.role = sys_roles[0];
        }
    });
    return {
        token: auth_server.make_auth_token(auth),
        access_keys: account_access_info.decrypted_access_keys,
        id: req.rpc_params.is_iam ? created_account._id.toString() : undefined,
        create_date: req.rpc_params.is_iam ? new Date() : undefined,
    };
}

function delete_account(req, account_to_delete) {
    const roles_to_delete = system_store.data.roles
    .filter(
        role => String(role.account._id) === String(account_to_delete._id)
    )
    .map(
        role => role._id
    );
    //const email = account_to_delete.email instanceof SensitiveString ? account_to_delete.email.unwrap() : username;

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
                desc: `${account_to_delete.email.unwrap()} was deleted by ${req.account && req.account.email.unwrap()}`,
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
                desc: `Error: ${account_to_delete.email.unwrap()} failed to delete by ${req.account && req.account.email.unwrap()}`,
            });
            throw err;
        }
    );
}

/**
 *
 * GENERATE_ACCOUNT_KEYS
 *
 */
async function generate_account_keys(req) {
    const account = system_store.get_account_by_email(req.rpc_params.email);
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }

    if (!req.system) {
        req.system = system_store.data.systems[0];
    }

    if (req.system && req.account) {
        if (!is_support_or_admin_or_me(req.system, req.account, account)) {
            throw new RpcError('UNAUTHORIZED', 'Cannot update account');
        }
    }
    if (account.is_support) {
        throw new RpcError('FORBIDDEN', 'Cannot update support account');
    }
    const access_keys = cloud_utils.generate_access_keys();
    const decrypted_access_keys = _.cloneDeep(access_keys);
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
        event: 'account.generate_credentials',
        level: 'info',
        system: req.system && req.system._id,
        actor: req.account && req.account._id,
        account: account._id,
        desc: `Credentials for ${account.email.unwrap()} were regenerated ${req.account && 'by ' + req.account.email.unwrap()}`,
    });
    if (req.rpc_params.is_iam) {
        return decrypted_access_keys;
    }
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

function create_access_key_auth(req, account, is_iam) {

    const account_mkey = system_store.master_key_manager.new_master_key({
        description: `master key of ${account._id} account`,
        cipher_type: system_store.data.systems[0].master_key_id.cipher_type,
        master_key_id: system_store.data.systems[0].master_key_id._id
    });
    account.master_key_id = account_mkey._id;
    let decrypted_access_keys;
    if (!is_iam) {
        if (account.name.unwrap() === 'demo' && account.email.unwrap() === 'demo@noobaa.com') {
            account.access_keys = [demo_access_keys];
        } else {
            const access_keys = req.rpc_params.access_keys || [cloud_utils.generate_access_keys()];
            if (!access_keys.length) throw new RpcError('FORBIDDEN', 'cannot create account without access_keys');
            account.access_keys = access_keys;
        }
        decrypted_access_keys = _.cloneDeep(account.access_keys);
        account.access_keys[0] = {
            access_key: account.access_keys[0].access_key,
            secret_key: system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
                account.access_keys[0].secret_key, account_mkey._id)
        };
    }

    return {
        decrypted_access_keys,
        account_mkey
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

// User name is first part is user provided name, and second part
// is root account name, This will make the user name uniq accross system.
function populate_username(username, requesting_account_name) {
    return new SensitiveString(`${username}:${requesting_account_name}`);
}

function get_iam_username(requested_account_name) {
    return requested_account_name.split(IAM_SPLIT_CHARACTERS)[0];
}

function _check_if_account_exists(action, email) {
    const account = system_store.get_account_by_email(email);
    email = email instanceof SensitiveString ? email.unwrap() : email;
    if (!account) {
        dbg.error(`AccountSpaceNB.${action} username does not exist`, email);
        const message_with_details = `The user with name ${email} cannot be found.`;
        const { code, http_code, type } = IamError.NoSuchEntity;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }
}

function _check_root_account_owns_user(root_account, user_account) {
    if (user_account.owner === undefined) return false;
    let root_account_id;
    let owner_account_id;
    if (typeof root_account._id === 'object') {
        root_account_id = String(root_account._id);
    } else {
        root_account_id = root_account._id;
    }

    if (typeof user_account.owner === 'object') {
        owner_account_id = String(user_account.owner._id);
    } else {
        owner_account_id = user_account.owner._id;
    }
    return root_account_id === owner_account_id;
}

function _check_if_requesting_account_is_root_account(action, requesting_account, user_details = {}) {
    const is_root_account = _check_root_account(requesting_account);
    dbg.log1(`AccountSpaceNB.${action} requesting_account ID: ${requesting_account._id}` +
        `name: ${requesting_account.name.unwrap()}`, 'is_root_account', is_root_account);
    if (!is_root_account) {
        dbg.error(`AccountSpaceNB.${action} requesting account is not a root account`,
            requesting_account);
        _throw_access_denied_error(action, requesting_account, user_details, "USER");
    }
}

function _check_username_already_exists(action, params, requesting_account) {
    const username = populate_username(params.username, requesting_account.name.unwrap());
    const account = system_store.get_account_by_email(username);
    if (account) {
        dbg.error(`AccountSpaceNB.${action} username already exists`, params.username);
        const message_with_details = `User with name ${params.username} already exists.`;
        const { code, http_code, type } = IamError.EntityAlreadyExists;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }
}

function _check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account) {
    const is_requested_account_root_account = _check_root_account(requested_account);
    dbg.log1(`AccountSpaceNB.${action} requested_account ID: ${requested_account._id} name: ${requested_account.name}`,
        'is_requested_account_root_account', is_requested_account_root_account);
    // access to root account is allowed to root account that has iam_operate_on_root_account true
    if (is_requested_account_root_account && !requesting_account.iam_operate_on_root_account) {
        _throw_error_perform_action_on_another_root_account(action,
            requesting_account, requested_account);
    }
    // access to IAM user is allowed to root account that either iam_operate_on_root_account undefined or false
    if (requesting_account.iam_operate_on_root_account && !is_requested_account_root_account) {
        _throw_error_perform_action_from_root_accounts_manager_on_iam_user(action,
            requesting_account, requested_account);
    }
}

function _check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account) {
    if (requesting_account.iam_operate_on_root_account) return;
    const is_user_account_to_get_owned_by_root_user = _check_root_account_owns_user(requesting_account, requested_account);
    if (!is_user_account_to_get_owned_by_root_user) {
        const username = requested_account.name instanceof SensitiveString ?
                requested_account.name.unwrap() : requested_account.name;
        dbg.error(`AccountSpaceNB.${action} requested account is not owned by root account`, username);
        const message_with_details = `The user with name ${username} cannot be found.`;
        const { code, http_code, type } = IamError.NoSuchEntity;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }
}

/**
* _returned_username would return the username of IAM Access key API:
    * 1. undefined - for root accounts manager on root account (no username, only account name)
    *                for root account on itself 
    * 2. username - for IAM user
    * @param {object} requesting_account
    * @param {Object} username
    * @param {boolean} on_itself
    */
function _returned_username(requesting_account, username, on_itself) {
    if ((requesting_account.iam_operate_on_root_account) ||
        (_check_root_account(requesting_account) && on_itself)) {
            return undefined;
    }
    return username instanceof SensitiveString ? username.unwrap() : username;
}

function _throw_error_perform_action_from_root_accounts_manager_on_iam_user(action, requesting_account, requested_account) {
    dbg.error(`AccountSpaceNB.${action} root accounts manager cannot perform actions on IAM users`,
        requesting_account, requested_account);
    throw new IamError(IamError.NotAuthorized);
}

// TODO: move to IamError class with a template
function _throw_error_perform_action_on_another_root_account(action, requesting_account, requested_account) {
    const username = requested_account.name instanceof SensitiveString ?
    requested_account.name.unwrap() : requested_account.name;
    // we do not want to to reveal that the root account exists (or usernames under it)
    // (cannot perform action on users from another root accounts)
    dbg.error(`AccountSpaceNB.${action} root account of requested account is different than requesting root account`,
        requesting_account._id.toString(), username);
    const message_with_details = `The user with name ${username} cannot be found.`;
    const { code, http_code, type } = IamError.NoSuchEntity;
    throw new IamError({ code, message: message_with_details, http_code, type });
}

function _throw_access_denied_error(action, requesting_account, details, entity) {
    const full_action_name = get_action_message_title(action);
    const account_id_for_arn = _get_account_owner_id_for_arn(requesting_account);
    const arn_for_requesting_account = create_arn_for_user(account_id_for_arn,
        requesting_account.name.unwrap(), requesting_account.path || IAM_DEFAULT_PATH);
    const basic_message = `User: ${arn_for_requesting_account} is not authorized to perform:` +
    `${full_action_name} on resource: `;
    let message_with_details;
    if (entity === 'USER') {
        let user_message;
        if (action === IAM_ACTIONS.LIST_ACCESS_KEYS) {
            user_message = `user ${details.username}`;
        } else {
            user_message = create_arn_for_user(account_id_for_arn, details.username, details.path);
        }
        message_with_details = basic_message +
        `${user_message} because no identity-based policy allows the ${full_action_name} action`;
    } else {
        message_with_details = basic_message + `access key ${details.access_key}`;
    }
    const { code, http_code, type } = IamError.AccessDeniedException;
    throw new IamError({ code, message: message_with_details, http_code, type });
}

/**
 * _get_account_owner_id_for_arn will return the account ID
 * that we need for creating the ARN, the cases:
 *   1. iam user - it's owner property
 *   2. root account - it's account ID
 *   3. root accounts manager - the account ID of the account that it operates on
 * @param {object} requesting_account
 * @param {object} [requested_account]
 * @returns {string|undefined}
 */
function _get_account_owner_id_for_arn(requesting_account, requested_account) {
    if (!requesting_account.iam_operate_on_root_account) {
        if (requesting_account.owner !== undefined) {
            return requesting_account.owner;
        }
        return requesting_account._id;
    }
    return requested_account?._id;
}

function _check_root_account(account) {
    return account.owner === undefined;
}



function validate_create_account_permissions(req) {
    const account = req.account;
    //For new system creation, nothing to be checked
    if (req.rpc_params.new_system_parameters) return;

    //Only allow support, admin/operator roles and UI login enabled accounts to create new accounts
    if (!account.is_support &&
        !account.has_login &&
        !(account.roles_by_system[req.system._id].some(
            role => role === 'admin' || role === 'operator'
        ))) {
        throw new RpcError('UNAUTHORIZED', 'Cannot create new account');
    }
}

function validate_create_account_params(req) {
    // find none-internal pools
    const has_non_internal_resources = (req.system && req.system.pools_by_name) ?
        Object.values(req.system.pools_by_name).some(p => !p.is_default_pool) :
        false;

    if (req.rpc_params.name.unwrap() !== req.rpc_params.name.unwrap().trim()) {
        throw new RpcError('BAD_REQUEST', 'system name must not contain leading or trailing spaces');
    }

    if (system_store.get_account_by_email(req.rpc_params.email)) {
        throw new RpcError('BAD_REQUEST', 'email address already registered');
    }

    if (req.rpc_params.s3_access) {
        if (!req.rpc_params.new_system_parameters) {
            if (req.system.pools_by_name === 0) {
                throw new RpcError('No resources in the system - Can\'t create accounts');
            }

            if (req.rpc_params.allow_bucket_creation && !req.rpc_params.default_resource) { //default resource needed only if new bucket can be created
                if (has_non_internal_resources) { // has resources which is not internal - must supply resource
                    throw new RpcError('BAD_REQUEST', 'Enabling S3 requires providing default_resource');
                }
            }
        }

        if (req.rpc_params.new_system_parameters) {
            if (!req.rpc_params.new_system_parameters.default_resource) {
                throw new RpcError(
                    'BAD_REQUEST',
                    'Creating new system with enabled S3 access for owner requires providing default_resource'
                );
            }
        }
    }

    if (req.rpc_params.has_login) {
        if (!req.rpc_params.password) {
            throw new RpcError('BAD_REQUEST', 'Password is missing');
        }

        // Verify that account with login access have full s3 access permissions.
        const { default_resource } = req.rpc_params.new_system_parameters || req.rpc_params;
        const allow_bucket_creation = req.rpc_params.new_system_parameters ?
            true :
            req.rpc_params.allow_bucket_creation;

        if (
            !req.rpc_params.s3_access ||
            (has_non_internal_resources && !default_resource) ||
            !allow_bucket_creation
        ) {
            throw new RpcError('BAD_REQUEST', 'Accounts with login access must have full s3 access permissions');
        }

    } else if (req.rpc_params.password) {
        throw new RpcError('BAD_REQUEST', 'Password should not be sent');
    }
}


exports.delete_account = delete_account;
exports.create_account = create_account;
exports.generate_account_keys = generate_account_keys;
exports.populate_username = populate_username;
exports.get_iam_username = get_iam_username;
exports._check_if_requesting_account_is_root_account = _check_if_requesting_account_is_root_account;
exports._check_username_already_exists = _check_username_already_exists;
exports.validate_create_account_permissions = validate_create_account_permissions;
exports.validate_create_account_params = validate_create_account_params;
exports._check_if_account_exists = _check_if_account_exists;
exports._returned_username = _returned_username;
exports._check_if_requested_is_owned_by_root_account = _check_if_requested_is_owned_by_root_account;
exports._check_if_requested_account_is_root_account_or_IAM_user = _check_if_requested_account_is_root_account_or_IAM_user;
