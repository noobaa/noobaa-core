/* Copyright (C) 2026 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const SensitiveString = require('../../../util/sensitive_string');
const system_store = require('../../../server/system_services/system_store').get_instance();
const bucket_server = require('../../../server/system_services/bucket_server');

mocha.describe('get_bucket_nsfs_account_config', function() {

    mocha.it('prefers owner_account nsfs_account_config', function() {
        const cfg = { uid: 10, gid: 10 };
        const got = bucket_server.get_bucket_nsfs_account_config({
            name: new SensitiveString('owned-bucket'),
            owner_account: { nsfs_account_config: cfg },
        });
        assert.strictEqual(got, cfg);
    });

    mocha.it('falls back to OBC claim account nsfs_account_config', function() {
        const cfg = { uid: 20, gid: 20 };
        const name = new SensitiveString('obc-bucket');
        system_store.data = system_store.data || {};
        const prev_accounts = system_store.data.accounts;
        system_store.data.accounts = [{
            bucket_claim_owner: { name },
            nsfs_account_config: cfg,
        }];
        try {
            const got = bucket_server.get_bucket_nsfs_account_config({
                name,
                owner_account: { email: new SensitiveString('operator@noobaa.io') },
            });
            assert.deepStrictEqual(got, cfg);
        } finally {
            system_store.data.accounts = prev_accounts;
        }
    });
});
