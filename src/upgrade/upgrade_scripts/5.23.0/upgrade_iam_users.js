/* Copyright (C) 2026 NooBaa */
"use strict";

async function run({ dbg, system_store, system_server }) {
    try {
        dbg.log0('Starting IAM user policy field migration...');
        const migrated_accounts = [];

        for (const account of system_store.data.accounts) {
            if (account.iam_user_policies === undefined) continue;
            const update = {
                _id: account._id,
                $unset: { iam_user_policies: 1 },
            };
            if (account.iam_inline_policies === undefined) {
                update.$set = { iam_inline_policies: account.iam_user_policies };
            }
            migrated_accounts.push(update);
        }

        if (migrated_accounts.length > 0) {
            await system_store.make_changes({
                update: {
                    accounts: migrated_accounts
                }
            });
        } else {
            dbg.log0('IAM user policy migration: no upgrade needed');
        }
    } catch (err) {
        dbg.error('Got error while migrating IAM user policy field:', err);
        throw err;
    }
}

module.exports = {
    run,
    description: 'Migrate legacy iam_user_policies to iam_inline_policies'
};
