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


        if (rule.filter.and) {
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

        // Generally expiration is optional,
        // however NooBaa implements expiration only, so it is expected here.
        current_rule.Expiration = {
            Days: rule.expiration.days,
        };
        if (rule.expiration.date) {
            current_rule.Expiration.Date = new Date(rule.expiration.date).toISOString();
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
