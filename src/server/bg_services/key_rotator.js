/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const config = require('../../../config');

class KeyRotator {

    constructor({ name }) {
        this.name = name;
    }

    async run_batch() {
        if (!this._can_run()) return config.KEY_ROTATOR_ERROR_DELAY;
        const mkm = system_store.master_key_manager;
        await mkm.load_root_keys_from_mount();

        dbg.log0('KeyRotator: new rotate cycle has started');
        const system = system_store.data.systems[0];
        // if the system root_key_id exist and enabled - nothing to do 
        if (system.master_key_id.root_key_id && !mkm.is_m_key_disabled(system.master_key_id.root_key_id)) {
            return config.KEY_ROTATOR_RUN_INTERVAL;
        }
        try {
            const active_root_key_id = mkm.get_root_key_id();
            const reencrypted = mkm._reencrypt_master_key_by_current_root(
                system.master_key_id._id,
                active_root_key_id
            );
            const unset = system.master_key_id.master_key_id && { master_key_id: 1 };
            await system_store.make_changes({
                update: {
                    master_keys: [_.omitBy({
                        _id: system.master_key_id._id,
                        $set: {
                            root_key_id: active_root_key_id,
                            cipher_key: reencrypted
                        },
                        $unset: unset,
                    }, _.isUndefined)]
                }
            });
        } catch (err) {
            dbg.error(`KeyRotator: got error when trying to rotate system ${system._id} root key:`, err);
            return config.KEY_ROTATOR_ERROR_DELAY;
        }
        dbg.log0(`KeyRotator: root key for system ${system._id} was rotated succesfully`);
        return config.KEY_ROTATOR_RUN_INTERVAL;
    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('KeyRotator: system_store did not finish initial load');
            return false;
        }
        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }
}

// EXPORTS
exports.KeyRotator = KeyRotator;
