/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const mongodb = require('mongodb');

// const dbg = require('../../util/debug_module')(__filename);
const db_client = require('../../util/db_client');

const func_stats_schema = require('./func_stats_schema');
const func_stats_indexes = require('./func_stats_indexes');
const mongo_functions = require('../../util/mongo_functions');
class FuncStatsStore {

    constructor() {
        this._func_stats = db_client.instance().define_collection({
            name: 'func_stats',
            schema: func_stats_schema,
            db_indexes: func_stats_indexes,
        });
    }

    static instance() {
        if (!FuncStatsStore._instance) FuncStatsStore._instance = new FuncStatsStore();
        return FuncStatsStore._instance;
    }

    make_func_stat_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    async create_func_stat(stat) {
        if (!stat._id) {
            stat._id = this.make_func_stat_id();
        }
        try {
            this._func_stats.validate(stat);
            await this._func_stats.insertOne(stat);
        } catch (err) {
            db_client.instance().check_duplicate_key_conflict(err, 'func stat');
        }
        return stat;
    }

    async query_func_stats(params) {

        const records = await this._func_stats
            .mapReduce(
                mongo_functions.map_func_stats,
                mongo_functions.reduce_func_stats, {
                    finalize: mongo_functions.finalize_func_stats,
                    query: {
                        system: params.system,
                        func: params.func,
                        time: {
                            $gte: params.since,
                            $lt: params.till
                        }
                    },
                    scope: {
                        step: params.step,
                        percentiles: params.percentiles,
                        max_samples: params.max_samples
                    },
                    out: {
                        inline: 1
                    }
                }
            );

        return records.map(record => [
            record._id,
            record.value
        ]);
    }
}

/** @type {FuncStatsStore} */
FuncStatsStore._instance = undefined;

// EXPORTS
exports.FuncStatsStore = FuncStatsStore;
exports.instance = FuncStatsStore.instance;
