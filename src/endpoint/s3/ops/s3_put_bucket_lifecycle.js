/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const { v4: uuid } = require('uuid');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTlifecycle.html
 */
async function put_bucket_lifecycle(req) {

    // <Rule>
    //   <ID>id2</ID>
    //   <Filter>
    //     <Prefix>logs/</Prefix> 
    //   </Filter>
    //   <Status>Enabled</Status>
    //   <Expiration>
    //     <Days>365</Days>
    //   </Expiration>
    // </Rule>
    const lifecycle_rules = _.map(req.body.LifecycleConfiguration.Rule, rule => {
        let rule_id = uuid().split('-')[0];
        if (rule.ID) {
            rule_id = rule.ID[0];
        }
        const current_rule = {
            id: rule_id,
            filter: {},
            status: rule.Status[0]
        };
        if (rule.Prefix) {
            dbg.error('Rule should not have prefix, it should be filter.prefix', rule);
            throw new S3Error(S3Error.InvalidArgument);
        }
        if (rule.Filter) {
            if (rule.Filter.length > 1 || rule.Filter[0].ObjectSizeGreaterThan || rule.Filter[0].ObjectSizeLessThan) {
                throw new S3Error(S3Error.NotImplemented);
            }
            if (rule.Filter[0].Prefix) {
                current_rule.filter.prefix = rule.Filter[0].Prefix[0];
            }
        }
        if (rule.Expiration) {
            current_rule.expiration = {};
            if (rule.Expiration[0].Days) {
                current_rule.expiration.days = parseInt(rule.Expiration[0].Days[0], 10);
                if (rule.Expiration[0].Days < 1) {
                    throw new S3Error(S3Error.InvalidArgument);
                }
            }

            if (rule.Expiration[0].Date) {
                current_rule.expiration.date = (new Date(rule.Expiration[0].Date[0])).getTime();
            }

            if (rule.Expiration[0].ExpiredObjectDeleteMarker) {
                current_rule.expiration.expired_object_delete_marker = rule.Expiration[0].ExpiredObjectDeleteMarker[0] === 'true';
            }

        }
        if (rule.AbortIncompleteMultipartUpload) {
            current_rule.abort_incomplete_multipart_upload = {
                days_after_initiation: rule.AbortIncompleteMultipartUpload[0].DaysAfterInitiation ?
                    parseInt(rule.AbortIncompleteMultipartUpload[0].DaysAfterInitiation[0], 10) : null
            };
        }
        if (rule.Transition) {
            current_rule.transition = {
                date: rule.Transition[0].Date ? (new Date(rule.Transition[0].Date[0])).getTime() : null,
                storage_class: rule.Transition[0].StorageClass ? rule.Transition[0].StorageClass[0] : 'STANDARD_IA'
            };
        }
        if (rule.NoncurrentVersionExpiration) {
            current_rule.noncurrent_version_expiration = {
                noncurrent_days: rule.NoncurrentVersionExpiration[0].NoncurrentDays ?
                    parseInt(rule.NoncurrentVersionExpiration[0].NoncurrentDays[0], 10) : null
            };
        }
        if (rule.NoncurrentVersionTransition) {
            current_rule.noncurrent_version_transition = {
                noncurrent_days: rule.NoncurrentVersionTransition[0].NoncurrentDays ?
                    parseInt(rule.NoncurrentVersionTransition[0].NoncurrentDays[0], 10) : null,
                storage_class: rule.NoncurrentVersionTransition[0].StorageClass ?
                    rule.NoncurrentVersionTransition[0].StorageClass[0] : 'STANDARD_IA'
            };
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
