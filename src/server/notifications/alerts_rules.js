/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const AlertsLogStore = require('./alerts_log_store').AlertsLogStore;

function only_once(sev, sysid, alert) {
    return P.resolve(AlertsLogStore.instance().find_alert(sev, sysid, alert))
        .then(res => {
            return res.length === 0;
        });
}


exports.only_once = only_once;
