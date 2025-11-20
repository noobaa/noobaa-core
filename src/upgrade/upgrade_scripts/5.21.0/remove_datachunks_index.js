/* Copyright (C) 2025 NooBaa */
"use strict";

/**
 * Drop the database index named "idx_btree_datachunks_dedup_key" if it exists.
 *
 * Executes the DROP INDEX operation against the connected database, logs success,
 * and rethrows any error after logging it.
 *
 * @param {{dbg: object, db_client: object}} args - Utilities required to perform the upgrade: a logger (`dbg`) and a database client (`db_client`).
 * @throws {Error} Re-throws any error encountered while executing the DROP INDEX statement.
 */
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