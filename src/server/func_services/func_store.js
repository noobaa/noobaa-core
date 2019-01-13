/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const stream = require('stream');
const crypto = require('crypto');
const mongodb = require('mongodb');

const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');
const buffer_utils = require('../../util/buffer_utils');
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
        this._func_code = mongo_client.instance().define_gridfs({
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

    get_by_id_include_deleted(func_id) {
        return P.resolve()
        .then(() => this._funcs.col().findOne({
            _id: func_id,
        }));
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
        const sha256 = crypto.createHash('sha256');
        var size = 0;
        return new P((resolve, reject) => {
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

    delete_code_gridfs(id) {
        return this._func_code.gridfs().delete(id);
    }

    stream_code_gridfs(id) {
        return this._func_code.gridfs().openDownloadStream(id);
    }

    read_code_gridfs(id) {
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
