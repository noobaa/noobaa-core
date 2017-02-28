/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const mongo_client = require('../../util/mongo_client');
const usage_schema = require('./s3_usage_schema');

class S3UsageStore {

    constructor() {
        this._usage = mongo_client.instance().define_collection({
            name: 'objectstats',
            schema: usage_schema,
            db_indexes: [{
                fields: {
                    system: 1,
                },
                options: {
                    unique: true,
                }
            }],
        });
    }

    update_usage(system, usage_info, errors_info) {
        // There might be a bug here as I saw it getting here with no system
        dbg.log1('update_usage');
        let update = {
            $inc: {}
        };
        _add_to_inc(update, usage_info, 's3_usage_info');
        _add_to_inc(update, errors_info, 's3_errors_info');
        if (!_.isEmpty(update.$inc)) {
            return P.resolve()
                .then(() => this._usage.col().findOneAndUpdate({
                    system: system._id
                }, update, {
                    upsert: true,
                    returnNewDocument: true
                }))
                .then(res => this._usage.validate(res, 'warn'))
                .return();
        }
    }

    reset_usage(system) {
        dbg.log1('reset_usage');
        return P.resolve()
            .then(() => this._usage.col().removeMany({
                system: system._id
            }))
            .return();
    }

    get_usage(system) {
        dbg.log1('get_usage');
        return P.resolve()
            .then(() => this._usage.col().findOne({
                system: system._id
            }))
            .then(res => this._usage.validate(res, 'warn'))
            .then(res => _.pick(res, ['s3_usage_info', 's3_errors_info']));
    }

    static instance(system) {
        S3UsageStore._instance = S3UsageStore._instance || new S3UsageStore();
        return S3UsageStore._instance;
    }
}

function _add_to_inc(update, update_array, field_name) {
    Object.keys(update_array).forEach(key => {
        if (update_array[key]) {
            update.$inc[`${field_name}.${key}`] = update_array[key];
        }
    });
}

// EXPORTS
exports.S3UsageStore = S3UsageStore;
