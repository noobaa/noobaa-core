/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const moment = require('moment');

const dbg = require('../../util/debug_module')(__filename);
const UsageReportStore = require('../analytic_services/usage_report_store').UsageReportStore;
const system_store = require('../system_services/system_store').get_instance();
const size_utils = require('../../util/size_utils');
const SensitiveString = require('../../util/sensitive_string');



const ZERO_STATS = {
    read_count: 0,
    write_count: 0,
    read_bytes: 0,
    write_bytes: 0,
};

async function get_bandwidth_report(params) {
    const { since, till, bucket, time_range } = params;
    if (time_range !== 'day' && time_range !== 'hour') {
        throw new Error(`wrong report time_range. should be day or hour. got ${time_range}`);
    }
    const start = moment(since).startOf(time_range).valueOf();
    const end = moment(till).endOf(time_range).valueOf();
    const reports = await UsageReportStore.instance().get_usage_reports({ since: start, till: end, buckets: [bucket] });
    const entries = aggregate_reports(reports, { time_range, aggergate_by: ['bucket'] }).map(report => ({
        date: moment(report.start_time).startOf(time_range).valueOf,
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

async function get_throughput_entries({ buckets, resolution, since, till }) {
    // first normalize since\till to start\end of hour
    since = moment(since).startOf('hour').valueOf();
    till = moment(till).endOf('hour').valueOf();
    const step = moment.duration(resolution, 'hour').valueOf();
    const entries_by_start_time = {};
    // build entries array to return
    for (let start = since; start < till; start += step) {
        entries_by_start_time[start] = _.extend(null, {
                start_time: start,
                end_time: start + step - 1
            },
            ZERO_STATS);
    }
    const reports = await UsageReportStore.instance().get_usage_reports({ since, till, buckets });
    for (const report of reports) {
        const { start_time } = report;
        // align start time of each report to the requested resolution
        const aligned_start_time = since + (Math.floor((start_time - since) / step) * step);
        const entry = entries_by_start_time[aligned_start_time];
        if (entry) {
            entry.read_count += report.read_count;
            entry.read_bytes = size_utils.sum_bigint_json(entry.read_bytes, report.read_bytes);
            entry.write_count += report.write_count;
            entry.write_bytes = size_utils.sum_bigint_json(entry.write_bytes, report.write_bytes);
        } else {
            dbg.error('could not find an entry for start_time =', aligned_start_time);
        }
    }
    return _.values(entries_by_start_time);
}


async function get_accounts_report(params) {
    const { since, till, accounts } = params;
    const usage_reports = await UsageReportStore.instance().get_usage_reports({
        since: moment(since).startOf('hour').valueOf(),
        till: moment(till).endOf('hour').valueOf(),
        accounts
    });
    const accounts_reports = _.groupBy(usage_reports, report => system_store.data.get_by_id(report.account).email.unwrap());
    return _.map(accounts_reports, (reports, account) => reports.reduce((curr, prev) => ({
        account: new SensitiveString(account),
        read_count: prev.read_count + (curr.read_count || 0),
        read_bytes: size_utils.sum_bigint_json(prev.read_bytes, (curr.read_bytes || 0)),
        write_count: prev.write_count + (curr.write_count || 0),
        write_bytes: size_utils.sum_bigint_json(prev.write_bytes, (curr.write_bytes || 0)),
    }), ZERO_STATS));
}




function aggregate_reports(reports, { time_range, aggergate_by } = {}) {
    const entries = [];
    const grouped_reports = _.groupBy(reports, report => aggergate_by.map(p => `${report[p]}`).join('#'));
    _.each(grouped_reports, bucket_reports => {
        const reports_groups = _.groupBy(bucket_reports, report => moment(report.start_time).startOf(time_range).valueOf());
        _.each(reports_groups, (day_reports, date) => {

            const reduced_report = day_reports.reduce((acc, curr) => ({
                system: curr.system,
                bucket: curr.bucket,
                account: curr.account,
                read_bytes: size_utils.sum_bigint_json(acc.read_bytes, curr.read_bytes),
                write_bytes: size_utils.sum_bigint_json(acc.write_bytes, curr.write_bytes),
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
    await UsageReportStore.instance().clean_usage_reports({ till });
}





// EXPORTS
exports.background_worker = background_worker;
exports.get_bandwidth_report = get_bandwidth_report;
exports.get_accounts_report = get_accounts_report;
exports.get_throughput_entries = get_throughput_entries;
