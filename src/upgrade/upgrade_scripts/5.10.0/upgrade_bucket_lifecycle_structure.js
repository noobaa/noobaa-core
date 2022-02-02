/* Copyright (C) 2016 NooBaa */
"use strict";

const util = require('util');

async function run({ dbg, system_store, system_server }) {

    try {
        dbg.log0('Starting upgrade lifecycle...');
        const buckets = [];

        for (const bucket of system_store.data.buckets) {
            //Do not update if there are no lifecycle_configuration_rules.
            if (!bucket.lifecycle_configuration_rules) return;

            const new_rules = bucket.lifecycle_configuration_rules.map(lifecycle_configuration_rules => ({
                id: lifecycle_configuration_rules.id,
                filter: { prefix: lifecycle_configuration_rules.prefix },
                status: lifecycle_configuration_rules.status,
                expiration: lifecycle_configuration_rules.expiration,
                //those field can be undefined and it will be filtered out in the make_changes update.
                abort_incomplete_multipart_upload: lifecycle_configuration_rules.abort_incomplete_multipart_upload,
                transition: lifecycle_configuration_rules.transition,
                noncurrent_version_expiration: lifecycle_configuration_rules.noncurrent_version_expiration,
                noncurrent_version_transition: lifecycle_configuration_rules.noncurrent_version_transition,
            }));

            buckets.push({
                _id: bucket._id,
                lifecycle_configuration_rules: new_rules,
            });
        }

        if (buckets.length > 0) {
            dbg.log0(`Replacing lifecycle rules to the new API structure for buckets: ${buckets.map(bucket => util.inspect(bucket)).join(', ')}`);
            await system_store.make_changes({ update: { buckets } });
        } else {
            dbg.log0('Upgrading buckets lifecycle: no upgrade needed...');
        }

    } catch (err) {
        dbg.error('Got error while upgrading buckets lifecycle:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Update lifecycle rules to the new API structure'
};
