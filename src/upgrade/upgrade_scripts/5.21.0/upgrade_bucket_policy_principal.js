/* Copyright (C) 2023 NooBaa */
"use strict";

const iam_constants = require('../../../endpoint/iam/iam_constants');

function _create_arn(dbg, principals, system_store) {
    if (!principals.AWS) return;
    const principal_arns = [];
    for (const principal of principals.AWS) {
        if (principal === '*') continue;
        const account = system_store.data.accounts.find(acc => acc.email.unwrap() === principal.unwrap());
        if (!account) {
            dbg.log0(`Could not find the account with email: ${principal}`);
            continue;
        }
        let arn;
        if (account.owner) {
            const iam_path = account.iam_path || iam_constants.IAM_DEFAULT_PATH;
            arn = `arn:aws:iam::${account._id.toString()}:user${iam_path}${account.email.unwrap()}`;
        } else {
            arn = `arn:aws:iam::${account._id.toString()}:root`;
        }
        principal_arns.push(arn);
    }
    return { AWS: principal_arns };
}

async function run({ dbg, system_store, system_server }) {
    try {
        dbg.log0('Starting bucket policy Principal upgrade...');
        const buckets = [];
        for (const bucket of system_store.data.buckets) {
            // Do not update if there are no bucket policy.
            if (!bucket.s3_policy) continue;
            if (bucket.s3_policy.Statement !== undefined) {
                const new_policy = bucket.s3_policy;
                new_policy.Statement = bucket.s3_policy.Statement.map(statement => ({
                    ...statement,
                    Principal: _create_arn(dbg, statement.Principal, system_store),
                }));
                buckets.push({
                    _id: bucket._id,
                    s3_policy: new_policy,
                });
            }
        }

        if (buckets.length > 0) {
            dbg.log0(`Replacing bucket policy Principal for ${buckets.length} buckets.`);
            await system_store.make_changes({ update: { buckets } });
        } else {
            dbg.log0('Upgrading buckets policy Principal: no upgrade needed...');
        }

    } catch (err) {
        dbg.error('Got error while upgrading buckets policy Principal:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Update bucket policy Principal to ARN format'
};
