/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('./debug_module')(__filename);

const lance = require('@lancedb/lancedb');

class VectorConn {
    constructor({path}) {
        this.path = path;
        this.connected = false;
    }
}

class LanceConn extends VectorConn {

    constructor({path}) {
        super({path});
        this.tables = new Map();
    }

    async connect() {
        this.lance = await lance.connect(this.path);
        this.connected = true;
    }

    async create_vector_bucket() {
        //lance needs at least one vector in order to create a table,
        //defer to the first insert
    }

    async put_vectors(table_name, aws_vectors, is_retry = false) {

        dbg.log0("put_vectors table_name =", table_name, ", aws_vectors =", aws_vectors);

        const lance_vectors = [];
        for (const aws_vector of aws_vectors) {
            const lance_vector = {
                id: aws_vector.key,
                //see https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_VectorData.html
                vector: aws_vector.data.float32,
                ...aws_vector.metadata
            };
            lance_vectors.push(lance_vector);
        }
        dbg.log0("put_vectors lance_vectors =", lance_vectors);


        let table = await this.get_table(table_name);
        if (table) {
            dbg.log("put_vectors table found in memory");
            await table.add(lance_vectors);
        } else {
            dbg.log0("put_vectors create table");
            try {
                table = await this.lance.createTable(table_name, lance_vectors);
            } catch (e) {
                //can happen for two concurrent inserts
                if (e.message.contains("has already been declared") && !is_retry) {
                    await this.put_vectors(table_name, lance_vectors, true);
                }
            }
            this.tables.set(table_name, table);
        }
    }

    async list_vectors(table_name, limit) {
        dbg.log0("list_vectors table_name =", table_name, ", limit =", limit);

        const table = await this.get_table(table_name);
        //TODO - check if(!table)
        const query = table.query();
        if (limit) query.limit(limit);
        //TODO - this won't work for large tables.
        //support aws segments/tokens?
        const lance_res = await query.toArray();
        dbg.log0("list_vectors lance_res =", lance_res);
        const aws_vectors = [];
        for (const lance_vector of lance_res) {
            //convert lance -> aws
            const metadata = {};
            for (const kv of [...lance_vector]) {
                if (kv[0] === 'id' || kv[0] === 'vector') continue;
                metadata[kv[0]] = kv[1];
            }
            const aws_vector = {
                key: lance_vector.id,
                data: {float32: Array.from(lance_vector.vector) },
                metadata
            };

            aws_vectors.push(aws_vector);
        }
        dbg.log0("list_vectors aws_vectors =", aws_vectors);
        return {vectors: aws_vectors};
    }

    async get_table(name) {
        let table = this.tables.get(name);
        if (table) return table;
        try {
            table = await this.lance.openTable(name);
            this.tables.set(name, table);
        } catch (e) {
            //ignore errors, at least for now
        }
        return null;
    }
}

//temporary static lance connection to work with
//TODO - a way to get a connection from some new parameter in account?
const lanceConn = new LanceConn({ path: "/tmp/lance" });

async function getVecorConn(vectorConnId) {
    if (!lanceConn.connected) {
        await lanceConn.connect();
    }
    return lanceConn;
}

async function create_fs_db(path = '/tmp/lance') {
    const db = await lance.connect(path);
    return db;
}

async function create_vector_bucket({vector_bucket_name}) {
    dbg.log0("create_vector_bucket vector_bucket_name = ", vector_bucket_name);
    const vc = await getVecorConn();
    await vc.create_vector_bucket();
    dbg.log0("create_vector_bucket done");
}

async function put_vectors({vector_bucket_name, vectors}) {
    dbg.log0("put_vectors =", vector_bucket_name, ", vectors =", vectors);
    const vc = await getVecorConn();
    await vc.put_vectors(vector_bucket_name, vectors);
    dbg.log0("put_vectors done");
}

async function list_vectors({vector_bucket_name, max_results}) {
    dbg.log0("list_vectors =", vector_bucket_name, ", max_results =", max_results);
    const vc = await getVecorConn();
    return await vc.list_vectors(vector_bucket_name, max_results);
}

async function main() {
    const db = await create_fs_db();
    console.log("db =", db);

    const table = await db.createTable("my_table", [
        { id: 1, vector: [0.1, 1.0], item: "foo", price: 10.0 },
        { id: 2, vector: [3.9, 0.5], item: "bar", price: 20.0 },
    ]);
    const results = await table.vectorSearch([0.1, 0.3]).limit(20).toArray();
    console.log("results =", results);

    return 0;
}

exports.main = main;
exports.create_vector_bucket = create_vector_bucket;
exports.put_vectors = put_vectors;
exports.list_vectors = list_vectors;

if (require.main === module) main();
