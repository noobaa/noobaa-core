/* Copyright (C) 2016 NooBaa */
'use strict';

const system_store = require('../system_services/system_store').get_instance();

function system_in_maintenance(system_id) {
    const system = system_store.data.get_by_id(system_id);

    if (!system) {
        // we don't want to throw here because callers will handle system deletion
        // on their own paths, and not as exception from here which.
        return false;
    }

    if (system.maintenance_mode &&
        system.maintenance_mode > Date.now()) {
        return true;
    }

    return false;
}

exports.system_in_maintenance = system_in_maintenance;
