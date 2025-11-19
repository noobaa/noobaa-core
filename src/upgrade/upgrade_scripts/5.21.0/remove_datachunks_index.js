/* Copyright (C) 2025 NooBaa */
"use strict";

async function run({ dbg, db_client }) {
  const indexName = 'idx_btree_datachunks_dedup_key';

  try {
    const pool = db_client.instance().get_pool();
    await pool.query(`DROP INDEX IF EXISTS ${indexName};`);

    dbg.log2("Executed upgrade script for dropping index ", indexName);
  } catch (err) {
    dbg.error('An error ocurred in the upgrade process:', err);
    throw err;
  }
}

module.exports = {
  run,
  description: 'Delete the "idx_btree_datachunks_dedup_key" index'
};
