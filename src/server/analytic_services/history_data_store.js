/* Copyright (C) 2016 NooBaa */
'use strict';

const mongodb = require('mongodb');

// const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
// const pkg = require('../../../package.json');
// const _ = require('lodash');
const P = require('../../util/promise');
const db_client = require('../../util/db_client');
const system_history_schema = require('../analytic_services/system_history_schema');

class HistoryDataStore {

    constructor() {
        this._history = db_client.instance().define_collection({
            name: 'system_history',
            schema: system_history_schema,
        });
    }

    static instance() {
        HistoryDataStore._instance = HistoryDataStore._instance || new HistoryDataStore();
        return HistoryDataStore._instance;
    }

    insert(item) {
        return P.resolve().then(async () => {
            const time_stamp = new Date();
            const record_expiration_date = new Date(time_stamp.getTime() - config.STATISTICS_COLLECTOR_EXPIRATION);
            const record = {
                _id: new mongodb.ObjectId(),
                time_stamp,
                system_snapshot: item,
                history_type: 'SYSTEM'
            };
            this._history.validate(record);
            await this._history.insertOne(record);
            await this._history.deleteMany({
                // remove old snapshots
                time_stamp: { $lt: record_expiration_date },
                history_type: 'SYSTEM'
            });
        });
    }

    async get_pool_history() {
        return this._history.find({
            history_type: 'SYSTEM'
        }, {
            projection: {
                time_stamp: 1,
                'system_snapshot.pools': 1,
            }
        });
    }

    get_system_version_history() {
        return P.resolve().then(async () => this._history.find({
            history_type: 'VERSION'
        }, {
            projection: {
                time_stamp: 1,
                version_snapshot: 1,
            }
        }));
    }

}

// EXPORTS
exports.HistoryDataStore = HistoryDataStore;
