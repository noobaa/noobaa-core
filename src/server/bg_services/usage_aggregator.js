/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const moment = require('moment');

const dbg = require('../../util/debug_module')(__filename);
const UsageReportStore = require('../analytic_services/usage_report_store').UsageReportStore;
const system_store = require('../system_services/system_store').get_instance();



async function get_bandwidth_report(params) {
    const { since, till, bucket, resolution } = params;
    if (resolution !== 'day' && resolution !== 'hour') {
        throw new Error(`wrong report resolution. should be day or hour. got ${resolution}`);
    }
    const start = moment(since).startOf(resolution).valueOf();
    const end = moment(till).endOf(resolution).valueOf();
    const reports = await UsageReportStore.instance().get_usage_reports({ since: start, till: end, bucket });

    const entries = aggregate_reports(reports, { resolution, aggergate_by: ['bucket'] }).map(report => ({
        date: moment(report.start_time).startOf(resolution).valueOf,
        timestamp: report.start_time,
        bucket: (system_store.data.get_by_id(report.bucket)).name,
        read_bytes: report.read_bytes,
        read_count: report.read_count,
        write_bytes: report.write_bytes,
        write_count: report.write_count,
    }));
    const sorted_entries = _.sortBy(entries, 'date');
    return sorted_entries;
}

function aggregate_reports(reports, { resolution, aggergate_by } = {}) {
    const entries = [];
    const grouped_reports = _.groupBy(reports, report => aggergate_by.map(p => `${report[p]}`).join('#'));
    _.each(grouped_reports, bucket_reports => {
        const reports_groups = _.groupBy(bucket_reports, report => moment(report.start_time).startOf(resolution).valueOf());
        _.each(reports_groups, (day_reports, date) => {

            const reduced_report = day_reports.reduce((acc, curr) => ({
                system: curr.system,
                bucket: curr.bucket,
                account: curr.account,
                read_bytes: acc.read_bytes + curr.read_bytes,
                write_bytes: acc.write_bytes + curr.write_bytes,
                read_count: acc.read_count + curr.read_count,
                write_count: acc.write_count + curr.write_count,
                start_time: Math.min(acc.start_time, curr.start_time),
                end_time: Math.max(acc.end_time, curr.end_time),
            }));

            entries.push(reduced_report);
        });
    });
    return entries;
}



async function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('System did not finish initial load');
        return;
    }

    const YEAR = 365 * 24 * 60 * 60 * 1000;
    const till = Date.now() - YEAR;
    // delete all reports older than one year
    dbg.log0('Deleting reports older than', new Date(till));
    return UsageReportStore.instance().clean_usage_reports({ till });
}





// EXPORTS
exports.background_worker = background_worker;
exports.get_bandwidth_report = get_bandwidth_report;
