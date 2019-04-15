/* Copyright (C) 2016 NooBaa */
'use strict';

const ip = require('ip');
const net = require('net');
const _ = require('lodash');
const dgram = require('dgram');
const api = require('../../api');
const P = require('../../util/promise');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const server_ops = require('../utils/server_functions');
const dbg = require('../../util/debug_module')(__filename);

const test_name = 'system_config';
dbg.set_process_name(test_name);

//noobaa rpc
let rpc;
let client;
let failures_in_test = false;

const second_timezone = 'US/Arizona';
const configured_timezone = 'Asia/Tel_Aviv';

let errors = [];

const {
    server_ip,
    skip_create_system = false,
    ntp_server = 'time.windows.com',
    primary_dns = '8.8.8.8',
    secondery_dns = '8.8.4.4',
    udp_rsyslog_port = 5001,
    tcp_rsyslog_port = 514,
    ph_proxy_port = 5003,
    skip_report = false,
    help = false
} = argv;

let configured_dns = [primary_dns, secondery_dns];

function usage() {
    console.log(`
    --server_ip             -   noobaa server ip.
    --skip_create_system    -   will skip create system
    --ntp_server            -   ntp server (default: ${ntp_server})
    --primary_dns           -   primary dns ip (default: ${primary_dns})
    --secondery_dns         -   secondery dns ip (default: ${secondery_dns})
    --udp_rsyslog_port      -   udp rsyslog port (default: ${udp_rsyslog_port})
    --tcp_rsyslog_port      -   tcp rsyslog port (default: ${tcp_rsyslog_port})
    --ph_proxy_port         -   Phone home proxy port (default: ${ph_proxy_port})
    --skip_report           -   will skip sending report to mongo
    --id                    -   an id that is attached to the agents name
    --help                  -   show this help.
    `);
}

if (help) {
    usage();
    process.exit(1);
}

let report = new Report();
const cases = [
    'set_DNS',
    'set_NTP',
    'set_Proxy',
    'disable_Proxy',
    'TCP_Remote_Syslog',
    'UDP_Remote_Syslog',
    'set_maintenance_mode',
    'update_n2n_config_single_port',
    'update_n2n_config_range',
    'set_debug_level_and_check',
    'set_diagnose_system',
];
report.init_reporter({ suite: test_name, conf: {}, mongo_report: true, cases: cases });

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

const lg_ip = ip.address(); // local ip - for test to run successfully to server and lg need to share same vnet
const proxy_server = 'http://' + lg_ip + ':3128';

async function set_DNS_And_check() {
    try {
        console.log('Setting DNS', configured_dns);
        await client.cluster_server.update_dns_servers({
            dns_servers: configured_dns
        });
        console.log(`Sleeping for 30 sec`);
        await P.delay(30 * 1000);
        await verify_DNS_settings();
        await verify_DNS_status();
        await report.success(`set_DNS`);
    } catch (e) {
        failures_in_test = true;
        await report.fail(`set_DNS`);
    }
}

async function verify_DNS_settings() {
    console.log('Waiting on Read system to verify DNS settings');
    let dns;
    for (let retries = 5; retries >= 0; --retries) {
        try {
            const server_config = await client.cluster_server.read_server_config({});
            console.log('Read server ready !!!!', server_config);
            dns = server_config.dns_servers;
            break;
        } catch (e) {
            console.log(`waiting for read server config, will retry extra ${retries} times`);
            await P.delay(15 * 1000);
        }
    }
    if (_.isEqual(dns, configured_dns)) {
        console.log(`The defined dns is ${dns} - as should`);
    } else {
        saveErrorAndResume(`The defined dns is ${dns}`);
        throw new Error('Test DNS Failed');
    }
}

async function verify_DNS_status() {
    console.log('Waiting on Read system to verify DNS status');
    const base_time = Date.now();
    let dns_status;
    while (Date.now() - base_time < 65 * 1000) {
        try {
            const system_info = await client.system.read_system({});
            dns_status = system_info.cluster.shards[0].servers[0].services_status.dns_servers;
            if (dns_status) break;
        } catch (e) {
            console.log('waiting for read systme, will sleep for 15 seconds');
            await P.delay(15 * 1000);
        }
    }

    if (dns_status === 'OPERATIONAL') {
        console.log('The service monitor see the dns status as OPERATIONAL - as should');
    } else {
        saveErrorAndResume(`The service monitor see the dns status as ${dns_status}`);
        throw new Error('Test DNS Failed');
    }
}

async function update_NTP({ target_secret, timezone, server, epoch }) {
    try {
        console.log(`Setting NTP. timezone ${timezone}, NTP server: ${server}`);
        await client.cluster_server.update_time_config({
            target_secret,
            timezone,
            ntp_server: server,
            epoch
        });
        await report.success(`set_NTP`);
    } catch (e) {
        await report.fail(`set_NTP`);
        throw new Error('Test NTP Failed');
    }
}

async function set_NTP_And_check() {
    let old_time = 0;
    try {
        let system_info = await client.system.read_system({});
        const target_secret = system_info.cluster.master_secret;
        await update_NTP({
            target_secret,
            timezone: configured_timezone,
            server: ntp_server
        });
        const current_time = await client.cluster_server.read_server_time({
            target_secret
        });
        console.log('Current time is:', new Date(current_time * 1000));
        old_time = current_time;
        console.log('Moving time 30 minutes forward');
        await update_NTP({
            target_secret,
            timezone: configured_timezone,
            epoch: current_time + (30 * 60) // moving 30 minutes forward
        });
        let new_time = await client.cluster_server.read_server_time({
            target_secret
        });
        if (new_time >= old_time + (30 * 60)) {
            console.log('New time moved more then 30 minutes forward', new Date(new_time * 1000), '- as should');
        } else {
            saveErrorAndResume('New time moved less then 30 minutes forward' + new Date(new_time * 1000) + '- failure!!!');
            throw new Error('Test NTP Failed');
        }
        console.log('Setting different timezone');
        await update_NTP({
            target_secret,
            timezone: second_timezone,
            server: ntp_server
        });
        let server_config = await client.cluster_server.read_server_config({});
        let timezone = server_config.timezone;
        if (timezone === second_timezone) {
            console.log(`The defined timezone is ${timezone} - as should`);
        } else {
            saveErrorAndResume(`The defined timezone is ${timezone}`);
            throw new Error('Test NTP Failed');
        }
        console.log(`Checking connection before setup ntp ${ntp_server}`);
        await client.system.attempt_server_resolve({
            server_name: ntp_server
        });
        await P.delay(30 * 1000);
        console.log('Setting NTP', ntp_server);
        await update_NTP({
            target_secret,
            timezone: configured_timezone,
            server: ntp_server
        });
        console.log('Waiting on Read system to verify NTP status');
        const base_time = Date.now();
        let ntp_status;
        while (Date.now() - base_time < 65 * 1000) {
            try {
                system_info = await client.system.read_system({});
                ntp_status = system_info.cluster.shards[0].servers[0].services_status.ntp_server;
                if (ntp_status) break;
            } catch (e) {
                console.log('waiting for read systme, will sleep for 15 seconds');
                await P.delay(15 * 1000);
            }
        }
        if (ntp_status === 'OPERATIONAL') {
            console.log('The service monitor see the ntp status as OPERATIONAL - as should');
        } else {
            saveErrorAndResume(`The service monitor see the ntp status as ${ntp_status}`);
            throw new Error('Test NTP Failed');
        }
        server_config = await client.cluster_server.read_server_config({});
        console.log(`after setting ntp cluster config is: ${JSON.stringify(server_config)}`);
        let ntp = server_config.ntp_server;
        if (ntp === ntp_server) {
            console.log(`The defined ntp is ${ntp} - as should`);
        } else {
            saveErrorAndResume(`The defined ntp is ${ntp}`);
            throw new Error('Test NTP Failed');
        }
        new_time = await client.cluster_server.read_server_time({
            target_secret
        });
        if (new_time < old_time + (2 * 60)) {
            console.log('New time has moved back to correct time', new Date(new_time * 1000), '- as should');
        } else {
            saveErrorAndResume('New time is more than 2 minutes away from the correct time', new Date(new_time * 1000), '- failure!!!');
            throw new Error('Test NTP Failed');
        }
    } catch (e) {
        failures_in_test = true;
        await report.fail(`set_NTP`);
    }
}

async function get_Phonehome_proxy_status() {
    console.log('Waiting on Read system to verify Proxy status');
    const base_time = Date.now();
    let proxy_status;
    while (Date.now() - base_time < 65 * 1000) {
        try {
            const system_info = await client.system.read_system({});
            proxy_status = system_info.cluster.shards[0].servers[0].services_status.phonehome_proxy;
            if (proxy_status) break;
        } catch (e) {
            console.log('waiting for read systme, will sleep for 15 seconds');
            await P.delay(15 * 1000);
        }
    }
    return proxy_status;
}

async function set_Proxy_and_check() {
    try {
        console.log('Setting Proxy');
        await client.system.update_phone_home_config({
            proxy_address: proxy_server
        });
        const proxy_status = await get_Phonehome_proxy_status();
        const defined_proxy = proxy_status.phone_home_config.proxy_address;
        if (defined_proxy === proxy_server) {
            console.log(`The defined proxy is ${defined_proxy} - as should`);
        } else {
            saveErrorAndResume(`The defined proxy is ${defined_proxy}`);
            throw new Error('Test Phonehome Failed');
        }
        const ph_status = proxy_status.cluster.shards[0].servers[0].services_status.phonehome_proxy;
        if (ph_status === 'OPERATIONAL') {
            console.log('The service monitor see the proxy status as OPERATIONAL - as should');
            await report.success(`set_Proxy`);
        } else {
            saveErrorAndResume(`The service monitor see the proxy status as ${ph_status}`);
            throw new Error('Test Phonehome Failed');
        }
    } catch (e) {
        console.error(e);
        failures_in_test = true;
        await report.fail(`set_Proxy`);
        throw new Error('Test Phonehome Failed');
    }
}

async function disable_Proxy_and_check() {
    try {
        console.log('Setting disable Proxy');
        await client.system.update_phone_home_config({ // phone home configuration
            proxy_address: null
        });
        const proxy_status = await get_Phonehome_proxy_status();
        const proxy_config = proxy_status.phone_home_config;
        console.log('Phone home config is: ' + JSON.stringify(proxy_config));
        if (JSON.stringify(proxy_config).includes('proxy_address') === false) {
            console.log('The defined proxy is no use proxy - as should');
        } else {
            saveErrorAndResume(`The defined phone home with disable proxy is ${proxy_config}`);
            throw new Error('Test Phonehome Failed');
        }
        console.log(JSON.stringify(proxy_status.cluster.shards[0].servers[0].services_status));
        const ph_status = proxy_status.cluster.shards[0].servers[0].services_status.phonehome_server.status;
        if (ph_status === 'OPERATIONAL') {
            console.log('The service monitor see the proxy status as OPERATIONAL - as should');
            await report.success(`disable_Proxy`);
        } else {
            saveErrorAndResume(`The service monitor see the proxy after disable status as ${ph_status}`);
            throw new Error('Test Phonehome Failed');
        }
    } catch (e) {
        failures_in_test = true;
        await report.fail(`disable_Proxy`);
    }
}

async function set_Phonehome_and_check() {
    try {
        try {
            await set_Proxy_and_check();
        } catch (e) {
            console.error(e);
            throw e;
        }
        await disable_Proxy_and_check();
    } catch (e) {
        console.error(e);
        failures_in_test = true;
    }
}

async function check_defined_syslog(expected_protocol, rsyslog_port) {
    const system_info = await client.system.read_system({});
    const address = system_info.remote_syslog_config.address;
    const protocol = system_info.remote_syslog_config.protocol;
    const port = system_info.remote_syslog_config.port;
    if (address === lg_ip && protocol === expected_protocol && port === rsyslog_port) {
        console.log(`The defined syslog is ${address}: ${port} - as should`);
    } else {
        saveErrorAndResume(`The defined syslog is ${address}: ${port}, expected ${lg_ip}: ${rsyslog_port}`);
        throw new Error(`Test ${expected_protocol}_Remote_Syslog Failed`);
    }
}

async function check_syslog_status(protocol) {
    console.log('Waiting on Read system to verify Rsyslog status');
    const base_time = Date.now();
    let remote_status;
    while (Date.now() - base_time < 65 * 1000) {
        try {
            const system_info = await client.system.read_system({});
            remote_status = system_info.cluster.shards[0].servers[0].services_status.remote_syslog;
            if (remote_status) break;
        } catch (e) {
            console.log('waiting for read systme, will sleep for 15 seconds');
            await P.delay(15 * 1000);
        }
    }
    const syslog_status = remote_status.cluster.shards[0].servers[0].services_status.remote_syslog.status;
    if (syslog_status === 'OPERATIONAL') {
        console.log('The service monitor see the syslog status as OPERATIONAL - as should');
    } else {
        saveErrorAndResume(`The service monitor see the syslog status as ${syslog_status}`);
        throw new Error(`Test ${protocol}_Remote_Syslog Failed`);
    }
}

async function set_remote_syslog_protocol_and_check(protocol, address, port, secret) {
    console.log(`Setting ${protocol} Remote Syslog`);
    try {
        await client.system.configure_remote_syslog({
            enabled: true,
            address,
            protocol,
            port
        });
        await createServerAndWaitForMessage(protocol, port, 60 * 1000, secret);
        console.log(`Just received ${protocol} rsyslog message - as should`);
    } catch (e) {
        console.error(e);
        saveErrorAndResume(`Didn't receive ${protocol} rsyslog message for 1 minute`);
        throw new Error(`Test ${protocol}_Remote_Syslog Failed`);
    }
}

function createServerAndWaitForMessage(protocol, port, timeout = 0, secret) {
    return new P((resolve, reject) => {
        let server = null;
        if (protocol === 'TCP') {
            server = net.createServer(c => {
                c.on('data', resolve);
                c.on('error', err => {
                    server.close();
                    reject(err);
                });
                c.on('end', () => reject(new Error('Server ended before message')));
            });

            server.listen(port);
        } else if (protocol === 'UDP') {
            server = dgram.createSocket('udp4');
            server.on('message', resolve);
            server.on('error', err => {
                server.close();
                reject(err);
            });
            server.on('end', () => reject(new Error('Server ended before message')));
            server.bind(port);

        } else {
            reject(new Error('Unknown protocol'));
        }

        if (timeout > 0) {
            setTimeout(() => {
                server.close();
                reject(new Error('Timeout'));
            }, timeout);
        }

        // Using it in order to create an event for the rsyslog to send
        client.cluster_server.update_server_conf({
                target_secret: secret,
                location: 'SlothLand'
            })
            .catch(console.error);
    });
}

async function remote_syslog(protocol, secret) {
    try {
        const port = protocol === 'TCP' ? tcp_rsyslog_port : udp_rsyslog_port;
        console.log(`port: ${port}`);
        await set_remote_syslog_protocol_and_check(protocol, lg_ip, port, secret);
        await check_defined_syslog(protocol, port);
        await check_syslog_status(protocol);
        await report.success(`${protocol}_Remote_Syslog`);
    } catch (e) {
        //failures_in_test = true;  //TODO: fix the fail and remove the remark
        await report.fail(`${protocol}_Remote_Syslog`);
    }
}

async function check_maintenance_mode(expected_mode) {
    const system_info = await client.system.read_system({});
    const is_mode_off = system_info.maintenance_mode.state;
    if (is_mode_off === expected_mode) {
        console.log(`The maintenance mode is ${is_mode_off} - as should`);
        await report.success(`set_maintenance_mode`);
    } else {
        saveErrorAndResume(`The maintenance mode is ${is_mode_off}`);
        await report.fail(`set_maintenance_mode`);
        throw new Error('Test set_maintenance_mode_and_check Failed');
    }
}

async function set_maintenance_mode(duration, delay_in_sec) {
    try {
        console.log(`Setting maintenance mode duration to ${duration}`);
        await client.system.set_maintenance_mode({ duration });
        console.log(`Sleeping for ${delay_in_sec} sec`);
        await P.delay(delay_in_sec * 1000);
    } catch (e) {
        await report.fail(`set_maintenance_mode`);
        throw new Error('Test set_maintenance_mode_and_check Failed');
    }
}

async function set_maintenance_mode_and_check() {
    try {
        console.log('Setting maintenance mode');
        await set_maintenance_mode(1, 10);
        await check_maintenance_mode(true);
        console.log(`Sleeping for 60 sec`);
        await P.delay(60 * 1000);
        await check_maintenance_mode(false);
        await set_maintenance_mode(30, 10);
        await set_maintenance_mode(0, 10);
        await check_maintenance_mode(false);
    } catch (e) {
        failures_in_test = true;
    }
}

async function update_n2n_config_and_check_single_port(port) {
    await client.system.update_n2n_config({
        config: {
            tcp_active: true,
            tcp_permanent_passive: { port }
        }
    });
    let system_info = await client.system.read_system({});
    const tcp_port = system_info.n2n_config.tcp_permanent_passive.port;
    let n2n_config = JSON.stringify(system_info.n2n_config);
    if (tcp_port === port) {
        console.log(`The single tcp port is: ${port} - as should`);
        await report.success(`update_n2n_config_single_port`);
    } else {
        saveErrorAndResume(`The single tcp port is ${n2n_config}`);
        await report.fail(`update_n2n_config_single_port`);
        throw new Error('Test update_n2n_config_and_check Failed');
    }
}

async function update_n2n_config_and_check_range(max, min) {
    await client.system.update_n2n_config({
        config: {
            tcp_active: true,
            tcp_permanent_passive: { max, min }
        }
    });
    const system_info = await client.system.read_system({});
    const tcp_port_min = system_info.n2n_config.tcp_permanent_passive.min;
    const tcp_port_max = system_info.n2n_config.tcp_permanent_passive.max;
    const n2n_config = JSON.stringify(system_info.n2n_config);
    if (tcp_port_min === min && tcp_port_max === max) {
        console.log(`The tcp port range is: ${min} to ${60500} - as should`);
        await report.success(`update_n2n_config_range`);
    } else {
        saveErrorAndResume(`The tcp port range is ${n2n_config}`);
        await report.fail(`update_n2n_config_range`);
        throw new Error('Test update_n2n_config_and_check Failed');
    }
}

async function update_n2n_config_and_check() {
    try {
        console.log('Updating n2n config mode');
        await update_n2n_config_and_check_single_port(60100);
        await update_n2n_config_and_check_range(60500, 60200);
    } catch (e) {
        failures_in_test = true;
    }
}

async function set_debug_level(level) {
    try {
        await client.cluster_server.set_debug_level({ level });
        const system_info = await client.system.read_system({});
        const debug_level = system_info.debug.level;
        if (debug_level === level) {
            console.log(`The debug level is: ${level} - as should`);
            await report.success(`set_debug_level_and_check`);
        } else {
            saveErrorAndResume(`The debug level is ${debug_level}`);
            throw new Error('Test set_debug_level_and_check Failed');
        }
    } catch (e) {
        await report.fail(`set_debug_level_and_check`);
        throw new Error('Test set_debug_level_and_check Failed');
    }
}

async function set_debug_level_and_check() {
    try {
        console.log('Setting debug level');
        //turn on debug level
        await set_debug_level(5);
        //turn off debug level
        await set_debug_level(0);
    } catch (e) {
        failures_in_test = true;
    }
}

async function set_diagnose_system_and_check() {
    try {
        console.log(`Setting Diagnostic`);
        const diagnose_system = await client.cluster_server.diagnose_system({});
        await P.delay(40 * 1000);
        if (diagnose_system.includes('/public/demo_cluster_diagnostics.tgz')) {
            console.log(`The diagnose system file is: ${diagnose_system} - as should `);
            await report.success(`set_diagnose_system`);
        } else {
            saveErrorAndResume(`The diagnose system file is: ${diagnose_system}`);
            throw new Error('Test set_diagnose_system_and_check Failed');
        }
    } catch (e) {
        failures_in_test = true;
        await report.fail(`set_diagnose_system`);
    }
}

async function set_rpc_and_create_auth_token() {
    rpc = api.new_rpc_from_base_address('wss://' + server_ip + ':8443');
    client = rpc.new_client({});
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
}

async function main() {
    try {
        if (skip_report) {
            report.pause();
        }
        await set_rpc_and_create_auth_token();
        let system_info = await client.system.read_system({});
        let secret = system_info.cluster.shards[0].servers[0].secret;
        console.log('Secret is ' + secret);
        rpc.disconnect_all();

        server_ops.init_reporter({
            suite_name: 'system_config',
            cases: [
                'clean_ova',
                'create_system'
            ]
        });

        if (skip_create_system) {
            console.log(`Skipping clean ova and create system`);
        } else {
            await server_ops.clean_ova_and_create_system(server_ip, secret);
            await set_rpc_and_create_auth_token();
            system_info = await client.system.read_system({});
            secret = system_info.cluster.shards[0].servers[0].secret;
        }
        await set_DNS_And_check();
        await set_NTP_And_check();
        await set_Phonehome_and_check();
        await remote_syslog('TCP', secret);
        await remote_syslog('UDP', secret);
        await set_maintenance_mode_and_check();
        await update_n2n_config_and_check();
        await set_debug_level_and_check();
        await set_diagnose_system_and_check();
        rpc.disconnect_all();
        await report.report();
        if (failures_in_test) {
            throw new Error(`Got error/s during test - exiting...`);
        } else {
            console.log('Test passed with no errors - exiting...');
            process.exit(0);
        }
    } catch (err) {
        await report.report();
        console.error(`${err}`);
        console.error(`${JSON.stringify(_.countBy(errors), null, 4)}`);
        process.exit(1);
    }
}

main();
