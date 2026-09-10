/* Copyright (C) 2026 NooBaa */
"use strict";

const { MDStore, is_restore_transition_indexes_enabled } = require('../../../server/object_services/md_store');
const object_md_indexes = require('../../../server/object_services/schemas/object_md_indexes');

const NEW_OBJECTMD_INDEX_NAMES = new Set(['restore_status_index', 'transition_info_index']);

async function run({ dbg }) {
    try {
        if (!is_restore_transition_indexes_enabled()) {
            dbg.log0('Skipping objectmds restore/transition index creation (OBJECTMDS_RESTORE_TRANSITION_INDEXES_ENABLED=false)');
            return;
        }
        const objects = MDStore.instance()._objects;
        const pool = objects.get_pool();
        const indexes = object_md_indexes.filter(index => NEW_OBJECTMD_INDEX_NAMES.has(index.options && index.options.name));
        await Promise.all(indexes.map(index => objects._create_db_index(index, pool)));
        dbg.log0('Executed upgrade script for creating objectmds restore/transition indexes');
    } catch (err) {
        dbg.error('Failed creating objectmds restore_status_index / transition_info_index:', err);
        throw err;
    }
}

module.exports = {
    run,
    description: 'Create objectmds restore_status_index and transition_info_index'
};
