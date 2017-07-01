/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETlifecycle.html
 */
function get_bucket_lifecycle(req) {
    return req.object_sdk.get_bucket_lifecycle_configuration_rules({ name: req.params.bucket })
        .then(reply => ({
            LifecycleConfiguration: _.map(reply, rule => ({
                Rule: [{
                        ID: rule.id,
                        Prefix: rule.prefix,
                        Status: rule.status,
                    },
                    rule.transition ? {
                        Transition: {
                            Days: rule.transition.days,
                            StorageClass: rule.transition.storage_class,
                        }
                    } : {},
                    rule.expiration ? {
                        Expiration: (rule.expiration.days ? {
                            Days: rule.expiration.days,
                            ExpiredObjectDeleteMarker: rule.expiration.expired_object_delete_marker ?
                                rule.expiration.expired_object_delete_marker : {}
                        } : {
                            Date: rule.expiration.date,
                            ExpiredObjectDeleteMarker: rule.expiration.expired_object_delete_marker ?
                                rule.expiration.expired_object_delete_marker : {}
                        })
                    } : {},
                    rule.noncurrent_version_transition ? {
                        NoncurrentVersionTransition: {
                            NoncurrentDays: rule.noncurrent_version_transition.noncurrent_days,
                            StorageClass: rule.noncurrent_version_transition.storage_class,
                        }
                    } : {},
                    rule.noncurrent_version_expiration ? {
                        NoncurrentVersionExpiration: {
                            NoncurrentDays: rule.noncurrent_version_expiration.noncurrent_days,
                        }
                    } : {}
                ]
            }))
        }));
}

module.exports = {
    handler: get_bucket_lifecycle,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
