'use strict';
let dbg = require('../util/debug_module')(__filename);
let string_utils = require('../util/string_utils');
let jstoxml = require('jstoxml');
let _ = require('lodash');

const DISPLAY_NAME = 'S3rver';
const S3_XML_ATTRS = Object.freeze({
    xmlns: 'http://doc.s3.amazonaws.com/2006-03-01'
});
const XML_OPTIONS = Object.freeze({
    header: true,
    indent: '  '
});

module.exports = {
    buildBuckets: buildBuckets,
    buildBucketQuery: buildBucketQuery,
    buildBucketNotFound: buildBucketNotFound,
    buildSignatureDoesNotMatch: buildSignatureDoesNotMatch,
    buildBucketNotEmpty: buildBucketNotEmpty,
    buildKeyNotFound: buildKeyNotFound,
    buildFolderNotFound: buildFolderNotFound,
    buildError: buildError,
    buildLocation: buildLocation,
    completeMultipleUpload: completeMultipleUpload,
    buildBucketVersionQuery: buildBucketVersionQuery,
    buildListPartsResult: buildListPartsResult,
    buildInitiateMultipartUploadResult: buildInitiateMultipartUploadResult,
    buildAcl: buildAcl,
    buildCopyObject: buildCopyObject,
    buildDeleteResult: buildDeleteResult,
};


function buildBuckets(buckets) {
    return jstoxml.toXML({
        _name: 'ListAllMyBucketsResult',
        _attrs: S3_XML_ATTRS,
        _content: {
            Owner: {
                ID: 123,
                DisplayName: DISPLAY_NAME
            },
            Buckets: _.map(buckets, bucket => ({
                Bucket: {
                    Name: bucket.name,
                    CreationDate: bucket.creationDate
                }
            }))
        }
    }, XML_OPTIONS);
}

function buildBucketQuery(options, items) {
    return jstoxml.toXML({
        _name: 'ListBucketResult',
        _attrs: S3_XML_ATTRS,
        _content: buildQueryContentXML(items, options)
    }, XML_OPTIONS);
}

function buildBucketNotFound(bucketName) {
    return jstoxml.toXML({
        Error: {
            Code: 'NoSuchBucket',
            Message: 'The resource you requested does not exist',
            Resource: bucketName,
            RequestId: 1
        }
    }, XML_OPTIONS);
}

function buildSignatureDoesNotMatch(string_to_sign) {
    return jstoxml.toXML({
        Error: {
            Code: 'SignatureDoesNotMatch',
            Type: 'Sender',
            Message: 'The request signature we calculated does not match the signature you provided.' +
                ' Check your AWS Secret Access Key and signing method.' +
                'Consult the service documentation for details.The canonical string' +
                'for this request should have been ' + '(no info)' +
                'The String - to - Sign should have been ' + string_to_sign,
            RequestId: 1
        }
    }, XML_OPTIONS);
}

function buildBucketNotEmpty(bucketName) {
    return jstoxml.toXML({
        Error: {
            Code: 'BucketNotEmpty',
            Message: 'The bucket your tried to delete is not empty',
            Resource: bucketName,
            RequestId: 1,
            HostId: 2
        }
    }, XML_OPTIONS);
}

function buildKeyNotFound(key) {
    return jstoxml.toXML({
        Error: {
            Code: 'NoSuchKey',
            Message: 'The specified key does not exist',
            Resource: key,
            RequestId: 1
        }
    }, XML_OPTIONS);
}

function buildFolderNotFound(key) {
    return jstoxml.toXML({
        Error: {
            Code: 'NoSuchKey',
            Message: 'The specified folder already exists',
            Resource: key,
            RequestId: 1
        }
    }, XML_OPTIONS);
}

function buildError(code, message) {
    return jstoxml.toXML({
        Error: {
            Code: code,
            Message: message,
            RequestId: 1
        }
    }, XML_OPTIONS);
}

function buildLocation() {
    return jstoxml.toXML({
        _name: 'LocationConstraint',
        _attrs: S3_XML_ATTRS,
        _content: 'EU'
    }, XML_OPTIONS);
}

function completeMultipleUpload(upload_info, items) {
    return jstoxml.toXML({
        _name: 'CompleteMultipartUploadResult',
        _attrs: S3_XML_ATTRS,
        _content: upload_info
    }, XML_OPTIONS);
}

function buildBucketVersionQuery(options, items) {
    let jxml = {
        _name: 'ListVersionsResult',
        _attrs: S3_XML_ATTRS,
        _content: buildVersionQueryContentXML(items, options)
    };
    let xml = jstoxml.toXML(jxml, XML_OPTIONS);
    console.log('version:', xml);
    return xml;
}

function buildListPartsResult(items, options) {
    try {
        let jxml = {
            _name: 'buildListPartsResult',
            _attrs: S3_XML_ATTRS,
            _content: buildListPartResult(items, options)
        };
        let xml = jstoxml.toXML(jxml, XML_OPTIONS);
        dbg.log2("list parts (xml):", xml);
        return xml;
    } catch (err) {
        dbg.log0('Error while buildListPartsResult:', err);
    }
}

function buildInitiateMultipartUploadResult(key, bucket) {
    return jstoxml.toXML({
        InitiateMultipartUploadResult: {
            Bucket: bucket,
            Key: key,
            UploadId: key
        }
    }, XML_OPTIONS);
}

function buildAcl() {
    return jstoxml.toXML({
        _name: 'AccessControlPolicy',
        _attrs: S3_XML_ATTRS,
        _content: {
            Owner: {
                ID: 123,
                DisplayName: DISPLAY_NAME
            },
            AccessControlList: {
                Grant: [{
                    _name: 'Grantee',
                    _attrs: {
                        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
                        'xsi:type': 'CanonicalUser'
                    },
                    _content: {
                        ID: 'abc',
                        DisplayName: 'You'
                    },
                }, {
                    _name: 'Permission',
                    _content: 'FULL_CONTROL'
                }]
            }
        }
    }, XML_OPTIONS);
}

function buildCopyObject(item) {
    return jstoxml.toXML({
        CopyObjectResult: {
            LastModified: item.modifiedDate,
            ETag: item.md5
        }
    }, XML_OPTIONS);
}

function buildDeleteResult(items, errors) {
    let xml = {
        _name: 'DeleteResult',
        _attrs: S3_XML_ATTRS,
        _content: buildDeleteContentXML(items, errors)
    };
    return jstoxml.toXML(xml, XML_OPTIONS);

}


// UTILS //////////////////////////////////////////////////////////////////////


function buildQueryContentXML(items, options) {
    let content = _.map(items, item => ({
        Contents: {
            Key: string_utils.encodeXML(item.key),
            LastModified: item.modifiedDate,
            ETag: item.md5,
            Size: item.size,
            StorageClass: 'Standard',
            Owner: {
                ID: 123,
                DisplayName: DISPLAY_NAME
            }
        }
    }));

    //console.log('cp value:',common_prefixes_value);
    content.unshift(_.map(options.common_prefixes, prefix => ([{
        _name: 'CommonPrefixes',
        _content: {
            Prefix: prefix || ''
        }
    }])));

    let additional_data = {
        Name: options.bucketName,
        Prefix: options.prefix || '',
        Marker: options.marker || '',
        MaxKeys: options.maxKeys,
        Delimiter: options.delimiter,
        IsTruncated: false
    };
    content.unshift(additional_data);
    return content;
}

function buildListPartResult(items, options) {
    let date = new Date();
    date.setMilliseconds(0);
    date = date.toISOString();
    let content = _.map(items, item => ({
        Part: {
            PartNumber: item.part_number,
            LastModified: date,
            ETag: options.key + item.part_number,
            Size: item.size,
        }
    }));

    //console.log('cp value:',common_prefixes_value);
    let additional_data = {
        Bucket: options.bucket,
        Key: options.key,
        UploadId: options.key,
        Initiator: {
            ID: 'admin',
            DisplayName: 'admin'
        },
        Owner: {
            ID: 'admin',
            DisplayName: 'admin'
        },
        StorageClass: 'STANDARD',
        PartNumberMarker: (_.head(items)).part_number,
        NextPartNumberMarker: options.NextPartNumberMarker,
        MaxParts: options.MaxParts,
        IsTruncated: options.IsTruncated,
    };

    content.unshift(additional_data);
    return content;
}

function buildVersionQueryContentXML(items, options) {
    console.log('items:', items);
    let date = new Date();
    date.setMilliseconds(0);
    date = date.toISOString();
    let content = _.map(items, function(item) {
        return {
            Version: {
                Key: item.key,
                VersionId: '1',
                IsLatest: true,
                LastModified: item.modifiedDate,
                ETag: item.md5,
                Size: item.size,
                StorageClass: 'Standard',
                Owner: {
                    ID: 123,
                    DisplayName: DISPLAY_NAME
                }
            }
        };
    });

    content.unshift({
        Name: options.bucketName,
        Prefix: options.prefix || '',
        LastModified: date,
        Marker: options.marker || '',
        KeyMarker: '',
        MaxKeys: options.maxKeys,
        VersionIdMarker: '',
        IsTruncated: false,
    });
    //console.log('content:', content, ' opts', options, 'items:', items);

    return content;
}

function buildDeleteContentXML(items, errors) {
    let content = _.map(items, item => ({
        Deleted: {
            Key: item.Key
        }
    }));
    let errors_content = _.map(errors, error => ({
        Error: {
            Key: error.Key,
            Code: error.Code,
            Message: error.Message
        }
    }));

    errors_content.unshift(content);
    return errors_content;
}
