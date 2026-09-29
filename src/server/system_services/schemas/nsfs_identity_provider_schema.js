/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'identity_provider_schema',
    type: 'object',
    required: [
        'name',
        'type',
        'uri',
        'admin_user',
        'admin_password',
        'search_dn',
    ],
    properties: {
        name: {
            type: 'string',
        },
        type: {
            type: 'string',
            enum: ['ldap'],
        },
        uri: {
            type: 'string',
        },
        admin_user: {
            type: 'string',
        },
        admin_password: {
            type: 'string',
        },
        search_dn: {
            type: 'string',
        },
        dn_attribute: {
            type: 'string',
        },
        search_scope: {
            type: 'string',
            enum: ['base', 'one', 'sub'],
        },
        jwt_secret: {
            type: 'string',
        },
        tls_options: {
            type: 'object',
            properties: {},
            additionalProperties: true,
        },
        master_key_id: {
            objectid: true,
        },
        creation_date: {
            type: 'string',
        },
    }
};
