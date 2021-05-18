/* Copyright (C) 2016 NooBaa */
"use strict";
const util = require('util');

async function run({ dbg, system_store, system_server}) {

    try {
        dbg.log0('starting upgrade namespace buckets...');
        const namespace_buckets = system_store.data.buckets
            .map(s => (s.namespace && {
                _id: s._id,
                $set: { 'namespace': {
                    read_resources: s.namespace.read_resources.map(nsr => ({'resource': nsr._id })),
                    write_resource: ({'resource': s.namespace.write_resource._id }),
                    caching: s.namespace.caching
                } }
            }))
            .filter(bucket => bucket);
        if (namespace_buckets.length > 0) {
            dbg.log0(`adding new namespace_bucket structure for these namespace buckets: ${namespace_buckets.map(b => util.inspect(b)).join(', ')}`);
            await system_store.make_changes({ update: { buckets: namespace_buckets } });
        } else {
            dbg.log0('upgrade namespace buckets: no upgrade needed...');
        }
    } catch (err) {
        dbg.error('got error while upgrading namespace buckets:', err);
        throw err;
    }

}
module.exports = {
    run,
    description: 'Update namespace bucket structure'
};