/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const mongodb = require('mongodb');

const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');
const func_stats_schema = require('./func_stats_schema');

class FuncStatsStore {

    constructor() {
        this._func_stats = mongo_client.instance().define_collection({
            name: 'func_stats',
            schema: func_stats_schema,
            db_indexes: [{
                fields: {
                    system: 1,
                    id: 1,
                    latency_ms: 1,
                }
            }]
        });
    }

    static instance() {
        if (!FuncStatsStore._instance) FuncStatsStore._instance = new FuncStatsStore();
        return FuncStatsStore._instance;
    }

    make_func_stat_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    create_func_stat(stat) {
        if (!stat._id) {
            stat._id = this.make_func_stat_id();
        }
        return P.resolve()
            .then(() => this._func_stats.validate(stat))
            .then(() => this._func_stats.col().insertOne(stat))
            .catch(err => mongo_utils.check_duplicate_key_conflict(err, 'func stat'))
            .return(stat);
    }

    sample_func_stats({
        system,
        func,
        since_time,
        sample_size
    }) {
        return this._func_stats.col().aggregate([{
                $match: {
                    system: system,
                    func: func,
                    time: {
                        $gte: since_time
                    },
                }
            }, {
                $sample: {
                    size: sample_size
                }
            }])
            .toArray();
    }

}


// EXPORTS
exports.FuncStatsStore = FuncStatsStore;
exports.instance = FuncStatsStore.instance;
