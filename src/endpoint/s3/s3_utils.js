/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const S3Error = require('./s3_errors').S3Error;
const http_utils = require('../../util/http_utils');
const time_utils = require('../../util/time_utils');
const endpoint_utils = require('../endpoint_utils');
const crypto = require('crypto');
const config = require('../../.././config');
const ChunkedContentDecoder = require('../../util/chunked_content_decoder');
const stream_utils = require('../../util/stream_utils');

/** @type {nb.StorageClass} */
const STORAGE_CLASS_STANDARD = 'STANDARD';
/** @type {nb.StorageClass} */
const STORAGE_CLASS_GLACIER = 'GLACIER'; // "S3 Glacier Flexible Retrieval"
/** @type {nb.StorageClass} */
const STORAGE_CLASS_GLACIER_IR = 'GLACIER_IR'; // "S3 Glacier Instant Retrieval"

const DEFAULT_S3_USER = Object.freeze({
    ID: '123',
    DisplayName: 'NooBaa'
});

const DEFAULT_OBJECT_ACL = Object.freeze({
    owner: DEFAULT_S3_USER,
    access_control_list: [{
        Grantee: { ...DEFAULT_S3_USER, Type: "CanonicalUser" },
        Permission: "FULL_CONTROL"
    }]
});

const XATTR_SORT_SYMBOL = Symbol('XATTR_SORT_SYMBOL');
const base64_regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const X_NOOBAA_AVAILABLE_STORAGE_CLASSES = 'x-noobaa-available-storage-classes';

const OBJECT_ATTRIBUTES = Object.freeze(['ETag', 'Checksum', 'ObjectParts', 'StorageClass', 'ObjectSize']);

 /**
 * get_default_object_owner returns bucket_owner info if exists
 * else it'll return the default owner
 * @param {string} bucket_name
 * @param {nb.ObjectSDK} object_sdk
 * @returns {Promise<object>}
 */
 async function get_default_object_owner(bucket_name, object_sdk) {
    const info = await object_sdk.read_bucket_sdk_config_info(bucket_name);
    if (info) {
        if (info.bucket_info && info.bucket_info.owner_account) {
            return Object.freeze({
                ID: info.bucket_info.owner_account.id,
                DisplayName: info.bucket_owner.unwrap()
            });
        } else {
            return Object.freeze({
                ID: info.owner_account.id,
                DisplayName: info.bucket_owner.unwrap()
            });
        }
    }
    return DEFAULT_S3_USER;
 }

 /**
 * get_object_owner returns object owner if obj.object_owner defined
 * @param {nb.ObjectInfo} obj
 * @returns {Object}
 */
function get_object_owner(obj) {
    if (obj.object_owner) {
        return Object.freeze({
            ID: obj.object_owner.id,
            DisplayName: obj.object_owner.name,
        });
    }
}

function decode_chunked_upload(source_stream) {
    const decoder = new ChunkedContentDecoder();
    // pipeline will back-propagate errors from the decoder to stop streaming from the source,
    // so the error callback here is only needed for logging.
    // Previously were implemented using callback with error
    // Latest implementation of pipeline is async so chaining .catch would behave the same way as callback errors
    // We are not waiting for the pipeline to end like previously
    stream_utils.pipeline([source_stream, decoder], true)
        .catch(err => console.warn('decode_chunked_upload: pipeline error', err.stack || err));

    decoder.on('error', err1 => dbg.error('s3_utils: error occured on stream ChunkedContentDecoder: ', err1));
    return decoder;
}

function format_s3_xml_date(input) {
    const date = input ? new Date(input) : new Date();
    date.setMilliseconds(0);
    return date.toISOString();
}

const X_AMZ_META = 'x-amz-meta-';

function get_request_xattr(req) {
    const xattr = {};
    _.each(req.headers, (val, hdr) => {
        if (!hdr.startsWith(X_AMZ_META)) return;
        const key = hdr.slice(X_AMZ_META.length);
        if (!key) return;
        xattr[key] = val;
    });
    return xattr;
}

function set_response_xattr(res, xattr) {
    let size_for_md_left = config.S3_MD_SIZE_LIMIT;
    const keys = Object.keys(xattr);
    // Using a special symbol on the xattr object to specify when sorting of keys is needed
    // which will make sure the returned headers are consistently being truncated.
    // The symbol is set by namespace_fs and could be used in other namespaces where
    // xattrs are more likely to exceed the size limit and therefore sorting is desired,
    // but for most namespaces where the size is also imposed on PUT, we can avoid it.
    if (xattr[XATTR_SORT_SYMBOL]) {
        keys.sort();
    }
    let returned_keys = 0;
    for (const key of keys) {
        const val = xattr[key];

        const md_header_size =
            X_AMZ_META.length +
            4 + // for ': ' and '\r\n'
            Buffer.byteLength(key, 'utf8') +
            Buffer.byteLength(val, 'utf8');
        if (md_header_size > size_for_md_left) {
            res.setHeader('x-amz-missing-meta', keys.length - returned_keys);
            break;
        }
        returned_keys += 1;
        size_for_md_left -= md_header_size;
        try {
            res.setHeader(X_AMZ_META + key, val);
        } catch (err) {
            dbg.warn(`s3_utils.set_response_xattr set_header failed, skipping... res.req.url=${res.req?.url} xattr key=${key} xattr value=${val}`);
        }
    }
}

function parse_etag(etag, err) {
    const match = (/^\s*(?:"(\S*)"|(\S*))\s*$/).exec(etag);
    if (match) return match[1] || match[2];
    if (err) throw new S3Error(err);
    return etag;
}

function parse_encryption(req, copy_source) {
    if (copy_source) return parse_sse_c(req, copy_source);
    const sse = parse_sse(req);
    if (sse) {
        if (req.method === 'GET' || req.method === 'HEAD') throw new S3Error(S3Error.BadRequest);
        return sse;
    }
    return parse_sse_c(req);
}

function parse_sse_c(req, copy_source) {
    const algorithm = req.headers[`x-amz-${copy_source ? 'copy-source-' : ''}server-side-encryption-customer-algorithm`];
    const key_b64 = req.headers[`x-amz-${copy_source ? 'copy-source-' : ''}server-side-encryption-customer-key`];
    const key_md5_b64 = req.headers[`x-amz-${copy_source ? 'copy-source-' : ''}server-side-encryption-customer-key-md5`];

    if (!algorithm) {
        if (key_b64 || key_md5_b64) {
            throw new S3Error(S3Error.InvalidDigest);
        } else {
            return;
        }
    }

    if (algorithm !== 'AES256') throw new S3Error(S3Error.InvalidEncryptionAlgorithmError);

    if (!key_b64 || !base64_regex.test(key_b64)) throw new S3Error(S3Error.InvalidDigest);

    if (!key_md5_b64 || !base64_regex.test(key_md5_b64)) throw new S3Error(S3Error.InvalidDigest);

    const key = Buffer.from(key_b64, 'base64');
    const calculated_key = crypto.createHash('md5').update(key).digest('base64');
    if (key_md5_b64 !== calculated_key) throw new S3Error(S3Error.InvalidDigest);

    return {
        algorithm,
        key_b64,
        key_md5_b64
    };
}

function parse_sse(req) {
    const algorithm = req.headers['x-amz-server-side-encryption'];
    const kms_key_id = req.headers['x-amz-server-side-encryption-aws-kms-key-id'];
    const context_b64 = algorithm === 'aws:kms' ? req.headers['x-amz-server-side-encryption-context'] : undefined;

    if (!algorithm) {
        if (kms_key_id) {
            throw new S3Error(S3Error.InvalidDigest);
        } else {
            return;
        }
    }

    if (algorithm !== 'AES256' && algorithm !== 'aws:kms') throw new S3Error(S3Error.InvalidArgument);

    if (algorithm === 'aws:kms' && !kms_key_id) throw new S3Error(S3Error.InvalidArgument);
    // const md5_regex = new RegExp('/^[a-f0-9]{32}$/');
    // if (kms_key_id && !md5_regex.test(kms_key_id)) throw new S3Error(S3Error.InvalidDigest);

    // const base64_regex = new RegExp('^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$');
    // if (context_b64 && !base64_regex.test(context_b64)) throw new S3Error(S3Error.InvalidDigest);

    return {
        algorithm,
        kms_key_id,
        context_b64
    };
}

function parse_part_number(num_str, err) {
    const num = Number(num_str);
    if (!Number.isInteger(num) || num < 1 || num > 10000) {
        dbg.warn('Invalid partNumber', num_str);
        throw new S3Error(err);
    }
    return num;
}

function set_encryption_response_headers(req, res, encryption = {}) {
    const { algorithm, kms_key_id, key_md5_b64, } = encryption;
    const encryption_headers = [
        'x-amz-server-side-encryption',
        'x-amz-server-side-encryption-aws-kms-key-id',
        'x-amz-server-side-encryption-customer-algorithm',
        'x-amz-server-side-encryption-customer-key',
        'x-amz-server-side-encryption-customer-key-md5',
    ];

    encryption_headers.forEach(header => req.headers[header] && res.setHeader(header, req.headers[header]));

    if (algorithm) {
        if (key_md5_b64) {
            res.setHeader('x-amz-server-side-encryption-customer-algorithm', algorithm);
            res.setHeader('x-amz-server-side-encryption-customer-key-md5', key_md5_b64);
        } else {
            res.setHeader('x-amz-server-side-encryption', algorithm);
        }
    }

    if (kms_key_id) res.setHeader('x-amz-server-side-encryption-aws-kms-key-id', kms_key_id);
}

function parse_copy_source(req) {
    const source_url = req.headers['x-amz-copy-source'];
    if (!source_url) return;
    // I wonder: do we want to support copy source url with host:port too?
    const { query, bucket, key } = endpoint_utils.parse_source_url(source_url);
    const version_id = query && query.versionId;
    const ranges = http_utils.parse_http_ranges(req.headers['x-amz-copy-source-range']);
    const encryption = parse_encryption(req, /* copy_source */ true);
    return { bucket, key, version_id, ranges, encryption };
}

function format_copy_source(copy_source) {
    if (!copy_source) return;
    const copy_source_range = http_utils.format_http_ranges(copy_source.ranges);
    let copy_source_str = `/${copy_source.bucket}/${copy_source.key}`;
    if (copy_source.version_id) {
        copy_source_str += `?versionId=${copy_source.version_id}`;
    }
    return {
        copy_source: copy_source_str,
        copy_source_range,
    };
}

/**
 * @param {nb.S3Response} res 
 * @param {nb.ObjectInfo} object_md 
 */
function set_response_object_md(res, object_md) {
    res.setHeader('ETag', '"' + object_md.etag + '"');

    if (object_md.last_modified_time) {
        res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date(object_md.last_modified_time)));
    } else {
        res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date(object_md.create_time)));
    }
    res.setHeader('Content-Type', object_md.content_type);
    if (object_md.content_encoding) res.setHeader('Content-Encoding', object_md.content_encoding);
    res.setHeader('Content-Length', object_md.content_length === undefined ? object_md.size : object_md.content_length);
    res.setHeader('Accept-Ranges', 'bytes');
    if (config.WORM_ENABLED && object_md.lock_settings) {
        if (object_md.lock_settings.legal_hold) {
            res.setHeader('x-amz-object-lock-legal-hold', object_md.lock_settings.legal_hold.status);
        }
        if (object_md.lock_settings.retention) {
            res.setHeader('x-amz-object-lock-mode', object_md.lock_settings.retention.mode);
            res.setHeader('x-amz-object-lock-retain-until-date', object_md.lock_settings.retention.retain_until_date);
        }
    }
    if (object_md.version_id) res.setHeader('x-amz-version-id', object_md.version_id);
    set_response_xattr(res, object_md.xattr);
    if (object_md.tag_count) res.setHeader('x-amz-tagging-count', object_md.tag_count);
    if (object_md.num_multiparts) res.setHeader('x-amz-mp-parts-count', object_md.num_multiparts);
    if (object_md.content_range) res.setHeader('Content-Range', object_md.content_range);
    const storage_class = parse_storage_class(object_md.storage_class);
    if (storage_class !== STORAGE_CLASS_STANDARD) {
        res.setHeader('x-amz-storage-class', storage_class);
    }
    if (object_md.restore_status) {
        const restore = [`ongoing-request="${object_md.restore_status.ongoing}"`];
        if (!object_md.restore_status.ongoing && object_md.restore_status.expiry_time) {
            // Expiry time is in UTC format
            const expiry_date = new Date(object_md.restore_status.expiry_time).toUTCString();

            restore.push(`expiry-date="${expiry_date}"`);
        }

        res.setHeader('x-amz-restore', restore);
    }
}

/**
 * @param {nb.S3Response} res 
 * @param {Array<string>} [supported_storage_classes]
 */
function set_response_supported_storage_classes(res, supported_storage_classes = []) {
    res.setHeader(X_NOOBAA_AVAILABLE_STORAGE_CLASSES, supported_storage_classes);
}

/**
 * @param {nb.S3Request} req
 * @returns {nb.StorageClass}
 */
function parse_storage_class_header(req) {
    const header = /** @type {string} */ (req.headers['x-amz-storage-class']);
    return parse_storage_class(header);
}

/**
 * @param {string} [storage_class]
 * @returns {nb.StorageClass}
 */
function parse_storage_class(storage_class) {
    if (!storage_class) return STORAGE_CLASS_STANDARD;
    if (storage_class === STORAGE_CLASS_STANDARD) return STORAGE_CLASS_STANDARD;
    if (storage_class === STORAGE_CLASS_GLACIER) return STORAGE_CLASS_GLACIER;
    if (storage_class === STORAGE_CLASS_GLACIER_IR) return STORAGE_CLASS_GLACIER_IR;
    throw new Error(`No such s3 storage class ${storage_class}`);
}

// Source: https://docs.aws.amazon.com/AmazonS3/latest/dev/object-tagging.html
function parse_body_tagging_xml(req) {
    const tagging = req.body.Tagging;
    if (!tagging) throw new S3Error(S3Error.MalformedXML);
    const tag_obj = tagging.TagSet[0];
    const tag_key_names = ['Key', 'Value'];
    const tag_set_map = _.map(tag_obj.Tag, tag => {
        const tag_keys = Object.keys(tag);
        if (!_.isEmpty(_.difference(tag_keys, tag_key_names)) ||
            tag_keys.length !== tag_key_names.length) throw new S3Error(S3Error.InvalidTag);
        return {
            key: tag.Key && tag.Key[0],
            value: tag.Value && tag.Value[0]
        };
    });
    if (tag_set_map.length === 0 || tag_set_map.length > 10) throw new S3Error(S3Error.InvalidTag);
    const tag_set = new Set();
    tag_set_map.forEach(tag => {
        if (!_is_valid_tag_values(tag)) throw new S3Error(S3Error.InvalidTag);
        if (tag_set.has(tag.key)) throw new S3Error(S3Error.InvalidTag);
        tag_set.add(tag.key);
    });
    return tag_set_map;
}

function _is_valid_tag_values(tag) {
    if (tag.key.length > 128 || tag.value.length > 256) return false;
    return true;
}

function _is_valid_retention(mode, retain_until_date) {
    if (new Date(retain_until_date) <= new Date()) {
        const err = new S3Error(S3Error.InvalidArgument);
        err.message = 'The retain until date must be in the future!';
        throw err;
    }
    if (mode !== 'GOVERNANCE' && mode !== 'COMPLIANCE') {
        throw new S3Error(S3Error.MalformedXML);
    }
    return true;
}

function _is_valid_legal_hold(legal_hold) {
    return legal_hold === 'ON' || legal_hold === 'OFF';
}

function parse_lock_header(req) {
    const lock_settings = {};
    const status = req.headers['x-amz-object-lock-legal-hold'];
    const mode = req.headers['x-amz-object-lock-mode'];
    const retain_until_date = req.headers['x-amz-object-lock-retain-until-date'] && new Date(req.headers['x-amz-object-lock-retain-until-date']);

    if (!status && !retain_until_date && !mode) return;

    if (mode || retain_until_date) {
        if (!(retain_until_date && mode)) {
            const err = new S3Error(S3Error.InvalidArgument);
            err.message = 'x-amz-object-lock-retain-until-date and x-amz-object-lock-mode must both be supplied';
            throw err;
        }
        if (_is_valid_retention(mode, retain_until_date)) {
            lock_settings.retention = { mode, retain_until_date };
        }
    }
    if (status) {
        if (!_is_valid_legal_hold(status)) throw new S3Error(S3Error.InvalidArgument);
        lock_settings.legal_hold = { status };
    }
    return lock_settings;
}

function parse_tagging_header(req) {
    const tagging_header = req.headers['x-amz-tagging'];
    if (!tagging_header) return;
    let tagging_params;
    try {
        tagging_params = new URLSearchParams(tagging_header);
    } catch (err) {
        dbg.error('parse_tagging_header failed', err);
        throw new S3Error(S3Error.MalformedXML);
    }
    const tag_map = new Map();
    tagging_params.forEach((value, key) => {
        const tag = { key, value };
        if (!_is_valid_tag_values(tag)) throw new S3Error(S3Error.InvalidTag);
        if (tag_map.has(tag.key)) throw new S3Error(S3Error.InvalidTag);
        tag_map.set(tag.key, tag);
    });
    if (tag_map.size > 10) throw new S3Error(S3Error.InvalidTag);
    return Array.from(tag_map.values());
}

/*
Specifies whether the object tags are copied from the source object or replaced with tags provided in the request.
If the tags are copied, the tagset remains unchanged.
If the tags are replaced, all of the original tagset is replaced by the tags you specify.
If you don't specify a tagging directive, Amazon S3 copies tags by default.
If the tagging directive is REPLACE, you specify any tags in url format in the x-amz-tagging header, similar to using a PUT object with tags.
If the tagging directive is REPLACE, but you don't specify the x-amz-tagging in the request, the destination object won't have tags.
Type: String
Default: COPY
Valid values: COPY | REPLACE
Constraints: Values other than COPY or REPLACE result in an immediate 400-based error response.
*/
function is_copy_tagging_directive(req) {
    const allowed_values = ['COPY', 'REPLACE'];
    const tagging_directive = req.headers['x-amz-tagging-directive'];
    if (!tagging_directive) return true;
    if (!allowed_values.includes(tagging_directive)) throw new S3Error(S3Error.InvalidArgument);
    if (tagging_directive === 'COPY') return true;
    return false;
}

// Source: https://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTencryption.html
function parse_body_encryption_xml(req) {
    const valid_algo_values = ['AES256', 'aws:kms'];
    const sse_conf = req.body.ServerSideEncryptionConfiguration;
    if (!sse_conf) throw new S3Error(S3Error.MalformedXML);
    const sse_rule = sse_conf.Rule[0];
    if (!sse_rule) throw new S3Error(S3Error.MalformedXML);
    const sse_default = sse_rule.ApplyServerSideEncryptionByDefault[0];
    if (!sse_default) return;
    const algorithm = sse_default.SSEAlgorithm && sse_default.SSEAlgorithm[0];
    const kms_key_id = sse_default.KMSMasterKeyID && sse_default.KMSMasterKeyID[0];
    if (
        !valid_algo_values.includes(algorithm) ||
        (kms_key_id && algorithm !== 'aws:kms')
    ) throw new S3Error(S3Error.MalformedXML);
    return {
        algorithm,
        kms_key_id
    };
}

function parse_body_object_lock_conf_xml(req) {
    const configuration = req.body.ObjectLockConfiguration;
    const retention = configuration.Rule[0].DefaultRetention[0];

    if ((retention.Days && retention.Years) || (!retention.Days && !retention.Years) ||
        (retention.Mode[0] !== 'GOVERNANCE' && retention.Mode[0] !== 'COMPLIANCE')) throw new S3Error(S3Error.MalformedXML);

    const conf = {
        object_lock_enabled: configuration.ObjectLockEnabled[0],
        rule: { default_retention: { mode: retention.Mode[0], } }
    };

    if (retention.Days) {
        const days = parseInt(retention.Days[0], 10);
        if (days <= 0) {
            const err = new S3Error(S3Error.InvalidArgument);
            err.message = 'Default retention period must be a positive integer value';
            throw err;
        }
        conf.rule.default_retention.days = days;
    }
    if (retention.Years) {
        const years = parseInt(retention.Years[0], 10);
        if (years <= 0) {
            const err = new S3Error(S3Error.InvalidArgument);
            err.message = 'Default retention period must be a positive integer value';
            throw err;
        }
        conf.rule.default_retention.years = years;
    }
    return conf;
}

function parse_body_website_xml(req) {
    const website = {
        website_configuration: {}
    };
    const website_configuration = req.body.WebsiteConfiguration;
    if (website_configuration.RedirectAllRequestsTo) {
        const site = website_configuration.RedirectAllRequestsTo[0];
        const host_name = site.HostName[0];
        if (!host_name) throw new S3Error(S3Error.InvalidArgument);
        const protocol = site.Protocol && site.Protocol[0].toUpperCase();
        website.website_configuration.redirect_all_requests_to = {
            host_name,
            protocol,
        };
        return website;
    } else if (website_configuration.IndexDocument) {
        const parsed_website_configuration = {};
        const suffix = website_configuration.IndexDocument[0].Suffix[0];
        if (!suffix || suffix.indexOf('/') > -1) throw new S3Error(S3Error.InvalidArgument);
        parsed_website_configuration.index_document = {
            suffix
        };
        if (website_configuration.ErrorDocument) {
            const key = website_configuration.ErrorDocument[0].Key[0];
            if (!key) throw new S3Error(S3Error.InvalidArgument);
            parsed_website_configuration.error_document = {
                key
            };
        }
        if (website_configuration.RoutingRules) {
            if (!website_configuration.RoutingRules[0].RoutingRule) throw new S3Error(S3Error.InvalidArgument);
            const routing_rules = website_configuration.RoutingRules[0].RoutingRule.map(rule => {
                if (!rule.Redirect) throw new S3Error(S3Error.InvalidArgument);
                return _.omitBy({
                    condition: rule.Condition && {
                        // TODO: Need to check the required stuff regarding each and every one of them
                        key_prefix_equals: rule.Condition[0].KeyPrefixEquals[0],
                        http_error_code_returned_equals: rule.Condition[0].HttpErrorCodeReturnedEquals[0],
                    },
                    redirect: {
                        protocol: rule.Redirect[0].Protocol[0] && rule.Redirect[0].Protocol[0].toUpperCase(),
                        host_name: rule.Redirect[0].HostName[0],
                        replace_key_prefix_with: rule.Redirect[0].ReplaceKeyPrefixWith[0],
                        replace_key_with: rule.Redirect[0].ReplaceKeyWith[0],
                        http_redirect_code: rule.Redirect[0].HttpRedirectCode[0],
                    },
                }, _.isUndefined);
            });
            parsed_website_configuration.routing_rules = routing_rules;
        }
        website.website_configuration = parsed_website_configuration;
        return website;
    }
}

function parse_to_camel_case(obj_lock, root_key) {
    const keys_func = key => _.upperFirst(_.camelCase(key));
    const rename_keys = variable => {
        if (_.isArray(variable)) {
            return _.map(variable, obj => rename_keys(obj));
        } else if (_.isObject(variable)) {
            return Object.keys(variable).reduce((acc, key) => ({
                ...acc,
                ...{
                    [keys_func(key)]: rename_keys(variable[key])
                }
            }), {});
        }
        return variable;
    };
    const reply = root_key ? { root_key: rename_keys(obj_lock) } : rename_keys(obj_lock);
    return reply;
}

function parse_website_to_body(website) {
    const keys_func = key => _.upperFirst(_.camelCase(key));
    const rename_keys = variable => {
        if (_.isArray(variable)) {
            return _.map(variable, obj => rename_keys(obj));
        } else if (_.isObject(variable)) {
            return Object.keys(variable).reduce((acc, key) => ({
                ...acc,
                ...{
                    [keys_func(key)]: rename_keys(variable[key])
                }
            }), {});
        }
        return variable;
    };
    const reply = rename_keys(website);
    if (reply.WebsiteConfiguration.RoutingRules) {
        reply.WebsiteConfiguration.RoutingRules =
            _.map(reply.WebsiteConfiguration.RoutingRules, rule => ({ RoutingRule: rule }));
    }
    return reply;
}

function parse_body_logging_xml(req) {
    const logging = {};
    const bucket_logging_status = req.body.BucketLoggingStatus;
    if (!bucket_logging_status) throw new S3Error(S3Error.MalformedXML);
    const target = bucket_logging_status.LoggingEnabled;
    if (target?.length > 0) {
        if (target[0].TargetGrants) throw new S3Error(S3Error.AccessControlListNotSupported);
        if (!target[0].TargetPrefix) {
            throw new S3Error({...S3Error.InvalidArgument, message: 'Log prefix is not provided'});
        }
        logging.log_bucket = target[0].TargetBucket[0];
        logging.log_prefix = target[0].TargetPrefix[0];
    }
    return logging;
}

function get_http_response_date(res) {
    const r = get_http_response_from_resp(res);
    if (!r.httpResponse.headers.date) throw new Error("date not found in response header");
    return r.httpResponse.headers.date;
}

function get_http_response_from_resp(res) {
    const r = res.$response;
    if (!r) throw new Error("no $response in s3 returned object");
    return r;
}

function get_response_field_encoder(req) {
    const encoding_type = req.query['encoding-type'];
    if ((typeof encoding_type === 'undefined') || (encoding_type === null)) return response_field_encoder_none;
    if (encoding_type.toLowerCase() === 'url') return response_field_encoder_url;
    dbg.warn('Invalid encoding-type', encoding_type);
    throw new S3Error(S3Error.InvalidEncodingType);
}

function response_field_encoder_none(value) {
    return value;
}

/** 
* Using URLSearchParams to encode the string as x-www-form-urlencoded
* with plus (+) instead of spaces (and not %20 as encodeURIComponent() does)
*/
function response_field_encoder_url(value) {
    return new URLSearchParams({ 'a': value }).toString().slice(2); // slice the leading 'a='
}

/**
 * parse_decimal_int consumes a string a returns a decimal integer if
 * the string represents a valid decimal integer.
 * @param {string} str
 * @returns {number}
 */
function parse_decimal_int(str) {
    const parsed = parseInt(str, 10);
    // If both return NaN or if parseInt tries to parse a string like '123abc'
    // or if Number tries to parse an empty string, then parsed !== Number(str)
    if (parsed !== Number(str)) throw new Error(`invalid decimal int ${str}`);

    return parsed;
}

/**
 * parse_version_id throws an error if version_id is an empty string, and returns it otherwise
 * @param {string|undefined} version_id
 * @param {import('./s3_errors').S3ErrorSpec} [empty_err]
 */
function parse_version_id(version_id, empty_err = S3Error.InvalidArgumentEmptyVersionId) {
    if (version_id === '') {
        throw new S3Error(empty_err);
    }
    return version_id;
}

/**
 * 
 * @param {*} req 
 * @returns {number}
 */
function parse_restore_request_days(req) {
    if (!req.body?.RestoreRequest?.Days?.[0]) {
        dbg.warn('parse_restore_request_days: missing Days in body');
        throw new S3Error(S3Error.MalformedXML);
    }

    const days = parse_decimal_int(req.body.RestoreRequest.Days[0]);
    if (days < 1) {
        dbg.warn('parse_restore_request_days: days cannot be less than 1');
        throw new S3Error(S3Error.InvalidArgument);
    }

    if (days > config.S3_RESTORE_REQUEST_MAX_DAYS) {
        if (config.S3_RESTORE_REQUEST_MAX_DAYS_BEHAVIOUR === 'DENY') {
            throw new S3Error({
                ...S3Error.InvalidArgument,
                detail: `Restore request days ${days} is above max ${config.S3_RESTORE_REQUEST_MAX_DAYS}`},
            );
        }

        dbg.log0(`Restore request days ${days} is above max ${config.S3_RESTORE_REQUEST_MAX_DAYS} - truncating`);
        return config.S3_RESTORE_REQUEST_MAX_DAYS;
    }

    return days;
}

exports.STORAGE_CLASS_STANDARD = STORAGE_CLASS_STANDARD;
exports.STORAGE_CLASS_GLACIER = STORAGE_CLASS_GLACIER;
exports.STORAGE_CLASS_GLACIER_IR = STORAGE_CLASS_GLACIER_IR;
exports.DEFAULT_S3_USER = DEFAULT_S3_USER;
exports.DEFAULT_OBJECT_ACL = DEFAULT_OBJECT_ACL;
exports.decode_chunked_upload = decode_chunked_upload;
exports.format_s3_xml_date = format_s3_xml_date;
exports.get_request_xattr = get_request_xattr;
exports.set_response_xattr = set_response_xattr;
exports.parse_etag = parse_etag;
exports.parse_part_number = parse_part_number;
exports.parse_copy_source = parse_copy_source;
exports.format_copy_source = format_copy_source;
exports.set_response_object_md = set_response_object_md;
exports.parse_storage_class = parse_storage_class;
exports.parse_storage_class_header = parse_storage_class_header;
exports.parse_encryption = parse_encryption;
exports.parse_body_tagging_xml = parse_body_tagging_xml;
exports.parse_tagging_header = parse_tagging_header;
exports.is_copy_tagging_directive = is_copy_tagging_directive;
exports.parse_body_encryption_xml = parse_body_encryption_xml;
exports.set_encryption_response_headers = set_encryption_response_headers;
exports.parse_body_website_xml = parse_body_website_xml;
exports.parse_body_logging_xml = parse_body_logging_xml;
exports.parse_website_to_body = parse_website_to_body;
exports.parse_lock_header = parse_lock_header;
exports.parse_body_object_lock_conf_xml = parse_body_object_lock_conf_xml;
exports.parse_to_camel_case = parse_to_camel_case;
exports._is_valid_retention = _is_valid_retention;
exports.get_http_response_from_resp = get_http_response_from_resp;
exports.get_http_response_date = get_http_response_date;
exports.XATTR_SORT_SYMBOL = XATTR_SORT_SYMBOL;
exports.get_response_field_encoder = get_response_field_encoder;
exports.parse_decimal_int = parse_decimal_int;
exports.parse_restore_request_days = parse_restore_request_days;
exports.parse_version_id = parse_version_id;
exports.get_object_owner = get_object_owner;
exports.get_default_object_owner = get_default_object_owner;
exports.set_response_supported_storage_classes = set_response_supported_storage_classes;
exports.parse_sse_c = parse_sse_c;
exports.OBJECT_ATTRIBUTES = OBJECT_ATTRIBUTES;
