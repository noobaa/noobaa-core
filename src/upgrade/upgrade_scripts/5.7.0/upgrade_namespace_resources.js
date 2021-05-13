/* Copyright (C) 2016 NooBaa */
"use strict";

async function run({ dbg, system_store, system_server}) {
    try {
        dbg.log0('starting upgrade namespace resources...');
        const namespace_resources = system_store.data.namespace_resources
            .map(s => ({
                _id: s._id,
                $set: { 'namespace_store.need_k8s_sync': true }
            }));
        if (namespace_resources.length > 0) {
            dbg.log0(`adding need to sync flag for these namespace resources: ${namespace_resources.map(b => b._id).join(', ')}`);
            await system_store.make_changes({ update: { namespace_resources } });
        } else {
            dbg.log0('upgrade namespace resources: no upgrade needed...');
        }
    } catch (err) {
        dbg.error('got error while upgrading namespace resources:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Set need_k8s_sync for existing namespace resources to true'
};
