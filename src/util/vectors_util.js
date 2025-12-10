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
    }

    async connect() {
        await lance.connect(this.path);
        this.connected = true;
    }

    async create_vector_bucket() {
        //nothing to do?
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

if (require.main === module) main();
