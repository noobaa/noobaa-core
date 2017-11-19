/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
/* global setVerboseShell, sleep */
'use strict';


var param_secret;

mongo_upgrade_wait_for_master();

function mongo_upgrade_wait_for_master() {
    print('\nMONGO UPGRADE WAIT FOR MASTER - START ...');
    setVerboseShell(true);
    sync_cluster_upgrade();
    print('\nMONGO UPGRADE 19 - DONE.');
}

function sync_cluster_upgrade() {
    // find if this server should perform mongo upgrade
    var is_mongo_upgrade = db.clusters.find({
        owner_secret: param_secret
    }).toArray()[0].upgrade ? db.clusters.find({
        owner_secret: param_secret
    }).toArray()[0].upgrade.mongo_upgrade : true;

    // if this server shouldn't run mongo_upgrade, set status to DB_READY,
    // to indicate that this server is upgraded and with mongo running.
    // then wait for master to complete upgrade
    if (!is_mongo_upgrade) {
        db.clusters.update({
            owner_secret: param_secret
        }, {
            $set: {
                "upgrade.stage": "DB_READY"
            }
        });
        var max_iterations = 400; // ~1 hour (multiplied with the 10 seconds sleep)
        var i = 0;
        while (i < max_iterations) {
            print('waiting for master to complete mongo upgrade...');
            i += 1;
            try {
                var master_status = db.clusters.find({
                    "upgrade.mongo_upgrade": true
                }).toArray()[0] ? db.clusters.find({
                    "upgrade.mongo_upgrade": true
                }).toArray()[0].upgrade.status : 'COMPLETED';
                if (master_status === 'COMPLETED') {
                    print('\nmaster completed mongo_upgrade - finishing upgrade of this server');
                    mark_completed();
                    quit();
                }
            } catch (err) {
                print(err);
            }
            sleep(10000);
        }
        print('\nERROR: master did not finish mongo_upgrade in time!!! finishing upgrade of this server');
        quit();
    }
}

function mark_completed() {
    // mark upgrade status of this server as completed
    db.clusters.update({
        owner_secret: param_secret
    }, {
        $set: {
            upgrade: {
                status: 'COMPLETED'
            }
        }
    });
}
