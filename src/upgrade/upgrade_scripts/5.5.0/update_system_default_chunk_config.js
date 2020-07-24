/* Copyright (C) 2016 NooBaa */
"use strict";

async function run({ dbg, system_store }) {
    try {
        const systems = system_store.data.systems
            .filter(s => s.default_chunk_config)
            .map(s => ({
                _id: s._id,
                $unset: { default_chunk_config: true }
            }));
        if (systems.length > 0) {
            dbg.log0(`removing default_chunk_config to these systems: ${systems.map(b => b._id).join(', ')}`);
            await system_store.make_changes({ update: { systems } });
        } else {
            dbg.log0('there are no systems that need default_chunk_config removal');
        }
    } catch (err) {
        dbg.error('got error while removing default_chunk_config for systems:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Unsets the default_chunk_config field for all systems'
};
