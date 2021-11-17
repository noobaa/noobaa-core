/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const { default: Ajv } = require('ajv');
const schema_keywords = require('../../util/schema_keywords');
const SensitiveString = require('../../util/sensitive_string');
const mongodb = require('mongodb');
const assert = require('assert');

/**
 * @typedef {import('ajv').KeywordCxt} KeywordCxt
 */

const ajv = new Ajv({ verbose: true, allErrors: true });

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
    },
};


mocha.describe('Test Schema Keywords', function() {

    mocha.before('Adding Schema And Keywords', async function() {
        ajv.addSchema(test_schema_keywords);
        ajv.addKeyword(schema_keywords.KEYWORDS.methods);
        ajv.addKeyword(schema_keywords.KEYWORDS.date);
        ajv.addKeyword(schema_keywords.KEYWORDS.idate);
        ajv.addKeyword(schema_keywords.KEYWORDS.objectid);
        ajv.addKeyword(schema_keywords.KEYWORDS.binary);
        ajv.addKeyword(schema_keywords.KEYWORDS.wrapper);
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

});
