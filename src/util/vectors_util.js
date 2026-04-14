/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const path = require('path');
const LRUCache = require('./lru_cache');
const system_store = require('../server/system_services/system_store').get_instance();
const js_utils = require('../util/js_utils');

const _ = require('lodash');
const lance = js_utils.require_optional('@lancedb/lancedb');

function qoute_string(string) {
    return "'" + string.replace(/'/g, "''") + "'";
}

function handle_literal(literal) {
    if (typeof literal === 'string') return qoute_string(literal);
    if (Array.isArray(literal)) return literal.map(handle_literal);
    //not a string, no need for qoutes
    return literal;
}


function filterToSql(filter) {
    dbg.log0("filterToSql filter =", filter);
    let res;
    const key = Object.keys(filter)[0];
    const value = handle_literal(filter[key]);
    switch (key) {
        case "$gt": {
            res = " > " + value;
            break;
        }
        case "$gte": {
            res = " >= " + value;
            break;
        }
        case "$lt": {
            res = " < " + value;
            break;
        }
        case "$lte": {
            res = " <= " + value;
            break;
        }
        case "$eq": {
            res = " = " + value;
            break;
        }
        case "$ne": {
            res = " != " + value;
            break;
        }
        case "$in": {
            res = " IN (" + value.join(",") + ")";
            break;
        }
        case "$nin": {
            res = " NOT IN (" + value.join(",") + ")";
            break;
        }
        case "$exists": {
            res = " IS " + (value ? "NOT " : "") + "NULL";
            break;
        }
        case "$and": {
            res = "(" + value.map(filterToSql).join(" AND ") + ")";
            break;
        }
        case "$or": {
            res = "(" + value.map(filterToSql).join(" OR ") + ")";
            break;
        }
        default: {
            if (typeof value === 'object') {
                //value is k:v pairs where k is operator and v is right-hand operator value.
                const ops = Object.keys(value);
                //make "key op rh-val" string for each op
                const op_rh_vals = [];
                for (const op of ops) {
                    //recurse into operator
                    op_rh_vals.push(key + filterToSql(_.pick(value, op)));
                }
                //join with AND
                res = op_rh_vals.join(' AND ');
            } else {
                //simple equality (ie filter is {key: value})
                res = key + " = " + value;
            }
        }
    }

    dbg.log0("filterToSql res =", res);
    return res;
}

class VectorConn {
    constructor(connOpts) {
        this.connOpts = connOpts;
        this.connected = false;
    }
}

class LanceConn extends VectorConn {

    constructor(connOpts) {
        if (!lance) {
            throw new Error("LanceDB package is not available.");
        }

        super(connOpts);
        this.tables = new Map();
    }

    async connect() {
        this.lance = await lance.connect(this.connOpts.path, this.connOpts.opts);
        this.connected = true;
    }

    create_vector_index() {
        //lance needs at least one vector in order to create a table,
        //defer to the first insert
    }

    get_vector_index() {
        //nothing to do in lance
    }

    async delete_vector_index(vector_bucket, vector_index) {
        const table_name = vector_bucket.name.unwrap() + "_" + vector_index.name.unwrap();
        dbg.log0("delete_vector_index table_name =", table_name);
        try {
            await this.lance.dropTable(table_name);
        } catch (e) {
            dbg.log1("drop table error =", e);
            //swallow table not found errors. it's possible lance table was never created
            if (e.message.indexOf('was not found') === -1) {
                throw e;
            }
        }
        this.tables.delete(table_name);
        dbg.log0("delete_vector_index done table_name =", table_name);

    }

    async put_vectors(vector_bucket, vector_index, vectors, is_retry = false) {
        dbg.log0("put_vectors vector_bucket =", vector_bucket.name.unwrap(), ", vector_index =", vector_index.name.unwrap(), ", vectors =", vectors);
        //note underscore is not allowed in vector bucket name
        const table_name = vector_bucket.name.unwrap() + "_" + vector_index.name.unwrap();

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
                    return await this.put_vectors(vector_bucket, vector_index, vectors, true);
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

    async list_vectors(vector_bucket, vector_index, params) {
        dbg.log0("list_vectors vector_bucket =", vector_bucket.name.unwrap(), ", vector_index =", vector_index.name.unwrap());
        const table_name = vector_bucket.name.unwrap() + "_" + vector_index.name.unwrap();

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

    async query_vectors(vector_bucket, vector_index, query_vector, limit, return_metadata, return_distance, filter) {
        dbg.log0("query_vectors vector_bucket =", vector_bucket.name.unwrap(), ", vector_index =", vector_index.name.unwrap(),
            ", query_vector =", query_vector, ", limit =", limit, ", filter =", filter);
        const table_name = vector_bucket.name.unwrap() + "_" + vector_index.name.unwrap();

        const table = await this.get_table(table_name);
        //TODO - check if(!table)
        const query = table.vectorSearch(query_vector);
        if (filter) {
            query.where(filterToSql(filter));
        }
        query.limit(limit);
        const lance_res = await query.toArray();
        dbg.log0("query_vectors lance_res =", lance_res);
        const aws_vectors = Array.from(lance_res, lance_vector => this._lance_to_aws(lance_vector, return_metadata, return_distance));
        dbg.log0("query_vectors aws_vectors =", aws_vectors);
        return {vectors: aws_vectors}; //TODO - return distance metric?
    }

    async delete_vectors(vector_bucket, vector_index, ids) {
        dbg.log0("delete_vectors vector_bucket =", vector_bucket.name.unwrap(), ", vector_index =", vector_index.name.unwrap(), ", ids =", ids);
        const table_name = vector_bucket.name.unwrap() + "_" + vector_index.name.unwrap();

        const table = await this.get_table(table_name);
        //TODO - check !table
        // Escape single quotes in ids to prevent injection
        const escaped_ids = ids.map(qoute_string);
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

async function new_vector_conn(vector_bucket) {
    dbg.log0("Creating a new vector conn for", vector_bucket.name, ", db type =", vector_bucket.vector_db_type);

    let lance_path;

    switch (vector_bucket.vector_db_type) {
        case 'lance':
            if (vector_bucket.path) {
                // NC NSFS - path is directly available in the vector bucket config
                lance_path = vector_bucket.path;
            } else {
                // Containerized - resolve via system_store namespace resource
                dbg.log0("vector_bucket.namespace_resource =", vector_bucket.namespace_resource);
                const nsr = system_store.data.systems[0].namespace_resources_by_name[vector_bucket.namespace_resource.resource];
                lance_path = nsr.nsfs_config.fs_root_path;
                if (vector_bucket.namespace_resource.path) {
                    lance_path = path.join(lance_path, vector_bucket.namespace_resource.path);
                }
            }
            return new LanceConn({
                path: lance_path
            });
        default:
            throw new Error("Unknown vector db type =", vector_bucket.vector_db_type);
    }
}

const vector_conns = new LRUCache({
    name: 'VectorConn',
    expiry_ms: config.VECTORS_CACHE_DURATION,
    make_key: ({ owner_account, name }) => owner_account.id + name.unwrap(),
    load: new_vector_conn,
});

async function getVectorConn(vector_bucket) {
    dbg.log0("getVectorConn vector_bucket =", vector_bucket);
    const lance_conn = await vector_conns.get_with_cache(vector_bucket);

    if (!lance_conn.connected) {
        await lance_conn.connect();
    }
    return lance_conn;
}

function delete_vector_bucket(vector_bucket) {
    dbg.log0("delete bucket=", vector_bucket);
    vector_conns.invalidate(vector_bucket);
}

async function create_vector_index(vector_bucket, vector_index, params) {
    dbg.log0("create index params =", params);
    const vc = await getVectorConn(vector_bucket);
    await vc.create_vector_index();
}

async function delete_vector_index(vector_bucket, vector_index) {
    dbg.log0("delete index vector_bucket_name =", vector_bucket.name.unwrap(), ", vector_index_name =", vector_index.name.unwrap());
    const vc = await getVectorConn(vector_bucket);
    await vc.delete_vector_index(vector_bucket, vector_index);
}

async function put_vectors(vector_bucket, vector_index, vectors) {
    dbg.log0("put_vectors vector_bucket_name =", vector_bucket.name.unwrap(), ", vector_index_name =", vector_index.name.unwrap(), ", vectors =", vectors);
    const vc = await getVectorConn(vector_bucket);
    await vc.put_vectors(vector_bucket, vector_index, vectors);
    dbg.log0("put_vectors done");
}

async function list_vectors(vector_bucket, vector_index, params) {
    dbg.log0("list_vectors vector_bucket_name =", vector_bucket.name.unwrap(), ", vector_index_name =", vector_index.name.unwrap());
    const vc = await getVectorConn(vector_bucket);
    return await vc.list_vectors(vector_bucket, vector_index, params);
}

async function query_vectors(vector_bucket, vector_index, {query_vector, topk, return_metadata, return_distance, filter}) {
    dbg.log0("query_vectors vector_bucket_name =", vector_bucket.name.unwrap(), ", vector_index_name =", vector_index.name.unwrap(),
        ", query_vector =", query_vector, ", filter =", filter);
    const vc = await getVectorConn(vector_bucket);
    return await vc.query_vectors(vector_bucket, vector_index, query_vector.float32, topk, return_metadata, return_distance, filter);
}

async function delete_vectors(vector_bucket, vector_index, keys) {
    dbg.log0("delete_vectors vector_bucket_name =", vector_bucket.name.unwrap(), ", vector_index_name =", vector_index.name.unwrap(), ", keys =", keys);
    const vc = await getVectorConn(vector_bucket);
    return await vc.delete_vectors(vector_bucket, vector_index, keys);
}

exports.delete_vector_bucket = delete_vector_bucket;
exports.create_vector_index = create_vector_index;
exports.delete_vector_index = delete_vector_index;
exports.put_vectors = put_vectors;
exports.list_vectors = list_vectors;
exports.query_vectors = query_vectors;
exports.delete_vectors = delete_vectors;
