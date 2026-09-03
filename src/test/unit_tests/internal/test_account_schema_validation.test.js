/* Copyright (C) 2026 NooBaa */
'use strict';

const _ = require('lodash');
const { default: Ajv } = require('ajv');
const { KEYWORDS } = require('../../../util/schema_keywords');
const common_api = require('../../../api/common_api');
const schema_utils = require('../../../util/schema_utils');
const account_schema = require('../../../server/system_services/schemas/account_schema');

describe('account_schema validation', () => {

    const OWNER = '6a9971a71ad1d20028db2249';

    describe('account with all needed properties', () => {

        test('ACCOUNT identity', () => {
            validate_account_schema(get_account_data());
        });

        test('USER identity', () => {
            const account_data = get_account_data();
            account_data.identity_type = 'USER';
            account_data.owner = OWNER;
            validate_account_schema(account_data);
        });

        test('ROLE identity', () => {
            validate_account_schema(get_role_data());
        });

        test('legacy identity without identity_type', () => {
            const account_data = get_account_data();
            delete account_data.identity_type;
            validate_account_schema(account_data);
        });

    });

    describe('account without required properties', () => {

        test('USER without owner', () => {
            const account_data = get_account_data();
            account_data.identity_type = 'USER';
            const reason = 'Test should have failed because USER is missing owner';
            assert_validation(account_data, reason);
        });

        test('ROLE without assume_role_policy_document', () => {
            const account_data = get_role_data();
            delete account_data.assume_role_policy_document;
            const reason = 'Test should have failed because ROLE is missing assume_role_policy_document';
            assert_validation(account_data, reason);
        });

    });

});


function get_account_data() {
    return {
        _id: '6a9971a81ad1d20028db2259',
        name: 'account',
        email: 'account@example.com',
        has_login: false,
        identity_type: 'ACCOUNT',
    };
}

function get_role_data() {
    return {
        _id: '6a9971a81ad1d20028db2259',
        name: 'role',
        identity_type: 'ROLE',
        owner: '6a9971a71ad1d20028db2249',
        assume_role_policy_document: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 's3.amazonaws.com' }, Action: 'sts:AssumeRole' }],
        },
    };
}

const validate_account = (() => {
    const ajv = new Ajv({ verbose: true, allErrors: true });
    ajv.addKeyword(KEYWORDS.methods);
    ajv.addKeyword(KEYWORDS.doc);
    ajv.addKeyword(KEYWORDS.date);
    ajv.addKeyword(KEYWORDS.idate);
    ajv.addKeyword(KEYWORDS.objectid);
    ajv.addKeyword(KEYWORDS.binary);
    ajv.addKeyword(KEYWORDS.wrapper);
    ajv.addSchema(common_api);
    _.each(common_api.definitions, schema => {
        schema_utils.strictify(schema, { additionalProperties: false });
    });
    return ajv.compile(schema_utils.strictify(account_schema, { additionalProperties: false }));
})();

function validate_account_schema(account) {
    if (!validate_account(account)) {
        throw new Error('INVALID_SCHEMA_DB accounts');
    }
}

function assert_validation(account_to_validate, reason) {
    try {
        validate_account_schema(account_to_validate);
        fail(reason);
    } catch (err) {
        expect(err.message).toBe('INVALID_SCHEMA_DB accounts');
    }
}

function fail(reason) {
    throw new Error(reason);
}
