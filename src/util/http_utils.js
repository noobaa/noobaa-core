/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * see https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.24
 */
function match_etag(condition, etag) {
    condition = condition.trim();
    if (condition === '*' || condition === `"${etag}"`) return true;
    return condition.split(/,(?=\s*"[^"]*"\s*)/)
        .some(c => c.trim() === `"${etag}"`);
}

exports.match_etag = match_etag;
