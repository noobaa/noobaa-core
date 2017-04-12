/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

function list_containers(req, res) {
    const { prefix, marker, maxresults } = req.query;
    return req.rpc_client.bucket.list_buckets()
        .then(reply => ({
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
        }));
}

module.exports = {
    handler: list_containers,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
