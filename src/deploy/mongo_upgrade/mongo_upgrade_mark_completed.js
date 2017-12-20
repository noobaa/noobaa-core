/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
/* global setVerboseShell */
'use strict';

// the following params are set from outside the script
// using mongo --eval 'var param_ip="..."' and we only declare them here for completeness
var param_secret;
var version;
// var param_bcrypt_secret;
// var param_client_subject;

update_version_change();
mongo_upgrade_mark_completed();

function update_version_change() {
    print('\nMONGO UPDATE VERSION CHANGE - START ...');
    setVerboseShell(true);
    db.system_history.insert({
        time_stamp: new Date(),
        history_type: 'VERSION',
        version_snapshot: version || 'Unknown'
    });
    print('\nMONGO UPDATE VERSION CHANGE - DONE.');
}

function mongo_upgrade_mark_completed() {
    print('\nMONGO UPGRADE MARK COMPLETED - START ...');
    setVerboseShell(true);

    db.systems.update({}, {
        $set: {
            "last_upgrade.timestamp": Date.now()
        }
    });

    // mark upgrade status of this server as completed
    db.clusters.update({
        owner_secret: param_secret
    }, {
        $set: {
            upgrade: {
                status: 'COMPLETED',
            }
        }
    });

    print('\nMONGO UPGRADE MARK COMPLETED - DONE.');
}
