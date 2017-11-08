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

    insert(item) {
        const time_stamp = new Date();
        const record_expiration_date = new Date(time_stamp.getTime() - config.STATISTICS_COLLECTOR_EXPIRATION);
        const record = {
            _id: new mongodb.ObjectId(),
            time_stamp,
            system_snapshot: item
        };
        return P.resolve()
            .then(() => this._history.validate(record))
            .then(() => this._history.col().insertOne(record))
            .then(() => this._history.col().removeMany({
                // remove old snapshots
                time_stamp: { $lt: record_expiration_date }
            }));
    }

    get_pool_history() {
        return this._history.col().find({}, {
                time_stamp: 1,
                'system_snapshot.pools': 1,
            })
            .toArray();
    }

}

// EXPORTS
exports.HistoryDataStore = HistoryDataStore;
