/* Copyright (C) 2022 NooBaa */
'use strict';

const _ = require('lodash');
const s3_const = require('../s3_constants');
const s3_utils = require('../s3_utils');
const crypto = require('crypto');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;

const true_regex = /true/i;
const MAX_LIFECYCLE_RULES = 1000; // AWS limit
const MAX_TAGS_IN_AND_FILTER = 10;

/**
 * Lifecycle Transition / NoncurrentVersionTransition waterfall, earlier (warmer) to later (colder).
 * A later class must use a strictly greater Days / Date / NoncurrentDays than an earlier class.
 * Insert new transition targets here; do not special-case class names in the combination validators.
 * @type {readonly nb.StorageClass[]}
 */
const LIFECYCLE_TRANSITION_STORAGE_CLASS_ORDER = Object.freeze([
    s3_utils.STORAGE_CLASS_GLACIER,
    s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
]);

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
            reject_if_not_midnight_utc(expiration_content.Date[0], 'Date');
        }
        if (expiration_content.Days) {
            parse_positive_int(expiration_content.Days[0], 'Expiration Days');
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
         parse_positive_int(nve_content.NoncurrentDays[0], 'NoncurrentVersionExpiration NoncurrentDays');
         if (nve_content.NewerNoncurrentVersions) {
            parse_positive_int(nve_content.NewerNoncurrentVersions[0], 'NewerNoncurrentVersions');
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
 *
 * @param {Object} rule - lifecycle rule to validate
 * @param {object} bucket_info - bucket from read_bucket (versioning, archive_policy, supported_storage_classes)
 * @throws {S3Error} - on validation failure
 */
function validate_lifecycle_rule(rule, bucket_info) {
    const bucket_versioning = bucket_info.versioning;
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

    // Transition Validation
    validate_lifecycle_transition_rule(rule, bucket_info);

    // NoncurrentVersionExpiration Validation
    validate_lifecycle_noncurrentexp_rule(rule, bucket_versioning);

    // NoncurrentVersionTransition Validation
    validate_lifecycle_noncurrent_transition_rule(rule, bucket_info);

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
         return reject_if_not_midnight_utc(field_array[0], field_name).getTime();
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

    // Fetch bucket info once for rule validation (versioning, archive policy, supported storage classes)
    const bucket_info = await req.object_sdk.read_bucket({ name: req.params.bucket });

    const id_set = new Set();
    const lifecycle_rules = _.map(rules_data, rule => {
        validate_lifecycle_rule(rule, bucket_info);

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
            current_rule.transitions = parse_transition_actions(rule.Transition);
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
            current_rule.noncurrent_version_transitions = parse_noncurrent_version_transition_actions(
                rule.NoncurrentVersionTransition
            );
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

////////////////////////
// VALIDATION HELPERS //
////////////////////////

/**
 * @param {string} raw_value
 * @param {string} error_message - InvalidArgument message when the value is not an integer >= 0
 * @returns {number}
 * @throws {S3Error} InvalidArgument
 */
function parse_non_negative_int(raw_value, error_message) {
    const value = parseInt(raw_value, 10);
    if (isNaN(value) || value < 0) {
        dbg.error(error_message, 'received:', raw_value);
        throw new S3Error({ ...S3Error.InvalidArgument, message: error_message });
    }
    return value;
}

/**
 * @param {string} raw_value
 * @param {string} field_name - used in the InvalidArgument message
 * @returns {number}
 * @throws {S3Error} InvalidArgument when the value is not an integer >= 1
 */
function parse_positive_int(raw_value, field_name) {
    const value = parseInt(raw_value, 10);
    if (isNaN(value) || value < 1) {
        dbg.error(`${field_name} must be a positive integer if specified, received:`, raw_value);
        throw new S3Error({ ...S3Error.InvalidArgument, message: `${field_name} must be a positive integer` });
    }
    return value;
}

/**
 * @param {string} date_str - ISO 8601 date string
 * @param {string} field_name - used in the InvalidArgument message
 * @returns {Date}
 * @throws {S3Error} InvalidArgument when the date is invalid or not midnight UTC
 */
function reject_if_not_midnight_utc(date_str, field_name) {
    const date = new Date(date_str);
    if (isNaN(date.getTime()) || date.getTime() !== Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())) {
        dbg.error(`${field_name} must be in ISO 8601 format at midnight UTC. Received:`, date_str);
        throw new S3Error({ ...S3Error.InvalidArgument, message: `'${field_name}' must be at midnight GMT` });
    }
    return date;
}

/**
 * AWS lifecycle errors include the rule filter, e.g. `(prefix=test/ and objectsizelessthan=120120)`.
 * @param {object} rule - xml2js lifecycle rule
 * @returns {string}
 */
function format_lifecycle_error_filter(rule) {
    if (rule.Prefix?.length === 1) {
        return `(prefix=${rule.Prefix[0]})`;
    }
    const filter = rule.Filter?.[0];
    if (!filter) return '(prefix=)';
    const node = filter.And?.[0] || filter;
    const parts = [];
    if (node.Prefix) {
        parts.push(`prefix=${node.Prefix[0]}`);
    }
    for (const tag of node.Tag || []) {
        parts.push(`tag={key=${tag.Key?.[0] || ''}, value=${tag.Value?.[0] || ''}}`);
    }
    if (node.ObjectSizeGreaterThan) {
        parts.push(`objectsizegreaterthan=${node.ObjectSizeGreaterThan[0]}`);
    }
    if (node.ObjectSizeLessThan) {
        parts.push(`objectsizelessthan=${node.ObjectSizeLessThan[0]}`);
    }
    if (!parts.length) return '(prefix=)';
    return `(${parts.join(' and ')})`;
}

////////////////////////
// TRANSITION HELPERS //
////////////////////////

/**
 * Storage classes a bucket may transition into (GLACIER / DEEP_ARCHIVE only, and only
 * when the bucket actually supports them — archive policy on hosted, NSFS glacier when enabled).
 * @param {object} bucket_info - bucket from read_bucket
 * @returns {string[]}
 */
function get_allowed_transition_storage_classes(bucket_info) {
    const glacier_classes = s3_utils.GLACIER_STORAGE_CLASSES;
    const supported = bucket_info.supported_storage_classes;
    if (Array.isArray(supported) && supported.length) {
        return glacier_classes.filter(sc => supported.includes(sc));
    }
    if (bucket_info.archive_policy?.deep_archive_resource) {
        return glacier_classes.slice();
    }
    return [];
}

/**
 * @param {string} [storage_class]
 * @param {string} action_name - action name (`Transition` or `NoncurrentVersionTransition`)
 * @param {string[]} allowed_storage_classes - storage classes this bucket may transition into
 * @throws {S3Error} MalformedXML when StorageClass is missing or not allowed
 */
function reject_invalid_transition_storage_class(storage_class, action_name, allowed_storage_classes) {
    if (!storage_class || !allowed_storage_classes.includes(storage_class)) {
        dbg.error(`${action_name} StorageClass is missing or not allowed. Received:`, storage_class, 'allowed:', allowed_storage_classes);
        throw new S3Error(S3Error.MalformedXML);
    }
}

/**
 * Transition and NoncurrentVersionTransition require archive support (hosted archive policy,
 * or NSFS glacier). Callers already know a Transition or NoncurrentVersionTransition is present.
 * @param {object} rule - lifecycle rule
 * @param {object} bucket_info - bucket from read_bucket
 * @throws {S3Error} InvalidRequest when the bucket has no archive/glacier support
 */
function reject_transitions_without_archive_policy(rule, bucket_info) {
    if (get_allowed_transition_storage_classes(bucket_info).length > 0) return;
    dbg.error('Transition actions require the bucket to have an archive policy attached', rule);
    throw new S3Error({
        ...S3Error.InvalidRequest,
        message: "'Transition' and 'NoncurrentVersionTransition' actions require the bucket to have an archive policy attached.",
    });
}

/**
 * Validates Transition actions: StorageClass (GLACIER / DEEP_ARCHIVE), Days xor Date,
 * and midnight UTC dates. Combination with Expiration is checked separately.
 * @param {object} rule - lifecycle rule
 * @param {object} bucket_info - bucket from read_bucket
 * @throws {S3Error} on invalid Transition configuration
 */
function validate_lifecycle_transition_rule(rule, bucket_info) {
    if (!rule.Transition?.length) return;
    reject_transitions_without_archive_policy(rule, bucket_info);

    const allowed_storage_classes = get_allowed_transition_storage_classes(bucket_info);

    for (const transition of rule.Transition) {
        const has_date = Boolean(transition.Date?.[0]);
        // Days=0 is valid for Transition (unlike Expiration, which requires >= 1)
        const has_days_field = Boolean(transition.Days);
        reject_invalid_transition_storage_class(transition.StorageClass?.[0], 'Transition', allowed_storage_classes);

        if (has_days_field && has_date) {
            // AWS XSD is a choice of Date vs Days; both on one Transition is MalformedXML.
            dbg.error('Transition must specify only one of Days or Date', rule);
            throw new S3Error(S3Error.MalformedXML);
        }
        if (!has_days_field && !has_date) {
            dbg.error('Transition must specify either Days or Date', rule);
            throw new S3Error({ ...S3Error.InvalidArgument, message: "'Transition' action must specify either 'Days' or 'Date'" });
        }
        if (has_days_field) {
            parse_non_negative_int(transition.Days[0], "'Days' in Transition action must be nonnegative");
        } else {
            reject_if_not_midnight_utc(transition.Date[0], 'Date');
        }
    }

    const has_transition_days = rule.Transition.some(t => t.Days);
    const has_transition_date = rule.Transition.some(t => t.Date?.[0]);
    validate_lifecycle_transitions_combination(rule, has_transition_days, has_transition_date);
    validate_lifecycle_expiration_transition_combination(rule, has_transition_days, has_transition_date);
}

/**
 * When a rule has more than one Transition, they must all use Days or all use Date, StorageClass
 * must be unique, and a later StorageClass (colder in `LIFECYCLE_TRANSITION_STORAGE_CLASS_ORDER`)
 * must have a strictly greater Days or Date than an earlier class.
 * @param {object} rule - lifecycle rule
 * @param {boolean} has_transition_days - true if any Transition uses Days
 * @param {boolean} has_transition_date - true if any Transition uses Date
 * @throws {S3Error} InvalidRequest when Days and Date are mixed or StorageClass is repeated;
 *     InvalidArgument when a later StorageClass is not strictly after an earlier one
 */
function validate_lifecycle_transitions_combination(rule, has_transition_days, has_transition_date) {
    if (has_transition_days && has_transition_date) {
        dbg.error('Days and Date cannot be mixed across Transition actions in the same rule', rule);
        throw new S3Error({
            ...S3Error.InvalidRequest,
            message: `Found mixed 'Date' and 'Days' based Transition actions in lifecycle rule for filter '${format_lifecycle_error_filter(rule)}'`,
        });
    }
    reject_duplicate_storage_classes(
        rule.Transition.map(t => ({ storage_class: t.StorageClass?.[0] })),
        'Transition',
        rule
    );
    if (has_transition_date) {
        reject_later_storage_class_timing_not_greater(
            rule.Transition, rule, 'Transition', 'Date', 'Date', raw => new Date(raw).getTime());
    } else {
        reject_later_storage_class_timing_not_greater(
            rule.Transition, rule, 'Transition', 'Days', 'Days', raw => parseInt(raw, 10));
    }
}

/**
 * When a rule has more than one NoncurrentVersionTransition, StorageClass must be unique and a
 * later StorageClass must have a strictly greater NoncurrentDays than an earlier class.
 * @param {object} rule - lifecycle rule
 * @throws {S3Error} InvalidRequest when StorageClass is repeated; InvalidArgument when a later
 *     StorageClass is not strictly after an earlier one
 */
function validate_lifecycle_noncurrent_transitions_combination(rule) {
    reject_duplicate_storage_classes(
        rule.NoncurrentVersionTransition.map(nvt => ({ storage_class: nvt.StorageClass?.[0] })),
        'NoncurrentVersionTransition',
        rule
    );
    reject_later_storage_class_timing_not_greater(
        rule.NoncurrentVersionTransition, rule, 'NoncurrentVersionTransition',
        'NoncurrentDays', 'NoncurrentDays', raw => parseInt(raw, 10));
}

/**
 * @param {object[]} [items] - xml2js Transition or NoncurrentVersionTransition elements
 * @param {object} rule - xml2js lifecycle rule
 * @param {string} action_name - `Transition` or `NoncurrentVersionTransition`
 * @param {string} xml_field - `Days`, `Date`, or `NoncurrentDays`
 * @param {string} field_label - name used in the error message
 * @param {(raw: string) => number} to_number
 * @throws {S3Error} MalformedXML when StorageClass or timing cannot be ranked;
 *     InvalidArgument when a later StorageClass is not strictly after an earlier one
 */
function reject_later_storage_class_timing_not_greater(items, rule, action_name, xml_field, field_label, to_number) {
    if (!items || items.length < 2) return;
    const ranked = [];
    for (const item of items) {
        const storage_class = item.StorageClass?.[0];
        const rank = LIFECYCLE_TRANSITION_STORAGE_CLASS_ORDER.indexOf(storage_class);
        const value = to_number(item[xml_field]?.[0]);
        if (rank < 0 || Number.isNaN(value)) {
            dbg.error('Cannot rank lifecycle transition for StorageClass ordering', {
                action_name, xml_field, storage_class, rank, value,
            });
            throw new S3Error(S3Error.MalformedXML);
        }
        ranked.push({ storage_class, value, rank });
    }
    ranked.sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < ranked.length; i++) {
        const prev = ranked[i - 1];
        const curr = ranked[i];
        if (curr.value > prev.value) continue;
        const filter = format_lifecycle_error_filter(rule);
        throw new S3Error({
            ...S3Error.InvalidArgument,
            message: `'${field_label}' in the ${action_name} action for StorageClass '${curr.storage_class}' for filter '${filter}' must be greater than '${field_label}' in the ${action_name} action for StorageClass '${prev.storage_class}' for filter '${filter}'`,
        });
    }
}

/**
 * When a rule has both Expiration and Transition, they must use the same timing
 * (Days vs Date), and Expiration Days/Date must be greater than Transition Days/Date.
 * @param {object} rule - lifecycle rule
 * @param {boolean} has_transition_days - true if any Transition uses Days
 * @param {boolean} has_transition_date - true if any Transition uses Date
 * @throws {S3Error} InvalidRequest when Days and Date are mixed; InvalidArgument when
 *     Expiration is not strictly after Transition
 */
function validate_lifecycle_expiration_transition_combination(rule, has_transition_days, has_transition_date) {
    if (!rule.Expiration?.length) return;
    const expiration_content = rule.Expiration[0];
    if ((expiration_content.Days && has_transition_date) ||
        (expiration_content.Date && has_transition_days)) {
        throw new S3Error({
            ...S3Error.InvalidRequest,
            message: `Found mixed 'Date' and 'Days' based Expiration and Transition actions in lifecycle rule for filter '${format_lifecycle_error_filter(rule)}'`,
        });
    }
    if (expiration_content.Days) {
        const exp_days = parseInt(expiration_content.Days[0], 10);
        if (!isNaN(exp_days) && rule.Transition.some(t => t.Days && exp_days <= parseInt(t.Days[0], 10))) {
            throw new S3Error({
                ...S3Error.InvalidArgument,
                message: `'Days' in the Expiration action for filter '${format_lifecycle_error_filter(rule)}' must be greater than 'Days' in the Transition action`,
            });
        }
    }
    if (expiration_content.Date) {
        const exp_date = new Date(expiration_content.Date[0]);
        if (!isNaN(exp_date.getTime()) &&
            rule.Transition.some(t => t.Date?.[0] && exp_date.getTime() <= new Date(t.Date[0]).getTime())) {
            throw new S3Error({
                ...S3Error.InvalidArgument,
                message: `'Date' in the Expiration action for filter '${format_lifecycle_error_filter(rule)}' must be greater than 'Date' in the Transition action`,
            });
        }
    }
}

/**
 * Validates NoncurrentVersionTransition actions: StorageClass, NoncurrentDays,
 * and NewerNoncurrentVersions. Combination with NoncurrentVersionExpiration is checked separately.
 * @param {object} rule - lifecycle rule
 * @param {object} bucket_info - bucket from read_bucket
 * @throws {S3Error} on invalid NoncurrentVersionTransition configuration
 */
function validate_lifecycle_noncurrent_transition_rule(rule, bucket_info) {
    if (!rule.NoncurrentVersionTransition?.length) return;
    reject_transitions_without_archive_policy(rule, bucket_info);

    const allowed_storage_classes = get_allowed_transition_storage_classes(bucket_info);

    for (const nvt of rule.NoncurrentVersionTransition) {
        reject_invalid_transition_storage_class(nvt.StorageClass?.[0], 'NoncurrentVersionTransition', allowed_storage_classes);
        if (!nvt.NoncurrentDays || nvt.NoncurrentDays.length !== 1) {
            dbg.error('NoncurrentVersionTransition action must specify NoncurrentDays', rule);
            throw new S3Error(S3Error.MalformedXML);
        }
        parse_non_negative_int(nvt.NoncurrentDays[0],
            "'NoncurrentDays' in NoncurrentVersionTransition action must be nonnegative");
        if (nvt.NewerNoncurrentVersions) {
            parse_positive_int(nvt.NewerNoncurrentVersions[0], 'NewerNoncurrentVersions');
        }
    }

    validate_lifecycle_noncurrent_transitions_combination(rule);
    validate_lifecycle_noncurrent_expiration_transition_combination(rule);
}

/**
 * When a rule has both NoncurrentVersionExpiration and NoncurrentVersionTransition,
 * NVE NoncurrentDays must be greater than NVT NoncurrentDays.
 * @param {object} rule - lifecycle rule
 * @throws {S3Error} InvalidArgument when NVE NoncurrentDays is not greater than NVT
 */
function validate_lifecycle_noncurrent_expiration_transition_combination(rule) {
    if (!rule.NoncurrentVersionExpiration?.length) return;
    const nve_content = rule.NoncurrentVersionExpiration[0];
    if (nve_content.NoncurrentDays) {
        const nve_days = parseInt(nve_content.NoncurrentDays[0], 10);
        if (!isNaN(nve_days) &&
            rule.NoncurrentVersionTransition.some(nvt => nve_days <= parseInt(nvt.NoncurrentDays[0], 10))) {
            throw new S3Error({
                ...S3Error.InvalidArgument,
                message: `'NoncurrentDays' in the NoncurrentVersionExpiration action for filter '${format_lifecycle_error_filter(rule)}' must be greater than 'NoncurrentDays' in the NoncurrentVersionTransition action`,
            });
        }
    }
}

/**
 * AWS rejects two Transition actions (or two NoncurrentVersionTransition actions) in the same
 * rule that target the same StorageClass (InvalidRequest). Transition and NoncurrentVersionTransition
 * may share a StorageClass — they apply to current vs noncurrent versions.
 *
 * @param {Array<{storage_class?: string}>} items - parsed transition actions
 * @param {string} action_name - XML action name used in the error message
 * @param {object} rule - xml2js lifecycle rule, formatted into the AWS error text on throw
 * @throws {S3Error} InvalidRequest when a StorageClass is repeated
 */
function reject_duplicate_storage_classes(items, action_name, rule) {
    const seen = new Set();
    for (const item of items) {
        if (item.storage_class === undefined) continue;
        if (seen.has(item.storage_class)) {
            throw new S3Error({
                ...S3Error.InvalidRequest,
                message: `'StorageClass' must be different for '${action_name}' actions in same 'Rule' with filter '${format_lifecycle_error_filter(rule)}'`,
            });
        }
        seen.add(item.storage_class);
    }
}

/**
 * Parses every `<Transition>` element on a lifecycle rule into the stored array shape.
 * Required fields and emptiness are already checked by validate_lifecycle_transition_rule.
 * @param {object[]} transitions - array of Transition elements
 * @returns {Array<{storage_class?: string, date?: number, days?: number}>}
 */
function parse_transition_actions(transitions) {
    return transitions.map(tran => _.omitBy({
        storage_class: parse_lifecycle_field(tran.StorageClass, String),
        date: parse_date_field(tran.Date, 'Date'),
        days: parse_lifecycle_field(tran.Days),
    }, _.isUndefined));
}

/**
 * Parses every `<NoncurrentVersionTransition>` element on a lifecycle rule into the stored array shape.
 * Required fields and emptiness are already checked by validate_lifecycle_noncurrent_transition_rule.
 * @param {object[]} noncurrent_version_transitions - array of NoncurrentVersionTransition elements
 * @returns {Array<{storage_class: string, noncurrent_days: number, newer_noncurrent_versions?: number}>}
 */
function parse_noncurrent_version_transition_actions(noncurrent_version_transitions) {
    return noncurrent_version_transitions.map(nvt => _.omitBy({
        storage_class: parse_lifecycle_field(nvt.StorageClass, String),
        noncurrent_days: parse_lifecycle_field(nvt.NoncurrentDays),
        newer_noncurrent_versions: parse_lifecycle_field(nvt.NewerNoncurrentVersions),
    }, _.isUndefined));
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
