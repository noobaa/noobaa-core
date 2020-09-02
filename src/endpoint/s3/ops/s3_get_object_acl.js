/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGETacl.html
 */
async function get_object_acl(req) {
    const reply = await req.object_sdk.get_object_acl({
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId,
    });

    return {
        AccessControlPolicy: {
            Owner: reply.owner,
            AccessControlList:
                _.map(reply.access_control_list, acl => ({
                    Grant: {
                        Grantee: {
                            _attr: {
                                'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
                                'xsi:type': acl.Grantee.Type,
                            },
                            _content: _.omit(acl.Grantee, 'Type')
                        },
                        Permission: acl.Permission
                    }
                }))
        }
    };
}

module.exports = {
    handler: get_object_acl,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
