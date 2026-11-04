/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
coretest.setup();

const mocha = require('mocha');
const assert = require('assert');

const config = require('../../../../config');
const SensitiveString = require('../../../util/sensitive_string');
const system_store = require('../../../server/system_services/system_store').get_instance();
const system_server = require('../../../server/system_services/system_server');

// These tests exercise _recover_stuck_initializing_system(), the core-side
// recovery for a create_system that was interrupted (e.g. the core pod was
// restarted mid-create_system) and left the system stuck in INITIALIZING.
mocha.describe('system recovery of stuck INITIALIZING system', function() {
    const self = this; // eslint-disable-line no-invalid-this
    self.timeout(60000);

    function current_system() {
        return system_store.data.systems[0];
    }

    async function set_system_state(mode) {
        const system = current_system();
        await system_store.make_changes({
            update: {
                systems: [{ _id: system._id, $set: { state: { mode, last_update: Date.now() } } }]
            }
        });
        return system._id;
    }

    // Leave the shared coretest system healthy for any suites that run after us.
    mocha.after(async function() {
        await set_system_state('READY');
        await system_store.load();
    });

    mocha.it('completes a committed system stuck in INITIALIZING -> READY', async function() {
        const system_id = await set_system_state('INITIALIZING');

        await system_server._recover_stuck_initializing_system(system_id);

        await system_store.load();
        const system = system_store.data.get_by_id(system_id);
        assert.strictEqual(system.state.mode, 'READY',
            'a fully-committed system should be completed to READY');
    });

    mocha.it('marks COULD_NOT_INITIALIZE when the operator account is missing', async function() {
        // Precondition: the coretest system has an operator account.
        const operator = system_store.get_account_by_email(new SensitiveString(config.OPERATOR_ACCOUNT_EMAIL));
        assert(operator, 'operator account should exist in the coretest system');

        const system_id = await set_system_state('INITIALIZING');

        // Emulate a create_system that died before the operator account was
        // committed, without destructively removing it from the shared store:
        // make the lookup report it missing for the duration of the call.
        const orig_get_account_by_email = system_store.get_account_by_email;
        system_store.get_account_by_email = email =>
            (email.unwrap() === config.OPERATOR_ACCOUNT_EMAIL ?
                undefined :
                orig_get_account_by_email.call(system_store, email));
        try {
            await system_server._recover_stuck_initializing_system(system_id);
        } finally {
            system_store.get_account_by_email = orig_get_account_by_email;
        }

        await system_store.load();
        const system = system_store.data.get_by_id(system_id);
        assert.strictEqual(system.state.mode, 'COULD_NOT_INITIALIZE',
            'a system missing the operator account is unsalvageable and must not be faked READY');
    });
});
