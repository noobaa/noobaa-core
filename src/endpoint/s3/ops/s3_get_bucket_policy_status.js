/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetBucketPolicyStatus.html
 */
async function get_bucket_policy_status(req) {
    const reply = await req.object_sdk.get_bucket_policy({ name: req.params.bucket });
    if (!reply.policy) throw new S3Error(S3Error.NoSuchBucketPolicy);
    const is_public = _is_policy_public(reply.policy);
    return { PolicyStatus: {IsPublic: is_public} };
}

// TODO: implemented according to current implementation of authorize_request_policy. should update when authorize_request_policy changed
// full public policy defintion: https://docs.aws.amazon.com/AmazonS3/latest/dev/access-control-block-public-access.html#access-control-block-public-access-policy-status
function _is_policy_public(policy) {
    for (const statement of policy.statement) {
        let principal_wildcard = false;
        let resource_wildcard = false;
        if (statement.effect === 'deny') {
            return false;
        }
        for (const principal of statement.principal) {
            if (principal.unwrap() === '*') {
                principal_wildcard = true;
            }
        }
        for (const resource of statement.resource) {
            if ((/[?*]/).test(resource)) {
                resource_wildcard = true;
            }
        }
        if (!principal_wildcard || !resource_wildcard) {
            return false;
        }
    }
    return true;
}

module.exports = {
    handler: get_bucket_policy_status,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
