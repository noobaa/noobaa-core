/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('../../util/promise');
var _ = require('lodash');
const net = require('net');
const dgram = require('dgram');
const http = require('http');
const ssh = require('../qa/ssh_functions');
const ssh2 = require('ssh2');
var promise_utils = require('../../util/promise_utils');
var argv = require('minimist')(process.argv);
var serverName = argv.server_ip;
var secret;

//noobaa rpc
var api = require('../../api');
var rpc;
var client;
var client_ssh;
var old_time = 0;
var configured_ntp = argv.ntp_server || 'pool.ntp.org';
var primary_dns = argv.primary_dns || '8.8.8.8';
var secondery_dns = argv.secondery_dns || '8.8.4.4';
var configured_dns = [primary_dns, secondery_dns];
var configured_timezone = 'Asia/Tel_Aviv';
var second_timezone = 'US/Arizona';
var received_phonehome_proxy_connection = false;
var received_udp_rsyslog_connection = false;
var received_tcp_rsyslog_connection = false;

var failures_in_test = false;

var my_external_ip = argv.my_ip;
var external_server_ip = argv.external_server_ip;
var udp_rsyslog_port = argv.udp_syslog_port || 5001;
var tcp_rsyslog_port = argv.tcp_syslog_port || 5002;
var ph_proxy_port = argv.ph_proxy_port || 5003;
var activation_code = 'pe^*pT%*&!&kmJ8nj@jJ6h3=Ry?EVns6MxTkz+JBwkmk_6ek&Wy%*=&+f$KE-uB5B&7m$2=YXX9tf&$%xAWn$td+prnbpKb7MCFfdx6S?txE=9bB+SVtKXQayzLVbAhqRWHW-JZ=_NCAE!7BVU_t5pe#deWy*d37q6m?KU?VQm?@TqE+Srs9TSGjfv94=32e_a#3H5Q7FBgMZd=YSh^J=!hmxeXtFZE$6bG+^r!tQh-Hy2LEk$+V&33e3Z_mDUVd';

let errors = [];

function saveErrorAndResume(message) {
    console.log(message);
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
    var auth_params = {
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
    .then(() => {
        client_ssh = new ssh2.Client();
        return ssh.ssh_connect(client_ssh, {
                host: external_server_ip,
              //  port: 22,
                username: 'noobaaroot',
                password: secret,
                keepaliveInterval: 5000,
            })
            .then(() => ssh.ssh_exec(client_ssh, 'sudo /root/node_modules/noobaa-core/src/deploy/NVA_build/clean_ova.sh -a'))
            .then(() => ssh.ssh_exec(client_ssh, 'sudo reboot -fn'))
            .then(() => client_ssh.end())
            .catch(err => {
                saveErrorAndResume(`${external_server_ip} FAILED`, err);
                failures_in_test = true;
                throw err;
            });
    })
    .then(() => {
        console.log('Waiting for connection server');
        rpc = api.new_rpc('wss://' + serverName + ':8443');
        client = rpc.new_client({});
        var retries = 10;
        var final_result;
        return promise_utils.pwhile(
            function() {
                return retries > 0;
            },
            function() {
                return P.resolve(client.account.accounts_status({}))
                    .then(res => {
                        console.log('Server is ready !!!!', res);
                        retries = 0;
                        final_result = res;
                    })
                    .catch(() => {
                        console.warn('Waiting for read server config, will retry extra', retries, 'times');
                        return P.delay(30000);
                    });
            }).then(() => final_result);
    })
    .then(() => {
        console.log('Validate activation code');
        return P.resolve(client.system.validate_activation({
            code: activation_code,
            email: 'demo@noobaa.com'
        }));
    })
    .then(result => {
        var code_is = result.valid;
        if (code_is === true) {
            console.log('Activation code is valid');
        } else {
            saveErrorAndResume('Activation code is not valid for new system failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.system.create_system({
        email: 'demo@noobaa.com',
        name: 'demo',
        password: 'DeMo1',
        activation_code: activation_code
    })))
    .then(() => P.resolve(client.account.accounts_status({})))
    .then(res => P.resolve()
        .then(() => promise_utils.pwhile(
            function() {
                return !res.has_accounts === true;
            },
            function() {
                console.warn('Waiting for account has status true');
                return P.delay(5000);
            }))
        .timeout(1 * 60000)
        .then(() => {
            console.log('Account has status: ' + res.has_accounts);
        })
        .catch(() => {
            saveErrorAndResume('Couldn\'t create system');
            failures_in_test = true;
        }))
    .then(() => {
    rpc = api.new_rpc('wss://' + serverName + ':8443');
    client = rpc.new_client({});
    var auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
    })
    .then(() => { // dns configuration
        console.log('Setting DNS', configured_dns);
        return P.resolve(client.cluster_server.update_dns_servers({
            dns_servers: configured_dns
        }));
    })
    .delay(30000)
    .then(() => {
        console.log('Waiting on Read system to verify DNS settings');
        var retries = 6;
        var final_result;
        return promise_utils.pwhile(
            function() {
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
        var dns = result.dns_servers;
        if (_.isEqual(dns, configured_dns)) {
            console.log('The defined dns is', dns, '- as should');
        } else {
            saveErrorAndResume('The defined dns is', dns, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        var dns_status = result.cluster.shards[0].servers[0].services_status.dns_servers;
        secret = result.cluster.shards[0].servers[0].secret;
        if (dns_status === 'OPERATIONAL') {
            console.log('The service monitor see the dns status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the dns status as', dns_status, '- failure!!!');
            failures_in_test = true;
        }
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
            saveErrorAndResume('New time moved less then 30 minutes forward', new Date(new_time * 1000), '- failure!!!');
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
        var timezone = result.timezone;
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
    .then(() => P.resolve(client.cluster_server.read_server_config({})))
    .then(result => {
        var ntp = result.ntp_server;
        if (ntp === configured_ntp) {
            console.log('The defined ntp is', ntp, '- as should');
        } else {
            saveErrorAndResume('The defined ntp is', ntp, '- failure!!!');
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
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        var ntp_status = result.cluster.shards[0].servers[0].services_status.ntp_server;
        if (ntp_status === 'OPERATIONAL') {
            console.log('The service monitor see the ntp status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the ntp status as', ntp_status, '- failure!!!');
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
        var proxy = result.phone_home_config.proxy_address;
        if (proxy === 'http://' + my_external_ip + ':' + ph_proxy_port) {
            console.log('The defined phone home proxy is', proxy, '- as should');
        } else {
            saveErrorAndResume('The defined phone home proxy is', proxy, '- failure');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        var ph_status = result.cluster.shards[0].servers[0].services_status.phonehome_proxy;
        if (ph_status === 'OPERATIONAL') {
            console.log('The service monitor see the phone home proxy status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the phone home proxy status as', ph_status, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => phone_home_proxy_server.close())
    .then(() => rsyslog_tcp_server.listen(tcp_rsyslog_port))
    .then(() => { // remote syslog configuration - TCP
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
        .timeout(1 * 60000)
        .then(() => {
            console.log('Just received tcp rsyslog message - as should');
        })
        .catch(() => {
            saveErrorAndResume('Didn\'t receive tcp rsyslog message for 1 minute - failure!!!');
            failures_in_test = true;
        }))
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        var address = result.remote_syslog_config.address;
        var protocol = result.remote_syslog_config.protocol;
        var port = result.remote_syslog_config.port;
        if (address === my_external_ip && protocol === 'TCP' && port === tcp_rsyslog_port) {
            console.log('The defined syslog is', address + ':' + port, '- as should');
        } else {
            saveErrorAndResume('The defined syslog is', address + ':' + port, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        var syslog_status = result.cluster.shards[0].servers[0].services_status.remote_syslog.status;
        if (syslog_status === 'OPERATIONAL') {
            console.log('The service monitor see the syslog status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the syslog status as', syslog_status, '- failure!!!');
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
        .timeout(1 * 60000)
        .then(() => {
            console.log('Just received udp rsyslog message - as should');
        })
        .catch(() => {
            saveErrorAndResume('Didn\'t receive udp rsyslog message for 1 minute - failure!!!');
            failures_in_test = true;
        }))
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        var address = result.remote_syslog_config.address;
        var protocol = result.remote_syslog_config.protocol;
        var port = result.remote_syslog_config.port;
        if (address === my_external_ip && protocol === 'UDP' && port === udp_rsyslog_port) {
            console.log('The defined syslog is', address + ':' + port, '- as should');
        } else {
            saveErrorAndResume('The defined syslog is', address + ':' + port, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(client.system.read_system({})))
    .then(result => {
        var syslog_status = result.cluster.shards[0].servers[0].services_status.remote_syslog.status;
        if (syslog_status === 'OPERATIONAL') {
            console.log('The service monitor see the syslog status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume('The service monitor see the syslog status as', syslog_status, '- failure!!!');
            failures_in_test = true;
        }
    })
    .then(() => rsyslog_udp_server.close())
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
