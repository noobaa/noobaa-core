/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
/* global setVerboseShell */
'use strict';

mongo_upgrade_19();

function mongo_upgrade_19() {
    print('\nMONGO UPGRADE 19 - START ...');
    setVerboseShell(true);
    update_cluster_address();
    update_allowed_ips();
    print('\nMONGO UPGRADE 19 - DONE.');
}

function update_cluster_address() {
    // will fix the owner and server address for none cluster server to 127.0.0.1
    var res = db.clusters.findOne({});
    if (!res.is_clusterized) {
        res.owner_address = '127.0.0.1';
        res.shards[0].servers[0].address = '127.0.0.1';
        db.clusters.updateOne({}, { $set: res });
    }
}

function update_allowed_ips() {
    // change the allowed_ips to a range format of {start, end}
    var accounts = db.accounts.find({}).toArray();
    print('\nupdate_allowed_ips: accounts before update: ');
    printjson(accounts);
    accounts.forEach(account => {
        if (account.allowed_ips && account.allowed_ips.length) {
            const allowed_ips = account.allowed_ips.map(ip => {
                if (typeof ip === 'string') {
                    return {
                        start: ip,
                        end: ip
                    };
                }
                return ip;
            });
            print('update_allowed_ips: updating account ' + account.name + ' to have allowed_ips = ');
            printjson(allowed_ips);
            db.accounts.updateOne({ _id: account._id }, { $set: { allowed_ips: allowed_ips } });
        }
    });
    accounts = db.accounts.find({}).toArray();
    print('\nupdate_allowed_ips: accounts after update: ');
    printjson(accounts);
}
