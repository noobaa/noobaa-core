/* Copyright (C) 2022 NooBaa */
'use strict';

const _ = require('lodash');
const { v4: uuid } = require('uuid');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;

// parse lifecycle rule filter
function parse_filter(filter) {
    const current_rule_filter = {};
    if (filter.Tag && filter.Tag.length === 1) {
        const tag = filter.Tag[0];
        current_rule_filter.tags = [{ key: tag.Key[0], value: tag.Value[0] }];
    }
    if (filter.Prefix && filter.Prefix.length === 1) {
        current_rule_filter.prefix = filter.Prefix[0];
    }
    if (filter.ObjectSizeGreaterThan &&
        filter.ObjectSizeGreaterThan.length === 1) {
        current_rule_filter.object_size_greater_than = parseInt(filter.ObjectSizeGreaterThan[0], 10);
    }
    if (filter.ObjectSizeLessThan &&
        filter.ObjectSizeLessThan.length === 1) {
        current_rule_filter.object_size_less_than = parseInt(filter.ObjectSizeLessThan[0], 10);
    }
    if (current_rule_filter.object_size_greater_than !== undefined &&
        current_rule_filter.object_size_less_than !== undefined &&
        current_rule_filter.object_size_greater_than >= current_rule_filter.object_size_less_than) {
        dbg.error('Invalid size range: filter', filter, 'size range: object_size_greater_than', current_rule_filter.object_size_greater_than, '>= object_size_less_than', current_rule_filter.object_size_less_than);
        throw new S3Error(S3Error.InvalidArgument);
    }
    if (filter.And &&
        filter.And.length === 1) {

        current_rule_filter.and = true;
        if (filter.And[0].Prefix &&
            filter.And[0].Prefix.length === 1) {
                current_rule_filter.prefix = filter.And[0].Prefix[0];
        }
        current_rule_filter.tags = _.map(filter.And[0].Tag, tag => ({ key: tag.Key[0], value: tag.Value[0]}));
        if (filter.And[0].ObjectSizeGreaterThan &&
            filter.And[0].ObjectSizeGreaterThan.length === 1) {
            current_rule_filter.object_size_greater_than = parseInt(filter.And[0].ObjectSizeGreaterThan[0], 10);
        }
        if (filter.And[0].ObjectSizeLessThan &&
            filter.And[0].ObjectSizeLessThan.length === 1) {
            current_rule_filter.object_size_less_than = parseInt(filter.And[0].ObjectSizeLessThan[0], 10);
        }
    }
    return current_rule_filter;
}

// parse lifecycle rule expiration
function parse_expiration(expiration) {
    const output_expiration = {};
    if (expiration.Days && expiration.Days.length === 1) {
        output_expiration.days = parseInt(expiration.Days[0], 10);
        if (output_expiration.days < 1) {
            dbg.error('Minimum value for expiration days is 1, actual', expiration.Days,
                'converted', output_expiration.days);
            throw new S3Error(S3Error.InvalidArgument);
        }
    } else if (expiration.Date && expiration.Date.length === 1) {
        output_expiration.date = (new Date(expiration.Date[0])).getTime();
    } else if (expiration.ExpiredObjectDeleteMarker &&
               expiration.ExpiredObjectDeleteMarker.length === 1 &&
               expiration.ExpiredObjectDeleteMarker[0] === 'true') {
        dbg.error('ExpiredObjectDeleteMarker is not implemented, expiration:', expiration);
        throw new S3Error(S3Error.NotImplemented);
    }
    return output_expiration;
}

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTlifecycle.html
 */
async function put_bucket_lifecycle(req) {
    const lifecycle_rules = _.map(req.body.LifecycleConfiguration.Rule, rule => {
        const current_rule = {
            filter: {},
        };

        if (rule.ID && rule.ID.length === 1) {
            current_rule.id = rule.ID[0];
        } else {
            // Generate a random ID if missing
            current_rule.id = uuid();
        }

        if (!(rule.Status && rule.Status.length === 1)) {
            dbg.error('Rule should have status', rule);
            throw new S3Error(S3Error.InvalidArgument);
        }
        current_rule.status = rule.Status[0];

        if (rule.Prefix) {
            dbg.error('Rule should not have prefix, it should be filter.prefix', rule);
            throw new S3Error(S3Error.InvalidArgument);
        }

        if (!(rule.Filter && rule.Filter.length === 1)) {
            dbg.error('Rule should have filter', rule);
            throw new S3Error(S3Error.InvalidArgument);
        }
        current_rule.filter = parse_filter(rule.Filter[0]);

        // Since other actions are not implemented, Expiration
        // is expected here
        if (!(rule.Expiration && rule.Expiration.length === 1)) {
            dbg.error('Rule is expected to have expiration', rule);
            throw new S3Error(S3Error.NotImplemented);
        }
        current_rule.expiration = parse_expiration(rule.Expiration[0]);

        if (rule.AbortIncompleteMultipartUpload) {
            dbg.error('AbortIncompleteMultipartUpload is not implemented, rule:', rule);
            throw new S3Error(S3Error.NotImplemented);
        }
        if (rule.Transition) {
            dbg.error('Transition is not implemented, rule:', rule);
            throw new S3Error(S3Error.NotImplemented);
        }
        if (rule.NoncurrentVersionExpiration) {
            dbg.error('NoncurrentVersionExpiration is not implemented, rule:', rule);
            throw new S3Error(S3Error.NotImplemented);
        }
        if (rule.NoncurrentVersionTransition) {
            dbg.error('NoncurrentVersionTransition is not implemented, rule:', rule);
            throw new S3Error(S3Error.NotImplemented);
        }

        return current_rule;
    });

    await req.object_sdk.set_bucket_lifecycle_configuration_rules({
        name: req.params.bucket,
        rules: lifecycle_rules
    });

    dbg.log0('set_bucket_lifecycle', lifecycle_rules);
}

module.exports = {
    handler: put_bucket_lifecycle,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
