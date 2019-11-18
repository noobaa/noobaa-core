/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const S3Error = require('./s3_errors').S3Error;
const http_utils = require('../../util/http_utils');
const time_utils = require('../../util/time_utils');
const endpoint_utils = require('../endpoint_utils');
const crypto = require('crypto');

const STORAGE_CLASS_STANDARD = 'STANDARD';

const DEFAULT_S3_USER = Object.freeze({
    ID: '123',
    DisplayName: 'NooBaa'
});

function format_s3_xml_date(input) {
    let date = input ? new Date(input) : new Date();
    date.setMilliseconds(0);
    return date.toISOString();
}

const X_AMZ_META = 'x-amz-meta-';

function get_request_xattr(req) {
    let xattr = {};
    _.each(req.headers, (val, hdr) => {
        if (!hdr.startsWith(X_AMZ_META)) return;
        let key = hdr.slice(X_AMZ_META.length);
        if (!key) return;
        xattr[key] = val;
    });
    return xattr;
}

function set_response_xattr(res, xattr) {
    _.each(xattr, (val, key) => {
        res.setHeader(X_AMZ_META + key, val);
    });
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

    const base64_regex = new RegExp('^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$');
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
    const context_b64 = (algorithm === 'aws:kms') && req.headers['x-amz-server-side-encryption-context'];

    if (!algorithm) {
        if (kms_key_id) {
            throw new S3Error(S3Error.InvalidDigest);
        } else {
            return;
        }
    }

    if (algorithm !== 'AES256' && algorithm !== 'aws:kms') throw new S3Error(S3Error.InvalidDigest);

    if (algorithm === 'aws:kms' && !kms_key_id) throw new S3Error(S3Error.InvalidDigest);
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

function parse_content_length(req) {
    const size = Number(req.headers['x-amz-decoded-content-length'] || req.headers['content-length']);
    if (!Number.isInteger(size) || size < 0) {
        dbg.warn('Missing content-length', req.headers['content-length']);
        throw new S3Error(S3Error.MissingContentLength);
    }
    return size;
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

function set_response_object_md(res, object_md) {
    res.setHeader('ETag', '"' + object_md.etag + '"');
    res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date(object_md.create_time)));
    res.setHeader('Content-Type', object_md.content_type);
    res.setHeader('Content-Length', object_md.size);
    res.setHeader('Accept-Ranges', 'bytes');
    if (object_md.version_id) res.setHeader('x-amz-version-id', object_md.version_id);
    set_response_xattr(res, object_md.xattr);
    if (object_md.tag_count) res.setHeader('x-amz-tagging-count', object_md.tag_count);
    return object_md;
}

// Source: https://docs.aws.amazon.com/AmazonS3/latest/dev/object-tagging.html
function parse_body_tagging_xml(req) {
    const tagging = req.body.Tagging;
    if (!tagging) throw new S3Error(S3Error.MalformedXML);
    const tag_set = tagging.TagSet[0];
    const tag_key_names = ['Key', 'Value'];
    const tag_set_map = _.map(tag_set.Tag, tag => {
        const tag_keys = Object.keys(tag);
        if (!_.isEmpty(_.difference(tag_keys, tag_key_names)) ||
            tag_keys.length !== tag_key_names.length) throw new S3Error(S3Error.InvalidTag);
        return {
            key: tag.Key && tag.Key[0],
            value: tag.Value && tag.Value[0]
        };
    });
    if (tag_set_map.length === 0 || tag_set_map.length > 10) throw new S3Error(S3Error.InvalidTag);
    const tag_map = new Map();
    tag_set_map.forEach(tag => {
        if (!_is_valid_tag_values(tag)) throw new S3Error(S3Error.InvalidTag);
        if (tag_map.has(tag.key)) throw new S3Error(S3Error.InvalidTag);
        tag_map.set(tag.key);
    });
    return tag_set_map;
}

function _is_valid_tag_values(tag) {
    if (tag.key.length > 128 || tag.value.length > 256) return false;
    return true;
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
    const tag_set = [];
    const tag_map = new Map();
    tagging_params.forEach((value, key) => {
        const tag = { key, value };
        if (!_is_valid_tag_values(tag)) throw new S3Error(S3Error.InvalidTag);
        if (tag_map.has(tag.key)) throw new S3Error(S3Error.InvalidTag);
        tag_map.set(tag.key);
        tag_set.push(tag);
    });
    if (tag_set.length > 10) throw new S3Error(S3Error.InvalidTag);
    return tag_set;
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

exports.STORAGE_CLASS_STANDARD = STORAGE_CLASS_STANDARD;
exports.DEFAULT_S3_USER = DEFAULT_S3_USER;
exports.format_s3_xml_date = format_s3_xml_date;
exports.get_request_xattr = get_request_xattr;
exports.set_response_xattr = set_response_xattr;
exports.parse_etag = parse_etag;
exports.parse_content_length = parse_content_length;
exports.parse_part_number = parse_part_number;
exports.parse_copy_source = parse_copy_source;
exports.format_copy_source = format_copy_source;
exports.set_response_object_md = set_response_object_md;
exports.parse_encryption = parse_encryption;
exports.parse_body_tagging_xml = parse_body_tagging_xml;
exports.parse_tagging_header = parse_tagging_header;
exports.is_copy_tagging_directive = is_copy_tagging_directive;
exports.parse_body_encryption_xml = parse_body_encryption_xml;
exports.set_encryption_response_headers = set_encryption_response_headers;
exports.parse_body_website_xml = parse_body_website_xml;
exports.parse_website_to_body = parse_website_to_body;
