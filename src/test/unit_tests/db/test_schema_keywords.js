/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const { default: Ajv } = require('ajv');
const schema_utils = require('../../../util/schema_utils');
const schema_keywords = require('../../../util/schema_keywords');
const common_api = require('../../../api/common_api');
const account_schema = require('../../../server/system_services/schemas/account_schema');
const SensitiveString = require('../../../util/sensitive_string');
const mongodb = require('mongodb');
const assert = require('assert');

/**
 * @typedef {import('ajv').KeywordCxt} KeywordCxt
 */

const ajv = new Ajv({ verbose: true, allErrors: true });
const ACCOUNT_ID = '6a9971a71ad1d20028db2249';
const ACCOUNT = {
    _id: ACCOUNT_ID,
    name: 'account',
    email: 'account@example.com',
    has_login: false,
    identity_type: 'ACCOUNT',
};
const ROLE = {
    _id: ACCOUNT_ID,
    name: 'role',
    identity_type: 'ROLE',
    owner: ACCOUNT_ID,
    assume_role_policy_document: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 's3.amazonaws.com' }, Action: 'sts:AssumeRole' }],
    },
};
let validate_account;

const oneOf_properties = {
    kind: { type: 'string' },
    name: { type: 'string' },
};

const test_schema_keywords = {
    $id: 'test_schema_keywords',
    methods: {
        params: {
            type: 'object',
            additionalProperties: false,
            properties: {
                key1: {
                    date: true,
                },
                key2: {
                    idate: true,
                },
                key3: {
                    objectid: true,
                },
                key4: {
                    binary: true,
                },
                key5: {
                    binary: 5,
                },
                key6: {
                    wrapper: SensitiveString,
                },
            },
        },
        oneOf: {
            type: 'object',
            properties: oneOf_properties,
            oneOf: [{
                type: 'object',
                required: ['kind', 'name'],
                properties: {
                    kind: { type: 'string', enum: ['A'] },
                    name: { type: 'string' },
                },
            }, {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { type: 'string' },
                },
            }],
        },
    },
};

function add_keywords(ajv_instance) {
    ajv_instance.addKeyword(schema_keywords.KEYWORDS.methods);
    ajv_instance.addKeyword(schema_keywords.KEYWORDS.doc);
    ajv_instance.addKeyword(schema_keywords.KEYWORDS.date);
    ajv_instance.addKeyword(schema_keywords.KEYWORDS.idate);
    ajv_instance.addKeyword(schema_keywords.KEYWORDS.objectid);
    ajv_instance.addKeyword(schema_keywords.KEYWORDS.binary);
    ajv_instance.addKeyword(schema_keywords.KEYWORDS.wrapper);
}

mocha.describe('Test Schema Keywords', function() {

    mocha.before('Adding Schema And Keywords', async function() {
        add_keywords(ajv);
        schema_utils.strictify(test_schema_keywords.methods.oneOf, { additionalProperties: false });
        ajv.addSchema(common_api);
        _.each(common_api.definitions, schema => {
            schema_utils.strictify(schema, { additionalProperties: false });
        });
        ajv.addSchema(test_schema_keywords);
        validate_account = ajv.compile(schema_utils.strictify(account_schema, { additionalProperties: false }));
    });

    mocha.it('Test keyword date', async function() {
        const validator = ajv.getSchema('test_schema_keywords#/methods/params');
        const should_pass = { key1: new Date() };
        assert.strictEqual(validator(should_pass), true);
        const should_fail = { key1: 'not_a_date' };
        assert.strictEqual(validator(should_fail), false);
    });

    mocha.it('Test keyword idate', async function() {
        const validator = ajv.getSchema('test_schema_keywords#/methods/params');
        const should_pass = { key2: Date.now() };
        assert.strictEqual(validator(should_pass), true);
        const should_fail = { key2: 'not_an_idate' };
        assert.strictEqual(validator(should_fail), false);
    });

    mocha.it('Test keyword objectid', async function() {
        const validator = ajv.getSchema('test_schema_keywords#/methods/params');
        const should_pass = { key3: new mongodb.ObjectId() };
        assert.strictEqual(validator(should_pass), true);
        const should_fail = { key3: 'not_an_objectid' };
        assert.strictEqual(validator(should_fail), false);
    });

    mocha.it('Test keyword objectid as string', async function() {
        const validator = ajv.getSchema('test_schema_keywords#/methods/params');
        //Testing an objectId value as string with length = 24 and allowed characters
        const should_pass = { key3: '1234567890abcdefABCDEF00' };
        assert.strictEqual(validator(should_pass), true);
        //Testing an objectId value as string with length < 24 and allowed characters
        const should_fail1 = { key3: '1234567890abcdefABCDEF' };
        assert.strictEqual(validator(should_fail1), false);
        //Testing an objectId value as string with length > 24 and allowed characters
        const should_fail2 = { key3: '1234567890abcdefABCDEF000' };
        assert.strictEqual(validator(should_fail2), false);
        //Testing an objectId value as string with length = 24 and not allowed characters
        const should_fail3 = { key3: '1234567890abcdefABCDEG' };
        assert.strictEqual(validator(should_fail3), false);
    });

    mocha.it('Test keyword binary', async function() {
        const validator = ajv.getSchema('test_schema_keywords#/methods/params');
        const should_pass = { key4: Buffer.from('buffer') };
        assert.strictEqual(validator(should_pass), true);
        const should_fail = { key4: 'not_a_buffer' };
        assert.strictEqual(validator(should_fail), false);
    });

    mocha.it('Test keyword binary length', async function() {
        const validator = ajv.getSchema('test_schema_keywords#/methods/params');
        //Testing an exact stated size of buffer
        const should_pass = { key5: Buffer.from('exact') };
        assert.strictEqual(validator(should_pass), true);
        //Testing a buffer larger then the stated size of buffer
        const should_fail1 = { key5: Buffer.from('larger') };
        assert.strictEqual(validator(should_fail1), false);
        //Testing a buffer smaller then the stated size of buffer
        const should_fail2 = { key5: Buffer.from('tiny') };
        assert.strictEqual(validator(should_fail2), false);
    });

    mocha.it('Test keyword wrapper', async function() {
        const validator = ajv.getSchema('test_schema_keywords#/methods/params');
        //Testing a SensitiveString
        const should_pass1 = { key6: new SensitiveString('text') };
        assert.strictEqual(validator(should_pass1), true);
        //Testing a string, and it should become a SensitiveString sting
        const should_pass2 = { key6: 'can_be_wrapper' };
        const been_wrapped = validator(should_pass2);
        assert.strictEqual(been_wrapped, true);
        assert.strictEqual(should_pass2.key6 instanceof SensitiveString, true);
        //Testing an int, and it should fail becoming a SensitiveString sting
        const should_fail = { key6: 1 };
        assert.strictEqual(validator(should_fail), false);
    });

    mocha.it('Test keyword oneOf', async function() {
        const validator = ajv.getSchema('test_schema_keywords#/methods/oneOf');
        assert.strictEqual(validator({ kind: 'A', name: 'name-a' }), true);
        assert.strictEqual(validator({ name: 'legacy' }), true);
        assert.strictEqual(validator({ kind: 'A' }), false);
    });

    mocha.describe('account_schema validation', function() {

        mocha.it('ACCOUNT identity', function() {
            assert.strictEqual(validate_account(ACCOUNT), true);
        });

        mocha.it('default ACCOUNT identity without identity_type', function() {
            const account = { ...ACCOUNT };
            delete account.identity_type;
            assert.strictEqual(validate_account(account), true);
        });

        mocha.it('USER identity', function() {
            assert.strictEqual(validate_account({ ...ACCOUNT, identity_type: 'USER', owner: ACCOUNT_ID }), true);
        });

        mocha.it('ROLE identity', function() {
            assert.strictEqual(validate_account(ROLE), true);
        });

        mocha.it('USER without owner', function() {
            assert.strictEqual(validate_account({ ...ACCOUNT, identity_type: 'USER' }), false);
        });

        mocha.it('ROLE without assume_role_policy_document', function() {
            const role = { ...ROLE };
            delete role.assume_role_policy_document;
            assert.strictEqual(validate_account(role), false);
        });

    });

});
