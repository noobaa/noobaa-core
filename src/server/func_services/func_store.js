/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const stream = require('stream');
const crypto = require('crypto');
const mongodb = require('mongodb');

// const dbg = require('../../util/debug_module')(__filename);
const db_client = require('../../util/db_client');
const P = require('../../util/promise');

const buffer_utils = require('../../util/buffer_utils');
const func_schema = require('./func_schema');
const func_indexes = require('./func_indexes');

class FuncStore {

    constructor() {
        this._funcs = db_client.instance().define_collection({
            name: 'funcs',
            schema: func_schema,
            db_indexes: func_indexes,
        });
        this._func_code = db_client.instance().define_gridfs({
            name: 'func_code_gridfs'
        });
    }

    static instance() {
        if (!FuncStore._instance) FuncStore._instance = new FuncStore();
        return FuncStore._instance;
    }

    make_func_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    create_func(func) {
        return P.resolve().then(async () => {
            try {
                this._funcs.validate(func);
                await this._funcs.insertOne(func);
            } catch (err) {
                db_client.instance().check_duplicate_key_conflict(err, 'func');
            }
            return func;
        });
    }

    delete_func(func_id) {
        return P.resolve().then(async () => {
            await this._funcs.updateOne({
                _id: func_id,
            }, {
                $set: {
                    deleted: new Date()
                }
            });
        });
    }

    update_func(func_id, set_updates) {
        return P.resolve().then(async () => {
            await this._funcs.updateOne({
                _id: func_id,
            }, {
                $set: set_updates
            });
        });
    }

    read_func(system, name, version) {
        return P.resolve().then(async () => {
            const res = await this._funcs.findOne({
                system: system,
                name: name,
                version: version,
                deleted: null,
            });
            return db_client.instance().check_entity_not_deleted(res, 'func');
        });
    }

    get_by_id_include_deleted(func_id) {
        return P.resolve().then(async () => this._funcs.findOne({
            _id: func_id,
        }));
    }

    list_funcs(system) {
        return P.resolve().then(async () => this._funcs.find({
            system: system,
            version: '$LATEST',
            deleted: null,
        }));
    }

    list_funcs_by_pool(system, pool) {
        return P.resolve().then(async () => this._funcs.find({
            system: system,
            pools: pool,
            deleted: null,
        }));
    }

    list_func_versions(system, name) {
        return P.resolve().then(async () => this._funcs.find({
            system: system,
            name: name,
            deleted: null,
        }));
    }

    create_code_gridfs(params) {
        const system = params.system;
        const name = params.name;
        const version = params.version;
        const code_stream = params.code_stream;
        const sha256 = crypto.createHash('sha256');
        var size = 0;
        return new Promise((resolve, reject) => {
            const upload_stream = this._func_code.gridfs().openUploadStream(
                this.code_filename(system, name, version));
            code_stream
                .once('error', reject)
                .pipe(new stream.Transform({
                    transform(buf, encoding, callback) {
                        size += buf.length;
                        sha256.update(buf);
                        callback(null, buf);
                    }
                }))
                .once('error', reject)
                .pipe(upload_stream)
                .once('error', reject)
                .once('finish', () => resolve({
                    id: upload_stream.id,
                    sha256: sha256.digest('base64'),
                    size: size,
                }));
        });
    }

    async delete_code_gridfs(id) {
        return this._func_code.gridfs().delete(id);
    }

    stream_code_gridfs(id) {
        return this._func_code.gridfs().openDownloadStream(id);
    }

    async read_code_gridfs(id) {
        return buffer_utils.read_stream_join(this.stream_code_gridfs(id));
    }

    code_filename(system, name, version) {
        return system + '/' + name + '/' + version;
    }

}

FuncStore._instance = undefined;

// EXPORTS
exports.FuncStore = FuncStore;
exports.instance = FuncStore.instance;
