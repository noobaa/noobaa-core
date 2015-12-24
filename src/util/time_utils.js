'use strict';

var perf_now = require('performance-now');

module.exports = {
    millistamp: millistamp,
    nanostamp: nanostamp,
    secstamp: secstamp,
    millitook: millitook,
    sectook: sectook,
    time_suffix: time_suffix
};

function millistamp() {
    return perf_now();
}

function nanostamp() {
    return perf_now() * 1e6;
}

function secstamp() {
    return perf_now() / 1000;
}

function millitook(since) {
    return (millistamp() - since).toFixed(1) + 'ms';
}

function sectook(since) {
    return (secstamp() - since).toFixed(1) + 'sec';
}

function time_suffix() {
    var d = new Date();
    return d.toISOString().replace(/T/, '-').substr(5, 11);
}
