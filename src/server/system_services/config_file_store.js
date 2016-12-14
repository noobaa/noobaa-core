'use strict';

const _ = require('lodash');
const Ajv = require('ajv');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const js_utils = require('../../util/js_utils');
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client').instance();
const schema_utils = require('../../util/schema_utils');
const mongodb = require('mongodb');
const config_file_schema = require('./schemas/config_file_schema');


const CONFIG_FILE_COLLECTION = js_utils.deep_freeze({
    name: 'config_files',
    schema: schema_utils.strictify(config_file_schema),
    db_indexes: [{
        fields: {
            filename: 1,
        },
        options: {
            unique: true,
        }
    }]
});

class ConfigFileStore {

    static instance() {
        ConfigFileStore._instance = ConfigFileStore._instance || new ConfigFileStore();
        return ConfigFileStore._instance;
    }

    constructor() {
        this._json_validator = new Ajv({
            formats: {
                objectid: val => mongo_utils.is_object_id(val)
            }
        });

        try {
            mongo_client.define_collection(CONFIG_FILE_COLLECTION);
        } catch (err) {
            // this might be a legit exception if system_collection was already defined
            dbg.warn('Exception while trying to init', CONFIG_FILE_COLLECTION.name, err);
        }
        this._json_validator.addSchema(CONFIG_FILE_COLLECTION.schema, CONFIG_FILE_COLLECTION.name);
    }

    connect() {
        return mongo_client.connect();
    }

    insert(item) {
        dbg.log0(`Inserting `, item);
        let validator = this._json_validator.getSchema(CONFIG_FILE_COLLECTION.name);
        _.defaults(item, {
            _id: new mongodb.ObjectId()
        });
        if (validator(item)) {
            return mongo_client.db.collection(CONFIG_FILE_COLLECTION.name).update({
                    filename: {
                        $eq: item.filename
                    }
                }, {
                    $set: {
                        data: item.data
                    }
                })
                .then(res => {
                    if (res && res.result) {
                        if (res.result.nModified === 0) {
                            dbg.log0(`item ${item.filename} did not exist in db. Inserted`);
                            return mongo_client.db.collection(CONFIG_FILE_COLLECTION.name).insert(item);
                        }
                        dbg.log0(`item ${item.filename} existed in db and was updated`);
                    } else {
                        return P.reject(new Error('Unkown result from mongo client: ', res));
                    }
                });
        }
        dbg.error(`item not valid in config file store`, validator.errors, item);
        return P.reject(new Error('history_data_store: item not valid in config file store'));
    }

    get(filename) {
        return mongo_client.db.collection(CONFIG_FILE_COLLECTION.name).findOne({
            filename: filename
        });
    }
}

exports.instance = ConfigFileStore.instance;
