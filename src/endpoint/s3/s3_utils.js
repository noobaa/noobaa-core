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

const STORAGE_CLASS_STANDARD = 'STANDARD';

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

const OP_NAME_TO_ACTION = Object.freeze({
    delete_bucket_analytics: { regular: "s3:putanalyticsconfiguration" },
    delete_bucket_cors: { regular: "s3:putbucketcors" },
    delete_bucket_encryption: { regular: "s3:putencryptionconfiguration" },
    delete_bucket_inventory: { regular: "s3:putinventoryconfiguration" },
    delete_bucket_lifecycle: { regular: "s3:putlifecycleconfiguration" },
    delete_bucket_metrics: { regular: "s3:putmetricsconfiguration" },
    delete_bucket_policy: { regular: "s3:deletebucketpolicy" },
    delete_bucket_replication: { regular: "s3:putreplicationconfiguration" },
    delete_bucket_tagging: { regular: "s3:putbuckettagging" },
    delete_bucket_website: { regular: "s3:deletebucketwebsite" },
    delete_bucket: { regular: "s3:deletebucket" },
    delete_object_tagging: { regular: "s3:deleteobjecttagging", versioned: "s3:deleteobjectversiontagging" },
    delete_object_uploadId: { regular: "s3:abortmultipartupload" },
    delete_object: { regular: "s3:deleteobject", versioned: "s3:deleteobjectversion" },

    get_bucket_accelerate: { regular: "s3:getaccelerateconfiguration" },
    get_bucket_acl: { regular: "s3:getbucketacl" },
    get_bucket_analytics: { regular: "s3:getanalyticsconfiguration" },
    get_bucket_cors: { regular: "s3:getbucketcors" },
    get_bucket_encryption: { regular: "s3:getencryptionconfiguration" },
    get_bucket_inventory: { regular: "s3:getinventoryconfiguration" },
    get_bucket_lifecycle: { regular: "s3:getlifecycleconfiguration" },
    get_bucket_location: { regular: "s3:getbucketlocation" },
    get_bucket_logging: { regular: "s3:getbucketlogging" },
    get_bucket_metrics: { regular: "s3:getmetricsconfiguration" },
    get_bucket_notification: { regular: "s3:getbucketnotification" },
    get_bucket_policy: { regular: "s3:getbucketpolicy" },
    get_bucket_replication: { regular: "s3:getreplicationconfiguration" },
    get_bucket_requestpayment: { regular: "s3:getbucketrequestpayment" },
    get_bucket_tagging: { regular: "s3:getbuckettagging" },
    get_bucket_uploads: { regular: "s3:listbucketmultipartuploads" },
    get_bucket_versioning: { regular: "s3:getbucketversioning" },
    get_bucket_versions: { regular: "s3:listbucketversions" },
    get_bucket_website: { regular: "s3:getbucketwebsite" },
    get_bucket: { regular: "s3:listbucket" },
    get_object_acl: { regular: "s3:getobjectacl" },
    get_object_tagging: { regular: "s3:getobjecttagging", versioned: "s3:getobjectversiontagging" },
    get_object_uploadId: { regular: "s3:listmultipartuploadparts" },
    get_object: { regular: "s3:getobject", versioned: "s3:getobjectversion" },
    get_service: { regular: "s3:listallmybuckets" },

    head_bucket: { regular: "s3:listbucket" },
    head_object: { regular: "s3:getobject", versioned: "s3:getobjectversion" },

    post_bucket_delete: { regular: "s3:deleteobject" },
    post_object: { regular: "s3:putobject" },
    post_object_uploadId: { regular: "s3:putobject" },
    post_object_uploads: { regular: "s3:putobject" },

    put_bucket_accelerate: { regular: "s3:putaccelerateconfiguration" },
    put_bucket_acl: { regular: "s3:putbucketacl" },
    put_bucket_analytics: { regular: "s3:putanalyticsconfiguration" },
    put_bucket_cors: { regular: "s3:putbucketcors" },
    put_bucket_encryption: { regular: "s3:putencryptionconfiguration" },
    put_bucket_inventory: { regular: "s3:putinventoryconfiguration" },
    put_bucket_lifecycle: { regular: "s3:putlifecycleconfiguration" },
    put_bucket_logging: { regular: "s3:putbucketlogging" },
    put_bucket_metrics: { regular: "s3:putmetricsconfiguration" },
    put_bucket_notification: { regular: "s3:putbucketnotification" },
    put_bucket_policy: { regular: "s3:putbucketpolicy" },
    put_bucket_replication: { regular: "s3:putreplicationconfiguration" },
    put_bucket_requestpayment: { regular: "s3:putbucketrequestpayment" },
    put_bucket_tagging: { regular: "s3:putbuckettagging" },
    put_bucket_versioning: { regular: "s3:putbucketversioning" },
    put_bucket_website: { regular: "s3:putbucketwebsite" },
    put_bucket: { regular: "s3:createbucket" },
    put_object_acl: { regular: "s3:putobjectacl" },
    put_object_tagging: { regular: "s3:putobjecttagging", versioned: "s3:putobjectversiontagging" },
    put_object_uploadId: { regular: "s3:putobject" },
    put_object: { regular: "s3:putobject" },
});

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
        const md_header_size =
            X_AMZ_META.length +
            4 + // for ': ' and '\r\n'
            Buffer.byteLength(key, 'utf8') +
            Buffer.byteLength(xattr[key], 'utf8');
        if (md_header_size > size_for_md_left) {
            res.setHeader('x-amz-missing-meta', keys.length - returned_keys);
            break;
        }
        returned_keys += 1;
        size_for_md_left -= md_header_size;
        res.setHeader(X_AMZ_META + key, xattr[key]);
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
    return object_md;
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
    const tag_set = new Set();
    tagging_params.forEach((value, key) => {
        const tag = { key, value };
        if (!_is_valid_tag_values(tag)) throw new S3Error(S3Error.InvalidTag);
        if (tag_set.has(tag.key)) throw new S3Error(S3Error.InvalidTag);
        tag_set.add(tag.key);
    });
    if (tag_set.size > 10) throw new S3Error(S3Error.InvalidTag);
    return Array.from(tag_set);
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
        let days = parseInt(retention.Days[0], 10);
        if (days <= 0) {
            let err = new S3Error(S3Error.InvalidArgument);
            err.message = 'Default retention period must be a positive integer value';
            throw err;
        }
        conf.rule.default_retention.days = days;
    }
    if (retention.Years) {
        let years = parseInt(retention.Years[0], 10);
        if (years <= 0) {
            let err = new S3Error(S3Error.InvalidArgument);
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

function has_bucket_policy_permission(policy, account, method, arn_path) {
    const [allow_statements, deny_statements] = _.partition(policy.statement, statement => statement.effect === 'allow');

    // look for explicit denies
    if (_is_statements_fit(deny_statements, account, method, arn_path)) return 'DENY';

    // look for explicit allows
    if (_is_statements_fit(allow_statements, account, method, arn_path)) return 'ALLOW';

    // implicit deny
    return 'IMPLICIT_DENY';
}

const qm_regex = /\?/g;
const ar_regex = /\*/g;
function _is_statements_fit(statements, account, method, arn_path) {
    for (const statement of statements) {
        let action_fit = false;
        let principal_fit = false;
        let resource_fit = false;
        for (const action of statement.action) {
            dbg.log0('bucket_policy: action fit?', action, method);
            if ((action === '*') || (action === 's3:*') || (action === method)) {
                action_fit = true;
            }
        }
        for (const principal of statement.principal) {
            dbg.log0('bucket_policy: principal fit?', principal, account);
            if ((principal.unwrap() === '*') || (principal.unwrap() === account)) {
                principal_fit = true;
            }
        }
        for (const resource of statement.resource) {
            const resource_regex = RegExp(`^${resource.replace(qm_regex, '.?').replace(ar_regex, '.*')}$`);
            dbg.log0('bucket_policy: resource fit?', resource_regex, arn_path);
            if (resource_regex.test(arn_path)) {
                resource_fit = true;
            }
        }
        dbg.log0('bucket_policy: is_statements_fit', action_fit, principal_fit, resource_fit);
        if (action_fit && principal_fit && resource_fit) return true;
    }
    return false;
}


exports.STORAGE_CLASS_STANDARD = STORAGE_CLASS_STANDARD;
exports.DEFAULT_S3_USER = DEFAULT_S3_USER;
exports.DEFAULT_OBJECT_ACL = DEFAULT_OBJECT_ACL;
exports.OP_NAME_TO_ACTION = OP_NAME_TO_ACTION;
exports.decode_chunked_upload = decode_chunked_upload;
exports.format_s3_xml_date = format_s3_xml_date;
exports.get_request_xattr = get_request_xattr;
exports.set_response_xattr = set_response_xattr;
exports.parse_etag = parse_etag;
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
exports.parse_lock_header = parse_lock_header;
exports.parse_body_object_lock_conf_xml = parse_body_object_lock_conf_xml;
exports.parse_to_camel_case = parse_to_camel_case;
exports._is_valid_retention = _is_valid_retention;
exports.get_http_response_from_resp = get_http_response_from_resp;
exports.get_http_response_date = get_http_response_date;
exports.has_bucket_policy_permission = has_bucket_policy_permission;
exports.XATTR_SORT_SYMBOL = XATTR_SORT_SYMBOL;
