/* Copyright (C) 2025 NooBaa */
"use strict";

async function run({ dbg, db_client }) {
  /* After the index is dropped, a new composite index (system, bucket, dedup_key) 
    will be created during bootstrap */
  const indexName = 'idx_btree_datachunks_dedup_key';

  try {
    const pool = db_client.instance().get_pool();
    await pool.query(`DROP INDEX IF EXISTS ${indexName};`);

    dbg.log0("Executed upgrade script for dropping index ", indexName);
  } catch (err) {
    dbg.error('An error ocurred in the upgrade process:', err);
    throw err;
  }
}

module.exports = {
  run,
  description: 'Delete the "idx_btree_datachunks_dedup_key" index'
};
