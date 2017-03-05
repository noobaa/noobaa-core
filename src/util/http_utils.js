/* Copyright (C) 2016 NooBaa */
'use strict';

const url = require('url');
const http = require('http');
const https = require('https');

/**
 * see https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.24
 */
function match_etag(condition, etag) {

    // trim white space
    condition = condition.trim();

    // * matches any etag
    if (condition === '*') return true;

    // detect exact match, but only allow it if no commas at all
    if (condition === `"${etag}"` && !condition.includes(',')) return true;

    // split the condition on commas followed by proper quoted-string
    // the then compare to find any match
    return condition.split(/,(?=\s*"[^"]*"\s*)/)
        .some(c => c.trim() === `"${etag}"`);
}

/**
 * Get http / https agent according to protocol
 */
function get_unsecured_http_agent(endpoint) {
    const protocol = url.parse(endpoint).protocol;
    return protocol === "https:" ?
        new https.Agent({
            rejectUnauthorized: false,
        }) :
        new http.Agent();
}

exports.match_etag = match_etag;
exports.get_unsecured_http_agent = get_unsecured_http_agent;
