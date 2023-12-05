/* Copyright (C) 2016 NooBaa */
'use strict';

const querystring = require('querystring');
const http_utils = require('../util/http_utils');
const path = require('path');
const json_utils = require('../util/json_utils');
const dbg = require('../util/debug_module')(__filename);

function prepare_rest_request(req) {
    // generate request id, this is lighter than uuid
    req.request_id = `${
        Date.now().toString(36)
    }-${
        process.hrtime()[1].toString(36)
    }-${
        Math.trunc(Math.random() * 65536).toString(36)
    }`;
    http_utils.parse_url_query(req);
}

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

async function get_nsfs_system_property(property, nsfs_config_root) {
    let system_data_path;
    try {
        if (nsfs_config_root) {
            system_data_path = path.join(nsfs_config_root, 'system.json');
            const system_data = new json_utils.JsonFileWrapper(system_data_path);
            const data = await system_data.read();
            return data[property];
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            dbg.log0(`System file not found in path ${system_data_path}`);
        } else {
            dbg.error(`Error while loading system file ${system_data_path}:`, err.message);
        }
    }
}

exports.prepare_rest_request = prepare_rest_request;
exports.parse_source_url = parse_source_url;
exports.get_nsfs_system_property = get_nsfs_system_property;
