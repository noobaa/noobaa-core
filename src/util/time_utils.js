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

//UTC is RFC822 + full year presentation (4 digits).
//This function convert it to 2 digits year, required by S3 (and specifically enforced by hadoop)

function toRFC822(in_date) {
     return in_date.toUTCString().replace(' '+in_date.getFullYear()+' ',' '+(in_date.getFullYear().toString()).substr(2)+' ');
}
