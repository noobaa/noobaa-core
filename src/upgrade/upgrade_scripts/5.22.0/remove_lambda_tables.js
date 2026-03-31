/* Copyright (C) 2025 NooBaa */
"use strict";

const TABLES_TO_DROP = ['funcs', 'func_stats'];

async function run({ dbg, db_client }) {
    try {
        const pool = db_client.instance().get_pool();

        for (const table of TABLES_TO_DROP) {
            try {
                const res = await pool.query(`SELECT COUNT(*) AS cnt FROM ${table}`);
                dbg.log0(`remove_lambda_tables: table "${table}" has ${res.rows[0].cnt} rows before drop`);
            } catch (err) {
                if (err.code === '42P01') { // undefined_table
                    dbg.log0(`remove_lambda_tables: table "${table}" does not exist, skipping`);
                } else {
                    throw err;
                }
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const table of TABLES_TO_DROP) {
                dbg.log0(`remove_lambda_tables: dropping table "${table}"`);
                await client.query(`DROP TABLE IF EXISTS ${table}`);
            }
            await client.query('COMMIT');
            dbg.log0('remove_lambda_tables: successfully dropped lambda tables');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        dbg.error('remove_lambda_tables: failed to drop lambda tables:', err);
        throw err;
    }
}

module.exports = {
    run,
    description: 'Drop the funcs and func_stats tables (lambda support removed)'
};
