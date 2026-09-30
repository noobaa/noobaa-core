/* Copyright (C) 2026 NooBaa */
'use strict';

const nsfs_schema_utils = require('../../../../manage_nsfs/nsfs_schema_utils');
const RpcError = require('../../../../rpc/rpc_error');
const config = require('../../../../../config');

describe('schema validation NC NSFS identity provider', () => {

    describe('identity provider with all needed properties', () => {

        it('ldap identity provider with required fields', () => {
            const data = get_identity_provider_data();
            nsfs_schema_utils.validate_identity_provider_schema(data);
        });

        it('ldap identity provider with optional fields', () => {
            const data = get_identity_provider_data();
            data.dn_attribute = 'sAMAccountName';
            data.search_scope = 'one';
            data.jwt_secret = 'secret';
            data.tls_options = { rejectUnauthorized: false };
            data.master_key_id = '65a62e22ceae5e5f1a758123';
            data.creation_date = new Date().toISOString();
            nsfs_schema_utils.validate_identity_provider_schema(data);
        });
    });

    describe('identity provider with missing required properties', () => {

        it('without name', () => {
            const data = get_identity_provider_data();
            delete data.name;
            assert_validation(data, 'Test should have failed because of missing required property name',
                "must have required property 'name'");
        });

        it('without type', () => {
            const data = get_identity_provider_data();
            delete data.type;
            assert_validation(data, 'Test should have failed because of missing required property type',
                "must have required property 'type'");
        });

        it('without uri', () => {
            const data = get_identity_provider_data();
            delete data.uri;
            assert_validation(data, 'Test should have failed because of missing required property uri',
                "must have required property 'uri'");
        });

        it('without admin_user', () => {
            const data = get_identity_provider_data();
            delete data.admin_user;
            assert_validation(data, 'Test should have failed because of missing required property admin_user',
                "must have required property 'admin_user'");
        });

        it('without admin_password', () => {
            const data = get_identity_provider_data();
            delete data.admin_password;
            assert_validation(data, 'Test should have failed because of missing required property admin_password',
                "must have required property 'admin_password'");
        });

        it('without search_dn', () => {
            const data = get_identity_provider_data();
            delete data.search_dn;
            assert_validation(data, 'Test should have failed because of missing required property search_dn',
                "must have required property 'search_dn'");
        });
    });

    describe('identity provider with invalid values', () => {

        it('invalid type', () => {
            const data = get_identity_provider_data();
            data.type = 'oidc';
            assert_validation(data, 'Test should have failed because of invalid type',
                'must be equal to one of the allowed values');
        });

        it('invalid search_scope', () => {
            const data = get_identity_provider_data();
            data.search_scope = 'invalid';
            assert_validation(data, 'Test should have failed because of invalid search_scope',
                'must be equal to one of the allowed values');
        });

        it('additional properties', () => {
            const data = get_identity_provider_data();
            data.unknown_field = 'x';
            const prev = config.NC_DISABLE_SCHEMA_CHECK;
            config.NC_DISABLE_SCHEMA_CHECK = false;
            try {
                assert_validation(data, 'Test should have failed because of additional properties',
                    'must NOT have additional properties');
            } finally {
                config.NC_DISABLE_SCHEMA_CHECK = prev;
            }
        });
    });
});

function get_identity_provider_data() {
    return {
        name: 'corp-ldap',
        type: 'ldap',
        uri: 'ldaps://ldap.example.com:636',
        admin_user: 'cn=admin,dc=example,dc=com',
        admin_password: 'encrypted-or-plain',
        search_dn: 'ou=people,dc=example,dc=com',
    };
}

function assert_validation(data_to_validate, reason, basic_message) {
    try {
        nsfs_schema_utils.validate_identity_provider_schema(data_to_validate);
        fail(reason);
    } catch (err) {
        expect(err).toBeInstanceOf(RpcError);
        expect(err).toHaveProperty('message');
        expect((err.message).includes(basic_message)).toBe(true);
    }
}

function fail(reason) {
    throw new Error(reason);
}
