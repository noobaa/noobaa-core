/* Copyright (C) 2025 NooBaa */
"use strict";

async function run({ dbg, system_store }) {
    try {
        dbg.log0('starting remove mongo_upgrade from systems...');
        const systems = system_store.data.systems
            .map(s => Object.hasOwn(s, 'mongo_upgrade') && ({
                _id: s._id,
                $unset: { mongo_upgrade: true }
            }))
            .filter(Boolean);
        if (systems.length > 0) {
            dbg.log0(`removing "mongo_upgrade" from systems: ${systems.map(s => s._id).join(', ')}`);
            await system_store.make_changes({ update: { systems } });
        } else {
            dbg.log0('remove mongo_upgrade: no upgrade needed...');
        }
    } catch (err) {
        dbg.error('got error while removing mongo_upgrade from systems:', err);
        throw err;
    }
}

module.exports = {
    run,
    description: 'Remove mongo_upgrade field from systems'
};
