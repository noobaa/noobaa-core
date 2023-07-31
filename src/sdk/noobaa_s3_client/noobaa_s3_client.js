/* Copyright (C) 2023 NooBaa */
'use strict';

const http = require('http');
const https = require('https');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { S3ClientSDKV2 } = require('./noobaa_s3_client_sdkv2');
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@aws-sdk/node-http-handler');
const config = require('../../../config');
const http_utils = require('../../util/http_utils');
const cloud_utils = require('../../util/cloud_utils');
const string_utils = require('../../util/string_utils');

// The params are the AWS SDK V3 params.
// params = a map of parameters that are passed to the constructor of S3 Object in order to to bind to every request
function get_s3_client_v3_params(params) {
    let s3_client;

    if (should_use_sdk_v2(params)) {
        change_s3_client_params_to_v2_structure(params);
        s3_client = new S3ClientSDKV2(params);
    } else {
        s3_client = new S3(params);
    }
    return s3_client;
}

// Here we decide which version of the sdk should we use:
// 1. by the flag AWS_SDK_VERSION_3_DISABLED (we use it as a workaround in case we want to use only AWS SDK V2).
// 2. signatureVersion defined? if it is 'v2' (signature version v2 is only supported in AWS SDK V2)
function should_use_sdk_v2(params) {
    return config.AWS_SDK_VERSION_3_DISABLED || (params.signatureVersion && params.signatureVersion === 'v2');
}

// we will use this function in debugging to print the class type easily
function get_sdk_class_str(s3) {
    if (s3 instanceof S3ClientSDKV2) return 'S3 Client SDK V2';
    return 'S3 Client SDK V3';
}

// This function gets map of params as they are written in AWS SDK V3
// and change the map of params as they appear in AWS SDK V2.
// The comments are based on AWS SDK V3 upgrading notes:
// https://github.com/aws/aws-sdk-js-v3/blob/main/UPGRADING.md
function change_s3_client_params_to_v2_structure(params) {
    // v2: s3ForcePathStyle, v3: forcePathStyle
    replace_field(params, 'forcePathStyle', 's3ForcePathStyle');

    // v2: sslEnabled, v3: tls
    replace_field(params, 'tls', 'sslEnabled');

    // v2: s3BucketEndpoint, v3: bucketEndpoint.
    // Note that when set to true, you specify the request endpoint in the Bucket request parameter,
    // the original endpoint will be overwritten.
    // Whereas in v2, the request endpoint in client constructor overwrites the Bucket request parameter.
    replace_field(params, 'bucketEndpoint', 's3BucketEndpoint');

    if (params.endpoint && params.requestHandler) {
        // v2: A set of options to pass to the low-level HTTP request.
        // v3: These options are aggregated differently in v3. All requests use HTTPS by default.
        // If you are passing custom endpoint which uses http, then you need to provide httpAgent
        const agent = http_utils.get_agent_by_endpoint(params.endpoint);
        params.httpOptions = {
            agent
        };
        delete params.requestHandler;
    }
}

// Replace in place a name of field in map params
function replace_field(params, remove_field, add_field) {
    if (params[remove_field] !== undefined) {
        params[add_field] = params[remove_field];
        delete params[remove_field];
    }
}

// This function allows us to wrap the agent by NodeHttpHandler
// The difference is between the property httpsAgent vs httpAgent (secure and unsecure)
// This function was created based on the use of http_utils.get_unsecured_agent
function get_requestHandler_with_suitable_agent(endpoint) {
    const agent = http_utils.get_agent_by_endpoint(endpoint);
    if (agent instanceof https.Agent || agent instanceof HttpsProxyAgent) {
        return new NodeHttpHandler({
            httpsAgent: agent
        });
    } else if (agent instanceof http.Agent || agent instanceof HttpProxyAgent) {
        return new NodeHttpHandler({
            httpAgent: agent
        });
    } else {
        throw new Error(`Protocol of ${endpoint} doesn't have a matching agent (valid only for HTTP, HTTPS, WSS only)`);
    }
}

// v2: code, v3: Code
function check_error_code(err, code) {
    return err.code === code || err.Code === code;
}

// We need to pass region for aws in the s3 client when using aws sdk v3.
// The region must match the bucket that we will run actions on.
// we will return the region if:
// 1. we have the region in the params.
// 2. we can extract it from the endpoint.
// 3. send a request with a default region using the target bucket:
//    3.1 no error - we have the region.
//    3.2 error - extract the region from the error parameters.
async function get_region(params, target_bucket) {
    let region;
    const endpoint = params.endpoint;
    if (!endpoint || !cloud_utils.is_aws_endpoint(endpoint) || should_use_sdk_v2(params)) {
        return;
    }
    if (params.region) {
        return params.region;
    }

    const endpoint_url = new URL(endpoint);
    // The endpoint host is a string like '{service}.{region}.amazonaws.com' (our case s3.{region}.amazonaws.com)
    region = endpoint_url.host.slice(string_utils.index_of_end(endpoint_url.host, 's3.'), endpoint_url.host.indexOf('.amazonaws.com'));
    if (region) {
        return region;
    }
    if (!target_bucket) {
        return;
    }

    // we would run an action with a default region and check if it works
    const { credentials } = params;
    // we use the minimum parameters needed to run an action on AWS.
    const s3_params_with_region = {
        credentials: credentials,
        region: config.DEFAULT_REGION
    };
    const s3_client_with_region = new S3(s3_params_with_region);
    try {
        // use an action that only needs a bucket
        await s3_client_with_region.listObjectsV2({
            Bucket: target_bucket,
            MaxKeys: 1
        });
        region = config.DEFAULT_REGION;
    } catch (err) {
        region = get_region_from_aws_error(err);
    }
    return region;
}

function get_region_from_aws_error(err) {
    let region;

    if (err.Code === 'AuthorizationHeaderMalformed') {
        region = err.Region;
    } else if (err.Code === 'TemporaryRedirect' || err.Code === 'PermanentRedirect') {
        const endpoint_in_error = err.Endpoint; // structure: {bucket}.s3-{region}.amazonaws.com
        region = endpoint_in_error.slice(string_utils.index_of_end(endpoint_in_error, '.s3-'), endpoint_in_error.indexOf('.amazonaws.com'));
    } else {
        throw new Error('Could not get bucket AWS S3 region, please add the region explicitly when passing AWS S3 connection details');
    }

    return region;
}

// in case we set a region and explicitly add the aws endpoint address it needs to contain the region
function get_non_global_aws_endpoint(endpoint, region) {
    if (region && (endpoint === 'https://s3.amazonaws.com' || endpoint === 'http://s3.amazonaws.com')) {
        const part_endpoint = endpoint.slice(0, endpoint.indexOf('.amazonaws.com'));
        const full_endpoint_with_region = `${part_endpoint}.${region}.${'amazonaws.com'}`;
        return full_endpoint_with_region;
    }
    return endpoint;
}

// EXPORTS
exports.get_s3_client_v3_params = get_s3_client_v3_params;
exports.change_s3_client_params_to_v2_structure = change_s3_client_params_to_v2_structure;
exports.get_sdk_class_str = get_sdk_class_str;
exports.check_error_code = check_error_code;
exports.get_requestHandler_with_suitable_agent = get_requestHandler_with_suitable_agent;
exports.get_region = get_region;
exports.get_non_global_aws_endpoint = get_non_global_aws_endpoint;
