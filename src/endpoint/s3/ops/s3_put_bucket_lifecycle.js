/* Copyright (C) 2022 NooBaa */
'use strict';

const _ = require('lodash');
const s3_const = require('../s3_constants');
const crypto = require('crypto');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;

const true_regex = /true/i;
const MAX_LIFECYCLE_RULES = 1000; // AWS limit
const MAX_TAGS_IN_AND_FILTER = 10;

/**
 * @param {*} field 
 * @param {(any) => any} field_parser 
 * @returns {any}
 */
function parse_lifecycle_field(field, field_parser = parseInt) {
    if (field?.length === 1) {
        const parsed_value = field_parser(field[0]);
        // Basic NaN check for parseInt results
        if (field_parser === parseInt && isNaN(parsed_value)) {
            dbg.error(`Invalid integer value provided for field: ${field[0]}`);
            // Use generic MalformedXML or InvalidArgument based on context
            throw new S3Error(S3Error.InvalidArgument);
        }
        return parsed_value;
    }
    return undefined;
}

function validate_lifecycle_expiration_rule(rule, bucket_versioning) {
    if (rule.Expiration?.length === 1) {
        const expiration_content = rule.Expiration[0];
        const expiration_keys = Object.keys(expiration_content);
        if (expiration_keys.length > 1) {
            dbg.error('Rule Expiration must specify only one of: Days, Date, or ExpiredObjectDeleteMarker', rule);
            throw new S3Error(S3Error.MalformedXML);
        }
        if (expiration_content.Date) {
            const date = new Date(expiration_content.Date[0]);
            if (isNaN(date.getTime()) || date.getTime() !== Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())) {
                dbg.error('Expiration Date value must conform to the ISO 8601 format and be at midnight UTC. Provided:', expiration_content.Date[0]);
                throw new S3Error({ ...S3Error.InvalidArgument, message: "'Date' must be at midnight GMT" });
            }
        }
        if (expiration_content.Days) {
            const days = parseInt(expiration_content.Days[0], 10);
            if (isNaN(days) || days < 1) {
                dbg.error('Minimum value for Expiration Days is 1, received:', expiration_content.Days[0]);
                throw new S3Error({ ...S3Error.InvalidArgument, message: 'Expiration Days must be a positive integer' });
            }
        }
        if (expiration_content.ExpiredObjectDeleteMarker) {
            if (expiration_content.ExpiredObjectDeleteMarker[0].toLowerCase() !== 'true') {
                 dbg.error('ExpiredObjectDeleteMarker must be "true" if specified', rule);
                 throw new S3Error({ ...S3Error.InvalidArgument, message: 'ExpiredObjectDeleteMarker must be true if specified' });
            }
            if (bucket_versioning !== 'ENABLED') {
                dbg.warn('ExpiredObjectDeleteMarker specified but bucket versioning is not ENABLED.', rule);
            }
        }
    }
}

function validate_lifecycle_noncurrentexp_rule(rule, bucket_versioning) {
    if (rule.NoncurrentVersionExpiration?.length === 1) {
         const nve_content = rule.NoncurrentVersionExpiration[0];
         if (!nve_content.NoncurrentDays || nve_content.NoncurrentDays.length !== 1) {
             dbg.error('NoncurrentVersionExpiration action must specify NoncurrentDays', rule);
             throw new S3Error(S3Error.MalformedXML);
         }
         const days = parseInt(nve_content.NoncurrentDays[0], 10);
         if (isNaN(days) || days < 1) {
             dbg.error('Minimum value for NoncurrentVersionExpiration NoncurrentDays is 1, received:', nve_content.NoncurrentDays[0]);
             throw new S3Error({ ...S3Error.InvalidArgument, message: 'NoncurrentVersionExpiration NoncurrentDays must be a positive integer' });
         }
         // Validate NewerNoncurrentVersions if present
         if (nve_content.NewerNoncurrentVersions) {
            const newer_versions = parseInt(nve_content.NewerNoncurrentVersions[0], 10);
            if (isNaN(newer_versions) || newer_versions < 1) {
                dbg.error('NewerNoncurrentVersions must be a positive integer if specified, received:', nve_content.NewerNoncurrentVersions[0]);
                throw new S3Error({ ...S3Error.InvalidArgument, message: 'NewerNoncurrentVersions must be a positive integer' });
            }
         }
         if (bucket_versioning !== 'ENABLED') {
            dbg.warn('NoncurrentVersionExpiration specified but bucket versioning is not ENABLED.', rule);
        }
    }
}

function validate_lifecycle_abortmultipart_rule(rule, has_filter) {
    if (rule.AbortIncompleteMultipartUpload?.length === 1) {
        const abort_content = rule.AbortIncompleteMultipartUpload[0];
        if (!abort_content.DaysAfterInitiation || abort_content.DaysAfterInitiation.length !== 1) {
            dbg.error('AbortIncompleteMultipartUpload action must specify DaysAfterInitiation', rule);
            throw new S3Error(S3Error.MalformedXML);
        }
        const days = parseInt(abort_content.DaysAfterInitiation[0], 10);
        if (isNaN(days) || days < 1) {
            dbg.error('Minimum value for AbortIncompleteMultipartUpload DaysAfterInitiation is 1, received:', abort_content.DaysAfterInitiation[0]);
            throw new S3Error({ ...S3Error.InvalidArgument, message: 'DaysAfterInitiation for AbortIncompleteMultipartUpload must be a positive integer' });
        }

        // Check incompatibility with Filter types
        if (has_filter) {
            const filter_content = rule.Filter[0];
            if (filter_content.Tag) {
                dbg.error('AbortIncompleteMultipartUpload cannot be specified with a Tag filter', rule);
                throw new S3Error({ ...S3Error.InvalidArgument, message: 'The action is not supported for rules that apply to objects that have tags.' });
            }
            if (filter_content.ObjectSizeGreaterThan || filter_content.ObjectSizeLessThan) {
                dbg.error('AbortIncompleteMultipartUpload cannot be specified with an ObjectSize filter', rule);
                throw new S3Error({ ...S3Error.InvalidArgument, message: 'AbortIncompleteMultipartUpload action cannot be specified with an ObjectSize filter.' });
            }
            if (filter_content.And) {
                 // Check if And contains disallowed filters for Abort
                 const and_content = filter_content.And[0];
                 if (and_content.Tag) {
                     dbg.error('AbortIncompleteMultipartUpload cannot be specified with a Tag filter inside And', rule);
                     throw new S3Error({ ...S3Error.InvalidArgument, message: 'The action is not supported for rules that apply to objects that have tags.' });
                 }
                 if (and_content.ObjectSizeGreaterThan || and_content.ObjectSizeLessThan) {
                    dbg.error('AbortIncompleteMultipartUpload cannot be specified with an ObjectSize filter inside And', rule);
                    throw new S3Error({ ...S3Error.InvalidArgument, message: 'AbortIncompleteMultipartUpload action cannot be specified with an ObjectSize filter.' });
                }
            }
        }
    }
}

/**
 * validate_lifecycle_rule validates lifecycle rule structure and logical constraints based on AWS S3 rules.
 * Skips validation for Transition and NoncurrentVersionTransition as they are not supported.
 *
 * @param {Object} rule - lifecycle rule to validate
 * @param {string} bucket_versioning - Bucket versioning status ('ENABLED', 'SUSPENDED', or null)
 * @throws {S3Error} - on validation failure
 */
function validate_lifecycle_rule(rule, bucket_versioning) {
    if (rule.ID?.length === 1 && rule.ID[0].length > s3_const.MAX_RULE_ID_LENGTH) {
        dbg.error('Rule ID length exceeds maximum limit:', s3_const.MAX_RULE_ID_LENGTH, rule);
        throw new S3Error({ ...S3Error.InvalidArgument, message: `ID length should not exceed allowed limit of ${s3_const.MAX_RULE_ID_LENGTH}` });
    }

    if (!rule.Status || rule.Status.length !== 1 ||
        (rule.Status[0] !== s3_const.LIFECYCLE_STATUS.STAT_ENABLED && rule.Status[0] !== s3_const.LIFECYCLE_STATUS.STAT_DISABLED)) {
        dbg.error('Rule Status must be "Enabled" or "Disabled"', rule);
        throw new S3Error(S3Error.MalformedXML);
    }

    const has_filter = rule.Filter?.length === 1;
    const has_deprecated_prefix = rule.Prefix?.length === 1;

    if (has_filter && has_deprecated_prefix) {
        dbg.error('Rule should not specify both Filter and Prefix elements', rule);
        throw new S3Error({ ...S3Error.InvalidArgument, message: 'The Filter and Prefix elements are mutually exclusive. You can specify one or the other, but not both.' });
    }

     if (!has_filter && !has_deprecated_prefix) {
        // Allow rule without Filter or Prefix (applies to all objects)
        // Add empty filter structure for parsing consistency later
        if (!rule.Filter) rule.Filter = [{}];
    } else if (has_filter) {
        const filter_content = rule.Filter[0];
        const filter_keys = Object.keys(filter_content);
        if (filter_keys.length === 0) {
             // Empty <Filter></Filter> is valid, implies rule applies to all objects.
        } else if (filter_content.And) {
            // If 'And' is present, it's the main filter type. Other direct types (Prefix, Tag, ObjectSize) are not allowed at the same level.
            if (filter_keys.length > 1) {
                dbg.error('Rule Filter cannot have And specified with other top-level filter types (Prefix, Tag, ObjectSize...)', rule);
                throw new S3Error(S3Error.MalformedXML);
            }
            // Validation within 'And' happens during parsing (parse_filter)
        } else if (filter_content.Prefix && filter_keys.length > 1) {
             dbg.error('Rule Filter cannot have Prefix specified with other filter types (Tag, ObjectSize...) unless within And', rule);
             throw new S3Error(S3Error.MalformedXML);
        } else if (filter_content.Tag && filter_keys.length > 1) {
             dbg.error('Rule Filter cannot have Tag specified with other filter types (Prefix, ObjectSize...) unless within And', rule);
             throw new S3Error(S3Error.MalformedXML);
        } else if ((filter_content.ObjectSizeGreaterThan || filter_content.ObjectSizeLessThan) && filter_keys.length > 1) {
            if (!filter_content.ObjectSizeGreaterThan || !filter_content.ObjectSizeLessThan || filter_keys.length > 2) {
                dbg.error('Rule Filter cannot have ObjectSize specified with other filter types (Prefix, Tag) unless within And', rule);
                throw new S3Error(S3Error.MalformedXML);
            }
        }
         // Case: Only one of Prefix, Tag, ObjectSizeGreaterThan, ObjectSizeLessThan, or both ObjectSize filters - Valid.
    }

    // Action Validations
    const actions = ['Expiration', 'Transition', 'NoncurrentVersionExpiration', 'NoncurrentVersionTransition', 'AbortIncompleteMultipartUpload'];
    const specified_actions = actions.filter(action => rule[action]?.length > 0); // Check length > 0 for multi-transitions

    if (specified_actions.length === 0) {
        dbg.error('Rule must specify at least one action.', rule);
        throw new S3Error({ ...S3Error.InvalidArgument, message: 'Found rule without an action specified.' });
    }

    // Expiration Validation
    validate_lifecycle_expiration_rule(rule, bucket_versioning);

    // --- Transition Validation SKIPPED (NooBaa does not support Transition) ---

    // NoncurrentVersionExpiration Validation
    validate_lifecycle_noncurrentexp_rule(rule, bucket_versioning);

    // --- NoncurrentVersionTransition Validation SKIPPED (NooBaa does not support NoncurrentVersionTransition) ---

    // AbortIncompleteMultipartUpload Validation
    validate_lifecycle_abortmultipart_rule(rule, has_filter);
}


// parse lifecycle rule filter
function parse_filter(filter) {
    const current_rule_filter = {};
    const filter_keys = Object.keys(filter);

    if (filter_keys.length === 0) {
        // Empty filter applies to all objects
        return {};
    }

    if (filter.And) {
        // Handle 'And' filter
        current_rule_filter.and = true; // Indicate 'And' was used
        const and_content = filter.And[0];
        if (and_content.Prefix?.length === 1) {
            current_rule_filter.prefix = and_content.Prefix[0];
        }
        if (and_content.Tag) {
             if (and_content.Tag.length > MAX_TAGS_IN_AND_FILTER) {
                dbg.error('Maximum number of tags allowed in And filter is', MAX_TAGS_IN_AND_FILTER, filter);
                throw new S3Error({ ...S3Error.InvalidArgument, message: `A Filter may contain at most ${MAX_TAGS_IN_AND_FILTER} Tags.` });
            }
            current_rule_filter.tags = _.map(and_content.Tag, tag => {
                if (!tag.Key || tag.Key.length !== 1 || !tag.Value || tag.Value.length !== 1) {
                    dbg.error('Malformed Tag structure within And filter', tag);
                    throw new S3Error(S3Error.MalformedXML);
                }
                return { key: tag.Key[0], value: tag.Value[0] };
            });
        }
        if (and_content.ObjectSizeGreaterThan?.length === 1) {
            current_rule_filter.object_size_greater_than = parseInt(and_content.ObjectSizeGreaterThan[0], 10);
            if (isNaN(current_rule_filter.object_size_greater_than)) throw new S3Error({ ...S3Error.InvalidArgument, message: 'ObjectSizeGreaterThan must be an integer.'});
        }
        if (and_content.ObjectSizeLessThan?.length === 1) {
            current_rule_filter.object_size_less_than = parseInt(and_content.ObjectSizeLessThan[0], 10);
             if (isNaN(current_rule_filter.object_size_less_than)) throw new S3Error({ ...S3Error.InvalidArgument, message: 'ObjectSizeLessThan must be an integer.'});
        }
         // Check both size filters exist and are valid range
        if (current_rule_filter.object_size_greater_than !== undefined &&
            current_rule_filter.object_size_less_than !== undefined &&
            current_rule_filter.object_size_greater_than >= current_rule_filter.object_size_less_than) {
            dbg.error('Invalid size range in And filter:', filter, 'size range:', current_rule_filter.object_size_greater_than, '>=', current_rule_filter.object_size_less_than);
            throw new S3Error({ ...S3Error.InvalidArgument, message: 'ObjectSizeGreaterThan must be less than ObjectSizeLessThan.' });
        }

    } else if (filter.Prefix) {
        // Handle 'Prefix' filter
        current_rule_filter.prefix = filter.Prefix[0];

    } else if (filter.Tag) {
        // Handle 'Tag' filter
        const tag = filter.Tag[0];
         if (!tag.Key || tag.Key.length !== 1 || !tag.Value || tag.Value.length !== 1) {
             dbg.error('Malformed Tag structure in Filter', tag);
             throw new S3Error(S3Error.MalformedXML);
         }
        current_rule_filter.tags = [{ key: tag.Key[0], value: tag.Value[0] }];

    } else if (filter.ObjectSizeGreaterThan || filter.ObjectSizeLessThan) {
         // Handle ObjectSize filters (outside 'And')
         if (filter.ObjectSizeGreaterThan?.length === 1) {
            current_rule_filter.object_size_greater_than = parseInt(filter.ObjectSizeGreaterThan[0], 10);
            if (isNaN(current_rule_filter.object_size_greater_than)) throw new S3Error({ ...S3Error.InvalidArgument, message: 'ObjectSizeGreaterThan must be an integer.'});
        }
        if (filter.ObjectSizeLessThan?.length === 1) {
            current_rule_filter.object_size_less_than = parseInt(filter.ObjectSizeLessThan[0], 10);
            if (isNaN(current_rule_filter.object_size_less_than)) throw new S3Error({ ...S3Error.InvalidArgument, message: 'ObjectSizeLessThan must be an integer.'});
        }
         // Check both size filters exist and are valid range
        if (current_rule_filter.object_size_greater_than !== undefined &&
            current_rule_filter.object_size_less_than !== undefined &&
            current_rule_filter.object_size_greater_than >= current_rule_filter.object_size_less_than) {
            dbg.error('Invalid size range:', filter, 'size range:', current_rule_filter.object_size_greater_than, '>=', current_rule_filter.object_size_less_than);
            throw new S3Error({ ...S3Error.InvalidArgument, message: 'ObjectSizeGreaterThan must be less than ObjectSizeLessThan.' });
        }
    } else {
         dbg.error('Invalid or empty Filter structure that was not caught by validation', filter);
         throw new S3Error(S3Error.MalformedXML);
    }

    return current_rule_filter;
}

// Parses date field, expects ISO 8601 format at midnight UTC. Returns epoch milliseconds.
function parse_date_field(field_array, field_name) {
     if (field_array?.length === 1) {
         const date_str = field_array[0];
         const date = new Date(date_str);
         // Reuse validation logic from validate_lifecycle_rule for consistency during parsing
         if (isNaN(date.getTime()) || date.getTime() !== Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())) {
             dbg.error(`${field_name} must be in ISO 8601 format at midnight UTC. Received:`, date_str);
             throw new S3Error({ ...S3Error.InvalidArgument, message: `'${field_name}' must be at midnight GMT` });
         }
         return date.getTime();
     }
     return undefined;
}

// Checks if an action field block (like Expiration[0]) is empty
function reject_empty_action_field(field, action_name) {
    // Check if the field itself exists and if it's an object with no keys
    if (!field || (_.isObject(field) && _.isEmpty(field))) {
        dbg.error(`MalformedXML: Action ${action_name} must contain required child elements. Field was empty or undefined.`, field);
        throw new S3Error(S3Error.MalformedXML);
    }
}

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTlifecycle.html
 */
async function put_bucket_lifecycle(req) {
    const rules_data = req.body.LifecycleConfiguration?.Rule;

    if (!req.body.LifecycleConfiguration || !Array.isArray(rules_data)) {
         dbg.error('Invalid LifecycleConfiguration structure: Root or Rule element is missing or Rule not an array.', req.body);
         throw new S3Error(S3Error.MalformedXML);
    }

    if (rules_data.length > MAX_LIFECYCLE_RULES) {
         dbg.error('Number of lifecycle rules exceeds the limit of', MAX_LIFECYCLE_RULES, 'Received:', rules_data.length);
         throw new S3Error({ ...S3Error.InvalidArgument, message: `The lifecycle configuration cannot have more than ${MAX_LIFECYCLE_RULES} rules.` });
    }

    // Fetch bucket versioning status once for rule validation
    const bucket_info = await req.object_sdk.read_bucket({ name: req.params.bucket });
    const bucket_versioning = bucket_info.versioning; // Should be 'ENABLED', 'SUSPENDED', or null/undefined

    const id_set = new Set();
    const lifecycle_rules = _.map(rules_data, rule => {
        validate_lifecycle_rule(rule, bucket_versioning);

        const current_rule = {
            filter: {},
        };

        if (rule.ID?.length === 1) {
            current_rule.id = rule.ID[0];
        } else {
            current_rule.id = crypto.randomUUID();
        }
        if (id_set.has(current_rule.id)) {
            dbg.error('Rule ID must be unique. Duplicate ID found:', current_rule.id);
            throw new S3Error({ ...S3Error.InvalidArgument, message: 'Rule IDs must be unique. Found same ID for more than one rule.' });
        }
        id_set.add(current_rule.id);

        current_rule.status = rule.Status[0];

        // Parse Filter or deprecated Prefix
        if (rule.Prefix?.length === 1) { // Deprecated Prefix used
             current_rule.filter = { prefix: rule.Prefix[0] };
             current_rule.uses_prefix = true;
        } else { // Filter element used (or implicitly applies to all if Filter is empty/missing)
            // validate_lifecycle_rule ensured Filter=[{}] exists if needed
             current_rule.filter = parse_filter(rule.Filter[0]);
        }

        // Parse Expiration
        if (rule.Expiration?.length === 1) {
            const exp = rule.Expiration[0];
            current_rule.expiration = _.omitBy({
                days: parse_lifecycle_field(exp.Days),
                date: parse_date_field(exp.Date, 'Expiration Date'),
                expired_object_delete_marker: exp.ExpiredObjectDeleteMarker ? true_regex.test(exp.ExpiredObjectDeleteMarker[0]) : undefined,
            }, _.isUndefined);
            reject_empty_action_field(current_rule.expiration, 'Expiration');
        }

        // Parse Transition
        if (rule.Transition?.length > 0) {
            const tran = rule.Transition[0];
            current_rule.transition = _.omitBy({
                storage_class: parse_lifecycle_field(tran.StorageClass, String),
                date: parse_lifecycle_field(tran.Date, s => (new Date(s)).getTime()),
                days: parse_lifecycle_field(tran.Days),
            }, _.isUndefined);
            reject_empty_action_field(current_rule.transition, 'Transition');
        }


        // Parse NoncurrentVersionExpiration
        if (rule.NoncurrentVersionExpiration?.length === 1) {
            const nve = rule.NoncurrentVersionExpiration[0];
            current_rule.noncurrent_version_expiration = _.omitBy({
                noncurrent_days: parse_lifecycle_field(nve.NoncurrentDays),
                newer_noncurrent_versions: parse_lifecycle_field(nve.NewerNoncurrentVersions),
            }, _.isUndefined);
            reject_empty_action_field(current_rule.noncurrent_version_expiration, 'NoncurrentVersionExpiration');
            // Ensure required field 'noncurrent_days' was parsed successfully
            if (current_rule.noncurrent_version_expiration.noncurrent_days === undefined) {
                throw new S3Error({ ...S3Error.InvalidArgument, message: 'NoncurrentVersionExpiration must specify NoncurrentDays.'});
            }
        }

         // Parse NoncurrentVersionTransition
         if (rule.NoncurrentVersionTransition?.length > 0) {
            const nvt = rule.NoncurrentVersionTransition[0];
            current_rule.noncurrent_version_transition = _.omitBy({
                storage_class: parse_lifecycle_field(nvt.StorageClass, String),
                noncurrent_days: parse_lifecycle_field(nvt.NoncurrentDays),
                newer_noncurrent_versions: parse_lifecycle_field(nvt.NewerNoncurrentVersions),
            }, _.isUndefined);
            reject_empty_action_field(current_rule.noncurrent_version_transition, 'NoncurrentVersionTransition');
            // Ensure required fields were parsed
            if (
                current_rule.noncurrent_version_transition.noncurrent_days === undefined ||
                current_rule.noncurrent_version_transition.storage_class === undefined
            ) {
                throw new S3Error({ ...S3Error.InvalidArgument, message: 'NoncurrentVersionTransition must specify NoncurrentDays and StorageClass.'});
            }
        }

        // Parse AbortIncompleteMultipartUpload
        if (rule.AbortIncompleteMultipartUpload?.length === 1) {
            const abort = rule.AbortIncompleteMultipartUpload[0];
            current_rule.abort_incomplete_multipart_upload = _.omitBy({
                days_after_initiation: parse_lifecycle_field(abort.DaysAfterInitiation),
            }, _.isUndefined);
            reject_empty_action_field(current_rule.abort_incomplete_multipart_upload, 'AbortIncompleteMultipartUpload');
            // Ensure required field was parsed
            if (current_rule.abort_incomplete_multipart_upload.days_after_initiation === undefined) {
                 throw new S3Error({ ...S3Error.InvalidArgument, message: 'AbortIncompleteMultipartUpload must specify DaysAfterInitiation.'});
            }
        }

        return current_rule;
    });

    await req.object_sdk.set_bucket_lifecycle_configuration_rules({
        name: req.params.bucket,
        rules: lifecycle_rules
    });

    dbg.log0('Successfully set bucket lifecycle configuration for bucket:', req.params.bucket, 'Rules:', lifecycle_rules);
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
