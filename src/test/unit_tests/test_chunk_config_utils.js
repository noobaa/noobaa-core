/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');

const chunk_config_utils = require('../../server/utils/chunk_config_utils');

mocha.describe('chunk_config_utils', function() {

    const chunk_configs = [{
        _id: 'default',
        chunk_coder_config: chunk_config_utils.new_chunk_code_config_defaults()
    }, {
        _id: 'ec_4_2',
        chunk_coder_config: chunk_config_utils.new_chunk_code_config_defaults({
            data_frags: 4,
            parity_frags: 2,
        })
    }, {
        _id: 'ec_8_2',
        chunk_coder_config: chunk_config_utils.new_chunk_code_config_defaults({
            data_frags: 8,
            parity_frags: 2,
        })
    }, {
        _id: 'ec_1_99',
        chunk_coder_config: chunk_config_utils.new_chunk_code_config_defaults({
            parity_frags: 99,
        })
    }];

    const account = {};
    const system = {
        _id: '~!@#$%^&*()',
        chunk_configs_by_id: _.keyBy(chunk_configs, '_id'),
    };
    chunk_configs.forEach(cc => {
        cc.system = system;
    });

    mocha.it('uses default', function() {
        [undefined, null, {}].forEach(ccc => {
            const cc = chunk_config_utils.resolve_chunk_config(ccc, account, system);
            assert.strictEqual(cc, system.chunk_configs_by_id.default);
        });
    });

    mocha.it('uses system default', function() {
        const def = system.chunk_configs_by_id.ec_1_99;
        system.default_chunk_config = def;
        const cc = chunk_config_utils.resolve_chunk_config(undefined, account, system);
        delete system.default_chunk_config;
        assert.strictEqual(cc, def);
    });

    mocha.it('uses account default', function() {
        const def = system.chunk_configs_by_id.ec_1_99;
        account.default_chunk_config = def;
        const cc = chunk_config_utils.resolve_chunk_config(undefined, account, system);
        delete account.default_chunk_config;
        assert.strictEqual(cc, def);
    });

    mocha.it('creates new with defaults when no match', function() {
        const ccc = { parity_frags: 666 };
        const cc = chunk_config_utils.resolve_chunk_config(ccc, account, system);
        assert.strictEqual(cc._id, undefined);
        assert.strictEqual(cc.system, system._id);
        assert.strictEqual(cc.chunk_coder_config.parity_frags, 666);
        assert.strictEqual(cc.chunk_coder_config.data_frags, 1);
        assert.strictEqual(cc.chunk_coder_config.replicas, 1);
    });

    mocha.it('uses EC 4+2 when given parity_frags', function() {
        const ccc = { data_frags: 4, parity_frags: 2 };
        const cc = chunk_config_utils.resolve_chunk_config(ccc, account, system);
        assert.strictEqual(cc, system.chunk_configs_by_id.ec_4_2);
    });

    mocha.it('uses EC 8+2 when given parity_frags', function() {
        const ccc = { data_frags: 8, parity_frags: 2 };
        const cc = chunk_config_utils.resolve_chunk_config(ccc, account, system);
        assert.strictEqual(cc, system.chunk_configs_by_id.ec_8_2);
    });

});
