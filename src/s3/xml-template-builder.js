'use strict';
var dbg = require('noobaa-util/debug_module')(__filename);
var string_utils = require('../util/string_utils');
var xml = function() {
    var jstoxml = require('jstoxml');
    var _ = require('lodash');
    var DISPLAY_NAME = 'S3rver';
    var buildQueryContentXML = function(items, options) {
        var content = _.map(items, function(item) {
            return {
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
            };
        });


        //console.log('cp value:',common_prefixes_value);
        var additional_data = {
            Name: options.bucketName,
            Prefix: options.prefix || '',
            Marker: options.marker || '',
            MaxKeys: options.maxKeys,
            Delimiter: options.delimiter,
            IsTruncated: false
        };
        content.unshift(_.map(options.common_prefixes, function(prefix) {
            return [{
                _name: 'CommonPrefixes',
                _content: {
                    Prefix: prefix || ''
                }
            }];
        }));

        content.unshift(additional_data);
        return content;
    };
    var buildListPartResult = function(items, options) {
        var date = new Date();
        date.setMilliseconds(0);
        date = date.toISOString();
        var content = _.map(items, function(item) {
            return {
                Part: {
                    PartNumber: item.part_number,
                    LastModified: date,
                    ETag: options.key + item.part_number,
                    Size: item.size,
                }
            };
        });


        //console.log('cp value:',common_prefixes_value);
        var additional_data = {
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
            PartNumberMarker: (_.first(items)).part_number,
            NextPartNumberMarker: options.NextPartNumberMarker,
            MaxParts: options.MaxParts,
            IsTruncated: options.IsTruncated,
        };

        content.unshift(additional_data);
        return content;
    };
    var buildVersionQueryContentXML = function(items, options) {
        console.log('items:', items);
        var date = new Date();
        date.setMilliseconds(0);
        date = date.toISOString();
        var content = _.map(items, function(item) {
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
    };

    return {
        buildBuckets: function(buckets) {
            return jstoxml.toXML({
                _name: 'ListAllMyBucketsResult',
                _attrs: {
                    'xmlns': 'http://doc.s3.amazonaws.com/2006-03-01'
                },
                _content: {
                    Owner: {
                        ID: 123,
                        DisplayName: DISPLAY_NAME
                    },
                    Buckets: _.map(buckets, function(bucket) {
                        return {
                            Bucket: {
                                Name: bucket.name,
                                CreationDate: bucket.creationDate
                            }
                        };
                    })
                }
            }, {
                header: true,
                indent: '  '
            });
        },
        buildBucketQuery: function(options, items) {
            var xml = {
                _name: 'ListBucketResult',
                _attrs: {
                    'xmlns': 'http://doc.s3.amazonaws.com/2006-03-01'
                },
                _content: buildQueryContentXML(items, options)
            };
            return jstoxml.toXML(xml, {
                header: true,
                indent: '  '
            });
        },
        buildBucketNotFound: function(bucketName) {
            return jstoxml.toXML({
                Error: {
                    Code: 'NoSuchBucket',
                    Message: 'The resource you requested does not exist',
                    Resource: bucketName,
                    RequestId: 1
                }
            }, {
                header: true,
                indent: '  '
            });
        },
        buildSignatureDoesNotMatch: function(string_to_sign) {
            return jstoxml.toXML({
                Error: {
                    Code: 'SignatureDoesNotMatch',
                    Type: 'Sender',
                    Message: 'The request signature we calculated does not match the signature you provided.'+
                            ' Check your AWS Secret Access Key and signing method.'+
                            'Consult the service documentation for details.The canonical string'+
                            'for this request should have been '+'(no info)'+
                            'The String - to - Sign should have been '+string_to_sign,
                    RequestId: 1
                }
            }, {
                header: true,
                indent: ' '
            });
        },
        buildBucketNotEmpty: function(bucketName) {
            return jstoxml.toXML({
                Error: {
                    Code: 'BucketNotEmpty',
                    Message: 'The bucket your tried to delete is not empty',
                    Resource: bucketName,
                    RequestId: 1,
                    HostId: 2
                }
            }, {
                header: true,
                indent: '  '
            });
        },
        buildKeyNotFound: function(key) {
            return jstoxml.toXML({
                Error: {
                    Code: 'NoSuchKey',
                    Message: 'The specified key does not exist',
                    Resource: key,
                    RequestId: 1
                }
            }, {
                header: true,
                indent: '  '
            });
        },
        buildFolderNotFound: function(key) {
            return jstoxml.toXML({
                Error: {
                    Code: 'NoSuchKey',
                    Message: 'The specified folder already exists',
                    Resource: key,
                    RequestId: 1
                }
            }, {
                header: true,
                indent: '  '
            });
        },
        buildError: function(code, message) {
            return jstoxml.toXML({
                Error: {
                    Code: code,
                    Message: message,
                    RequestId: 1
                }
            }, {
                header: true,
                indent: '  '
            });
        },
        buildLocation: function() {

            return jstoxml.toXML({

                _name: 'LocationConstraint',
                _attrs: {
                    'xmlns': 'http://doc.s3.amazonaws.com/2006-03-01'
                },
                _content: 'EU'
            }, {
                header: true,
                indent: '  '

            });
        },
        completeMultipleUpload: function(upload_info, items) {
            return jstoxml.toXML({
                _name: 'CompleteMultipartUploadResult',
                _attrs: {
                    'xmlns': 'http://doc.s3.amazonaws.com/2006-03-01'
                },
                _content: upload_info
            }, {
                header: true,
                indent: '  '
            });
        },
        buildBucketVersionQuery: function(options, items) {
            var jxml = {
                _name: 'ListVersionsResult',
                _attrs: {
                    'xmlns': 'http://doc.s3.amazonaws.com/2006-03-01'
                },
                _content: buildVersionQueryContentXML(items, options)
            };

            var xml = jstoxml.toXML(jxml, {
                header: true,
                indent: '  '
            });
            console.log('version:', xml);
            return xml;
        },
        ListPartsResult: function(items, options) {
            try {

                var jxml = {
                    _name: 'ListPartsResult',
                    _attrs: {
                        'xmlns': 'http://doc.s3.amazonaws.com/2006-03-01'
                    },
                    _content: buildListPartResult(items, options)
                };
                var xml = jstoxml.toXML(jxml, {
                    header: true,
                    indent: '  '
                });
                dbg.log2("list parts (xml):", xml);
                return xml;
            } catch (err) {
                dbg.log0('Error while ListPartsResult:', err);
            }

        },
        buildInitiateMultipartUploadResult: function(key,bucket) {
            return jstoxml.toXML({
                InitiateMultipartUploadResult: {
                    Bucket: bucket,
                    Key: key,
                    UploadId: key
                }
            }, {
                header: true,
                indent: '  '
            });
        },
        buildAcl: function() {
            return jstoxml.toXML({
                _name: 'AccessControlPolicy',
                _attrs: {
                    'xmlns': 'http://doc.s3.amazonaws.com/2006-03-01'
                },
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
            }, {
                header: true,
                indent: '  '
            });
        },
        buildCopyObject: function(item) {
            return jstoxml.toXML({
                CopyObjectResult: {
                    LastModified: item.modifiedDate,
                    ETag: item.md5
                }
            }, {
                header: true,
                indent: '  '
            });
        }
    };
};
module.exports = xml();
