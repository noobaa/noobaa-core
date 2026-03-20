/* Copyright (C) 2025 NooBaa */
'use strict';

const _ = require('lodash');

const { VectorError } = require('../vector_errors');

const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListVectors.html
 */
async function post_list_vectors(req, res) {

    dbg.log0("post_list_vectors body = ", req.body);

    const fieldList = [];

    const next_token = req.body.nextToken;
    if (!next_token_sanity_check(next_token)) {
        fieldList.push({path: 'nextToken', message: "Bad nextToken"});
    }

    const segment_count = req.body.segmentCount;
    const segment_index = req.body.segmentIndex;
    const validation_error = segment_validate(segment_count, segment_index);

    if (validation_error) {
        fieldList.push(validation_error);
    }

    if (fieldList.length > 0) {
        //validation failed
        throw new VectorError({
            code: VectorError.ValidationException.code,
            http_code: VectorError.ValidationException.http_code,
            message: VectorError.ValidationException.message,
            fieldList,
        });
    }

    const list = await req.vector_sdk.list_vectors({
        vector_bucket_name: req.body.vectorBucketName,
        vector_index_name: req.body.indexName,
        max_results: req.body.maxResults || 500,
        return_data: req.body.returnData,
        return_metadata: req.body.returnMetadata,
        segment_count,
        segment_index,
        next_token,
    });

    dbg.log0("post_list_vectors list =", list);

    return list;
}

function segment_validate(count, index) {
    if (_.isNil(count) && _.isNil(index)) return; //no segments, nothing to do.
    if (_.isNil(count)) return {path: "segmentCount", message: "Missing"};
    if (_.isNil(index)) return {path: "segmentIndex", message: "Missing"};
    if (!Number.isInteger(count)) return {path: "segmentCount", message: "Must be an integer."};
    if (!Number.isInteger(index)) return {path: "segmentIndex", message: "Must be an integer."};
    if (count <= 0) return {path: "segmentCount", message: "Must be greater than zero."};
    if (index < 0) return {path: "segmentIndex", message: "Cannot be negative."};
    if (index >= count) return {path: "segmentIndex", message: "Must be less than segmentCount."};
}

//validate next_token is of the form number_number
function next_token_sanity_check(next_token) {
    if (!next_token) return true;
    const delim = next_token.indexOf('_');
    if (delim === -1) return false;
    const split = next_token.split('_');
    if (split.length !== 2) return false;
    if (split[0] === '' || split[1] === '') return false;
    const start = Number(split[0]);
    const end = Number(split[1]);
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0) return false;
    if (start >= end) return false;
    return true;
}

exports.handler = post_list_vectors;
