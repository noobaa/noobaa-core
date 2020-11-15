/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const db_client = require('../../util/db_client');
const s3_usage_schema = require('./s3_usage_schema');
const usage_report_schema = require('./usage_report_schema');
const endpoint_group_report_schema = require('./endpoint_group_report_schema');
const s3_usage_indexes = require('./s3_usage_indexes');
const usage_report_indexes = require('./usage_report_indexes');
const endpoint_group_report_indexes = require('./endpoint_group_report_indexes');

const { ENDPOINT_MONITOR_INTERVAL } = require('../../../config');

class EndpointStatsStore {
    static get instance() {
        if (!this._instance) {
            this._instance = new EndpointStatsStore();
        }
        return this._instance;
    }

    constructor() {
        this._s3_ops_counters = db_client.instance().define_collection({
            name: 'objectstats',
            schema: s3_usage_schema,
            db_indexes: s3_usage_indexes,
        });

        this._bandwidth_reports = db_client.instance().define_collection({
            name: 'usagereports',
            schema: usage_report_schema,
            db_indexes: usage_report_indexes,
        });

        this._endpoint_group_reports = db_client.instance().define_collection({
            name: 'endpointgroupreports',
            schema: endpoint_group_report_schema,
            db_indexes: endpoint_group_report_indexes,
        });
    }

    async accept_endpoint_report(system, report) {
        await Promise.all([
            this._update_s3_ops_counters(system, report),
            this._update_bandwidth_reports(system, report),
            this._update_endpoint_group_reports(system, report)
        ]);
    }

    //--------------------------------------------
    // S3 ops counters
    //--------------------------------------------

    async get_s3_ops_counters(system) {
        dbg.log1('get_s3_ops_counters');
        const res = await this._s3_ops_counters.findOne({ system: system._id });
        return _.pick(res, 's3_usage_info', 's3_errors_info');
    }

    async reset_s3_ops_counters(system) {
        dbg.log1('reset_s3_ops_counters');
        await this._s3_ops_counters.deleteMany({ system: system._id });
    }

    async _update_s3_ops_counters(system, report) {
        const { usage = {}, errors = {} } = report.s3_ops;
        const selector = {
            system: system._id
        };
        const update = {
            $inc: {
                ..._.mapKeys(usage, (unused, key) => `s3_usage_info.${key}`),
                ..._.mapKeys(errors, (unused, key) => `s3_errors_info.${key}`)
            }
        };
        const options = {
            upsert: true,
            returnOriginal: false
        };

        const res = await this._s3_ops_counters
            .findOneAndUpdate(selector, update, options);

        this._s3_ops_counters.validate(res.value, 'warn');
    }

    //--------------------------------------------
    // bandwidth reports
    //--------------------------------------------

    async get_bandwidth_reports(params) {
        dbg.log1('get_bandwidth_reports', params);
        const query = this._format_bandwidth_report_query(params);
        return this._bandwidth_reports
            .find(query);
    }

    async clean_bandwidth_reports(params) {
        dbg.log1('clean_bandwidth_reports', params);
        const query = this._format_bandwidth_report_query(params);
        return this._bandwidth_reports.deleteMany(query);
    }

    _format_bandwidth_report_query(params) {
        const { endpoint_groups, buckets, accounts, since, till } = params;
        const query = {};
        if (endpoint_groups) _.set(query, ['endpoint_group', '$in'], _.castArray(endpoint_groups));
        if (buckets) _.set(query, ['bucket', '$in'], _.castArray(buckets));
        if (accounts) _.set(query, ['account', '$in'], _.castArray(accounts));
        if (since) _.set(query, ['start_time', '$gte'], since);
        if (till) _.set(query, ['end_time', '$lte'], till);
        return query;
    }

    async _update_bandwidth_reports(system, report) {
        const start_time = Math.floor(report.timestamp / ENDPOINT_MONITOR_INTERVAL) * ENDPOINT_MONITOR_INTERVAL;
        const end_time = start_time + ENDPOINT_MONITOR_INTERVAL - 1;

        await P.map_with_concurrency(10, report.bandwidth, async record => {
            const selector = {
                start_time,
                end_time,
                system: system._id,
                endpoint_group: report.endpoint_group,
                bucket: record.bucket,
                account: record.account
            };
            const update = {
                $inc: _.pick(record, [
                    'read_bytes',
                    'write_bytes',
                    'read_count',
                    'write_count'
                ])
            };
            const options = {
                upsert: true,
                returnOriginal: false
            };

            const res = await this._bandwidth_reports
                .findOneAndUpdate(selector, update, options);

            this._bandwidth_reports.validate(res.value, 'warn');
        });
    }

    //--------------------------------------------
    // Endpoint Group Reports
    //--------------------------------------------

    async get_endpoint_group_reports(params) {
        dbg.log1('get_endpoint_group_reports', params);
        const query = this._format_endpoint_gorup_report_query(params);
        return this._endpoint_group_reports.find(query);
    }

    async clean_endpoint_group_reports(params) {
        dbg.log1('clean_endpoint_group_reports', params);
        const query = this._format_endpoint_gorup_report_query(params);
        return this._endpoint_group_reports.deleteMany(query);
    }

    _format_endpoint_gorup_report_query(params) {
        const { groups, since, till } = params;
        const query = {};
        if (groups) _.set(query, ['group_name', '$in'], _.castArray(groups));
        if (since) _.set(query, ['start_time', '$gte'], since);
        if (till) _.set(query, ['end_time', '$lte'], till);
        return query;
    }

    async _update_endpoint_group_reports(system, report) {
        const start_time = Math.floor(report.timestamp / ENDPOINT_MONITOR_INTERVAL) * ENDPOINT_MONITOR_INTERVAL;
        const end_time = start_time + ENDPOINT_MONITOR_INTERVAL - 1;
        const selector = {
            start_time,
            end_time,
            system: system._id,
            group_name: report.endpoint_group,
        };
        const update = {
            $push: {
                endpoints: _.pick(report, [
                    'hostname',
                    'cpu',
                    'memory'
                ])
            }
        };
        const options = {
            upsert: true,
            returnOriginal: false
        };

        const res = await this._endpoint_group_reports
            .findOneAndUpdate(selector, update, options);

        this._endpoint_group_reports.validate(res.value, 'warn');
    }
}

exports.EndpointStatsStore = EndpointStatsStore;
