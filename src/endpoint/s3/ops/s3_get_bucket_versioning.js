/* Copyright (C) 2016 NooBaa */
'use strict';

const GET_VERSIONING_STATUS_MAP = Object.freeze({
    ENABLED: 'Enabled',
    SUSPENDED: 'Suspended',
});

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETversioningStatus.html
 */
async function get_bucket_versioning(req) {

    // TODO: There is also MFA Delete configuration that we do not support

    const bucket_info = await req.object_sdk.read_bucket({ name: req.params.bucket });

    return {
        VersioningConfiguration: {
            Status: GET_VERSIONING_STATUS_MAP[bucket_info.versioning]
        }
    };
}

module.exports = {
    handler: get_bucket_versioning,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
