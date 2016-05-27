'use strict';

module.exports = {
    system_in_maintenance: system_in_maintenance,
};

var system_store = require('../system_services/system_store').get_instance();
var moment = require('moment');

function system_in_maintenance(system_id) {
    let system = system_store.data.get_by_id(system_id);

    if (!system) {
        throw new Error('System with id: ' + system_id + ' was not found');
    }

    if (system.maintenance_mode && moment().diff(system.maintenance_mode) < 0) {
        return true;
    }

    return false;
}
