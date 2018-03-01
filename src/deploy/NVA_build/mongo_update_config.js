/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

var update_dns;
var update_time;
var dns_primary;
var dns_secondary;
var ntp_server;
var secret;
var timezone;

if (db.systems.findOne()) {
    if (update_dns) {
        update_dns_servers(dns_primary, dns_secondary);
    } else if (update_time) {
        update_ntp_config(ntp_server, timezone);
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

function update_ntp_config(server, zone) {
    var ntp_config = {};
    if (server) {
        ntp_config.server = server;
    }
    if (zone) {
        ntp_config.timezone = zone;
    }
    print('update cluster to following time configuration', secret);
    printjson(ntp_config);
    printjson(db.clusters.updateOne({ owner_secret: secret }, { $set: { ntp: ntp_config } }));
}
