/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const Ajv = require('ajv');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const js_utils = require('../../util/js_utils');
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');
const schema_utils = require('../../util/schema_utils');
const func_schema = require('./func_schema');

const FUNCS_COLLECTION = js_utils.deep_freeze({
    name: 'funcs',
    schema: schema_utils.strictify(func_schema),
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

class FuncStore {

    static instance() {
        if (!FuncStore._instance) {
            FuncStore._instance = new FuncStore();
        }
        return FuncStore._instance;
    }

    constructor() {
        mongo_client.instance().define_collection(FUNCS_COLLECTION);
        this._json_validator = new Ajv({
            formats: {
                date: schema_utils.date_format,
                idate: schema_utils.idate_format,
                objectid: val => mongo_utils.is_object_id(val)
            }
        });
        this._func_validator = this._json_validator.compile(FUNCS_COLLECTION.schema);
    }

    connect() {
        return mongo_client.instance().connect();
    }

    collection() {
        return mongo_client.instance().db.collection(FUNCS_COLLECTION.name);
    }

    code_gridfs() {
        if (!this._func_code_gridfs) {
            this._func_code_gridfs = new mongodb.GridFSBucket(mongo_client.instance().db, {
                bucketName: 'func_code_gridfs'
            });
        }
        return this._func_code_gridfs;
    }

    validate(func, fail) {
        if (!this._func_validator(func)) {
            dbg.warn('BAD FUNC SCHEMA', func,
                'ERRORS', this._func_validator.errors);
            if (fail) {
                throw new Error('BAD FUNC SCHEMA');
            }
        }
        return func;
    }

    validate_list(funcs, fail) {
        _.each(funcs, func => this.validate(func, fail));
        return funcs;
    }

    make_func_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    create_func(func) {
        if (!func._id) {
            func._id = this.make_func_id();
        }
        return P.resolve()
            .then(() => this.validate(func, 'fail'))
            .then(() => this.collection().insertOne(func))
            .catch(err => mongo_utils.check_duplicate_key_conflict(err, 'func'))
            .return(func);
    }

    delete_func(func_id) {
        return P.resolve()
            .then(() => this.collection().updateOne({
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
            .then(() => this.collection().updateOne({
                _id: func_id,
            }, {
                $set: set_updates
            }))
            .return();
    }

    read_func(system, name, version) {
        return P.resolve()
            .then(() => this.collection().findOne({
                system: system,
                name: name,
                version: version,
                deleted: null,
            }))
            .then(res => mongo_utils.check_entity_not_deleted(res, 'func'));
    }

    list_funcs(system) {
        return P.resolve()
            .then(() => this.collection().find({
                    system: system,
                    version: '$LATEST',
                    deleted: null,
                })
                .toArray());
    }

    list_func_versions(system, name) {
        return P.resolve()
            .then(() => this.collection().find({
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
            const upload_stream = this.code_gridfs().openUploadStream(
                this.code_filename(system, name, version));
            code_stream
                .once('error', reject)
                .pipe(upload_stream)
                .once('error', reject)
                .once('finish', () => resolve(upload_stream.id));
        });
    }

    delete_code_gridfs(id) {
        return this.code_gridfs().delete(id);
    }

    stream_code_gridfs(id) {
        return this.code_gridfs().openDownloadStream(id);
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
