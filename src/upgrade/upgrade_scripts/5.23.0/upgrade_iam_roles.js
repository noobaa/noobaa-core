/* Copyright (C) 2023 NooBaa */
"use strict";

const util = require('util');
const _ = require('lodash');

const SensitiveString = require('../../../util/sensitive_string');
const { DEFAULT_MAX_SESSION_DURATION_SECS } = require('../../../endpoint/iam/iam_constants');

// Note: If the role with same already exists in iam_role schema, 
//      Script will skip the migration for that entry in account.role_config


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
        dbg.log0('Starting migration of roles from account schema to role schema...');
        const new_roles = [];
        const migrated_account_ids = [];

        for (const account of system_store.data.accounts) {
            //Do not update if there are no role_config.
            if (!account.role_config) continue;

            const role_config = account.role_config;
            const new_policy = {};

            const iam_role = system_store.data.iam_roles.find(
                role => role.name === role_config.role_name &&
                role.owner._id.toString() === account._id.toString()
            );
            if (iam_role) {
                dbg.log0(`IAM role with name ${role_config.role_name} already exists, Skipping the entry...`);
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
                owner: account._id,
                name: role_config.role_name,
                iam_path: "/",
                description: "Migrated from account",
                max_session_duration: max_session_duration,
                assume_role_policy_document: new_policy,
                iam_role_policies: [],
                creation_date: Date.now(),
            }, _.isUndefined);

            new_roles.push(new_role);
            migrated_account_ids.push(account._id);
        }

        if (new_roles.length > 0) {
            dbg.log0(`Migrate roles from account to role schema ${new_roles.map(r => util.inspect(r)).join(', ')}`);
            await system_store.make_changes({
                insert: {
                    iam_roles: new_roles,
                },
                update: {
                    accounts: migrated_account_ids.map(account_id => ({
                        _id: account_id,
                        $unset: { role_config: 1 }
                    }))
                }
            });
        } else {
            dbg.log0('Migration of roles from account schema to role schema: no upgrade needed...');
        }

    } catch (err) {
        dbg.error('Got error while migrating role policy:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Migrate roles from account to role schema'
};
