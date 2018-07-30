/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const P = require('../../util/promise');
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

    async insert_usage_reports(reports, { accumulate } = {}) {
        if (!reports || !reports.length) return;

        // group the report by <bucket, account, start_time, end_time> tuple
        const grouped_reports = _.groupBy(reports, report =>
            `${report.bucket}#${report.account}#${report.start_time}#${report.end_time}`);
        await P.map(_.values(grouped_reports), async group => {
            const selector = {
                system: group[0].system,
                bucket: group[0].bucket,
                account: group[0].account,
                start_time: group[0].start_time,
                end_time: group[0].end_time
            };
            const usage_data = {
                read_bytes: _.sumBy(group, 'read_bytes'),
                write_bytes: _.sumBy(group, 'write_bytes'),
                read_count: _.sumBy(group, 'read_count'),
                write_count: _.sumBy(group, 'write_count')
            };
            const update = accumulate ? {
                $set: selector,
                $inc: usage_data
            } : {
                $set: Object.assign({}, selector, usage_data)
            };
            const res = await this._usage_reports.col().findOneAndUpdate(
                selector,
                update, {
                    upsert: true,
                    returnOriginal: false
                }
            );
            this._usage_reports.validate(res.value, 'warn');
        });
    }

    async get_usage_reports(params) {
        const { since, till, bucket } = params;
        const start_time = since || till ? _.omitBy({
            $gte: since,
            $lt: till,
        }, _.isUndefined) : undefined;
        const query = { start_time };
        if (bucket) query.bucket = bucket;
        return this._usage_reports.col().find(_.omitBy(query, _.isUndefined)).toArray();
    }

    async clean_usage_reports(params) {
        const { since, till } = params;
        return this._usage_reports.col().removeMany({
            start_time: _.omitBy({
                $gte: since,
                $lt: till
            }, _.isUndefined)
        });
    }

    ///////////////////////
    // S3 ops statistics //
    ///////////////////////



    async update_usage(system, usage_info, errors_info) {
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
        const res = await this._s3_usage.col().findOneAndUpdate({ system: system._id },
            update, { upsert: true, returnOriginal: false });
        this._s3_usage.validate(res.value, 'warn');
    }

    async reset_usage(system) {
        dbg.log1('reset_usage');
        await this._s3_usage.col().removeMany({
            system: system._id,
            bucket: null,
            account: null,
        });
    }

    async get_usage(system) {
        dbg.log1('get_usage');
        const res = await this._s3_usage.col().findOne({ system: system._id });
        this._s3_usage.validate(res, 'warn');
        return _.pick(res, 's3_usage_info', 's3_errors_info');
    }

}


// EXPORTS
exports.UsageReportStore = UsageReportStore;
