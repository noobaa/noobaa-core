/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const mongo_client = require('../../util/mongo_client');
const s3_usage_schema = require('./s3_usage_schema');
const usage_report_schema = require('./usage_report_schema');

class UsageReportStore {

    static instance(system) {
        UsageReportStore._instance = UsageReportStore._instance || new UsageReportStore();
        return UsageReportStore._instance;
    }

    constructor() {
        this._s3_usage = mongo_client.instance().define_collection({
            name: 'objectstats',
            schema: s3_usage_schema,
            db_indexes: [{
                fields: {
                    system: 1,
                },
                options: {
                    unique: true,
                }
            }],
        });

        this._usage_reports = mongo_client.instance().define_collection({
            name: 'usagereports',
            schema: usage_report_schema,
            db_indexes: [{
                fields: {
                    start_time: 1,
                    aggregated_time: -1,
                    aggregated_time_range: 1,
                }
            }],
        });

    }

    /////////////////////////
    // Usage reports funcs //
    /////////////////////////

    insert_usage_reports(reports) {
        for (const report of reports) {
            report._id = report._id || new mongodb.ObjectID();
            report.first_sample_time = report.first_sample_time || report.start_time;
            report.aggregated_time_range = report.aggregated_time_range || 0;
            report.aggregated_time = report.aggregated_time || new Date();

            this._usage_reports.validate(report);
        }
        return this._usage_reports.col().insertMany(reports);
    }

    get_latest_aggregated_report_time(params) {
        const { aggregated_time_range, bucket, account } = params;
        return this._usage_reports.col().findOne({
                bucket,
                account,
                aggregated_time_range
            }, {
                sort: {
                    aggregated_time: -1
                }
            })
            .then(report => {
                if (!report) {
                    return 0;
                }
                return report.aggregated_time.getTime();
            });
    }

    update_aggregated_usage_reports(update) {
        return this._usage_reports.col().findOne({
                start_time: update.start_time,
                aggregated_time_range: update.aggregated_time_range
            })
            .then(res => {
                if (res) {
                    // perform update if the range is already in the DB
                    const $inc = _.pick(update, ['read_bytes', 'write_bytes', 'read_count', 'write_count']);
                    return this._usage_reports.col().updateOne({
                        start_time: update.start_time,
                        aggregated_time_range: update.aggregated_time_range
                    }, {
                        $inc
                    });
                } else {
                    // if not found preform an insert
                    return this.insert_usage_reports([update]);
                }
            })
            .return();
    }

    get_usage_reports(params) {
        const { since, till, lt_range, bucket } = params;
        const start_time = {
            $lt: till ? new Date(till) : new Date()
        };
        if (since) {
            start_time.$gt = new Date(since);
        }
        const query = {
            start_time,
        };
        if (lt_range) {
            query.aggregated_time_range = {
                $lt: lt_range
            };
        }
        if (bucket) {
            query.bucket = bucket;
        }

        return this._usage_reports.col().find(query)
            .toArray();
    }

    clean_usage_reports(params) {
        const { till, lt_aggregated_time_range } = params;
        return this._usage_reports.col().removeMany({
            start_time: {
                $lt: new Date(till)
            },
            aggregated_time_range: {
                $lt: lt_aggregated_time_range
            }
        });
    }

    ///////////////////////
    // S3 ops statistics //
    ///////////////////////



    update_usage(system, usage_info, errors_info) {
        dbg.log1('update_usage');
        let update = {
            $inc: {}
        };
        _.forEach(usage_info, (count, key) => {
            update.$inc[`s3_usage_info.${key}`] = count;
        });
        _.forEach(errors_info, (count, key) => {
            update.$inc[`s3_errors_info.${key}`] = count;
        });
        if (_.isEmpty(update.$inc)) return;
        return P.resolve()
            .then(() => this._s3_usage.col().findOneAndUpdate({
                system: system._id
            }, update, {
                upsert: true,
                returnNewDocument: true
            }))
            .then(res => this._s3_usage.validate(res.value, 'warn'))
            .return();
    }

    reset_usage(system) {
        dbg.log1('reset_usage');
        return P.resolve()
            .then(() => this._s3_usage.col().removeMany({
                system: system._id,
                bucket: null,
                account: null,
            }))
            .return();
    }

    get_usage(system) {
        dbg.log1('get_usage');
        return P.resolve()
            .then(() => this._s3_usage.col().findOne({
                system: system._id
            }))
            .then(res => this._s3_usage.validate(res, 'warn'))
            .then(res => _.pick(res, 's3_usage_info', 's3_errors_info'));
    }

}


// EXPORTS
exports.UsageReportStore = UsageReportStore;
