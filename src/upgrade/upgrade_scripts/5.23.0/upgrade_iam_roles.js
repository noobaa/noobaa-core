/* Copyright (C) 2023 NooBaa */
"use strict";

const util = require('util');
const _ = require('lodash');

const SensitiveString = require('../../../util/sensitive_string');
const account_util = require('../../../util/account_util');
const { DEFAULT_MAX_SESSION_DURATION_SECS } = require('../../../endpoint/iam/iam_constants');

// Note: If the role with same name already exists for account/user in accounts schema,
// Script will skip the migration for that entry in account.role_config


/**
 * unwarp principle for Principal property
 *
 * @param {String[] | SensitiveString[]} principals 
 * @returns {String[]}
 */
function unwrap_principal(principals) {
    return principals.map(principal =>
        (principal instanceof SensitiveString ? principal.unwrap() : principal)
    );
}

async function run({ dbg, system_store, system_server }) {

    try {
        dbg.log0('Starting IAM role migration from account role_config entries...');
        const new_roles = [];
        const migrated_account_ids = [];

        for (const account of system_store.data.accounts) {
            //Do not update if there are no role_config.
            if (!account.role_config) continue;

            const role_config = account.role_config;
            const new_policy = {};

            const role_email = account_util.get_account_email_from_role_name(role_config.role_name, account._id.toString());
            const iam_role = system_store.get_account_by_email(role_email);
            if (iam_role) {
                dbg.log0(`IAM role with name ${role_config.role_name} already exists for account ${account._id.toString()}, Skipping the entry...`);
                continue;
            }

            if (role_config.assume_role_policy.version) new_policy.Version = role_config.assume_role_policy.version;
            new_policy.Statement = role_config.assume_role_policy.statement.map(statement => ({
                Effect: statement.effect === 'allow' ? 'Allow' : 'Deny',
                Action: statement.action,
                Principal: { AWS: unwrap_principal(statement.principal) },
                Sid: 'RoleMigration0'
            }));

            const max_session_duration = DEFAULT_MAX_SESSION_DURATION_SECS;
            const new_role = _.omitBy({
                _id: system_store.new_system_store_id(),
                identity_type: 'ROLE',
                owner: account._id,
                name: new SensitiveString(role_config.role_name),
                email: role_email,
                has_login: false,
                access_keys: [],
                iam_path: "/",
                description: "Migrated from account",
                max_session_duration: max_session_duration,
                assume_role_policy_document: new_policy,
                iam_inline_policies: [],
                creation_date: Date.now(),
            }, _.isUndefined);

            new_roles.push(new_role);
            migrated_account_ids.push(account._id);
        }

        if (new_roles.length > 0) {
            dbg.log0(`Migrating IAM role entries: ${new_roles.map(r => util.inspect(r)).join(', ')}`);
            await system_store.make_changes({
                insert: {
                    accounts: new_roles,
                },
                update: {
                    accounts: migrated_account_ids.map(account_id => ({
                        _id: account_id,
                        $unset: { role_config: 1 }
                    }))
                }
            });
        } else {
            dbg.log0('IAM role migration: no upgrade needed');
        }

    } catch (err) {
        dbg.error('Got error while migrating role policy:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Migrate IAM roles from account role_config entries'
};
