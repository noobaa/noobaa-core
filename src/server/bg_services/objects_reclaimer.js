/* Copyright (C) 2016 NooBaa */
'use strict';

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const map_deleter = require('../object_services/map_deleter');
const {clean_md_store_objects} = require('./db_cleaner');
const P = require('../../util/promise');

class ObjectsReclaimer {

    constructor({ name, client }) {
        this.name = name;
        this.client = client;
    }

    async run_batch() {
        if (!this._can_run()) return;

        const unreclaimed_objects = await MDStore.instance().find_unreclaimed_objects(config.OBJECT_RECLAIMER_BATCH_SIZE);
        if (!unreclaimed_objects || !unreclaimed_objects.length) {
            dbg.log0('no objects in "unreclaimed" state. nothing to do');
            return config.OBJECT_RECLAIMER_EMPTY_DELAY;
        }

        let has_errors = false;
        dbg.log0('object_reclaimer: starting batch work on objects: ', unreclaimed_objects.map(o => o.key).join(', '));
        const reclaimed_objects_ids = [];
        await P.all(unreclaimed_objects.map(async obj => {
            try {
                await map_deleter.delete_object_mappings(obj, true);
                reclaimed_objects_ids.push(obj._id);
            } catch (err) {
                dbg.error(`got error when trying to delete object ${obj.key} mappings :`, err);
                has_errors = true;
            }
        }));
        await MDStore.instance().update_objects_by_ids(reclaimed_objects_ids, { reclaimed: new Date() });

        if (has_errors) {
            return config.OBJECT_RECLAIMER_ERROR_DELAY;
        }

        await clean_md_store_objects(Date.now());

        return config.OBJECT_RECLAIMER_BATCH_DELAY;

    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('ObjectsReclaimer: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

}


exports.ObjectsReclaimer = ObjectsReclaimer;
