/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const P = require('../../util/promise');
const Report = require('../framework/report');
const child_process = require('child_process');
const argv = require('minimist')(process.argv);
const server_ops = require('../utils/server_functions');
const dbg = require('../../util/debug_module')(__filename);

const test_name = 'TUI';
dbg.set_process_name(test_name);
let secret;
let expectFail = false;
let isSystemStarted = true;
let strip_ansi_from_output;

const {
    server_ip,
    dont_strip = false,
    cycles = 10,
    help = false
} = argv;

if (dont_strip) {
    strip_ansi_from_output = false;
} else {
    strip_ansi_from_output = true;
}

if (help) {
    usage();
    process.exit(1);
}

const api = require('../../api');
let rpc = api.new_rpc(`wss://${server_ip}:8443`);
let client = rpc.new_client({});
// the double -t -t is not a mistake! it is needed to force ssh to create a pseudo-tty even though stdin is a pipe
const sshOptions = ['-t', '-t', '-o', `ServerAliveInterval=60`, '-o', `LogLevel=QUIET`, `noobaa@${server_ip}`];

function usage() {
    console.log(`
    --server_ip     -   noobaa server ip
    --dont_strip    -   Will show the TUI
    --cycles        -   Number of cycles (default ${cycles})
    --help          -   Show this help
    `);
}

//define colors
const NC = "\x1b[0m";
const YELLOW = "\x1b[33;1m";
//const RED = "\x1b[31m";

let report = new Report();
const cases = [
    'NTP_only_TZ',
    'NTP_reachable_with_TZ',
    'NTP_reachable_without_TZ',
    'NTP_unreachable_with_TZ',
    'NTP_unreachable_without_TZ',
    'NTP_reachable_with_TZ',
    'set_valid_hostname_dialog',
    'set_empty_hostname_dialog',
    'DNS_primary_invalid',
    'DNS_primary_reachable',
    'DNS_primary_reachable',
    'DNS_secondary_unreachable',
    'DNS_primary_unreachable',
    'DNS_secondary_unreachable',
    'DNS_primary_reachable',
    'DNS_primary_unreachable',
    'DNS_primary_empty',
    'DNS_primary_empty',
    'DNS_primary_reachable',
];
report.init_reporter({ suite: test_name, conf: {}, mongo_report: true, cases: cases });

//class Expect, should move to a util.
class Expect {

    constructor(options) {
        this._options = options;
        this._stdout = '';
        this._stderr = '';
        this._expects = [];
        this.MAX = 100000;
    }

    spawn(cmd, args) {
        console.log('=====> spawn:', cmd, args);
        this._proc = child_process
            .spawn(cmd, args, { stdio: 'pipe' })
            .on('error', err => console.error('=====> spawn: error', err))
            .on('exit', (code, signal) => console.error('=====> spawn: exit', code, signal));
        this._proc.stdout.on('data', data => {
            if (this._options.output) this._options.output(data);
            this._stdout = (this._stdout + data.toString()).slice(-this.MAX);
            this.check_expects();
        });
        this._proc.stderr.on('data', data => {
            if (this._options.output) this._options.output(data);
            this._stderr = (this._stderr + data.toString()).slice(-this.MAX);
            this.check_expects();
        });
    }

    expect(str, timeout) {
        const e = {
            str,
            resolve: null,
            reject: null,
            timeout: setTimeout(() => this.timeout(e), timeout ? timeout : 5 * 60 * 1000)
        };
        this._expects.push(e);
        return new Promise((resolve, reject) => {
            e.resolve = resolve;
            e.reject = reject;
            this.check_expects();
        });
    }

    check_expects() {
        for (var i = this._expects.length - 1; i >= 0; --i) {
            const e = this._expects[i];
            if (this._stdout.search(e.str) >= 0) {
                console.log('=====> expect:', e.str);
                e.resolve();
                clearTimeout(e.timeout);
                this._expects.splice(i, 1);
            }
        }
    }

    send(str) {
        console.log('=====> send:', str);
        this._proc.stdin.write(str);
        this.flush();
    }

    end() {
        console.log('=====> end:');
        this._proc.stdin.end();
        this.flush();
    }

    flush() {
        this._stdout = '';
        this._stderr = '';
    }

    timeout(e) {
        e.reject(new Error(util.format('TIMEOUT:', e.str)));
        this._proc.kill();
    }
}

// const UP = '\x1BOA';
const DOWN = '\x1BOB';
const BACKSPACE = '\x1B[3~';
const END = '\x1BOF~';
const SHIFTTAB = '\x1B[Z';
const DELETE = `${END}${BACKSPACE}${BACKSPACE}${BACKSPACE}${BACKSPACE}${BACKSPACE}${
    BACKSPACE}${BACKSPACE}${BACKSPACE}${BACKSPACE}${BACKSPACE}${BACKSPACE}${
    BACKSPACE}${BACKSPACE}${BACKSPACE}${BACKSPACE}${BACKSPACE}${BACKSPACE}${
    BACKSPACE}${BACKSPACE}${BACKSPACE}`;
// const HOME = '\x1BOE~';
// const RIGHT = '\x1BOC';
// const LEFT = '\x1BOD';

//clean the TUI from graphics
function strip_ansi_escape_codes(str) {
    //eslint-disable-next-line no-control-regex
    const ansi_escape_codes_regexp = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PRZcf-ntqry=><~]))/g;
    return str
        .replace(ansi_escape_codes_regexp, ' ')
        .replace(/t?q{4,}u?/g, ' ')
        .replace(/m?q{4,}j?/g, ' ')
        .replace(/l?q{4,}j?/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .replace(/^\s*$/gm, '');
}

async function expect_and_send(e, expect, send, delay = 0, timeout = undefined) {
    await e.expect(expect, timeout);
    if (delay !== 0) {
        await P.delay(delay * 1000);
    }
    await e.send(send);
}

//if system already started then expecting the "override the previous configuration" text
async function expect_override_conf(e, timeout) {
    if (isSystemStarted) {
        await expect_and_send(e, 'Are you sure you wish to override the previous configuration', 'y', 5, timeout);
    }
}

async function expect_an_error_and_get_back(e, errorMassage, timeout) {
    await expect_and_send(e, errorMassage, `${SHIFTTAB}\r`, 5, timeout);
}

async function expect_a_result_and_get_back(e, text, timeout) {
    await expect_and_send(e, text, `${SHIFTTAB}\r`, 5, timeout);
}

async function login_logout() {
    const e = new Expect({
        output: data => console.log(
            strip_ansi_from_output ? strip_ansi_escape_codes(data.toString()) : data.toString()
        )
    });

    try {
        await e.spawn('ssh', ['-t', '-t', '-o', `StrictHostKeyChecking=no`, '-o', `ServerAliveInterval=60`, `noobaa@${server_ip}`]);
        await P.delay(1 * 1000);
        await e.end();
    } catch (err) {
        throw new Error('FAILED', err);
    }
}

function ntp_Configuration_parameters(configureTZ, reachable) {
    //running with or without TZ
    const ntp_parameters = {
        ntpString: '',
        toExpect: '',
        expectFail: false,
        to_report: ''
    };
    if (Math.floor(Math.random() * 5) === 0) {
        ntp_parameters.expectFail = true;
        ntp_parameters.ntpString = `${DELETE}${DOWN}${DELETE}Asia/Jerusalem\r`;
        ntp_parameters.to_report = `NTP_only_TZ`;
    } else if (configureTZ && reachable) {
        console.log('Configuring reachable NTP with TZ');
        ntp_parameters.ntpString = `${DELETE}pool.ntp.org${DOWN}${DELETE}Asia/Jerusalem\r`;
        ntp_parameters.toExpect = 'pool.ntp.org';
        ntp_parameters.to_report = `NTP_reachable_with_TZ`;
    } else if (!configureTZ && reachable) {
        console.log('Configuring reachable NTP without TZ');
        ntp_parameters.ntpString = `${DELETE}pool.ntp.org${DOWN}${DELETE}\r`;
        ntp_parameters.toExpect = 'pool.ntp.org';
        ntp_parameters.to_report = `NTP_reachable_without_TZ`;
    } else if (configureTZ && !reachable) {
        console.log('Configuring unreachable NTP with TZ');
        ntp_parameters.ntpString = `${DELETE}unreachable${DOWN}${DELETE}Asia/Jerusalem\r`;
        ntp_parameters.toExpect = 'unreachable';
        ntp_parameters.to_report = `NTP_unreachable_with_TZ`;
    } else if (configureTZ && !reachable) {
        console.log('Configuring unreachable NTP without TZ');
        ntp_parameters.ntpString = `${DELETE}unreachable${DOWN}${DELETE}\r`;
        ntp_parameters.toExpect = 'unreachable';
        ntp_parameters.to_report = `NTP_unreachable_without_TZ`;
    } else {
        //making sure that we are not missing states... 
        console.log('Configuring reachable NTP with TZ');
        ntp_parameters.ntpString = `${DELETE}pool.ntp.org${DOWN}${DELETE}Asia/Jerusalem\r`;
        ntp_parameters.toExpect = 'pool.ntp.org';
        ntp_parameters.to_report = `NTP_reachable_with_TZ`;
    }
    return ntp_parameters;
}

//this function will run NTP configuration from the TUI
async function ntp_Configuration(configureTZ = true, reachable = true) {
    const e = new Expect({
        output: data => console.log(
            strip_ansi_from_output ? strip_ansi_escape_codes(data.toString()) : data.toString()
        )
    });

    const ntp_parameters = ntp_Configuration_parameters(configureTZ, reachable);
    try {
        await e.spawn('ssh', sshOptions);
        await expect_override_conf(e, 120 * 1000);
        await expect_and_send(e, 'This is a short first install wizard', '\r');
        await expect_and_send(e, 'NTP Configuration', `2\r`);
        await expect_and_send(e, 'Please supply an NTP server address and Time Zone', `${ntp_parameters.ntpString}\r`);
        await P.delay(30 * 1000);
        if (ntp_parameters.expectFail) {
            await expect_an_error_and_get_back(e, 'NTP Server must be set', 120 * 1000);
        } else {
            await expect_and_send(e, 'NTP Configuration', `2\r`);
            await expect_a_result_and_get_back(e, ntp_parameters.toExpect, 120 * 1000);
        }
        await expect_and_send(e, '6*Exit', '6\r', 1);
        await P.delay(5 * 1000);
        await e.expect('was configured and is ready to use', 120 * 1000);
        await P.delay(1 * 1000);
        await e.end();
        await report.success(ntp_parameters.to_report);
    } catch (err) {
        await report.fail(ntp_parameters.to_report);
        throw new Error('FAILED', err);
    }
}

function dns_Configuration_parameters(configurePrimary, configureSecondary, reachablePrimaryDns, reachableSecondaryDns) {
    //running with or without Secondary and wit or without valid ip
    const dns_parameters = {
        dnsString: '',
        toExpect: '',
        expectFail: false,
        to_report: ''
    };
    if (Math.floor(Math.random() * 9) === 0) {
        dns_parameters.expectFail = true;
        if (Math.floor(Math.random() * 2) === 0) {
            console.log('Configuring primary DNS ip with wrong ip format');
            dns_parameters.dnsString = `${DELETE}8,8.8.8${DOWN}${DELETE}\r`;
            dns_parameters.to_report = `DNS_primary_invalid`;
        } else {
            console.log('Configuring secondary DNS ip with wrong ip format');
            dns_parameters.dnsString = `${DELETE}8.8.8.8${DOWN}${DELETE}8,8.4.4\r`;
            dns_parameters.toExpect = '8.8.8.8';
            dns_parameters.to_report = `DNS_primary_reachable`;
        }
    } else if (configurePrimary && configureSecondary && reachablePrimaryDns && reachableSecondaryDns) {
        console.log('Configuring reachable Primary DNS with reachable Secondary DNS');
        dns_parameters.dnsString = `${DELETE}8.8.8.8${DOWN}${DELETE}8.8.4.4\r`;
        dns_parameters.toExpect = '8.8.8.8';
        dns_parameters.to_report = `DNS_primary_reachable`;
    } else if (configurePrimary && configureSecondary && !reachablePrimaryDns && !reachableSecondaryDns) {
        console.log('Configuring unreachable Primary DNS with unreachable Secondary DNS');
        dns_parameters.dnsString = `${DELETE}1.1.1.1${DOWN}${DELETE}1.1.4.4\r`;
        dns_parameters.toExpect = '1.1.1.1';
        dns_parameters.to_report = `DNS_secondary_unreachable`;
    } else if (configurePrimary && configureSecondary && !reachablePrimaryDns && reachableSecondaryDns) {
        console.log('Configuring unreachable Primary DNS with reachable Secondary DNS');
        dns_parameters.dnsString = `${DELETE}1.1.1.1${DOWN}${DELETE}8.8.4.4\r`;
        dns_parameters.toExpect = '1.1.1.1';
        dns_parameters.to_report = `DNS_primary_unreachable`;
    } else if (configurePrimary && configureSecondary && reachablePrimaryDns && !reachableSecondaryDns) {
        console.log('Configuring reachable Primary DNS with unreachable Secondary DNS');
        dns_parameters.dnsString = `${DELETE}8.8.8.8${DOWN}${DELETE}1.1.4.4\r`;
        dns_parameters.toExpect = '8.8.8.8';
        dns_parameters.to_report = `DNS_secondary_unreachable`;
    } else if (configurePrimary && !configureSecondary && reachablePrimaryDns) {
        console.log('Configuring reachable Primary DNS without Secondary DNS');
        dns_parameters.dnsString = `${DELETE}8.8.8.8${DOWN}${DELETE}\r`;
        dns_parameters.toExpect = '8.8.8.8';
        dns_parameters.to_report = `DNS_primary_reachable`;
    } else if (configurePrimary && !configureSecondary && !reachablePrimaryDns) {
        console.log('Configuring unreachable Primary DNS without Secondary DNS');
        dns_parameters.dnsString = `${DELETE}1.1.1.1${DOWN}${DELETE}\r`;
        dns_parameters.toExpect = '1.1.1.1';
        dns_parameters.to_report = `DNS_primary_unreachable`;
    } else if (!configurePrimary && configureSecondary && reachableSecondaryDns) {
        dns_parameters.expectFail = true;
        console.log('Configuring reachable Secondary DNS without Primary DNS');
        dns_parameters.dnsString = `${DELETE}${DOWN}8.8.8.8${DELETE}\r`;
        dns_parameters.to_report = `DNS_primary_empty`;
    } else if (!configurePrimary && configureSecondary && !reachableSecondaryDns) {
        dns_parameters.expectFail = true;
        console.log('Configuring unreachable Secondary DNS without Primary DNS');
        dns_parameters.dnsString = `${DELETE}${DOWN}1.1.1.1${DELETE}\r`;
        dns_parameters.to_report = `DNS_primary_empty`;
    } else {
        //making sure that we are not missing states... 
        console.log('Configuring reachable Primary DNS with reachable Secondary DNS');
        dns_parameters.dnsString = `${DELETE}8.8.8.8${DOWN}${DELETE}8.8.4.4\r`;
        dns_parameters.toExpect = '8.8.8.8';
        dns_parameters.to_report = `DNS_primary_reachable`;
    }
    return dns_parameters;
}

//this function will run DNS configuration from the TUI
async function dns_Configuration(configurePrimary = true, configureSecondary = true,
    reachablePrimaryDns = true, reachableSecondaryDns = true) {
    const e = new Expect({
        output: data => console.log(
            strip_ansi_from_output ? strip_ansi_escape_codes(data.toString()) : data.toString()
        )
    });

    const dns_parameters = dns_Configuration_parameters(configurePrimary, configureSecondary,
        reachablePrimaryDns, reachableSecondaryDns);
    try {
        await e.spawn('ssh', sshOptions);
        await P.delay(10 * 1000);
        await expect_override_conf(e, 120 * 1000);
        await expect_and_send(e, 'This is a short first install wizard', '\r');
        await expect_and_send(e, 'Networking Configuration', `1\r`);
        await expect_and_send(e, 'DNS Settings', `2\r`);
        await expect_and_send(e, 'Please supply a primary and secondary DNS servers', `${dns_parameters.dnsString}\r`);
        await P.delay(30 * 1000);
        if (dns_parameters.expectFail) {
            await expect_an_error_and_get_back(e, 'DNS server is not valid', 120 * 1000);
        } else {
            await expect_and_send(e, 'DNS Settings', `2\r`, 0, 120 * 1000);
            await expect_a_result_and_get_back(e, dns_parameters.toExpect, 120 * 1000);
        }
        await expect_and_send(e, '4*Exit', '4\r', 1);
        await P.delay(5 * 1000);
        await expect_and_send(e, '6*Exit', '6\r', 1);
        await P.delay(5 * 1000);
        await expect_and_send(e, 'was configured and is ready to use', '\r', 1);
        await P.delay(5 * 1000);
        await e.end();
        await report.success(dns_parameters.to_report);
    } catch (err) {
        await report.fail(dns_parameters.to_report);
        throw new Error('FAILED', err);
    }
}

//this function will set hostname
async function hostname_Settings() {
    const e = new Expect({
        output: data => console.log(
            strip_ansi_from_output ? strip_ansi_escape_codes(data.toString()) : data.toString()
        )
    });

    //setting empty or valid hostname.
    let hostname;
    let to_report;
    expectFail = false;
    if ((Math.floor(Math.random() * 2)) === 0) {
        hostname = 'noobaa-TUI';
        to_report = 'set_valid_hostname_dialog';
    } else {
        expectFail = true;
        hostname = '';
        to_report = 'set_empty_hostname_dialog';
    }
    try {
        await e.spawn('ssh', sshOptions);
        await expect_override_conf(e, 120 * 1000);
        await expect_and_send(e, 'This is a short first install wizard', '\r');
        await expect_and_send(e, 'Networking Configuration', `1\r`, 1);
        await expect_and_send(e, 'Hostname Settings', `3\r`, 1);
        await expect_and_send(e, 'Please supply a hostname for this', `${DELETE}${hostname}\r`);
        await P.delay(30 * 1000);
        if (!expectFail) {
            await expect_and_send(e, 'Hostname Settings', `3\r`);
            await expect_a_result_and_get_back(e, hostname, 120 * 1000);
        }
        await expect_and_send(e, '4*Exit', '4\r', 1);
        await P.delay(5 * 1000);
        await expect_and_send(e, '6*Exit', '6\r', 1);
        await P.delay(5 * 1000);
        await expect_and_send(e, 'was configured and is ready to use', '\r', 1);
        await P.delay(5 * 1000);
        await e.end();
        await report.success(to_report);
    } catch (err) {
        await report.fail(to_report);
        throw new Error('FAILED', err);
    }
}

async function authenticate() {
    await client.create_auth_token({
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    });
    const system_info = await client.system.read_system({});
    secret = system_info.cluster.shards[0].servers[0].secret;
    console.log('Secret is ' + secret);
    rpc.disconnect_all();
}

async function main() {
    try {
        await authenticate();
        server_ops.init_reporter({
            suite_name: 'TUI',
            cases: [
                'clean_ova',
                'create_system'
            ]
        });
        await server_ops.set_first_install_mark(server_ip, secret);
        await server_ops.enable_noobaa_login(server_ip, secret);
        //will loop twice, one with system and the other without.
        for (let cycle = 0; cycle < cycles; ++cycle) {
            console.log(`${YELLOW}Starting cycle number: ${cycle}${NC}`);
            if (cycle % 2 > 0) {
                console.log(`Running cycle without system`);
                // currently we are running only in azure. 
                // clean_ova does not delete /etc/first_install.mrk on platform other then esx
                // system is always consider started. 
                //isSystemStarted = false;
                await server_ops.clean_ova(server_ip, secret, true);
                await server_ops.wait_server_reconnect(server_ip);
                rpc = api.new_rpc(`wss://${server_ip}:8443`);
                client = rpc.new_client({});
            } else {
                console.log(`Running cycle with System pre-configured`);
                rpc = api.new_rpc(`wss://${server_ip}:8443`);
                client = rpc.new_client({});
                await authenticate();
            }
            //running the main flow
            await login_logout();
            const configureTZ = Boolean(Math.floor(Math.random() * 2));
            await ntp_Configuration(configureTZ, false);
            await ntp_Configuration(configureTZ);
            await ntp_Configuration();
            const configurePrimary = Boolean(Math.floor(Math.random() * 2));
            const configureSecondary = Boolean(Math.floor(Math.random() * 2));
            const reachablePrimaryDns = Boolean(Math.floor(Math.random() * 2));
            const reachableSecondaryDns = Boolean(Math.floor(Math.random() * 2));
            await dns_Configuration(configurePrimary, configureSecondary, reachablePrimaryDns, reachableSecondaryDns);
            await dns_Configuration();
            await hostname_Settings();
            if (cycle % 2 > 0) {
                await server_ops.validate_activation_code(server_ip);
                await server_ops.create_system_and_check(server_ip);
            }
        }
        console.log(`Everything finished with success!`);
        await report.report();
        process.exit(0);
    } catch (err) {
        console.error('TUI got an error:', err);
        await report.report();
        process.exit(1);
    }
}

P.resolve()
    .then(main);
