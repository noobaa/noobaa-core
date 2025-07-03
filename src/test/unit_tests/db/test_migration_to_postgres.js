/* Copyright (C) 2016 NooBaa */
'use strict';

// TODO: Should implement the test

// const { PostgresClient } = require('../../util/postgres_client');
const mongo_client = require('../../util/mongo_client');
const { Pool } = require('pg');
const _ = require('lodash');


const POSTGRES_PARAMS = {
    host: 'postgres',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres'
};

const pool = new Pool(POSTGRES_PARAMS);



// const _objects = PostgresClient.instance().define_table({
//     name: 'objectmds',
// });
// const _multiparts = PostgresClient.instance().define_table({
//     name: 'objectmultiparts',
// });
// const _parts = PostgresClient.instance().define_table({
//     name: 'objectparts',
// });
// const _chunks = PostgresClient.instance().define_table({
//     name: 'datachunks',
// });
// const _blocks = PostgresClient.instance().define_table({
//     name: 'datablocks',
// });
// const _sequences = PostgresClient.instance().define_table({
//     name: 'mdsequences',
// });

const batch_size = 100;


async function migrate_collection(col_name) {
    console.log(`DZDZ: migrating ${col_name}`);
    const client = await pool.connect();
    const col = mongo_client.instance().collection(col_name);
    await client.query(`CREATE TABLE IF NOT EXISTS ${col_name} (_id char(24) PRIMARY KEY, data jsonb )`);
    let done = false;
    let marker;
    let total = 0;
    while (!done) {
        const docs = await col.find({ _id: marker ? { $gt: marker } : undefined }, { limit: batch_size });
        if (docs.length > 0) {
            const rows = docs.map(doc => ({ _id: doc._id.toString(), data: doc }));
            const values_str = _.times(docs.length, n => `($${(n * 2) + 1}, $${(n * 2) + 2})`).join(', ');
            const values = _.flatMap(rows, row => _.map(row, k => k));
            const text = `INSERT INTO ${col_name} (_id, data) VALUES ${values_str}`;
            await client.query({ text, values });
            total += docs.length;
            console.log(`DZDZ: migrated ${total} documents to table ${col_name}`);
            marker = docs[docs.length - 1]._id;
        } else {
            done = true;
        }
    }
    console.log(`DZDZ: completed migration of ${total} documents to table ${col_name}`);
}


async function main() {
    await mongo_client.instance().connect();
    await migrate_collection('objectmds');
    await migrate_collection('objectmultiparts');
    await migrate_collection('objectparts');
    await migrate_collection('datachunks');
    await migrate_collection('datablocks');
    await migrate_collection('mdsequences');
    process.exit(0);
}


main();
