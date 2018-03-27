/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const _ = require('lodash');
const net = require('net');
const dgram = require('dgram');
const ip = require('ip');
const promise_utils = require('../../util/promise_utils');
const server_ops = require('../utils/server_functions');
const argv = require('minimist')(process.argv);
const api = require('../../api');
const dbg = require('../../util/debug_module')(__filename);
dbg.set_process_name('system_config');

//noobaa rpc
let secret;
let rpc;
let client;
let old_time = 0;
let failures_in_test = false;
let received_udp_rsyslog_connection = false;
let received_tcp_rsyslog_connection = false;

const second_timezone = 'US/Arizona';
const configured_timezone = 'Asia/Tel_Aviv';

let errors = [];

const {
    server_ip,
    ntp_server = 'pool.ntp.org',
    primary_dns = '8.8.8.8',
    secondery_dns = '8.8.4.4',
    udp_rsyslog_port = 5001,
    tcp_rsyslog_port = 514,
    ph_proxy_port = 5003,
    help = false
} = argv;

let configured_dns = [primary_dns, secondery_dns];

function usage() {
    console.log(`
    --server_ip             -   noobaa server ip.
    --ntp_server            -   ntp server (default: ${ntp_server})
    --primary_dns           -   primary dns ip (default: ${primary_dns})
    --secondery_dns         -   secondery dns ip (default: ${secondery_dns})
    --udp_rsyslog_port      -   udp rsyslog port (default: ${udp_rsyslog_port})
    --tcp_rsyslog_port      -   tcp rsyslog port (default: ${tcp_rsyslog_port})
    --ph_proxy_port         -   Phone home proxy port (default: ${ph_proxy_port})
    --id                    -   an id that is attached to the agents name
     --help                  -   show this help.
    `);
}

if (help) {
    usage();
    process.exit(1);
}

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

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

const lg_ip = ip.address(); // local ip - for test to run successfully to server and lg need to share same vnet
const proxy_server = 'http://' + lg_ip + ':3128';
P.fcall(function() {
        rpc = api.new_rpc('wss://' + server_ip + ':8443');
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
    .then(() => server_ops.clean_ova(server_ip, secret))
    .then(() => server_ops.wait_server_recoonect(server_ip))
    .then(() => server_ops.validate_activation_code(server_ip)
        .catch(err => {
            saveErrorAndResume(err.message);
            failures_in_test = true;
        }))
    .then(() => server_ops.create_system_and_check(server_ip)
        .catch(err => {
            saveErrorAndResume(err.message);
            failures_in_test = true;
        }))
    .then(() => {
        rpc = api.new_rpc('wss://' + server_ip + ':8443');
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
                        console.log(`waiting for read server config, will retry extra ${retries} times`);
                        return P.delay(15000);
                    });
            }).then(() => final_result);
    })
    .then(result => {
        let dns = result.dns_servers;
        if (_.isEqual(dns, configured_dns)) {
            console.log(`The defined dns is ${dns} - as should`);
        } else {
            saveErrorAndResume(`The defined dns is ${dns} - failure!!!`);
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
            saveErrorAndResume(`The service monitor see the dns status as ${dns_status} - failure!!!`);
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        secret = result.cluster.master_secret;
    })
    // time configuration - manual
    .then(() => {
        console.log('Setting timezone to :', configured_timezone);
        return P.resolve(client.cluster_server.update_time_config({
            target_secret: secret,
            timezone: configured_timezone,
            ntp_server
        }));
    })
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
        if (new_time >= old_time + (30 * 60)) {
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
            ntp_server
        }));
    })
    .then(() => P.resolve(client.cluster_server.read_server_config({})))
    .then(result => {
        let timezone = result.timezone;
        if (timezone === second_timezone) {
            console.log(`The defined timezone is ${timezone} - as should`);
        } else {
            saveErrorAndResume(`The defined timezone is ${timezone} - failure!!!`);
            failures_in_test = true;
        }
    })
    .then(() => { // time configuration - ntp
        console.log(`Checking connection before setup ntp ${ntp_server}`);
        return P.resolve(client.system.attempt_server_resolve({
            server_name: ntp_server
        }));
    })
    .delay(30000)
    .then(() => { // time configuration - ntp
        console.log('Setting NTP', ntp_server);
        return P.resolve(client.cluster_server.update_time_config({
            target_secret: secret,
            timezone: configured_timezone,
            ntp_server: ntp_server
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
            saveErrorAndResume(`The service monitor see the ntp status as ${ntp_status} - failure!!!`);
            failures_in_test = true;
        }
    }) // 3559
    .then(() => P.resolve(client.cluster_server.read_server_config({})))
    .then(result => {
        console.log('after setting ntp cluster config is:' + JSON.stringify(result));
        let ntp = result.ntp_server;
        if (ntp === ntp_server) {
            console.log(`The defined ntp is ${ntp} - as should`);
        } else {
            saveErrorAndResume(`The defined ntp is ${ntp} - failure!!!`);
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
        console.log('Setting Proxy');
        return P.resolve(client.system.update_phone_home_config({
            proxy_address: proxy_server
        }));
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
    .tap(result => {
        let proxy = result.phone_home_config.proxy_address;
        if (proxy === proxy_server) {
            console.log(`The defined proxy is ${proxy} - as should`);
        } else {
            saveErrorAndResume(`The defined proxy is ${proxy} - failure`);
            failures_in_test = true;
        }
    })
    .then(res => {
        let ph_status = res.cluster.shards[0].servers[0].services_status.phonehome_proxy;
        if (ph_status === 'OPERATIONAL') {
            console.log('The service monitor see the proxy status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume(`The service monitor see the proxy status as ${ph_status} - failure!!!`);
            failures_in_test = true;
        }
    })
    .then(() => { // phone home configuration -
        console.log('Setting disable Proxy');
        return P.resolve(client.system.update_phone_home_config({
            proxy_address: null
        }));
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
    .tap(result => {
        let proxy = result.phone_home_config;
        console.log('Phone home config is: ' + JSON.stringify(proxy));
        if (JSON.stringify(proxy).includes('proxy_address') === false) {
            console.log('The defined proxy is no use proxy - as should');
        } else {
            saveErrorAndResume(`The defined phone home with disable proxy is ${proxy} - failure`);
            failures_in_test = true;
        }
    })
    .then(result => {
        console.log(JSON.stringify(result.cluster.shards[0].servers[0].services_status));
        let ph_status = result.cluster.shards[0].servers[0].services_status.phonehome_server.status;
        if (ph_status === 'OPERATIONAL') {
            console.log('The service monitor see the proxy status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume(`The service monitor see the proxy after disable status as ${ph_status} - failure!!!`);
            failures_in_test = true;
        }
    })
    .then(() => rsyslog_tcp_server.listen(tcp_rsyslog_port))
    .then(() => { //#2596remote syslog configuration - TCP
        console.log('Setting TCP Remote Syslog');
        return P.resolve(client.system.configure_remote_syslog({
            enabled: true,
            address: lg_ip,
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
        if (address === lg_ip && protocol === 'TCP' && port === tcp_rsyslog_port) {
            console.log(`The defined syslog is ${address}: ${port} - as should`);
        } else {
            saveErrorAndResume(`The defined syslog is ${address}: ${port} - failure!!!`);
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
            saveErrorAndResume(`The service monitor see the syslog status as ${syslog_status} - failure!!!`);
            failures_in_test = true;
        }
    })
    .then(() => rsyslog_tcp_server.close())
    .then(() => rsyslog_udp_server.bind(udp_rsyslog_port))
    .then(() => { // remote syslog configuration - UDP
        console.log('Setting UDP Remote Syslog');
        return P.resolve(client.system.configure_remote_syslog({
            enabled: true,
            address: lg_ip,
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
        if (address === lg_ip && protocol === 'UDP' && port === udp_rsyslog_port) {
            console.log(`The defined syslog is ${address}: ${port} - as should`);
        } else {
            saveErrorAndResume(`The defined syslog is ${address}: ${port} - failure!!!`);
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
            saveErrorAndResume(`The service monitor see the syslog status as ${syslog_status} - failure!!!`);
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
            saveErrorAndResume(`The maintenance mode is ${mode} - failure!!!`);
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
            saveErrorAndResume(`The maintenance mode after turn finished time is ${mode} - failure!!!`);
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
            saveErrorAndResume(`The maintenance mode after turn off is ${mode} - failure!!!`);
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
            saveErrorAndResume(`The single tcp port is ${n2n_config} - failure!!!`);
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
            saveErrorAndResume(`The tcp port range is ${n2n_config} - failure!!!`);
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.cluster_server.set_debug_level({
        level: 5
    })))
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let debug_level = result.debug.level;
        if (debug_level === 5) {
            console.log('The debug level is : ', 5, ' - as should');
        } else {
            saveErrorAndResume(`The debug level is ${debug_level} - failure!!!`);
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.cluster_server.set_debug_level({
        level: 0
    })))
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        let debug_level = result.debug.level;
        if (debug_level === 0) {
            console.log('The debug level after turn off is : ', 0, ' - as should');
        } else {
            saveErrorAndResume(`The debug level after turn off is ${debug_level} - failure!!!`);
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.cluster_server.diagnose_system({})))
    .delay(40000)
    .then(result => {
        if (result.includes('/public/demo_cluster_diagnostics.tgz')) {
            console.log(`The diagnose system file is: ${result} - as should`);
        } else {
            saveErrorAndResume(`The diagnose system file is: ${result} - failure!!!`);
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
