/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETlifecycle.html
 */
async function get_bucket_lifecycle(req) {
    const reply = await req.object_sdk.get_bucket_lifecycle_configuration_rules({ name: req.params.bucket });
    const rules = _.map(reply, rule => {
        const current_rule = {
            ID: rule.id,
            Status: rule.status,
        };


        if (rule.uses_prefix) {
            current_rule.Prefix = rule.filter.prefix;
        } else if (rule.filter.and) {
            current_rule.Filter = {
                And: [{
                        Prefix: rule.filter.prefix,
                        ObjectSizeGreaterThan: rule.filter.object_size_greater_than,
                        ObjectSizeLessThan: rule.filter.object_size_less_than,
                    },
                    _.map(rule.filter.tags, tag => ({ Tag: { Key: tag.key, Value: tag.value } })),
                ],
            };
        } else {
            current_rule.Filter = {
                Prefix: rule.filter.prefix,
                ObjectSizeGreaterThan: rule.filter.object_size_greater_than,
                ObjectSizeLessThan: rule.filter.object_size_less_than,
            };
            if (rule.filter.tags) {
                const tag = rule.filter.tags[0];
                current_rule.Filter.Tag = {
                    Key: tag.key,
                    Value: tag.value
                };
            }
        }


        if (rule.expiration) {
            current_rule.Expiration = {
                Days: rule.expiration.days,
                Date: rule.expiration.date ? new Date(rule.expiration.date).toISOString() : undefined,
            };
            _.omitBy(current_rule.Expiration, _.isUndefined);
        }

        if (rule.transition) {
            current_rule.Transition = {
                Days: rule.transition.days,
                Date: rule.transition.date ? new Date(rule.transition.date).toISOString() : undefined,
                StorageClass: rule.transition.storage_class,
            };
            _.omitBy(current_rule.Transition, _.isUndefined);
        }

        if (rule.noncurrent_version_transition) {
            current_rule.NoncurrentVersionTransition = {
                NoncurrentDays: rule.noncurrent_version_transition.noncurrent_days,
                NewerNoncurrentVersions: rule.noncurrent_version_transition.newer_noncurrent_versions,
                StorageClass: rule.noncurrent_version_transition.storage_class,
            };
            _.omitBy(current_rule.NoncurrentVersionTransition, _.isUndefined);
        }

        if (rule.noncurrent_version_expiration) {
            current_rule.NoncurrentVersionExpiration = {
                NoncurrentDays: rule.noncurrent_version_expiration.noncurrent_days,
                NewerNoncurrentVersions: rule.noncurrent_version_expiration.newer_noncurrent_versions,
            };
            _.omitBy(current_rule.NoncurrentVersionExpiration, _.isUndefined);
        }

        if (rule.abort_incomplete_multipart_upload) {
            current_rule.AbortIncompleteMultipartUpload = {
                DaysAfterInitiation: rule.abort_incomplete_multipart_upload.days_after_initiation,
            };
            _.omitBy(current_rule.AbortIncompleteMultipartUpload, _.isUndefined);
        }




        return { Rule: current_rule };
    });

    return { LifecycleConfiguration: rules };
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
