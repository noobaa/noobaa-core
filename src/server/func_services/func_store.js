/* Copyright (C) 2016 NooBaa */
'use strict';

const mongodb = require('mongodb');

const db_client = require('../../util/db_client');

const func_schema = require('./func_schema');
const func_indexes = require('./func_indexes');

class FuncStore {

    constructor() {
        this._funcs = db_client.instance().define_collection({
            name: 'funcs',
            schema: func_schema,
            db_indexes: func_indexes,
        });
    }

    static instance() {
        if (!FuncStore._instance) FuncStore._instance = new FuncStore();
        return FuncStore._instance;
    }

    make_func_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    async create_func(func) {
        try {
            this._funcs.validate(func);
            await this._funcs.insertOne(func);
        } catch (err) {
            db_client.instance().check_duplicate_key_conflict(err, 'func');
        }
        return func;
    }

    async delete_func(func_id) {
        await this._funcs.updateOne({
            _id: func_id,
        }, {
            $set: {
                deleted: new Date()
            }
        });
    }

    async update_func(func_id, set_updates) {
        await this._funcs.updateOne({
            _id: func_id,
        }, {
            $set: set_updates
        });
    }

    async read_func(system, name, version) {
        const res = await this._funcs.findOne({
            system: system,
            name: name,
            version: version,
            deleted: null,
        });
        return db_client.instance().check_entity_not_deleted(res, 'func');
    }

    async get_by_id_include_deleted(func_id) {
        return this._funcs.findOne({
            _id: func_id,
        });
    }

    async list_funcs(system) {
        return this._funcs.find({
            system: system,
            version: '$LATEST',
            deleted: null,
        });
    }

    async list_funcs_by_pool(system, pool) {
        return this._funcs.find({
            system: system,
            pools: pool,
            deleted: null,
        });
    }

    async list_func_versions(system, name) {
        return this._funcs.find({
            system: system,
            name: name,
            deleted: null,
        });
    }

    code_filename(system, name, version) {
        return system + '/' + name + '/' + version;
    }

}

FuncStore._instance = undefined;

// EXPORTS
exports.FuncStore = FuncStore;
exports.instance = FuncStore.instance;
