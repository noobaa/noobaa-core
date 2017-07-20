/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const moment = require('moment');

const dbg = require('../../util/debug_module')(__filename);
const P = require('../../util/promise');
const UsageReportStore = require('../analytic_services/usage_report_store').UsageReportStore;
// const system_store = require('../system_services/system_store').get_instance();



function aggregate_report(params) {
    dbg.log0(`aggregate_report: got params:`, params);
    const { since, till, aggregate_day = false } = params;
    const start_of_range = aggregate_day ? 'day' : 'hour';
    const hour_range = 60 * 60 * 1000;
    const day_range = 24 * hour_range;
    const aggregated_time_range = aggregate_day ? day_range : hour_range;
    // get all reports with time range less than the required aggregation
    return UsageReportStore.instance().get_usage_reports({ since, till, lt_range: aggregated_time_range })
        .then(reports => {
            const range_reports = _.groupBy(reports, report => {
                const start_time = moment(report.start_time).startOf(start_of_range)
                    .toDate();
                return String(report.bucket) + '#' + String(report.account) + '#' + start_time;
            });
            // for each group, get the latest aggregated report for a range of 1 hour
            return P.map(_.values(range_reports), range_items => {
                    // before aggregating we need to figure out if there are reports that are already aggregated
                    // and were not cleaned (due to a crash in the middle of last aggregation)
                    UsageReportStore.instance().get_latest_aggregated_report_time({
                            bucket: range_items[0].bucket,
                            account: range_items[0].account,
                            aggregated_time_range: aggregated_time_range
                        })
                        .then(latest_report_time => {
                            // only reduce entries that are newer than the aggregated time
                            const new_items = range_items.filter(item => item.aggregated_time > latest_report_time);
                            if (new_items.length) {
                                const reduced_report = new_items.reduce(_reduce_usage_reports);
                                reduced_report.aggregated_time_range = aggregated_time_range;
                                reduced_report.aggregated_time = new Date(till);

                                reduced_report.start_time = moment(new_items[0].start_time).startOf(start_of_range)
                                    .toDate();
                                // fill rest of the data from new_items[0]
                                _.defaults(reduced_report, _.omit(new_items[0], '_id'));
                                return UsageReportStore.instance().update_aggregated_usage_reports(reduced_report);
                            }
                        });
                })
                .then(() => UsageReportStore.instance().clean_usage_reports({
                    till: till,
                    lt_aggregated_time_range: aggregated_time_range
                }));
        })
        .return();
}



function get_daily_reports_for_bucket(params) {
    const { since, till, bucket } = params;
    const start_day = moment(since).startOf('day')
        .toDate();
    const end_day = moment(till).endOf('day')
        .toDate();
    return UsageReportStore.instance().get_usage_reports({ start_day, end_day, bucket })
        .then(reports => {
            const entries = [];
            const daily_reports_groups = _.groupBy(reports, report => moment(report.start_time).startOf('day')
                .toDate());
            _.each(daily_reports_groups, (day_reports, date) => {
                const reduced_report = day_reports.reduce(_reduce_usage_reports);
                entries.push({
                    date,
                    read_bytes: reduced_report.read_bytes,
                    read_count: reduced_report.read_count,
                    write_bytes: reduced_report.write_bytes,
                    write_count: reduced_report.write_count,
                });
            });
            return _.sortBy(entries, 'date');
        });

}


function _reduce_usage_reports(acc, curr) {
    const latest_end_time = Math.max(acc.end_time.getTime(), curr.end_time.getTime());
    const earliest_start_time = Math.min(acc.first_sample_time.getTime(), curr.first_sample_time.getTime());
    return {
        read_bytes: acc.read_bytes + curr.read_bytes,
        write_bytes: acc.write_bytes + curr.write_bytes,
        read_count: acc.read_count + curr.read_count,
        write_count: acc.write_count + curr.write_count,
        first_sample_time: new Date(earliest_start_time),
        end_time: new Date(latest_end_time)
    };
}

function background_worker() {
    // if (!system_store.is_finished_initial_load) {
    //     dbg.log0('System did not finish initial load');
    //     return;
    // }

    dbg.log0('starting usage reports aggregator bg work');

    // first aggregate past week to ranges of hour
    const week_ago = Date.now() - (7 * 24 * 60 * 60 * 1000);
    return aggregate_report({ since: week_ago, till: Date.now(), aggregate_day: false })
        .catch(err => dbg.error('got error when aggregating past week usage', err))
        .then(() => aggregate_report({ till: week_ago, aggregate_day: true }))
        .catch(err => dbg.error('got error when aggregating usage older than a week', err));

}





// EXPORTS
exports.background_worker = background_worker;
exports.aggregate_report = aggregate_report;
exports.get_daily_reports_for_bucket = get_daily_reports_for_bucket;
