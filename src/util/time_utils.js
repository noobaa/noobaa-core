/* Copyright (C) 2016 NooBaa */
'use strict';

const perf_now = require('performance-now');

function millistamp() {
    return perf_now();
}

function nanostamp() {
    return perf_now() * 1e6;
}

function microstamp() {
    return perf_now() * 1e3;
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
 * Previously this function used to convert the year to 2 digits for hadoop,
 * but apparently this is not done by S3, and failed aws-sdk-go.
 * We don't know if hadoop will still fail on it or not but for now we just don't care.
 * @param {Date} date
 */
function format_http_header_date(date) {
    return date.toUTCString();
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
    const match_ISO_8601 = (/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/).exec(str);
    if (match_ISO_8601) {
        return Date.parse(`${match_ISO_8601[1]}-${match_ISO_8601[2]}-${match_ISO_8601[3]}T${match_ISO_8601[4]}:${match_ISO_8601[5]}:${match_ISO_8601[6]}Z`);
    }
    return Date.parse(str);
}

function format_time_duration(millis, show_millis) {
    const secs = Math.floor(millis / 1000 % 60);
    const mins = Math.floor(millis / 60000 % 60);
    const hours = Math.floor(millis / 3600000);
    const secs_str = '00'.slice(secs.toString().length) + secs;
    const mins_str = '00'.slice(mins.toString().length) + mins;
    const hours_str = '00'.slice(hours.toString().length) + hours;
    if (show_millis) {
        const ms = Math.floor(millis % 1000);
        const ms_str = '000'.slice(ms.toString().length) + ms;
        return `${hours_str}:${mins_str}:${secs_str}.${ms_str}`;
    }
    return `${hours_str}:${mins_str}:${secs_str}`;
}


exports.millistamp = millistamp;
exports.microstamp = microstamp;
exports.nanostamp = nanostamp;
exports.secstamp = secstamp;
exports.millitook = millitook;
exports.sectook = sectook;
exports.format_http_header_date = format_http_header_date;
exports.parse_http_header_date = parse_http_header_date;
exports.parse_amz_date = parse_amz_date;
exports.format_time_duration = format_time_duration;
