/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const mongo_client = require('../../util/mongo_client');
const mongodb = require('mongodb');
const config_file_schema = require('./schemas/config_file_schema');

class ConfigFileStore {

    constructor() {
        this._config_files = mongo_client.instance().define_collection({
            name: 'config_files',
            schema: config_file_schema,
            db_indexes: [{
                fields: {
                    filename: 1,
                },
                options: {
                    unique: true,
                }
            }]
        });
    }

    static instance() {
        if (!ConfigFileStore._instance) ConfigFileStore._instance = new ConfigFileStore();
        return ConfigFileStore._instance;
    }

    insert(item) {
        dbg.log0(`insert`, item);
        _.defaults(item, {
            _id: new mongodb.ObjectId()
        });
        // There shouldn't be more than one record, this is being on the safe side
        return P.resolve()
            .then(() => this._config_files.validate(item))
            .then(() => this._config_files.col().updateMany({
                filename: {
                    $eq: item.filename
                }
            }, {
                $set: {
                    data: item.data
                }
            }))
            .then(res => {
                if (!res || !res.result) {
                    return P.reject(new Error('Unkown result from mongo client: ', res));
                }
                if (res.result.nModified === 0) {
                    dbg.log0(`item ${item.filename} did not exist in db. Inserted`);
                    return this._config_files.col().insertOne(item);
                }
                dbg.log0(`item ${item.filename} existed in db and was updated`);
            });
    }

    get(filename) {
        return this._config_files.col().findOne({
            filename: filename
        });
    }
}

exports.instance = ConfigFileStore.instance;
