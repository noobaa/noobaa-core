/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/list-containers2
 */
async function get_service_list(req, res) {
    const { prefix, marker, maxresults } = req.query;
    const reply = await req.object_sdk.list_buckets();
    return {
        EnumerationResults: {
            Prefix: prefix,
            Marker: marker,
            MaxResults: maxresults,
            Containers: _.map(reply.buckets, bucket => (
                bucket.name.includes('.') ? [] : {
                    Container: {
                        Name: bucket.name,
                        Properties: {
                            LeaseStatus: 'unlocked',
                            LeaseState: 'available',
                            Etag: '"1"',
                            'Last-Modified': (new Date()).toUTCString(),
                        }
                    }
                }
            ))
        }
    };
}

module.exports = {
    handler: get_service_list,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
