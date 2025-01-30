/* Copyright (C) 2023 NooBaa */
"use strict";

const util = require('util');
const config = require('../../../../config.js');

async function run({ dbg, system_store }) {

    try {
        dbg.log0('Starting bucket CORS upgrade...');
        const buckets = system_store.data.buckets
            .map(bucket => ({
                _id: bucket._id,
                cors_configuration_rules: [{
                    allowed_origins: config.S3_CORS_ALLOW_ORIGIN,
                    allowed_methods: config.S3_CORS_ALLOW_METHODS,
                    allowed_headers: config.S3_CORS_ALLOW_HEADERS,
                    expose_headers: config.S3_CORS_EXPOSE_HEADERS,
                }],
            }));

        if (buckets.length > 0) {
            dbg.log0(`Adding default bucket CORS configuration to: ${buckets.map(bucket => util.inspect(bucket)).join(', ')}`);
            await system_store.make_changes({ update: { buckets } });
        } else {
            dbg.log0('Upgrading buckets CORS configuration: no upgrade needed...');
        }

    } catch (err) {
        dbg.error('Got error while upgrading buckets CORS configuration:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Update default CORS configuration for all buckets',
};
