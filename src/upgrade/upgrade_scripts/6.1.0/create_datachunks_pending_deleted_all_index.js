/* Copyright (C) 2026 NooBaa */
"use strict";

const time_utils = require('../../../util/time_utils');
const data_chunk_indexes = require('../../../server/object_services/schemas/data_chunk_indexes');
const db_client_mod = require('../../../util/db_client');
const { build_create_index_sql } = require('../../../util/postgres_client');

const INDEX_NAMES = ['pending_deleted_all', 'deleted'];

async function run({ dbg, db_client = db_client_mod, table_name = 'datachunks' }) {
    const millistamp = time_utils.millistamp();
    for (const index_name of INDEX_NAMES) {
        const index = data_chunk_indexes.find(entry => entry.options?.name === index_name);
        if (!index) {
            throw new Error(`datachunks index ${index_name} is not defined in data_chunk_indexes`);
        }
        const idx_str = build_create_index_sql(table_name, index);
        dbg.log0('create_datachunks_pending_deleted_all_index: Creating index:', idx_str);
        try {
            await db_client.instance().executeSQL(idx_str, [], { preferred_pool: 'md' });
        } catch (err) {
            if (err.code !== '42P07') throw err; //ignore already-exists
        }
    }
    dbg.log0('Executed upgrade script for creating datachunks pending_deleted_all and deleted indexes',
        'took', time_utils.millitook(millistamp));
}

module.exports = {
    run,
    description: 'Create datachunks pending_deleted_all and idx_btree_datachunks_deleted indexes',
};
