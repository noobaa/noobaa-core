/* Copyright (C) 2023 NooBaa */
'use strict';

const http = require('http');
const https = require('https');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { S3ClientSDKV2 } = require('./noobaa_s3_client_sdkv2');
const { S3ClientAutoRegion } = require('./noobaa_s3_client_sdkv3');
const { NodeHttpHandler } = require("@aws-sdk/node-http-handler");
const config = require('../../../config');
const http_utils = require('../../util/http_utils');

// The params are the AWS SDK V3 params.
// params = a map of parameters that are passed to the constructor of S3 Object in order to to bind to every request
function get_s3_client_v3_params(params) {
    let s3_client;

    if (should_use_sdk_v2(params)) {
        change_s3_client_params_to_v2_structure(params);
        s3_client = new S3ClientSDKV2(params);
    } else {
        s3_client = new S3ClientAutoRegion(params);
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

// EXPORTS
exports.get_s3_client_v3_params = get_s3_client_v3_params;
exports.change_s3_client_params_to_v2_structure = change_s3_client_params_to_v2_structure;
exports.get_sdk_class_str = get_sdk_class_str;
exports.check_error_code = check_error_code;
exports.get_requestHandler_with_suitable_agent = get_requestHandler_with_suitable_agent;
