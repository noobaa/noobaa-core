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
const { create_arn_for_user, get_action_message_title, get_owner_account_id } = require('../endpoint/iam/iam_utils');
const { IAM_ACTIONS, MAX_NUMBER_OF_ACCESS_KEYS, IAM_DEFAULT_PATH, ACCESS_KEY_STATUS_ENUM,
    IAM_ACTIONS_USER_INLINE_POLICY, AWS_LIMIT_CHARS_USER_INlINE_POLICY } = require('../endpoint/iam/iam_constants');

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
    const account_access_info = create_access_key_auth(req, account, req.rpc_params.owner);

    if (req.rpc_params.role_config) {
        validate_assume_role_policy(req.rpc_params.role_config.assume_role_policy);
        account.role_config = req.rpc_params.role_config;
    }
    // TODO : remove rpc_params
    if (req.rpc_params.owner) {
        account.owner = req.rpc_params.owner;
        account.iam_path = req.rpc_params.iam_path;
        account.creation_date = Date.now();
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
        id: created_account._id.toString(),
        create_date: req.rpc_params.owner ? account.creation_date : undefined, // GAP: Do not save account creation date
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
    const account_access_keys = account.access_keys || [];
    const now = Date.now();
    // Encrypt the secret_key before saving it againg other wise secret_key saved without encrypt
    // We can add only two access key, when adding second access key first accesskey secret 
    // is encrypted again with same master_key_id
    if (account_access_keys.length > 0) {
        account_access_keys[0].secret_key = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
                        account_access_keys[0].secret_key, account.master_key_id._id);
    }
    const access_key_obj = cloud_utils.generate_access_keys();
    const decrypted_access_keys = _.cloneDeep(access_key_obj);
    access_key_obj.secret_key = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
                                        access_key_obj.secret_key, account.master_key_id._id);
    access_key_obj.deactivated = false;
    access_key_obj.creation_date = now;
    decrypted_access_keys.creation_date = now;
    // IAM create accesskey will have multiple accesskeys.
    if (req.rpc_params.owner) {
        account_access_keys.push(access_key_obj);
    } else {
        // Noobaa CLI create and generate accesskey commands replace existing accesskey
        account_access_keys[0] = access_key_obj;
    }
    await system_store.make_changes({
        update: {
            accounts: [{
                _id: account._id,
                $set: { access_keys: account_access_keys }
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
    if (req.rpc_params.owner) {
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

// To make the user name unique across system:
// - first part is user name in lower case 
// - second part is root account id
function get_account_email_from_username(username, requesting_account_id) {
    return new SensitiveString(`${username.toLowerCase()}:${requesting_account_id}`);
}

function _check_if_account_exists(action, email_wrapped, username) {
    const account = system_store.get_account_by_email(email_wrapped);
    if (!account) {
        dbg.error(`AccountSpaceNB.${action} username does not exist`, email_wrapped.unwrap());
        const message_with_details = `The user with name ${username} cannot be found.`;
        throw new RpcError('NO_SUCH_ENTITY', message_with_details);
    }
    return account;
}

function _check_root_account_owns_user(root_account, user_account) {
    if (user_account.owner === undefined) return false;
    let root_account_id;
    if (typeof root_account._id === 'object') {
        root_account_id = String(root_account._id);
    } else {
        root_account_id = root_account._id;
    }
    const owner_account_id = get_owner_account_id(user_account);
    return root_account_id === owner_account_id;
}

function _check_if_requesting_account_is_root_account(action, requesting_account, user_details = {}) {
    const is_root_account = _check_root_account(requesting_account);
    dbg.log1(`AccountSpaceNB.${action} requesting_account ID: ${requesting_account._id}` +
        `name: ${requesting_account.name.unwrap()}`, 'is_root_account', is_root_account);
    if (!is_root_account) {
        dbg.error(`AccountSpaceNB.${action} requesting account is not a root account`, requesting_account._id);
        _throw_access_denied_error(action, requesting_account, user_details, "USER");
    }
}

function _check_username_already_exists(action, email_wrapped, username) {
    const account = system_store.get_account_by_email(email_wrapped);
    if (account) {
        dbg.error(`AccountSpaceNB.${action} username already exists`, username);
        const message_with_details = `User with name ${username} already exists.`;
        throw new RpcError('ENTITY_ALREADY_EXISTS', message_with_details);
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
        throw new RpcError('NO_SUCH_ENTITY', message_with_details);
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
    throw new RpcError('NOT_AUTHORIZED', 'You do not have permission to perform this action.');
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
    throw new RpcError('NO_SUCH_ENTITY', message_with_details);
}

function _throw_error_no_such_entity_access_key(action, access_key_id) {
    dbg.error(`AccountSpaceNB.${action} access key does not exist`, access_key_id);
    const message_with_details = `The Access Key with id ${access_key_id} cannot be found.`;
    throw new RpcError('NO_SUCH_ENTITY', message_with_details);
}

function _throw_error_no_such_entity_policy(action, policy_name) {
    dbg.error(`AccountSpaceNB.${action} The user policy with name does not exist`, policy_name);
    const message_with_details = `The user policy with name ${policy_name} cannot be found.`;
    throw new RpcError('NO_SUCH_ENTITY', message_with_details);
}

function _throw_access_denied_error(action, requesting_account, details, entity) {
    const full_action_name = get_action_message_title(action);
    const account_id = _get_account_owner_id_for_arn(requesting_account);
    const account_id_for_arn = String(account_id);
    const arn_for_requesting_account = account_id ? create_arn_for_user(account_id_for_arn, requesting_account.name.unwrap(),
        requesting_account.iam_path || IAM_DEFAULT_PATH) : '';
    const basic_message = `User: ${arn_for_requesting_account} is not authorized to perform: ` +
        `${full_action_name} on resource: `;
    let message_with_details;
    if (entity === 'USER') {
        let user_message;
        if (action === IAM_ACTIONS.LIST_ACCESS_KEYS ||
            IAM_ACTIONS_USER_INLINE_POLICY.includes(action)) {
            user_message = `user ${details.username}`;
        } else {
            user_message = create_arn_for_user(account_id_for_arn, details.username, details.path);
        }
        message_with_details = basic_message +
            `${user_message} because no identity-based policy allows the ${full_action_name} action`;
    } else {
        message_with_details = basic_message + `access key ${details.access_key}`;
    }
    throw new RpcError('UNAUTHORIZED', message_with_details);
}

function _throw_error_delete_conflict(action, account_to_delete, resource_name) {
    dbg.error(`AccountSpaceNB.${action} requested account ` +
        `${account_to_delete.name} ${account_to_delete._id} has ${resource_name}`);
    const message_with_details = `Cannot delete entity, must delete ${resource_name} first.`;
    throw new RpcError('DELETE_CONFLICT', message_with_details);
}

// ACCESS KEY VALIDATIONS

function _check_number_of_access_key_array(action, requested_account) {
    if (requested_account.access_keys && requested_account.access_keys.length >= MAX_NUMBER_OF_ACCESS_KEYS) {
        dbg.error(`AccountSpaceNB.${action} cannot exceed quota for AccessKeysPerUser `,
            requested_account.name);
        const message_with_details = `Cannot exceed quota for AccessKeysPerUser: ${MAX_NUMBER_OF_ACCESS_KEYS}.`;
        throw new RpcError('LIMIT_EXCEEDED', message_with_details);
    }
}

function _check_if_iam_user_belongs_to_account_owner_by_access_key(action, requesting_account, access_key_id) {
    const access_key_id_wrapped = new SensitiveString(access_key_id);
    const requested_account = system_store.get_account_by_access_key(access_key_id_wrapped);
    if (!requested_account) {
        _throw_error_no_such_entity_access_key(action, access_key_id);
    }
    const is_account_on_himself = String(requesting_account._id) === String(requested_account._id);
    if (is_account_on_himself) {
        // didn't block an account from running action on itself since it not editing anything here
        return requested_account;
    } else {
        const is_root_account = _check_root_account(requesting_account);
        if (!is_root_account) {
            _throw_access_denied_error(action, requesting_account, { access_key: access_key_id }, "ACCESS_KEY");
        }
        const is_requested_account_owned_by_root_account = _check_root_account_owns_user(requesting_account, requested_account);
        if (!is_requested_account_owned_by_root_account) {
            _throw_error_no_such_entity_access_key(action, access_key_id);
        }
        return requested_account;
    }
}

function _check_access_key_belongs_to_account(action, requested_account, access_key_id) {
    const is_access_key_belongs_to_account = _check_specific_access_key_exists(requested_account.access_keys, access_key_id);
    if (!is_access_key_belongs_to_account) {
        _throw_error_no_such_entity_access_key(action, access_key_id);
    }
}

function _check_specific_access_key_exists(access_keys, access_key_to_find) {
    for (const access_key_obj of access_keys) {
        const access_key = access_key_obj.access_key instanceof SensitiveString ?
            access_key_obj.access_key.unwrap() : access_key_obj.access_key;
        if (access_key_to_find === access_key) {
            return true;
        }
    }
    return false;
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
            return get_owner_account_id(requesting_account);
        }
        return requesting_account._id;
    }
    return requested_account?._id;
}

function _check_root_account(account) {
    return account.owner === undefined;
}

function _check_access_key_is_deactivated(status) {
    return status === ACCESS_KEY_STATUS_ENUM.INACTIVE;
}

function _get_access_key_status(deactivated) {
    // we would like the default to be Active (so when it is undefined it would be Active)
    const status = deactivated ? ACCESS_KEY_STATUS_ENUM.INACTIVE : ACCESS_KEY_STATUS_ENUM.ACTIVE;
    return status;
}

// This function will return accesskey that is not updated/deleted with proper encryption, Otherwise random string is saved 
//      - In case of update, return the accessky that is not updated with proper encryption
//      - In case of delete, return the accessky that is not deleted with proper encryption
// Update/Delete method will use this accesskey to save to DB
function get_non_updating_access_key(requested_account, access_key_id) {
    const filtered_access_keys = requested_account.access_keys.filter(access_key => access_key.access_key.unwrap() !== access_key_id);
    if (filtered_access_keys.length > 0) {
        filtered_access_keys[0].secret_key = system_store.master_key_manager
            .encrypt_sensitive_string_with_master_key_id(filtered_access_keys[0].secret_key, requested_account.master_key_id._id);
    }
    return filtered_access_keys;
}

function _list_access_keys_from_account(requesting_account, account, on_itself) {
    const members = [];
    if (!account.access_keys || account.access_keys.length === 0) {
        return members;
    }
    for (const access_key of account.access_keys) {
        const member = {
            username: _returned_username(requesting_account, account.name.unwrap(), on_itself),
            access_key: access_key.access_key instanceof SensitiveString ? access_key.access_key.unwrap() : access_key.access_key,
            status: _get_access_key_status(access_key.deactivated),
            // Creation date only for IAM users and new account(4.20 and above), 
            // Existing accounts(4.20 below) wont have it hense we default it to Date.now().
            create_date: access_key.creation_date || account.creation_date || Date.now(),
        };
        members.push(member);
    }
    return members;
}

function _check_user_policy_exists(action, iam_user_policies, policy_name) {
    const iam_user_policy_index = _get_iam_user_policy_index(iam_user_policies, policy_name);
    if (iam_user_policy_index === -1) {
        _throw_error_no_such_entity_policy(action, policy_name);
    }
    return iam_user_policy_index;
}

function _get_iam_user_policy_index(iam_user_policies, policy_name) {
    const iam_user_policy_index = iam_user_policies.findIndex(current_iam_user_policy =>
        current_iam_user_policy.policy_name === policy_name);
    return iam_user_policy_index;
}

function _check_total_policy_size(iam_user_policies, username) {
    const total_chars_size = _get_total_size_of_policies(iam_user_policies);
    if (total_chars_size > AWS_LIMIT_CHARS_USER_INlINE_POLICY) {
        const message_with_details = `Maximum policy size of ${AWS_LIMIT_CHARS_USER_INlINE_POLICY} bytes exceeded for user ${username}`;
        throw new RpcError('LIMIT_EXCEEDED', message_with_details);
    }
}

// each char is  byte and not including whitespaces
function _get_total_size_of_policies(iam_user_policies) {
    let total_size = 0;
    for (const iam_user_policy of iam_user_policies) {
        const policy_as_string = JSON.stringify(iam_user_policy);
        total_size += policy_as_string.length;
    }
    return total_size;
}

// only resources of IAM (without the case of root account)
function _check_if_user_does_not_have_resources_before_deletion(action, account_to_delete) {
    _check_if_user_does_not_have_access_keys_before_deletion(action, account_to_delete);
    _check_if_user_does_not_have_user_policy_before_deletion(action, account_to_delete);
}

function _check_if_user_does_not_have_access_keys_before_deletion(action, account_to_delete) {
    const resource_name = 'access keys';
    const access_keys = account_to_delete.access_keys || [];
    const is_access_keys_empty = access_keys.length === 0;
    if (!is_access_keys_empty) {
        _throw_error_delete_conflict(action, account_to_delete, resource_name);
    }
}

function _check_if_user_does_not_have_user_policy_before_deletion(action, account_to_delete) {
    const resource_name = 'policies';
    const iam_user_policies = account_to_delete.iam_user_policies || [];
    const is_policies_removed = iam_user_policies.length === 0;
    if (!is_policies_removed) {
        _throw_error_delete_conflict(action, account_to_delete, resource_name);
    }
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

// implicit policy - we allow a few actions that a IAM user can run on himself
// Currently - all access key actions
function validate_and_return_requested_account_with_option_itself(params, action, requesting_account) {
    const requester_username = requesting_account.name.unwrap();
    // check if root account or IAM user is operating on themselves (with or without --user-name flag)
    const no_username_or_self_operation = !params.username; // can be root account or IAM user
    const is_iam_user_operating_on_itself = !_check_root_account(requesting_account) &&
        requester_username.toLowerCase() === params.username?.toLowerCase();
    const on_itself = no_username_or_self_operation || is_iam_user_operating_on_itself;

    let requested_account;
    if (on_itself) {
        // When accesskey API called without specific username, action on the same requesting account.
        // So in that case requesting account and requested account is same.
        requested_account = requesting_account;
        // we do not allow for AWS account root user to perform IAM action on itself
        if (requesting_account.owner === undefined) {
            throw new RpcError('NOT_AUTHORIZED', 'You do not have permission to perform this action.');
        }
    } else {
        return validate_and_return_requested_account(params, action, requesting_account);
    }
    return requested_account;
}

function validate_and_return_requested_account(params, action, requesting_account) {
    _check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
    const account_email = get_account_email_from_username(params.username, requesting_account._id.toString());
    const requested_account = _check_if_account_exists(action, account_email, params.username);
    _check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
    _check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
    return requested_account;
}

function return_list_member(iam_user, iam_path, iam_username) {
    const owner_account_id = get_owner_account_id(iam_user);
    return {
        user_id: iam_user._id.toString(),
        iam_path: iam_path,
        username: iam_username,
        arn: create_arn_for_user(owner_account_id, iam_username, iam_path),
        create_date: iam_user.creation_date,
        // TODO: GAP missing password_last_used
        password_last_used: Date.now(), // GAP
    };
}

function get_sorted_list_tags_for_user(user_tagging) {
    if (!user_tagging || user_tagging.length === 0) {
        return [];
    }
    const sorted_tags = user_tagging.sort((a, b) => a.key.localeCompare(b.key));
    return sorted_tags.map(tag => ({
        member: {
            Key: tag.key,
            Value: tag.value
        }
    }));
}

function get_system_id_for_events(req) {
    const sys_id = req.rpc_params.new_system_parameters ?
        system_store.parse_system_store_id(req.rpc_params.new_system_parameters.new_system_id) :
        req.system && req.system._id;
    return sys_id;
}

exports.delete_account = delete_account;
exports.create_account = create_account;
exports.generate_account_keys = generate_account_keys;
exports.get_account_email_from_username = get_account_email_from_username;
exports.get_non_updating_access_key = get_non_updating_access_key;
exports._check_if_requesting_account_is_root_account = _check_if_requesting_account_is_root_account;
exports._check_username_already_exists = _check_username_already_exists;
exports._check_number_of_access_key_array = _check_number_of_access_key_array;
exports._check_access_key_belongs_to_account = _check_access_key_belongs_to_account;
exports._get_access_key_status = _get_access_key_status;
exports._check_access_key_is_deactivated = _check_access_key_is_deactivated;
exports._list_access_keys_from_account = _list_access_keys_from_account;
exports.validate_create_account_permissions = validate_create_account_permissions;
exports.validate_create_account_params = validate_create_account_params;
exports._check_if_account_exists = _check_if_account_exists;
exports._returned_username = _returned_username;
exports._check_if_requested_is_owned_by_root_account = _check_if_requested_is_owned_by_root_account;
exports._check_if_requested_account_is_root_account_or_IAM_user = _check_if_requested_account_is_root_account_or_IAM_user;
exports._get_iam_user_policy_index = _get_iam_user_policy_index;
exports._check_user_policy_exists = _check_user_policy_exists;
exports._check_if_user_does_not_have_resources_before_deletion = _check_if_user_does_not_have_resources_before_deletion;
exports._check_total_policy_size = _check_total_policy_size;
exports.validate_and_return_requested_account = validate_and_return_requested_account;
exports.validate_and_return_requested_account_with_option_itself = validate_and_return_requested_account_with_option_itself;
exports.return_list_member = return_list_member;
exports.get_owner_account_id = get_owner_account_id;
exports.get_sorted_list_tags_for_user = get_sorted_list_tags_for_user;
exports._check_if_iam_user_belongs_to_account_owner_by_access_key = _check_if_iam_user_belongs_to_account_owner_by_access_key;
exports.get_system_id_for_events = get_system_id_for_events;
