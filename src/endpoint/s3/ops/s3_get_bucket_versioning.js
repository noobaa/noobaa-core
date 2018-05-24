/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETversioningStatus.html
 */
function get_bucket_versioning(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            // TODO: There is also MFA Delete configuration that we do not support
            const reply = {
                VersioningConfiguration: {}
            };
            if (bucket_info.versioning !== 'DISABLED') {
                reply.VersioningConfiguration.Status = _capitalize(bucket_info.versioning);
            }
            return reply;
        });
}

function _capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
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
