/* Copyright (C) 2026 NooBaa */
"use strict";

const config = require('../../../../config');
const time_utils = require('../../../util/time_utils');
const object_md_indexes = require('../../../server/object_services/schemas/object_md_indexes');
const db_client_mod = require('../../../util/db_client');
const { build_create_index_sql } = require('../../../util/postgres_client');

const INDEX_NAMES = object_md_indexes.RESTORE_TRANSITION_INDEX_NAMES;

async function run({ dbg, db_client = db_client_mod, table_name = 'objectmds' }) {
    try {
        if (config.OBJECTMDS_RESTORE_TRANSITION_INDEXES_ENABLED !== true) {
            dbg.log0('Skipping objectmds restore/transition index creation (OBJECTMDS_RESTORE_TRANSITION_INDEXES_ENABLED=false)');
            return;
        }
        const millistamp = time_utils.millistamp();

        const indexes = object_md_indexes.filter(index => index.options?.name && INDEX_NAMES.has(index.options.name));
        if (indexes.length !== INDEX_NAMES.size) {
            throw new Error(
                `expected ${INDEX_NAMES.size} restore/transition indexes, found ${indexes.length}`
            );
        }
        const pool = db_client.instance().get_pool();
        const results = await Promise.allSettled(indexes.map(index => {
            const idx_str = build_create_index_sql(table_name, index);
            dbg.log0('create_objectmds_restore_transition_indexes: Creating index:', idx_str);
            return pool.query(idx_str);
        }));
        const failures = results
            .filter(result => result.status === 'rejected' && result.reason.code !== '42P07')
            .map(result => result.reason);
        if (failures.length) {
            throw new Error(
                `Failed creating objectmds restore_status_index / transition_info_index: ${failures.map(f => f.message).join('; ')}`,
                { cause: failures }
            );
        }
        dbg.log0('Executed upgrade script for creating objectmds restore/transition indexes', 'took', time_utils.millitook(millistamp));
    } catch (err) {
        dbg.error('Failed creating objectmds restore_status_index / transition_info_index:', err);
        throw err;
    }
}

module.exports = {
    run,
    description: 'Create objectmds restore_status_index and transition_info_index',
};
