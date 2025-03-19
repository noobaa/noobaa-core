/* Copyright (C) 2022 NooBaa */
'use strict';

const _ = require('lodash');
const crypto = require('crypto');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;

const true_regex = /true/i;

// parse lifecycle rule filter
function parse_filter(filter) {
    const current_rule_filter = {};
    if (filter.Tag?.length === 1) {
        const tag = filter.Tag[0];
        current_rule_filter.tags = [{ key: tag.Key[0], value: tag.Value[0] }];
    }
    if (filter.Prefix?.length === 1) {
        current_rule_filter.prefix = filter.Prefix[0];
    }
    if (filter.ObjectSizeGreaterThan?.length === 1) {
        current_rule_filter.object_size_greater_than = parseInt(filter.ObjectSizeGreaterThan[0], 10);
    }
    if (filter.ObjectSizeLessThan?.length === 1) {
        current_rule_filter.object_size_less_than = parseInt(filter.ObjectSizeLessThan[0], 10);
    }
    if (current_rule_filter.object_size_greater_than !== undefined &&
        current_rule_filter.object_size_less_than !== undefined &&
        current_rule_filter.object_size_greater_than >= current_rule_filter.object_size_less_than) {
        dbg.error('Invalid size range: filter', filter, 'size range: object_size_greater_than', current_rule_filter.object_size_greater_than, '>= object_size_less_than', current_rule_filter.object_size_less_than);
        throw new S3Error(S3Error.InvalidArgument);
    }
    if (filter.And?.length === 1) {
        current_rule_filter.and = true;
        if (filter.And[0].Prefix?.length === 1) {
            current_rule_filter.prefix = filter.And[0].Prefix[0];
        }
        current_rule_filter.tags = _.map(filter.And[0].Tag, tag => ({ key: tag.Key[0], value: tag.Value[0] }));
        if (filter.And[0].ObjectSizeGreaterThan?.length === 1) {
            current_rule_filter.object_size_greater_than = parseInt(filter.And[0].ObjectSizeGreaterThan[0], 10);
        }
        if (filter.And[0].ObjectSizeLessThan?.length === 1) {
            current_rule_filter.object_size_less_than = parseInt(filter.And[0].ObjectSizeLessThan[0], 10);
        }
    }
    return current_rule_filter;
}

function reject_empty_field(field) {
    if (_.isEmpty(field)) {
        dbg.error('Invalid field - empty', field);
        throw new S3Error(S3Error.MalformedXML);
    }
}

// parse lifecycle rule expiration
function parse_expiration(expiration) {
    const output_expiration = {};
    if (expiration.Days?.length === 1) {
        output_expiration.days = parseInt(expiration.Days[0], 10);
        if (output_expiration.days < 1) {
            dbg.error('Minimum value for expiration days is 1, actual', expiration.Days,
                'converted', output_expiration.days);
            throw new S3Error(S3Error.InvalidArgument);
        }
    } else if (expiration.Date?.length === 1) {
        output_expiration.date = (new Date(expiration.Date[0])).getTime();
    } else if (expiration.ExpiredObjectDeleteMarker?.length === 1) {
        output_expiration.expired_object_delete_marker = true_regex.test(expiration.ExpiredObjectDeleteMarker[0]);
    }
    return output_expiration;
}

function parse_lifecycle_field(field, field_parser = parseInt) {
    if (field?.length === 1) {
        return field_parser(field[0]);
    }
    return undefined;
}

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTlifecycle.html
 */
async function put_bucket_lifecycle(req) {
    const lifecycle_rules = _.map(req.body.LifecycleConfiguration.Rule, rule => {
        const current_rule = {
            filter: {},
        };

        if (rule.ID?.length === 1) {
            current_rule.id = rule.ID[0];
        } else {
            // Generate a random ID if missing
            current_rule.id = crypto.randomUUID();
        }

        if (rule.Status?.length !== 1) {
            dbg.error('Rule should have status', rule);
            throw new S3Error(S3Error.InvalidArgument);
        }
        current_rule.status = rule.Status[0];

        if (rule.Prefix) {
            if (rule.Filter?.length === 1) {
                dbg.error('Rule should not have prefix together with a filter', rule);
                throw new S3Error(S3Error.InvalidArgument);
            }
            current_rule.filter.prefix = rule.Prefix[0];
            current_rule.uses_prefix = true;

        } else {
            if (rule.Filter?.length !== 1) {
                dbg.error('Rule should have filter', rule);
                throw new S3Error(S3Error.InvalidArgument);
            }
            current_rule.filter = parse_filter(rule.Filter[0]);
        }

        if (rule.Expiration?.length === 1) {
            current_rule.expiration = parse_expiration(rule.Expiration[0]);
            reject_empty_field(current_rule.expiration);
        }

        if (rule.AbortIncompleteMultipartUpload?.length === 1) {
            current_rule.abort_incomplete_multipart_upload = _.omitBy({
                days_after_initiation: parse_lifecycle_field(rule.AbortIncompleteMultipartUpload[0].DaysAfterInitiation),
            }, _.isUndefined);
            reject_empty_field(current_rule.abort_incomplete_multipart_upload);
        }

        if (rule.Transition?.length === 1) {
            current_rule.transition = _.omitBy({
                storage_class: parse_lifecycle_field(rule.Transition[0].StorageClass, String),
                date: parse_lifecycle_field(rule.Transition[0].Date, s => new Date(s)),
                days: parse_lifecycle_field(rule.Transition[0].Days),
            }, _.isUndefined);
            reject_empty_field(current_rule.transition);
        }

        if (rule.NoncurrentVersionExpiration?.length === 1) {
            current_rule.noncurrent_version_expiration = _.omitBy({
                noncurrent_days: parse_lifecycle_field(rule.NoncurrentVersionExpiration[0].NoncurrentDays),
                newer_noncurrent_versions: parse_lifecycle_field(rule.NoncurrentVersionExpiration[0].NewerNoncurrentVersions),
            }, _.isUndefined);
            reject_empty_field(current_rule.noncurrent_version_expiration);
        }

        if (rule.NoncurrentVersionTransition?.length === 1) {
            current_rule.noncurrent_version_transition = _.omitBy({
                storage_class: parse_lifecycle_field(rule.NoncurrentVersionTransition[0].StorageClass, String),
                noncurrent_days: parse_lifecycle_field(rule.NoncurrentVersionTransition[0].NoncurrentDays),
                newer_noncurrent_versions: parse_lifecycle_field(rule.NoncurrentVersionTransition[0].NewerNoncurrentVersions),
            }, _.isUndefined);
            reject_empty_field(current_rule.noncurrent_version_transition);
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
