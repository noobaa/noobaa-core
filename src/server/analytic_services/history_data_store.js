/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const mongodb = require('mongodb');

const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const mongo_client = require('../../util/mongo_client');
const system_history_schema = require('../analytic_services/system_history_schema');

class HistoryDataStore {

    constructor() {
        this._history = mongo_client.instance().define_collection({
            name: 'system_history',
            schema: system_history_schema,
        });
    }

    static instance() {
        HistoryDataStore._instance = HistoryDataStore._instance || new HistoryDataStore();
        return HistoryDataStore._instance;
    }

    get_pool_history(pool_list) {
        return this._history.col().find()
            .toArray()
            .then(history_records => history_records.map(history_record => {
                const pools = history_record.system_snapshot.pools
                    .filter(pool => !pool_list || pool_list.includes(pool.name))
                    .map(pool => {
                        const { name, storage, cloud_info } = pool;
                        return {
                            name,
                            storage,
                            is_cloud_pool: Boolean(cloud_info)
                        };
                    });

                return {
                    timestamp: history_record.time_stamp,
                    pool_list: pools
                };
            }));
    }

    insert(item) {
        const record_expiration_date = Date.now() - config.STATISTICS_COLLECTOR_EXPIRATION;
        const record = {
            _id: new mongodb.ObjectId(),
            time_stamp: Date.now(),
            system_snapshot: item
        };
        return P.resolve()
            .then(() => this._history.validate(record))
            .then(() => this._history.col().insertOne(record))
            .then(() => this._history.col().removeMany({
                time_stamp: { // Will remove old snapshots
                    $lt: record_expiration_date
                }
            }));
    }
}

// EXPORTS
exports.HistoryDataStore = HistoryDataStore;
