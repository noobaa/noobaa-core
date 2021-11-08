/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
// const _ = require('lodash');
const { default: Ajv } = require('ajv');
const util = require('util');
const BSON = require('bson');
const assert = require('assert');
const { KEYWORDS } = require('../../util/schema_keywords');
const SensitiveString = require('../../util/sensitive_string');

mocha.describe('SensitiveString', function() {
    const ajv = new Ajv({ verbose: true, allErrors: true });
    ajv.addKeyword(KEYWORDS.wrapper);
    ajv.addSchema({
        $id: 'system',
        type: 'object',
        required: ['users'],
        additionalProperties: false,
        properties: {
            users: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['name', 'secret'],
                    additionalProperties: false,
                    properties: {
                        name: { type: 'string' },
                        secret: {
                            wrapper: SensitiveString,
                        },
                    }
                }
            }
        }
    });

    const SECRET = 'SHHHHH';
    const system = {
        users: [
            { name: 'Alice', secret: SECRET + '-Alice' },
            { name: 'Bob', secret: SECRET + '-Bob' },
        ]
    };
    const first_validation = ajv.validate('system', system);
    const second_validation = ajv.validate('system', system);

    mocha.it('first validation success and wraps secrets', function() {
        assert.strictEqual(first_validation, true);
        for (const user of system.users) {
            assert.strictEqual(user.secret.constructor, SensitiveString);
        }
    });

    mocha.it('second validation success and wraps secrets', function() {
        assert.strictEqual(second_validation, true);
        for (const user of system.users) {
            assert.strictEqual(user.secret.constructor, SensitiveString);
        }
    });


    mocha.it('inspect hides sensitive data', function() {
        const str = util.inspect(system, { depth: null });
        assert.strictEqual(str.search(SECRET), -1);
        assert.strictEqual(str.split('SENSITIVE').length, 3);
    });

    mocha.it('json unwraps sensitive data', function() {
        const str = JSON.stringify(system);
        assert.strictEqual(str.search('SENSITIVE'), -1);
        assert.strictEqual(str.split(SECRET).length, 3);
    });

    mocha.it('bson unwraps sensitive data', function() {
        const bson = new BSON();
        const str = util.inspect(bson.deserialize(bson.serialize(system)), { depth: null });
        assert.strictEqual(str.search('SENSITIVE'), -1);
        assert.strictEqual(str.split(SECRET).length, 3);
    });

    mocha.it('direct access/compare requires manual unwrap', function() {
        for (const user of system.users) {
            const direct = user.secret;
            assert.strictEqual(direct.constructor, SensitiveString);
            assert.strictEqual(direct.valueOf(), SECRET + '-' + user.name);
            assert.notStrictEqual(direct, SECRET + '-' + user.name);
        }
    });

    mocha.it('Check that double wrapping doesn\'t change the value', function() {
        const first_wrap = new SensitiveString(SECRET);
        const second_wrap = new SensitiveString(first_wrap);
        assert.strictEqual(first_wrap.toString(), second_wrap.toString());
        assert.strictEqual(first_wrap.unwrap(), second_wrap.unwrap());
    });

    mocha.it('Should throw on non string/undefined value', function() {
        assert.throws(function() {
            const a = new SensitiveString({ a: 1 });
            a.unwrap();
        }, Error);
    });

    mocha.it('Should return unwraped undefined', function() {
        const wrap = new SensitiveString(undefined);
        assert.strictEqual(wrap.unwrap(), undefined);
        assert.strictEqual(wrap.toString(), 'SENSITIVE-undefined');
    });
});
