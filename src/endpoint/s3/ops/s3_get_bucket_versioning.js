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
            if (bucket_info.versioning === 'ENABLED') {
                reply.VersioningConfiguration.Status = 'Enabled';
            } else if (bucket_info.versioning === 'SUSPENDED') {
                reply.VersioningConfiguration.Status = 'Suspended';
            }
            return reply;
        });
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
