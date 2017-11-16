/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const _ = require('lodash');
const net = require('net');
const dgram = require('dgram');
const http = require('http');
const promise_utils = require('../../util/promise_utils');
const server_ops = require('../qa/functions/server_functions');
const argv = require('minimist')(process.argv);
const serverName = argv.server_ip;
const api = require('../../api');

//noobaa rpc
let secret;
let rpc;
let client;
let old_time = 0;
let configured_ntp = argv.ntp_server || 'pool.ntp.org';
let primary_dns = argv.primary_dns || '8.8.8.8';
let secondery_dns = argv.secondery_dns || '8.8.4.4';
let configured_dns = [primary_dns, secondery_dns];
let configured_timezone = 'Asia/Tel_Aviv';
let second_timezone = 'US/Arizona';
let received_phonehome_proxy_connection = false;
let received_udp_rsyslog_connection = false;
let received_tcp_rsyslog_connection = false;

let failures_in_test = false;

let my_external_ip = argv.my_ip;
let external_server_ip = argv.external_server_ip;
let udp_rsyslog_port = argv.udp_syslog_port || 5001;
let tcp_rsyslog_port = argv.tcp_syslog_port || 5002;
let ph_proxy_port = argv.ph_proxy_port || 5003;

let errors = [];


function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}
// Create an HTTP tunneling proxy
const phone_home_proxy_server = http.createServer(function(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('okay');
});

phone_home_proxy_server.on('connect', function(req, cltSocket, head) {
    console.warn('phone home server got incoming tunnel connection');
    received_phonehome_proxy_connection = true;
});


// create a tcp rsyslog server
const rsyslog_tcp_server = net.createServer(c => {
    console.log('client connected');
    c.on('end', () => {
        console.log('client disconnected');
    });

    c.on('data', function(data) {
        console.log('tcp rsyslog server got: ' + data);
        received_tcp_rsyslog_connection = true;
    });
});

// create a udp rsyslog server
const rsyslog_udp_server = dgram.createSocket('udp4');

rsyslog_udp_server.on('error', err => {
    console.log(`udp rsyslog server error:\n${err.stack}`);
    rsyslog_udp_server.close();
});

rsyslog_udp_server.on('message', (msg, rinfo) => {
    console.log(`udp rsyslog server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
    received_udp_rsyslog_connection = true;
});

P.fcall(function() {
        rpc = api.new_rpc('wss://' + serverName + ':8443');
        client = rpc.new_client({});
        let auth_params = {
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        };
        return client.create_auth_token(auth_params);
    })
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        secret = result.cluster.shards[0].servers[0].secret;
        console.log('Secret is ' + secret);
    })
    .then(() => rpc.disconnect_all())
    .then(() => server_ops.clean_ova(external_server_ip, secret))
    .then(() => server_ops.wait_server_recoonect(serverName))
    .then(() => server_ops.validate_activation_code(serverName)
        .catch(err => {
            saveErrorAndResume(err.message);
            failures_in_test = true;
        }))
    .then(() => server_ops.create_system_and_check(serverName)
        .catch(err => {
            saveErrorAndResume(err.message);
            failures_in_test = true;
        }))
    .then(() => {
        rpc = api.new_rpc('wss://' + serverName + ':8443');
        client = rpc.new_client({});
        let auth_params = {
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        };
        return client.create_auth_token(auth_params);
    }) //#3216 dns configuration
    .then(() => {
        console.log('Setting DNS', configured_dns);
        return P.resolve(client.cluster_server.update_dns_servers({
            dns_servers: configured_dns
        }));
    })
    .delay(30000)
    .then(() => {
        console.log('Waiting on Read system to verify DNS settings');
        let retries = 6;
        let final_result;
        return promise_utils.pwhile(function() {
                return retries > 0;
            },
            function() {
                return P.resolve(client.cluster_server.read_server_config({}))
                    .then(res => {
                        console.log('Read server ready !!!!', res);
                        retries = 0;
                        final_result = res;
                    })
                    .catch(() => {
                        console.log('waiting for read server config, will retry extra', retries, 'times');
                        return P.delay(15000);
                    });
            }).then(() => final_result);
    })
    .then(result => {
        let dns = result.dns_servers;
        if (_.isEqual(dns, configured_dns)) {
            console.log('The defined dns is', dns, '- as should');
        } else {
            saveErrorAndResume('The defined dns is', dns, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => {
        console.log('Waiting on Read system to verify DNS status');
        let time_waiting = 0;
        let final_result;
        return promise_utils.pwhile(function() {
                return (time_waiting < 65 && !final_result); // HB + something
            },
            function() {
                return P.resolve(client.system.read_system({}))
                    .then(res => {
                        if (res.cluster.shards[0].servers[0].services_status.dns_servers) final_result = res;
                    })
                    .catch(() => {
                        console.log('waiting for read systme, will retry extra', 65 - time_waiting, 'seconds');
                        time_waiting += 15;
                        return P.delay(15000);
                    });
            }).then(() => final_result);
    })
    .then(result => {
        let dns_status = result.cluster.shards[0].servers[0].services_status.dns_servers;
        if (dns_status === 'OPERATIONAL') {
            console.log('The service monitor see the dns status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the dns status as' + dns_status + '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        secret = result.cluster.master_secret;
    })
    // time configuration - manual
    .then(() => P.resolve(client.cluster_server.read_server_time({
        target_secret: secret
    })))
    .then(current_time => {
        console.log('Current time is:', new Date(current_time * 1000));
        old_time = current_time;
        console.log('Moving time 30 minutes forward');
        return P.resolve(client.cluster_server.update_time_config({
            target_secret: secret,
            timezone: configured_timezone,
            epoch: current_time + (30 * 60) // moving 30 minutes forward
        }));
    })
    .then(() => P.resolve(client.cluster_server.read_server_time({
        target_secret: secret
    })))
    .then(new_time => {
        if (new_time > old_time + (30 * 60)) {
            console.log('New time moved more then 30 minutes forward', new Date(new_time * 1000), '- as should');
        } else {
            saveErrorAndResume('New time moved less then 30 minutes forward' + new Date(new_time * 1000) + '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => { // timezone configuration
        console.log('Setting different timezone');
        return P.resolve(client.cluster_server.update_time_config({
            target_secret: secret,
            timezone: second_timezone,
            ntp_server: configured_ntp
        }));
    })
    .then(() => P.resolve(client.cluster_server.read_server_config({})))
    .then(result => {
        let timezone = result.timezone;
        if (timezone === second_timezone) {
            console.log('The defined timezone is', timezone, '- as should');
        } else {
            saveErrorAndResume('The defined timezone is', timezone, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => { // time configuration - ntp
        console.log('Checking connection before setup ntp', configured_ntp);
        return P.resolve(client.system.attempt_server_resolve({
            server_name: configured_ntp
        }));
    })
    .delay(10000)
    .then(() => { // time configuration - ntp
        console.log('Setting NTP', configured_ntp);
        return P.resolve(client.cluster_server.update_time_config({
            target_secret: secret,
            timezone: configured_timezone,
            ntp_server: configured_ntp
        }));
    })
    .then(() => {
        console.log('Waiting on Read system to verify NTP status');
        let time_waiting = 0;
        let final_result;
        return promise_utils.pwhile(function() {
                return (time_waiting < 65 && !final_result); // HB + something
            },
            function() {
                return P.resolve(client.system.read_system({}))
                    .then(res => {
                        if (res.cluster.shards[0].servers[0].services_status.ntp_server) final_result = res;
                    })
                    .catch(() => {
                        console.log('waiting for read systme, will retry extra', 65 - time_waiting, 'seconds');
                        time_waiting += 15;
                        return P.delay(15000);
                    });
            }).then(() => final_result);
    })
    .then(result => {
        let ntp_status = result.cluster.shards[0].servers[0].services_status.ntp_server;
        if (ntp_status === 'OPERATIONAL') {
            console.log('The service monitor see the ntp status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the ntp status as' + ntp_status + '- failure!!!');
            failures_in_test = true;
        }
    }) // 3559
    .then(() => P.resolve(client.cluster_server.read_server_config({})))
    .then(result => {
        console.log('after setting ntp cluster config is:' + JSON.stringify(result));
        let ntp = result.ntp_server;
        if (ntp === configured_ntp) {
            console.log('The defined ntp is', ntp, '- as should');
        } else {
            saveErrorAndResume('The defined ntp is' + ntp + '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.cluster_server.read_server_time({
        target_secret: secret
    })))
    .then(new_time => {
        if (new_time < old_time + (2 * 60)) {
            console.log('New time has moved back to correct time', new Date(new_time * 1000), '- as should');
        } else {
            saveErrorAndResume('New time is more than 2 minutes away from the correct time', new Date(new_time * 1000), '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => { // phone home configuration -
        console.log('Setting Phone home Proxy');
        return P.resolve(client.system.update_phone_home_config({
            proxy_address: 'http://' + my_external_ip + ':' + ph_proxy_port
        }));
    })
    .then(() => phone_home_proxy_server.listen(ph_proxy_port))
    .then(() => promise_utils.pwhile(
            function() {
                return !received_phonehome_proxy_connection;
            },
            function() {
                console.warn('Didn\'t get phone home message yet');
                return P.delay(5000);
            }).timeout(1 * 90000)
        .then(() => {
            console.log('Just received phone home message - as should');
        })
        .catch(() => {
            saveErrorAndResume('Didn\'t receive phone home message for 1 minute - failure!!!');
            failures_in_test = true;
        })
    )
    .delay(10000)
    .then(() => {
        console.log('Doing Read system to verify Proxy settings');
        return P.resolve(client.system.read_system({}));
    })
    .then(result => {
        let proxy = result.phone_home_config.proxy_address;
        if (proxy === 'http://' + my_external_ip + ':' + ph_proxy_port) {
            console.log('The defined phone home proxy is', proxy, '- as should');
        } else {
            saveErrorAndResume('The defined phone home proxy is', proxy, '- failure');
            failures_in_test = true;
        }
    })
    .then(() => {
        console.log('Waiting on Read system to verify Proxy status');
        let time_waiting = 0;
        let final_result;
        return promise_utils.pwhile(function() {
                return (time_waiting < 65 && !final_result); // HB + something
            },
            function() {
                return P.resolve(client.system.read_system({}))
                    .then(res => {
                        if (res.cluster.shards[0].servers[0].services_status.phonehome_proxy) final_result = res;
                    })
                    .catch(() => {
                        console.log('waiting for read systme, will retry extra', 65 - time_waiting, 'seconds');
                        time_waiting += 15;
                        return P.delay(15000);
                    });
            }).then(() => final_result);
    })
    .then(res => {
        let ph_status = res.cluster.shards[0].servers[0].services_status.phonehome_proxy;
        if (ph_status === 'OPERATIONAL') {
            console.log('The service monitor see the phone home proxy status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the phone home proxy status as' + ph_status + '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => { // phone home configuration -
        console.log('Setting disable Phone home Proxy');
        return P.resolve(client.system.update_phone_home_config({
            proxy_address: null
        }));
    })
    .then(() => phone_home_proxy_server.listen(ph_proxy_port))
    .then(() => promise_utils.pwhile(
            function() {
                return !received_phonehome_proxy_connection;
            },
            function() {
                console.warn('Didn\'t get phone home message yet');
                return P.delay(5000);
            }).timeout(1 * 60000)
        .then(() => {
            console.log('Just received phone home message - as should');
        })
        .catch(() => {
            saveErrorAndResume('Didn\'t receive phone home message for 1 minute - failure!!!');
            failures_in_test = true;
        }))
    .then(() => {
        console.log('Doing Read system to verify Proxy settings');
        return P.resolve(client.system.read_system({}));
    })
    .then(result => {
        let proxy = result.phone_home_config;
        console.log('Phone home config is: ' + JSON.stringify(proxy));
        if (JSON.stringify(proxy).includes('proxy_address') === false) {
            console.log('The defined phone home proxy is no use proxy - as should');
        } else {
            saveErrorAndResume('The defined phone home with disable proxy is', proxy, '- failure');
            failures_in_test = true;
        }
    })
    .delay(50000)
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        console.log(JSON.stringify(result.cluster.shards[0].servers[0].services_status));
        let ph_status = result.cluster.shards[0].servers[0].services_status.phonehome_server.status;
        if (ph_status === 'OPERATIONAL') {
            console.log('The service monitor see the phone home proxy status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the phone home proxy after disable status as' + ph_status + '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => phone_home_proxy_server.close())
    .then(() => rsyslog_tcp_server.listen(tcp_rsyslog_port))
    .then(() => { //#2596remote syslog configuration - TCP
        console.log('Setting TCP Remote Syslog');
        return P.resolve(client.system.configure_remote_syslog({
            enabled: true,
            address: my_external_ip,
            protocol: 'TCP',
            port: tcp_rsyslog_port
        }));
    })
    .then(() => P.resolve()
        .then(() => promise_utils.pwhile(
            function() {
                return !received_tcp_rsyslog_connection;
            },
            function() {
                console.warn('Didn\'t get tcp rsyslog message yet');
                return P.delay(5000);
            }))
        .timeout(60000)
        .then(() => {
            console.log('Just received tcp rsyslog message - as should');
        })
        .catch(() => {
            saveErrorAndResume('Didn\'t receive tcp rsyslog message for 1 minute - failure!!!');
            failures_in_test = true;
        }))
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let address = result.remote_syslog_config.address;
        let protocol = result.remote_syslog_config.protocol;
        let port = result.remote_syslog_config.port;
        if (address === my_external_ip && protocol === 'TCP' && port === tcp_rsyslog_port) {
            console.log('The defined syslog is', address + ':' + port, '- as should');
        } else {
            saveErrorAndResume('The defined syslog is', address + ':' + port, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => {
        console.log('Waiting on Read system to verify Rsyslog status');
        let time_waiting = 0;
        let final_result;
        return promise_utils.pwhile(function() {
                return (time_waiting < 65 && !final_result); // HB + something
            },
            function() {
                return P.resolve(client.system.read_system({}))
                    .then(res => {
                        if (res.cluster.shards[0].servers[0].services_status.remote_syslog) final_result = res;
                    })
                    .catch(() => {
                        console.log('waiting for read systme, will retry extra', 65 - time_waiting, 'seconds');
                        time_waiting += 15;
                        return P.delay(15000);
                    });
            }).then(() => final_result);
    })
    .then(result => {
        let syslog_status = result.cluster.shards[0].servers[0].services_status.remote_syslog.status;
        if (syslog_status === 'OPERATIONAL') {
            console.log('The service monitor see the syslog status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the syslog status as' + syslog_status + '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => rsyslog_tcp_server.close())
    .then(() => rsyslog_udp_server.bind(udp_rsyslog_port))
    .then(() => { // remote syslog configuration - UDP
        console.log('Setting UDP Remote Syslog');
        return P.resolve(client.system.configure_remote_syslog({
            enabled: true,
            address: my_external_ip,
            protocol: 'UDP',
            port: udp_rsyslog_port
        }));
    })
    .then(() => P.resolve()
        .then(() => promise_utils.pwhile(
            function() {
                return !received_udp_rsyslog_connection;
            },
            function() {
                console.warn('Didn\'t get udp rsyslog message yet');
                return P.delay(5000);
            }))
        .timeout(60000)
        .then(() => {
            console.log('Just received udp rsyslog message - as should');
        })
        .catch(() => {
            saveErrorAndResume('Didn\'t receive udp rsyslog message for 1 minute - failure!!!');
            failures_in_test = true;
        }))
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let address = result.remote_syslog_config.address;
        let protocol = result.remote_syslog_config.protocol;
        let port = result.remote_syslog_config.port;
        if (address === my_external_ip && protocol === 'UDP' && port === udp_rsyslog_port) {
            console.log('The defined syslog is', address + ':' + port, '- as should');
        } else {
            saveErrorAndResume('The defined syslog is', address + ':' + port, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => {
        console.log('Waiting on Read system to verify Rsyslog status');
        let time_waiting = 0;
        let final_result;
        return promise_utils.pwhile(function() {
                return (time_waiting < 65 && !final_result); // HB + something
            },
            function() {
                return P.resolve(client.system.read_system({}))
                    .then(res => {
                        if (res.cluster.shards[0].servers[0].services_status.remote_syslog) final_result = res;
                    })
                    .catch(() => {
                        console.log('waiting for read systme, will retry extra', 65 - time_waiting, 'seconds');
                        time_waiting += 15;
                        return P.delay(15000);
                    });
            }).then(() => final_result);
    })
    .then(result => {
        let syslog_status = result.cluster.shards[0].servers[0].services_status.remote_syslog.status;
        if (syslog_status === 'OPERATIONAL') {
            console.log('The service monitor see the syslog status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the syslog status as' + syslog_status + '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => rsyslog_udp_server.close())
    .then(() => P.resolve(client.system.set_maintenance_mode({
        duration: 1
    })))
    .delay(10000)
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let mode = result.maintenance_mode.state;
        if (mode === true) {
            console.log('The maintenance mode is true - as should');
        } else {
            saveErrorAndResume('The maintenance mode is ', mode, '- failure!!!');
            failures_in_test = true;
        }
    })
    .delay(61000)
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let mode = result.maintenance_mode.state;
        if (mode === false) {
            console.log('The maintenance mode is false - as should');
        } else {
            saveErrorAndResume('The maintenance mode after turn finished time is ', mode, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.system.set_maintenance_mode({
        duration: 30
    })))
    .delay(10000)
    .then(() => P.resolve(client.system.set_maintenance_mode({
        duration: 0
    })))
    .delay(10000)
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let mode = result.maintenance_mode.state;
        if (mode === false) {
            console.log('The maintenance mode is false - as should');
        } else {
            saveErrorAndResume('The maintenance mode after turn off is ', mode, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.system.update_n2n_config({
        tcp_active: true,
        tcp_permanent_passive: {
            port: 60100
        }
    })))
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let tcp_port = result.n2n_config.tcp_permanent_passive.port;
        let n2n_config = JSON.stringify(result.n2n_config);
        if (tcp_port === 60100) {
            console.log('The single tcp port is : ', 60100, ' - as should');
        } else {
            saveErrorAndResume('The single tcp port is ', n2n_config, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.system.update_n2n_config({
        tcp_active: true,
        tcp_permanent_passive: {
            max: 60500,
            min: 60200
        }
    })))
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let tcp_port_min = result.n2n_config.tcp_permanent_passive.min;
        let tcp_port_max = result.n2n_config.tcp_permanent_passive.max;
        let n2n_config = JSON.stringify(result.n2n_config);
        if (tcp_port_min === 60200 && tcp_port_max === 60500) {
            console.log('The tcp port range is : ', 60100, ' to ', 60500, ' - as should');
        } else {
            saveErrorAndResume('The tcp port range is ', n2n_config, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.cluster_server.set_debug_level({
        level: 5
    })))
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let debug_level = result.debug_level;
        if (debug_level === 5) {
            console.log('The debug level is : ', 5, ' - as should');
        } else {
            saveErrorAndResume('The debug level is ', debug_level, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.cluster_server.set_debug_level({
        level: 0
    })))
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let debug_level = result.debug_level;
        if (debug_level === 0) {
            console.log('The debug level after turn off is : ', 0, ' - as should');
        } else {
            saveErrorAndResume('The debug level after turn off is ', debug_level, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.cluster_server.diagnose_system({})))
    .delay(40000)
    .then(result => {
        if (result.includes('/public/demo_cluster_diagnostics.tgz')) {
            console.log('The diagnose system file is  : ', result, ' - as should');
        } else {
            saveErrorAndResume('The diagnose system file is  : ', result, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => rpc.disconnect_all())
    .then(() => {
        if (failures_in_test) {
            console.log('Got error/s during test :( - exiting...' + errors);
            process.exit(1);
        } else {
            console.log('Test passed with no errors :) - exiting...');
            process.exit(0);
        }
    })
    .catch(err => {
        console.log('Major error during test :( - exiting...', err);
        process.exit(1);
    });
