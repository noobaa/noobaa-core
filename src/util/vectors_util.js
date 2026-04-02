/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('./debug_module')(__filename);
const config = require('../../config');

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

    create_vector_bucket() {
        //nothing to do in lance
    }

    async delete_vector_bucket(table_name) {
        //nothing to do in lance
    }


    create_vector_index() {
        //lance needs at least one vector in order to create a table,
        //defer to the first insert
    }

    get_vector_index() {
        //nothing to do in lance
    }

    async delete_vector_index(vector_bucket, vector_index) {
        const table_name = vector_bucket + "_" + vector_index;
        dbg.log0("delete_vector_index table_name =", table_name);
        try {
            await this.lance.dropTable(table_name);
        } catch (e) {
            dbg.log1("drop table error =", e);
            //swallow bucket not found errors. it's possible lance table was never created
            if (e.message.indexOf('bucket does not exist') === -1) {
                throw e;
            }
        }
        this.tables.delete(table_name);
        dbg.log0("delete_vector_index done table_name =", table_name);

    }

    async put_vectors(vector_bucket_name, vector_index, vectors, is_retry = false) {

        dbg.log0("put_vectors vector_bucket =", vector_bucket_name, ", vector_index =", vector_index.name, ", vectors =", vectors);
        //note underscore is not allowed in vector bucket name
        const table_name = vector_bucket_name + "_" + vector_index.name;

        let lance_vectors;
        if (is_retry) {
            //already transformed aws vectors to lance format, can just use them
            lance_vectors = vectors;
        } else {
            //transofrm vectors format aws->lance
            lance_vectors = [];
            for (const aws_vector of vectors) {
                const lance_vector = {
                    id: aws_vector.key,
                    //see https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_VectorData.html
                    vector: aws_vector.data.float32,
                    ...aws_vector.metadata
                };
                lance_vectors.push(lance_vector);
            }
        }
        dbg.log0("put_vectors lance_vectors =", lance_vectors);

        let table = await this.get_table(table_name);
        if (table) {
            dbg.log("put_vectors table found in memory");
            await table.add(lance_vectors);
        } else {
            dbg.log0("put_vectors create table");
            try {
                table = await this._create_table(table_name, lance_vectors, vector_index);
            } catch (e) {
                //can happen for two concurrent inserts
                if (e.message.indexOf("has already been declared") > -1 && !is_retry) {
                    return await this.put_vectors(table_name, vector_index, lance_vectors, true);
                } else {
                    dbg.error("Failed to create table ", table_name, e);
                    throw e;
                }
            }
            this.tables.set(table_name, table);
        }

        try {
            await table.createIndex('vector', {replace: false});
        } catch (err) {
            //swallow 'not enougn rows', try again on next put_vectors
            if (!err.message.includes('Not enough rows') && !err.message.include("already exists")) {
                //failed to create vector index. revert so retry is possible.
                dbg.error("Failed to create vector index for", table_name, ", err =", err);
                this.lance.dropTable(table_name);
                throw err;
            }
        }
    }

    async list_vectors(params) {
        //dbg.log0("list_vectors vector_bucket =", vector_bucket, ", vector_index =", vector_index, ", limit =", limit);
        dbg.log0("lance list vectors params =", params);
        const table_name = params.vector_bucket_name + "_" + params.vector_index_name;

        const table = await this.get_table(table_name);
        //TODO - check if(!table)

        //determine this request place in the table
        if (!params.next_token) {
            //if there's no next_token, we're either in a segmented list_vector op or not segmented
            //for not-segmented, create a default dummy segment which will include all rows
            params.segment_count = params.segment_count || 1;
            params.segment_index = params.segment_index || 0;
            //now that we definitely have a segment, calc it's start and end for the given index
            const rows = await table.countRows();
            const segment = Math.floor(rows / params.segment_count); //total number of rows in a segment
            const start = segment * params.segment_index;
            //the last will pick up the remainder
            const end = (params.segment_index + 1 === params.segment_count) ? rows : (segment * (params.segment_index + 1));
            //continue as if we have next_token
            dbg.log0("rows = ", rows, ", segment = ", segment, ", start = ", start, ", end =", end);
            params.next_token = start + "_" + end;
        }

        //next_token syntax is currentOffset_endOfSegment
        const next_token_parts = params.next_token.split('_');
        const offset = Number(next_token_parts[0]);
        const end = Number(next_token_parts[1]);
        dbg.log0("lance list vectors offset =", offset, ", end =", end);

        const query = table.query();
        query.offset(offset);
        //limit can't get us over end
        const limit = offset + params.max_results >= end ? end - offset : params.max_results;
        query.limit(limit);
        const lance_res = await query.toArray();
        dbg.log0("list_vectors lance_res =", lance_res);
        const aws_vectors = Array.from(lance_res, lance_vector => this._lance_to_aws(lance_vector));
        dbg.log0("list_vectors aws_vectors =", aws_vectors);
        return {
            vectors: aws_vectors,
            //if there are more results in the segment, return the new next_token
            nextToken: offset + limit >= end ? undefined : (offset + limit) + "_" + end};
    }

    async query_vectors(vector_bucket, vector_index, query_vector, limit, return_metadata, return_distance) {
        dbg.log0("query_vectors vector_bucket =", vector_bucket, ", vector_index =", vector_index, ", query_vector =", query_vector, ", limit =", limit);
        const table_name = vector_bucket + "_" + vector_index;

        const table = await this.get_table(table_name);
        //TODO - check if(!table)
        const query = table.vectorSearch(query_vector).limit(limit);
        const lance_res = await query.toArray();
        dbg.log0("query_vectors lance_res =", lance_res);
        const aws_vectors = Array.from(lance_res, lance_vector => this._lance_to_aws(lance_vector, return_metadata, return_distance));
        dbg.log0("query_vectors aws_vectors =", aws_vectors);
        return {vectors: aws_vectors}; //TODO - return distance metric?
    }

    async delete_vectors(vector_bucket, vector_index, ids) {
        dbg.log0("delete_vectors vector_bucket =", vector_bucket, ", vector_index =", vector_index, ", ids =", ids);
        const table_name = vector_bucket + "_" + vector_index;

        const table = await this.get_table(table_name);
        //TODO - check !table
        // Escape single quotes in ids to prevent injection
        const escaped_ids = ids.map(id => "'" + String(id).replace(/'/g, "\\'") + "'");
        const res = await table.delete('id in (' + escaped_ids.join(',') + ')');
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
        dbg.log0("get_table name =", name);
        let table = this.tables.get(name);
        if (table) return table;
        dbg.log0("not in tables name =", name);
        try {
            table = await this.lance.openTable(name);
            this.tables.set(name, table);
        } catch (e) {
            dbg.log0("e = ", e);
            //ignore errors, at least for now
        }
        return table;
    }

    async _create_table(name, vectors, vector_index) {
        const table = await this.lance.createTable(name, vectors);

        const non_filterable_metadata_keys = vector_index?.metadata_configuration?.non_filterable_metadata_keys || [];
        //schema is implicitly defined by the first inserted vectors, get md fields from a vector
        const keys = Object.keys(vectors[0]);

        for (const key of keys) {
            //skip 'vector' field
            if (key === 'vector') continue;
            //skip non-filterable metadata keys (ie, fields which user explicitly asked not to index)
            if (non_filterable_metadata_keys.indexOf(key) > -1) continue;
            //md field is searchable and should be indexed:
            try {
                await table.createIndex(key);
            } catch (err) {
                //revert so retry is possible
                dbg.error("Failed to created index for", key, ", err =", err);
                this.lance.dropTable(name);
                throw err;
            }
        }

        return table;
    }
}

//temporary static lance connection to work with
//TODO - a way to get a connection from some new parameter in account?
//const lanceConn = new LanceConn({ path: "/tmp/lance" });

function get_lance_opts_s3() {

    const SystemStore = require('../server/system_services/system_store');

    if (!SystemStore.get_instance().data) {
        return;
    }

    const account = SystemStore.get_instance().data.accounts_by_email['admin@noobaa.io'] ||
                    SystemStore.get_instance().data.accounts_by_email['coretest@noobaa.com'];

    return {
        storageOptions: {
            awsAccessKeyId: account.access_keys[0].access_key.unwrap(),
            awsSecretAccessKey: account.access_keys[0].secret_key.unwrap(),
            endpoint: `http://localhost:${config.ENDPOINT_PORT}`,
            allowHttp: "true"
        },
    };
}

let lanceConn;

async function getVectorConn(vectorConnId) {

    const lance_s3_opts = get_lance_opts_s3();

    if (!lanceConn) {
        lanceConn = new LanceConn({
            path: lance_s3_opts ? "s3://lance" : '/tmp/lance',
            opts: lance_s3_opts
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
    const vc = await getVectorConn();
    await vc.create_vector_bucket();
    dbg.log0("create_vector_bucket done");
}

async function delete_vector_bucket({name}) {
    dbg.log0("delete_vector_bucket name = ", name);
    const vc = await getVectorConn();
    await vc.delete_vector_bucket(name);
    dbg.log0("delete_vector_bucket done");
}

async function create_vector_index(params) {
    dbg.log0("create index params =", params);
    const vc = await getVectorConn();
    await vc.create_vector_index(params);
}

async function delete_vector_index({vector_bucket_name, vector_index_name}) {
    dbg.log0("delete index vector_bucket_name =", vector_bucket_name, ", vector_index_name =", vector_index_name);
    const vc = await getVectorConn();
    await vc.delete_vector_index(vector_bucket_name, vector_index_name);
}

async function put_vectors({vector_bucket_name, vector_index, vectors}) {
    dbg.log0("put_vectors vector_bucket_name =", vector_bucket_name, ", vector_index.name =", vector_index.name, ", vectors =", vectors);
    const vc = await getVectorConn();
    await vc.put_vectors(vector_bucket_name, vector_index, vectors);
    dbg.log0("put_vectors done");
}

async function list_vectors(params) {
    dbg.log0("list_vectors params =", params);

    const vc = await getVectorConn();
    return await vc.list_vectors(params);
}

async function query_vectors({vector_bucket_name, vector_index_name, query_vector, topk, return_metadata, return_distance}) {
    dbg.log0("query_vectors vector_bucket_name =", vector_bucket_name, ", vector_index_name =", vector_index_name, ", query_vector =", query_vector);
    const vc = await getVectorConn();
    return await vc.query_vectors(vector_bucket_name, vector_index_name, query_vector.float32, topk, return_metadata, return_distance);
}

async function delete_vectors({vector_bucket_name, vector_index_name, keys}) {
    dbg.log0("delete_vectors vector_index_name =", vector_index_name, vector_bucket_name, ", keys =", keys);
    const vc = await getVectorConn();
    return await vc.delete_vectors(vector_bucket_name, vector_index_name, keys);
}

async function main() {
    const db = await create_fs_db();
    console.log("db =", db);

    const table = await db.createTable("my_table", [
        { id: 1, vector: [0.1, 0.2], item: "foo", price: 10.0 },
        { id: 1, vector: [0.2, 0.4], item: "foo", price: 20.0 },
        { id: 2, vector: [0.9, 0.5], item: "bar", price: 15.0 },
    ]);
    let results = await table.vectorSearch([0.1, 0.3]).limit(1).toArray();
    console.log("results =", results);

    results = await table.vectorSearch([0.1, 0.3]).where("price > 11").limit(1).toArray();
    console.log("results =", results);

    results = await table.vectorSearch([0.1, 0.3]).where("price > 11 AND price < 18").limit(1).toArray();
    console.log("results =", results);

    return 0;
}

exports.main = main;
exports.create_vector_bucket = create_vector_bucket;
exports.delete_vector_bucket = delete_vector_bucket;
exports.create_vector_index = create_vector_index;
exports.delete_vector_index = delete_vector_index;
exports.put_vectors = put_vectors;
exports.list_vectors = list_vectors;
exports.query_vectors = query_vectors;
exports.delete_vectors = delete_vectors;

if (require.main === module) main();
