/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../util/debug_module')(__filename);
const db_client = require('../../util/db_client');
const mongodb = require('mongodb');
const config_file_schema = require('./schemas/config_file_schema');
const config_file_indexes = require('./schemas/config_file_indexes');

class ConfigFileStore {

    constructor() {
        this._config_files = db_client.instance().define_collection({
            name: 'config_files',
            schema: config_file_schema,
            db_indexes: config_file_indexes,
        });
    }

    static instance() {
        if (!ConfigFileStore._instance) ConfigFileStore._instance = new ConfigFileStore();
        return ConfigFileStore._instance;
    }

    async insert(item) {
        dbg.log0(`insert`, item);
        _.defaults(item, {
            _id: new mongodb.ObjectId()
        });
        // There shouldn't be more than one record, this is being on the safe side
        this._config_files.validate(item);
        const res = await this._config_files.updateMany({
            filename: {
                $eq: item.filename
            }
        }, {
            $set: {
                data: item.data
            }
        });
        if (!res || !res.result) {
            throw new Error(`Unkown result from db client: ${res}`);
        }
        if (res.result.n === 0) {
            dbg.log0(`item ${item.filename} did not exist in db. Inserted`);
            return this._config_files.insertOne(item);
        }
        dbg.log0(`item ${item.filename} existed in db and was updated`);
    }

    async get(filename) {
        return this._config_files.findOne({
            filename: filename
        });
    }
}

exports.instance = ConfigFileStore.instance;
