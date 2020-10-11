/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const moment = require('moment');

const dbg = require('../../util/debug_module')(__filename);
const { EndpointStatsStore } = require('../analytic_services/endpoint_stats_store');
const system_store = require('../system_services/system_store').get_instance();
const size_utils = require('../../util/size_utils');

const ZERO_STATS = {
    read_count: 0,
    write_count: 0,
    read_bytes: 0,
    write_bytes: 0,
};

async function get_bandwidth_report(params) {
    const { time_range } = params;
    if (time_range !== 'day' && time_range !== 'hour') {
        throw new Error(`wrong report time_range. should be day or hour. got ${time_range}`);
    }

    const reports = await EndpointStatsStore.instance.get_bandwidth_reports({
        since: moment(params.since).startOf(time_range).valueOf(),
        till: moment(params.till).endOf(time_range).valueOf(),
        buckets: params.bucket
    });

    const by_bucket_and_date = reports.reduce((mapping, report) => {
        const bucket = system_store.data.get_by_id(report.bucket);
        if (!bucket) return mapping;

        const date = moment(report.start_time).startOf(time_range).valueOf();
        const key = [date, report.bucket].join('#');
        let record = mapping.get(key);
        if (!record) {
            record = {
                date,
                bucket: bucket.name,
                timestamp: report.start_time,
                ...ZERO_STATS
            };
            mapping.set(key, record);
        }

        record.timestamp = Math.min(record.timestamp, report.start_time);
        _accumulate_bandwidth(record, report);
        return mapping;
    }, new Map());

    return _.sortBy(
        [...by_bucket_and_date.values()],
        'date'
    );
}

async function get_bandwith_over_time(params) {
    const since = moment(params.since).startOf('hour').valueOf();
    const till = moment(params.till).endOf('hour').valueOf();
    const step = moment.duration(params.resolution, 'hour').asMilliseconds();

    // get relevent bandwidth reports.
    const reports = await EndpointStatsStore.instance.get_bandwidth_reports({
        ..._.pick(params, ['buckets', 'accounts', 'endpoint_groups']),
        since,
        till
    });

    // Build time slots array to return
    const length = (till - since) / step;
    const time_slots = Array.from({ length }).map((unused, i) => {
        const start_time = since + (i * step);
        const end_time = start_time + step - 1;
        return { ...ZERO_STATS, start_time, end_time };
    });

    // fill the slots with the proper data from the store.
    return reports.reduce((slots, report) => {
        const index = Math.floor((report.start_time - since) / step);
        _accumulate_bandwidth(slots[index], report);
        return slots;
    }, time_slots);
}

async function get_accounts_bandwidth_usage(query) {
    const reports = await EndpointStatsStore.instance.get_bandwidth_reports(query);
    const by_account = _.groupBy(reports, report => report.account);
    return Object.entries(by_account)
        .map(pair => {
            const [account_id, reportList] = pair;
            const account = system_store.data.get_by_id(account_id);
            if (!account) {
                return null;
            }

            return reportList.reduce(
                (acc, report) => _accumulate_bandwidth(acc, report), { account: account.email, ...ZERO_STATS }
            );
        })
        .filter(Boolean);
}

async function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('System did not finish initial load');
        return;
    }

    // delete all reports older than eight weeks
    const till = moment().subtract(8, 'weeks').valueOf();
    dbg.log0('Deleting reports older than', new Date(till));
    await EndpointStatsStore.instance.clean_bandwidth_reports({ till });
}

function _accumulate_bandwidth(acc, update) {
    acc.read_count += update.read_count || 0;
    acc.read_bytes = size_utils.sum_bigint_json(acc.read_bytes, update.read_bytes || 0);
    acc.write_count += update.write_count || 0;
    acc.write_bytes = size_utils.sum_bigint_json(acc.write_bytes, update.write_bytes || 0);
    return acc;
}

// EXPORTS
exports.background_worker = background_worker;
exports.get_bandwidth_report = get_bandwidth_report;
exports.get_accounts_bandwidth_usage = get_accounts_bandwidth_usage;
exports.get_bandwith_over_time = get_bandwith_over_time;
