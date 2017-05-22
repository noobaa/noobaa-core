/* Copyright (C) 2016 NooBaa */
'use strict';

var argv = require('minimist')(process.argv);
var AzureFunctions = require('../../deploy/azureFunctions');
const P = require('../../util/promise');
var api = require('../../api');
var promise_utils = require('../../util/promise_utils');
var ops = require('../system_tests/basic_server_ops');
var _ = require('lodash');

require('../../util/dotenv').load();

var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

var resourceGroup = argv.resource || 'jacky-rg';
var location = argv.location || 'westus2';
var storage = argv.storage || 'jenkinsnoobaastorage';
var vnet = argv.vnet || 'jacky-rg-vnet';
var prefix = argv.prefix || 'Server';

var serversincluster = argv.servers || 3;
var errors_in_test = false;
var breakonerror = argv.breakonerror || false;

var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resourceGroup, location);

function checkClusterStatus(servers, oldMasterNumber) {
    var oldSecret = 0;
    var isMasterDown = true;
    if (oldMasterNumber > -1) {
        oldSecret = servers[oldMasterNumber].secret;
        isMasterDown = servers[oldMasterNumber].status !== 'CONNECTED';
        console.log('Old master is', oldMasterNumber, servers[oldMasterNumber].status);
    } else {
        console.log('Old master is undesicive - too much servers were down');
    }
    var serversByStatus = _.groupBy(servers, 'status');
    var masterIndex = oldMasterNumber;
    var master_ip;
    var rpc;
    var client;
    if (serversByStatus.CONNECTED && serversByStatus.CONNECTED.length > (servers.length / 2)) {
        return promise_utils.exec('curl http://' + serversByStatus.CONNECTED[0].ip + ':8080 2> /dev/null ' +
                '| grep -o \'[0-9]\\{1,3\\}\\.[0-9]\\{1,3\\}\\.[0-9]\\{1,3\\}\\.[0-9]\\{1,3\\}\'', false, true)
            .catch(() => {
                master_ip = serversByStatus.CONNECTED[0].ip;
            })
            .then(ip => {
                master_ip = master_ip || ip.trim();
                console.log('Master ip', master_ip);
                rpc = api.new_rpc('wss://' + master_ip + ':8443');
                client = rpc.new_client({});
                rpc.disable_validation();
                return P.fcall(() => {
                    var auth_params = {
                        email: 'demo@noobaa.com',
                        password: 'DeMo1',
                        system: 'demo'
                    };
                    return client.create_auth_token(auth_params);
                });
            })
            .then(() => {
                console.log('Waiting on read system');
                return P.resolve(client.system.read_system({}));
            })
            .then(res => {
                var masterSecret = res.cluster.master_secret;
                if (isMasterDown) {
                    if (oldSecret === masterSecret) {
                        console.log('Error - Cluster secret didn\'t change and master is down');
                        errors_in_test = true;
                    } else {
                        console.log('The cluster secret was changed - as should', oldSecret, 'to', masterSecret);
                    }
                } else if (oldSecret === masterSecret) {
                    console.log('The cluster secret is the same as the old one - as Should');
                } else {
                    console.log('Error - Cluster secret was changed - and Shouldn\'t', oldSecret, 'to', masterSecret);
                    errors_in_test = true;
                }
                var serversBySecret = _.groupBy(res.cluster.shards[0].servers, 'secret');
                var serversUp = serversByStatus.CONNECTED.length;
                if (serversUp > (servers.length / 2) + 1) {
                    if (res.cluster.shards[0].high_availabilty) {
                        console.log('Cluster is highly available as should!!');
                    } else {
                        console.log('Error! Cluster is not highly available although most servers are up!!');
                        errors_in_test = true;
                    }
                } else if (res.cluster.shards[0].high_availabilty) {
                    console.log('Error! Cluster is highly available when most servers are down!!');
                    errors_in_test = true;
                } else {
                    console.log('Cluster is not highly available as should!!');
                }
                servers.forEach(server => {
                    if (serversBySecret[server.secret].length > 1) {
                        console.log('Read system returned more than one server with the same secret!!', serversBySecret[server.secret]);
                        errors_in_test = true;
                        throw new Error('Read System duplicate Secrets!!');
                    }
                    var role = '*SLAVE*';
                    if (server.secret === masterSecret) {
                        masterIndex = servers.indexOf(server);
                        role = '*MASTER*';
                    }
                    if (server.status === serversBySecret[server.secret][0].status) {
                        console.log('Success -', role, server.name, '(' + server.ip + ')',
                            'secret', server.secret, 'is of Status', serversBySecret[server.secret][0].status, '- As should');

                    } else {
                        console.log('Error -', role, server.name, '(' + server.ip + ')', 'secret', server.secret, 'is of Status', serversBySecret[server.secret][0].status, '- should be', server.status);
                        console.log(res.cluster.shards[0]);
                        errors_in_test = true;
                    }
                });
                if (errors_in_test && breakonerror) {
                    throw new Error('Error in test - breaking the test');
                }
                return masterIndex;
            })
            .finally(() => rpc.disconnect_all());
    }
    console.log('Most of the servers are down - Can\'t check cluster status');
    return -1;
}
var servers = [];
var master;
var slaves;

var timeout = argv.timeout || 10; // 10 minutes default
var masterIndex = serversincluster - 1;
console.log('Breaking on error?', breakonerror);
return azf.authenticate()
    .then(() => {
        for (var i = 0; i < serversincluster; ++i) {
            servers.push({
                name: prefix + i,
                secret: '',
                ip: '',
                status: 'CONNECTED'
            });
        }
    })
    .then(() => P.map(servers, server => azf.deleteVirtualMachine(server.name).catch(err => console.log('Can\'t delete old server', err.message))))
    .then(() => P.map(servers, server => azf.createServer(server.name, vnet, storage)
        .then(new_secret => {
            server.secret = new_secret;
            return azf.getIpAddress(server.name + '_pip');
        })
        .then(ip => {
            server.ip = ip;
            return ops.upload_and_upgrade(ip, argv.upgrade_pack);
        })
        .catch(err => console.log('Can\'t create server', err))))
    .then(() => {
        slaves = Array.from(servers);
        master = slaves.pop();
        return P.each(slaves, slave => azf.addServerToCluster(master.ip, slave.ip, slave.secret, slave.name));
    })
    .then(() => {
        console.log('Wating 90 seconds for cluster to stable...');
        return P.delay(90000);
    })
    .then(() => checkClusterStatus(servers, masterIndex))
    .then(() => {
        var start = Date.now();
        return promise_utils.pwhile(() => (timeout === 0 || (Date.now() - start) < (timeout * 1000 * 60)), () => {
            var rand = Math.floor(Math.random() * serversincluster);
            console.log('<====== Starting a new cycle... ======>');
            var prom;
            if (servers[rand].status === 'CONNECTED') {
                servers[rand].status = 'DISCONNECTED';
                prom = azf.stopVirtualMachine(servers[rand].name); // turn the server off
            } else {
                servers[rand].status = 'CONNECTED';
                prom = azf.startVirtualMachine(servers[rand].name); // turn the server back on
            }
            return prom
                .then(() => {
                    console.log('Waiting 180 seconds for cluster to stable...');
                    return P.delay(180000);
                })
                .then(() => checkClusterStatus(servers, masterIndex))
                .then(newMaster => {
                    masterIndex = newMaster;
                });
        });
    })
    .catch(err => {
        console.log('something went wrong :(' + err);
        errors_in_test = true;
    })
    .then(() => {
        if (errors_in_test) {
            console.error(':( :( Errors during cluster test ): ):');
            process.exit(1);
        }
        console.log(':) :) :) cluster test were successful! (: (: (:');
        process.exit(0);
    });
