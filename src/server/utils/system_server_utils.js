'use strict';

module.exports = {
    system_in_maintenance: system_in_maintenance,
};

var system_store = require('../system_services/system_store').get_instance();
var moment = require('moment');

function system_in_maintenance(system_id) {
    let system = system_store.data.get_by_id(system_id);

    if (!system) {
        // we don't want to throw here because callers will handle system deletion
        // on their own paths, and not as exception from here which.
        return false;
    }

    if (system.maintenance_mode && moment().diff(system.maintenance_mode) < 0) {
        return true;
    }

    return false;
}
