/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

var update_dns;
var dns_primary;
var dns_secondary;
var secret;

if (db.systems.findOne()) {
    if (update_dns) {
        update_dns_servers(dns_primary, dns_secondary);
    }
} else {
    print('No system - nothing to do');
}


function update_dns_servers(primary, secondary) {
    var dns_servers = [];
    if (primary) {
        dns_servers.push(primary);
        if (secondary) dns_servers.push(secondary);
        print('update cluster to following dns configuration', secret, dns_servers);
        printjson(db.clusters.updateOne({ owner_secret: secret }, { $set: { dns_servers: dns_servers } }));
    }
}