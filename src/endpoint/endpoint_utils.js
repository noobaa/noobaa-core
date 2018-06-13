/* Copyright (C) 2016 NooBaa */
'use strict';

const querystring = require('querystring');


function parse_source_url(source_url) {
    let slash_index = source_url.indexOf('/');
    let start_index = 0;
    if (slash_index === 0) {
        start_index = 1;
        slash_index = source_url.indexOf('/', 1);
    }
    let query_index = source_url.indexOf('?', slash_index);
    let query;
    if (query_index < 0) {
        query_index = source_url.length;
    } else {
        query = querystring.parse(source_url.slice(query_index + 1));
    }
    const bucket = decodeURIComponent(source_url.slice(start_index, slash_index));
    const key = decodeURIComponent(source_url.slice(slash_index + 1, query_index));
    return { query, bucket, key };
}


exports.parse_source_url = parse_source_url;
