// module targets: nodejs & browserify
'use strict';

var _ = require('lodash');
var Q = require('q');
var dbg = require('noobaa-util/debug_module')(__filename);
var s3_util = require('aws-sdk/lib/util');

// The original s3 code doesn't work well with express and query string.
// It expects to see query string as part of the request.path.
// This is a copy of aws javascript sdk code, with minor modifications.

module.exports = {
    noobaa_string_to_sign: noobaa_string_to_sign,
    canonicalizedResource: canonicalizedResource,
    canonicalizedAmzHeaders: canonicalizedAmzHeaders
};



var subResources = {
    'acl': 1,
    'cors': 1,
    'lifecycle': 1,
    'delete': 1,
    'location': 1,
    'logging': 1,
    'notification': 1,
    'partNumber': 1,
    'policy': 1,
    'requestPayment': 1,
    'restore': 1,
    'tagging': 1,
    'torrent': 1,
    'uploadId': 1,
    'uploads': 1,
    'versionId': 1,
    'versioning': 1,
    'versions': 1,
    'website': 1
};
function canonicalizedResource (request) {
    //handle path - modification on top of aws code.
    var r = request;
    var parts = r.url.split('?');
    var path = r.path;
    var querystring = parts[1];

    var resource = '';

    if (r.virtualHostedBucket)
        resource += '/' + r.virtualHostedBucket;

    resource += path;
    if (querystring) {

        // collect a list of sub resources and query params that need to be signed
        var resources = [];

        s3_util.arrayEach(querystring.split('&'), function(param) {
            var name = param.split('=')[0];
            var value = param.split('=')[1];
            if (subResources[name]) {
                var subresource = {
                    name: name
                };
                //another modification on top of aws code.
                //fixed to isEmpty, instead of undefined comparison
                if (!_.isEmpty(value)) {
                    if (subResources[name]) {
                        subresource.value = value;
                    } else {
                        subresource.value = decodeURIComponent(value);
                    }
                }
                resources.push(subresource);
            }
        });

        resources.sort(function(a, b) {
            return a.name < b.name ? -1 : 1;
        });

        if (resources.length) {
            querystring = [];
            s3_util.arrayEach(resources, function(res) {
                if (res.value === undefined)
                    querystring.push(res.name);
                else
                    querystring.push(res.name + '=' + res.value);
            });

            resource += '?' + querystring.join('&');
        }

    }
    return resource;
}
function canonicalizedAmzHeaders (request) {
    var amzHeaders = [];

    s3_util.each(request.headers, function(name) {
        if (name.match(/^x-amz-/i))
            amzHeaders.push(name);
    });

    amzHeaders.sort(function(a, b) {
        return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
    });

    var parts = [];
    s3_util.arrayEach( amzHeaders, function(name) {
        parts.push(name.toLowerCase() + ':' + String(request.headers[name]));
    });

    return parts.join('\n');
}
function noobaa_string_to_sign (request) {
    var r = request;
    var parts = [];
    parts.push(r.method);
    //changed to lower case (on top of aws code)
    parts.push(r.headers['content-md5'] || '');
    parts.push(r.headers['content-type'] || '');

    // This is the "Date" header, but we use X-Amz-Date.
    // The S3 signing mechanism requires us to pass an empty
    // string for this Date header regardless.
    parts.push(r.headers['presigned-expires'] || '');

    var headers = canonicalizedAmzHeaders(request);
    if (headers) parts.push(headers);
    parts.push(canonicalizedResource(request));

    parts = parts.join('\n');
    return parts;

}
