/* Copyright (C) 2021 NooBaa */
"use strict";

const util = require('util');

// The following upgrade process will do the following:
// 1. update non null versions of an object with deleted = new Date()
// 2. drop the current index - idx_btree_objectmds_null_version_index

// idx_btree_objectmds_null_version_index postgres index is incorrect since 
// postgres considers nulls as distinct, causes multiple latest versions of objectmds to be allowed
// recreation of the index is being handled lazily in md_store constructor
async function run({ dbg, db_client }) {
    let pg_client;
    try {
        if (process.env.DB_TYPE !== 'postgres') {
            dbg.log0('upgrade postgres objectmds null version index: not running on postgres - no upgrade needed...');
            return;
        }
        dbg.log0('starting upgrade version null on non null object versions...');

        const select_query = `SELECT 
            data->>'bucket' as bucket,
            data->>'key' as key,
            jsonb_agg(jsonb_build_object('seq', data->'version_seq', '_id', _id)) as versions
            FROM objectmds
            WHERE ((data -> 'deleted'::text) IS NULL OR (data -> 'deleted'::text) = 'null'::jsonb)
            AND ((data -> 'upload_started'::text) IS NULL OR (data -> 'upload_started'::text) = 'null'::jsonb)
            AND ((data -> 'version_enabled'::text) IS NULL OR (data -> 'version_enabled'::text) = 'null'::jsonb)
            GROUP BY 1,2
            HAVING count(*) > 1;`;

        pg_client = await db_client.instance().pool.connect();
        const batch_handler = async rows => {
            dbg.log0(`upgrade_objectmds: found: ', ${rows.length} rows to update`, util.inspect(rows, { depth: null }));

            // create an array of db ids of non latest version ids (not max seq)
            const non_max_seq_ids = [];
            for (let row of rows) {
                let max_seq = 0;
                // calc max seq per key and bucket
                for (const version of row.versions) {
                    max_seq = max_seq > version.seq ? max_seq : version.seq;
                }
                // filter max seq out
                for (const version of row.versions) {
                    if (version.seq !== max_seq) {
                        non_max_seq_ids.push(version._id.toString());
                    }
                }
            }

            dbg.log0('updating the following ids:', util.inspect(non_max_seq_ids, { depth: null }));
            const deleted_date = new Date();
            // update in db the non latest version ids with deleted = new Date()
            let update_q = `UPDATE objectmds 
                SET data = jsonb_set(data, '{deleted}','${JSON.stringify(deleted_date)}'::jsonb) 
                WHERE _id in ( '${non_max_seq_ids.join(`','`)}' );`;

            const res = await db_client.instance().sql_query(pg_client, update_q);
            dbg.log0(`upgrade_objectmds: finished updating: ', ${res.rowCount} successfully`, res);
        };

        await db_client.instance().sql_query_batch(select_query, undefined, 10, batch_handler);
        dbg.log0('upgrade_objectmds: finished updating all non null versions with deleted = new Date()');

        // 2. drop index
        const index_short_name = `null_version_index;`;
        // Do not use direclty objectmds collection of db_client 
        // so it won't create schema changes here
        const drop_res = await db_client.instance().drop_index(pg_client, 'objectmds', index_short_name);
        dbg.log0('upgrade_objectmds: dropped index successfully', drop_res);
        dbg.log0('upgrade_objectmds: finished successfully');

    } catch (err) {
        dbg.error('upgrade_objectmds:got error while upgrading buckets version enabled:', err);
        throw err;
    } finally {
        if (pg_client) pg_client.release();
    }
}


module.exports = {
    run,
    description: 'Update objectmds version_enabled for non null version'
};