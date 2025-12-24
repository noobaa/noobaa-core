/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('./debug_module')(__filename);
const SystemStore = require('../server/system_services/system_store');

const lance = require('@lancedb/lancedb');

class VectorConn {
    constructor(connOpts) {
        this.connOpts = connOpts;
        this.connected = false;
    }
}

class LanceConn extends VectorConn {

    constructor(connOpts) {
        super(connOpts);
        this.tables = new Map();
    }

    async connect() {
        this.lance = await lance.connect(this.connOpts.path, this.connOpts.opts);
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
                if (e.message.indexOf("has already been declared") > -1 && !is_retry) {
                    return await this.put_vectors(table_name, lance_vectors, true);
                } else {
                    dbg.error("Failed to create table ", table_name, e);
                    throw e;
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
        const aws_vectors = Array.from(lance_res, lance_vector => this._lance_to_aws(lance_vector));
        dbg.log0("list_vectors aws_vectors =", aws_vectors);
        return {vectors: aws_vectors};
    }

    async query_vectors(table_name, query_vector, limit, return_metadata, return_distance) {
        dbg.log0("query_vectors table_name =", table_name, ", limit =", query_vector);

        const table = await this.get_table(table_name);
        //TODO - check if(!table)
        const query = table.vectorSearch(query_vector).limit(limit);
        const lance_res = await query.toArray();
        dbg.log0("query_vectors lance_res =", lance_res);
        const aws_vectors = Array.from(lance_res, lance_vector => this._lance_to_aws(lance_vector, return_metadata, return_distance));
        dbg.log0("query_vectors aws_vectors =", aws_vectors);
        return {vectors: aws_vectors}; //TODO - return distance metric?
    }

    async delete_vectors(table_name, ids) {
        dbg.log0("delete_vectors table_name =", table_name, ", ids =", ids);

        const table = await this.get_table(table_name);
        //TODO - check !table
        const res = await table.delete('id in (' + ids.map(id => "'" + id + "'").join(',') + ')');
        dbg.log0("delete_vectors res =", res);
        return res;
    }

    _lance_to_aws(lance_vector, return_metadata, return_distance) {
        const aws_vector = {
            key: lance_vector.id,
            data: {float32: Array.from(lance_vector.vector) }
        };
        if (return_metadata) {
            const metadata = {};
            for (const kv of [...lance_vector]) {
                if (kv[0] === 'id' || kv[0] === 'vector' || kv[0] === '_distance') continue;
                metadata[kv[0]] = kv[1];
            }
            aws_vector.metadata = metadata;
        }
        if (return_distance) {
            aws_vector.distance = lance_vector._distance;
        }
        return aws_vector;
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
//const lanceConn = new LanceConn({ path: "/tmp/lance" });

function get_lance_opts() {
//const lanceConn = new LanceConn({path: "s3://lance", opts: {
    return {
        storageOptions: {
            awsAccessKeyId: SystemStore.get_instance().data.accounts_by_email['admin@noobaa.io'].access_keys[0].access_key.unwrap(),
            awsSecretAccessKey: SystemStore.get_instance().data.accounts_by_email['admin@noobaa.io'].access_keys[0].secret_key.unwrap(),
            endpoint: "http://localhost:6001",
            allowHttp: "true"
        },
    };
}

let lanceConn;

async function getVecorConn(vectorConnId) {

    if (!lanceConn) {
        lanceConn = new LanceConn({
            path: "s3://lance",
            opts: get_lance_opts()
        });
    }
    if (!lanceConn.connected) {
        await lanceConn.connect();
    }
    return lanceConn;
}

async function create_fs_db(path = '/tmp/lance') {
    const db = await lance.connect(path);
    return db;
}

async function create_vector_bucket({name}) {
    dbg.log0("create_vector_bucket name = ", name);
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

async function query_vectors({vector_bucket_name, query_vector, topk, return_metadata, return_distance}) {
    dbg.log0("query_vectors =", vector_bucket_name, ", query_vector =", query_vector);
    const vc = await getVecorConn();
    return await vc.query_vectors(vector_bucket_name, query_vector.float32, topk, return_metadata, return_distance);
}

async function delete_vectors({vector_bucket_name, keys}) {
    dbg.log0("delete_vectors =", vector_bucket_name, ", keys =", keys);
    const vc = await getVecorConn();
    return await vc.delete_vectors(vector_bucket_name, keys);
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
exports.query_vectors = query_vectors;
exports.delete_vectors = delete_vectors;

if (require.main === module) main();
