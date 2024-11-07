/* Copyright (C) 2023 NooBaa */
"use strict";

const util = require('util');
const { OP_NAME_TO_ACTION } = require('../../../endpoint/s3/s3_bucket_policy_utils');
const _ = require('lodash');


function _create_actions_map() {
    const actions_map = new Map();
    for (const action of Object.values(OP_NAME_TO_ACTION)) {
        if (Array.isArray(action.regular)) {
            // API's with array actions were added after version 5.15.z (e.g get_object_attributes)
            // we skip this because there were no policies to fix
            continue;
        }
        actions_map.set(action.regular.toLowerCase(), action.regular);
        if (action.versioned) {
            actions_map.set(action.versioned.toLowerCase(), action.versioned);
        }
    }
    actions_map.set('s3:*', 's3:*');
    return actions_map;
}

async function run({ dbg, system_store, system_server }) {

    try {
        dbg.log0('Starting bucket policy upgrade...');
        const buckets = [];
        const actions_map = _create_actions_map();
        for (const bucket of system_store.data.buckets) {
            //Do not update if there are no bucket policy.
            if (!bucket.s3_policy) continue;


            if (_.isUndefined(bucket.s3_policy.Statement)) {
                const new_policy = {};
                if (bucket.s3_policy.version) new_policy.Version = bucket.s3_policy.version;
                new_policy.Statement = bucket.s3_policy.statement.map(statement => ({
                    Effect: statement.effect === 'allow' ? 'Allow' : 'Deny',
                    Action: statement.action.map(action => actions_map.get(action)),
                    Principal: { AWS: statement.principal },
                    Resource: statement.resource,
                    Sid: statement.sid
                }));
                buckets.push({
                    _id: bucket._id,
                    s3_policy: new_policy,
                });
            }
        }

        if (buckets.length > 0) {
            dbg.log0(`Replacing bucket policy rules to the new API structure for buckets: ${buckets.map(bucket => util.inspect(bucket)).join(', ')}`);
            await system_store.make_changes({ update: { buckets } });
        } else {
            dbg.log0('Upgrading buckets policy: no upgrade needed...');
        }

    } catch (err) {
        dbg.error('Got error while upgrading buckets policy:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Update bucket policy to new API format'
};
