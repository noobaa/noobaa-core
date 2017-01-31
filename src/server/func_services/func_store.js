/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const mongodb = require('mongodb');

const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');
const func_schema = require('./func_schema');

class FuncStore {

    constructor() {
        this._funcs = mongo_client.instance().define_collection({
            name: 'funcs',
            schema: func_schema,
            db_indexes: [{
                fields: {
                    system: 1,
                    name: 1,
                    version: 1,
                    deleted: 1, // allow to filter deleted
                },
                options: {
                    unique: true,
                }
            }]
        });
    }

    static instance() {
        if (!FuncStore._instance) FuncStore._instance = new FuncStore();
        return FuncStore._instance;
    }

    make_func_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    _code_gridfs() {
        if (!this._func_code_gridfs) {
            this._func_code_gridfs = new mongodb.GridFSBucket(mongo_client.instance().db, {
                bucketName: 'func_code_gridfs'
            });
        }
        return this._func_code_gridfs;
    }

    create_func(func) {
        if (!func._id) {
            func._id = this.make_func_id();
        }
        return P.resolve()
            .then(() => this._funcs.validate(func))
            .then(() => this._funcs.col().insertOne(func))
            .catch(err => mongo_utils.check_duplicate_key_conflict(err, 'func'))
            .return(func);
    }

    delete_func(func_id) {
        return P.resolve()
            .then(() => this._funcs.col().updateOne({
                _id: func_id,
            }, {
                $set: {
                    deleted: new Date()
                }
            }))
            .return();
    }

    update_func(func_id, set_updates) {
        return P.resolve()
            .then(() => this._funcs.col().updateOne({
                _id: func_id,
            }, {
                $set: set_updates
            }))
            .return();
    }

    read_func(system, name, version) {
        return P.resolve()
            .then(() => this._funcs.col().findOne({
                system: system,
                name: name,
                version: version,
                deleted: null,
            }))
            .then(res => mongo_utils.check_entity_not_deleted(res, 'func'));
    }

    list_funcs(system) {
        return P.resolve()
            .then(() => this._funcs.col().find({
                    system: system,
                    version: '$LATEST',
                    deleted: null,
                })
                .toArray());
    }

    list_func_versions(system, name) {
        return P.resolve()
            .then(() => this._funcs.col().find({
                    system: system,
                    name: name,
                    deleted: null,
                })
                .toArray());
    }

    create_code_gridfs(params) {
        const system = params.system;
        const name = params.name;
        const version = params.version;
        const code_stream = params.code_stream;
        return new P((resolve, reject) => {
            const upload_stream = this._code_gridfs().openUploadStream(
                this.code_filename(system, name, version));
            code_stream
                .once('error', reject)
                .pipe(upload_stream)
                .once('error', reject)
                .once('finish', () => resolve(upload_stream.id));
        });
    }

    delete_code_gridfs(id) {
        return this._code_gridfs().delete(id);
    }

    stream_code_gridfs(id) {
        return this._code_gridfs().openDownloadStream(id);
    }

    read_code_gridfs(id) {
        return new P((resolve, reject) => {
            const download_stream = this.stream_code_gridfs(id);
            const chunks = [];
            download_stream
                .on('data', chunk => chunks.push(chunk))
                .once('error', reject)
                .once('end', () => resolve(Buffer.concat(chunks)));
        });
    }

    code_filename(system, name, version) {
        return system + '/' + name + '/' + version;
    }

}


// EXPORTS
exports.FuncStore = FuncStore;
exports.instance = FuncStore.instance;
