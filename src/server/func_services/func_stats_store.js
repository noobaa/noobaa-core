/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const Ajv = require('ajv');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const js_utils = require('../../util/js_utils');
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');
const schema_utils = require('../../util/schema_utils');
const func_stats_schema = require('./func_stats_schema');

const FUNC_STATS_COLLECTION = js_utils.deep_freeze({
    name: 'func_stats',
    schema: schema_utils.strictify(func_stats_schema),
    db_indexes: [{
        fields: {
            system: 1,
            id: 1,
            latency_ms: 1,
        }
    }]
});

class FuncStatsStore {

    static instance() {
        if (!FuncStatsStore._instance) {
            FuncStatsStore._instance = new FuncStatsStore();
        }
        return FuncStatsStore._instance;
    }

    constructor() {
        mongo_client.instance().define_collection(FUNC_STATS_COLLECTION);
        this._json_validator = new Ajv({
            formats: {
                date: schema_utils.date_format,
                idate: schema_utils.idate_format,
                objectid: val => mongo_utils.is_object_id(val)
            }
        });
        this._stats_validator = this._json_validator.compile(FUNC_STATS_COLLECTION.schema);
    }

    connect() {
        return mongo_client.instance().connect();
    }

    collection() {
        return mongo_client.instance().db.collection(FUNC_STATS_COLLECTION.name);
    }

    validate(func, fail) {
        if (!this._stats_validator(func)) {
            dbg.warn('BAD FUNC STATS SCHEMA', func,
                'ERRORS', this._stats_validator.errors);
            if (fail) {
                throw new Error('BAD FUNC STATS SCHEMA');
            }
        }
        return func;
    }

    make_func_stat_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    create_func_stat(stat) {
        if (!stat._id) {
            stat._id = this.make_func_stat_id();
        }
        return P.resolve()
            .then(() => this.validate(stat, 'fail'))
            .then(() => this.collection().insertOne(stat))
            .catch(err => mongo_utils.check_duplicate_key_conflict(err, 'func stat'))
            .return(stat);
    }

    query_stats_percentiles({
        system,
        func_id,
        since_time,
    }) {
        return P.resolve()
            .then(() => this.collection().find({
                    system: system,
                    func_id: func_id,
                    start_time: {
                        $gte: since_time
                    },
                    error: null,
                })
                .sort({
                    latency_ms: 1
                })
                .toArray())
            .then(res => {
                const latency_percentiles = res.length ?
                    _.map([
                        0, 10, 20, 30, 40,
                        50, 60, 70, 80, 90,
                        95, 99, 100
                    ], i => ({
                        index: i,
                        value: res[
                            Math.min(
                                res.length - 1,
                                Math.floor(res.length * i * 0.01))
                        ].latency_ms
                    })) : [];
                return {
                    invoke_count: res.length,
                    latency_percentiles: latency_percentiles,
                };
            });
    }

}


// EXPORTS
exports.FuncStatsStore = FuncStatsStore;
exports.instance = FuncStatsStore.instance;
