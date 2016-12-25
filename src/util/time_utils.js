/* Copyright (C) 2016 NooBaa */
'use strict';

const perf_now = require('performance-now');

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

/**
 * Date.toUTCString returns RFC-822 with full year (4 digits).
 * This function convert it to 2 digits year,
 * required by S3 (and specifically enforced by hadoop)
 * @param {Date} date
 */
function format_http_header_date(date) {
    const full_year = date.getFullYear().toString();
    const short_year = full_year.slice(-2); // keep last two digits
    return date.toUTCString().replace(' ' + full_year + ' ', ' ' + short_year + ' ');
}

/**
 * Parse http date header
 * Also accepts RFC-822 with 2 digits year.
 * See https://tools.ietf.org/html/rfc7231#section-7.1.1.1
 * > The preferred format is a fixed-length and single-zone subset of the date and time
 * > specification used by the Internet Message Format [RFC5322]
 * Example: 'Sun, 06 Nov 1994 08:49:37 GMT'    ; IMF-fixdate
 * @param {String} str
 */
function parse_http_header_date(str) {
    return str ? Date.parse(str) : NaN;
}

/**
 * AMZ date is formatted as ISO-8601
 * Example: '20151014T235959Z'
 * This is very similar to the format of Date.toISOString() - '2017-03-28T00:48:19.246Z'
 * so we edit to that format and then parse.
 * @param {String} str
 */
function parse_amz_date(str) {
    if (!str) return NaN;
    const iso = `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 11)}:${str.slice(11, 13)}:${str.slice(13)}`;
    return Date.parse(iso);
}


exports.millistamp = millistamp;
exports.nanostamp = nanostamp;
exports.secstamp = secstamp;
exports.millitook = millitook;
exports.sectook = sectook;
exports.format_http_header_date = format_http_header_date;
exports.parse_http_header_date = parse_http_header_date;
exports.parse_amz_date = parse_amz_date;
