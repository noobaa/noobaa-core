'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const Ajv = require('ajv');
const js_utils = require('../../util/js_utils');
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');
//const pool_statistics_schema = require('../analytic_services/schemas/pool_stats_schema');
const system_history_schema = require('../analytic_services/system_history_schema');
const schema_utils = require('../../util/schema_utils');
const config = require('../../../config.js');
const mongodb = require('mongodb');


/*
const COLLECTIONS = js_utils.deep_freeze([{
    name: 'pool_stats',
    schema: schema_utils.strictify(pool_statistics_schema),
    db_indexes: [{
        fields: {
            id: 1,
        }
    }]
}]);
*/
//const COLLECTIONS_BY_NAME = _.keyBy(COLLECTIONS, 'name');

const SYSTEM_COLLECTION = js_utils.deep_freeze({
    name: 'system_history',
    schema: schema_utils.strictify(system_history_schema),
    db_indexes: [{
        fields: {
            id: 1,
        }
    }]
});

class StatsStore {

    static instance() {
            StatsStore._instance = StatsStore._instance || new StatsStore();
            return StatsStore._instance;
        }
        /*
            constructor() {
                this._json_validator = new Ajv({
                    formats: {q

                        date: schema_utils.date_format,
                        idate: schema_utils.idate_format,
                        objectid: val => mongo_utils.is_object_id(val)
                    }
                });
                _.each(COLLECTIONS, col => {
                    try {
                        mongo_client.instance().define_collection(col);
                    } catch (err) {
                        dbg.warn('Exception while trying to init', col, err);
                    }
                    this._json_validator.addSchema(col.schema, col.name);

                    this[col.name] = {
                        insert: item => {
                            item._id = item._id || new mongo_client.ObjectId();
                            let validator = this._json_validator.getSchema(col.name);
                            let record_expiration_date = Date.now() - config.STATISTICS_COLLECTOR_EXPIRATION;
                            if (validator(item)) {
                                return mongo_client.instance().db.collection(col.name).insert(item)
                                    .then(() => mongo_client.instance().db.collection(col.name).remove({
                                        time_stamp: {
                                            $lt: record_expiration_date
                                        }
                                    }));
                            }
                            dbg.error('history_data_store: item not valid in collection,', col.name, validator.errors, item);
                            return P.reject(new Error('history_data_store: item not valid in collection'));
                        }
                    };
                });
            }
        */

    constructor() {
        this._json_validator = new Ajv({
            formats: {
                date: schema_utils.date_format,
                objectid: val => mongo_utils.is_object_id(val)
            }
        });

        try {
            mongo_client.instance().define_collection(SYSTEM_COLLECTION);
        } catch (err) {
            dbg.warn('Exception while trying to init', SYSTEM_COLLECTION, err);
        }
        this._json_validator.addSchema(SYSTEM_COLLECTION.schema, SYSTEM_COLLECTION.name);
    }

    connect() {
        return mongo_client.instance().connect();
    }

    get_pool_history(pool_list) {
        return mongo_client.instance().db.collection(SYSTEM_COLLECTION.name).find()
            .toArray()
            .then(history_records => history_records.map(history_record => ({
                time_stamp: history_record.time_stamp,
                pool_list: _.filter(history_record.system_snapshot.pools
                    .map(pool =>
                        _.pick(pool, ['name', 'storage'])),
                    pool => !pool_list || _.isEmpty(pool_list) ||
                    _.includes(pool_list, pool.name)) || []
            })));
    }

    insert(item) {
        let validator = this._json_validator.getSchema(SYSTEM_COLLECTION.name);
        let record_expiration_date = Date.now() - config.STATISTICS_COLLECTOR_EXPIRATION;
        let record = {
            _id: new mongodb.ObjectId(),
            time_stamp: Date.now(),
            system_snapshot: item
        };
        if (validator(record)) {
            return mongo_client.instance().db.collection(SYSTEM_COLLECTION.name).insert(record)
                .then(() => mongo_client.instance().db.collection(SYSTEM_COLLECTION.name).remove({
                    time_stamp: {
                        $lt: record_expiration_date
                    }
                }));
        }
        dbg.error('history_data_store: item not valid in system history store', validator.errors, item);
        return P.reject(new Error('history_data_store: item not valid in system history store'));
    }
}

exports.StatsStore = StatsStore;
