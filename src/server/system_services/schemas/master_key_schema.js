/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'master_key_schema',
    type: 'object',
    required: [
        '_id',
    ],
    properties: {
        _id: { objectid: true },
        description: { type: 'string' },
        // If missing - encrypted with root key
        // 1. ENV - Mounted key from Kubernetes secret
        // 2. HSM configuration TBD - Get key from Vault
        master_key_id: { objectid: true },
        // cipher used to provide confidentiality - computed on the compressed data
        cipher_type: { $ref: 'common_api#/definitions/cipher_type' },
        cipher_key: { binary: true },
        cipher_iv: { binary: true },
        disabled: { type: 'boolean' }
    }
};
