/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const AlertsLogStore = require('./alerts_log_store').AlertsLogStore;

function only_once(sev, sysid, alert) {
    return P.resolve(AlertsLogStore.instance().find_alert(sev, sysid, alert))
        .then(res => res.length === 0);
}

function only_once_by_regex(regex) {
    return function(sev, sysid, alert) {
        return P.resolve(AlertsLogStore.instance().find_alert(sev, sysid, { $regex: regex }))
            .then(res => (res.length === 0));
    };
}

function once_every(interval) {
    return function(sev, sysid, alert) {
        const interval_date = new Date(Date.now() - interval);
        return P.resolve(AlertsLogStore.instance().find_alert(sev, sysid, alert, { $gt: interval_date }))
            .then(res => (res.length === 0));
    };
}

function once_daily(sev, sysid, alert) {
    const one_day = 1000 * 60 * 60 * 24;
    const one_day_ago = new Date(Date.now() - one_day);
    return P.resolve(AlertsLogStore.instance().find_alert(sev, sysid, alert, { $gt: one_day_ago }))
        .then(res => (res.length === 0));
}

function once_weekly(sev, sysid, alert) {
    const one_week = 1000 * 60 * 60 * 24 * 7;
    const one_week_ago = new Date(Date.now() - one_week);
    return P.resolve(AlertsLogStore.instance().find_alert(sev, sysid, alert, { $gt: one_week_ago }))
        .then(res => (res.length === 0));
}


exports.only_once = only_once;
exports.once_daily = once_daily;
exports.once_weekly = once_weekly;
exports.once_every = once_every;
exports.only_once_by_regex = only_once_by_regex;
