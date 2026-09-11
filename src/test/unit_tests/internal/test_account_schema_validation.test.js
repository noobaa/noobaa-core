/* Copyright (C) 2026 NooBaa */
'use strict';

const _ = require('lodash');
const { default: Ajv } = require('ajv');
const { KEYWORDS } = require('../../../util/schema_keywords');
const common_api = require('../../../api/common_api');
const schema_utils = require('../../../util/schema_utils');
const account_schema = require('../../../server/system_services/schemas/account_schema');

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
schema_utils.strictify(account_schema, { additionalProperties: false });
const validate_account = ajv.compile(account_schema);

const OWNER = '6a9971a71ad1d20028db2249';
const ACCOUNT = {
    _id: '6a9971a81ad1d20028db2259',
    name: 'account',
    email: 'account@example.com',
    has_login: false,
    identity_type: 'ACCOUNT',
};
const ROLE = {
    _id: '6a9971a81ad1d20028db2259',
    name: 'role',
    email: 'role/role:6a9971a71ad1d20028db2249',
    identity_type: 'ROLE',
    owner: OWNER,
    assume_role_policy_document: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 's3.amazonaws.com' }, Action: 'sts:AssumeRole' }],
    },
};

describe('account_schema validation', () => {

    describe('account with all needed properties', () => {

        test('ACCOUNT identity', () => {
            expect(validate_account(ACCOUNT)).toBe(true);
        });

        test('default ACCOUNT identity without identity_type', () => {
            const account = { ...ACCOUNT };
            delete account.identity_type;
            expect(validate_account(account)).toBe(true);
        });

        test('USER identity', () => {
            expect(validate_account({ ...ACCOUNT, identity_type: 'USER', owner: OWNER })).toBe(true);
        });

        test('ROLE identity', () => {
            expect(validate_account(ROLE)).toBe(true);
        });

    });

    describe('account without required properties', () => {

        test('USER without owner', () => {
            expect(validate_account({ ...ACCOUNT, identity_type: 'USER' })).toBe(false);
        });

        test('ROLE without email', () => {
            const role = { ...ROLE };
            delete role.email;
            expect(validate_account(role)).toBe(false);
        });

        test('ROLE without assume_role_policy_document', () => {
            const role = { ...ROLE };
            delete role.assume_role_policy_document;
            expect(validate_account(role)).toBe(false);
        });

    });

});
