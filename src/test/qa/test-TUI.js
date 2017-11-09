/* Copyright (C) 2016 NooBaa */
'use strict';

const child_process = require('child_process');
const P = require('../../util/promise');
const argv = require('minimist')(process.argv);
const server_ops = require('../qa/functions/server_functions');
const promise_utils = require('../../util/promise_utils');
let secret;
let isSystemStarted = true;

const {
    server_ip,
    help = false
} = argv;

const api = require('../../api');
const rpc = api.new_rpc(`wss://${server_ip}:8443`);
const client = rpc.new_client({});

function usage() {
    console.log(`
    --server_ip     -   noobaa server ip
    --help          -   show this help
    `);
}

if (help) {
    usage();
    process.exit(1);
}

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
            timeout: setTimeout(() => this.timeout(e), timeout ? timeout : 10000)
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
        e.reject(new Error('TIMEOUT'));
        this._proc.kill();
    }
}

// const UP = '\x1BOA';
const DOWN = '\x1BOB';
// const RIGHT = '\x1BOC';
// const LEFT = '\x1BOD';
const strip_ansi_from_output = true;

//clean the TUI from grafics
function strip_ansi_escape_codes(str) {
    const ansi_escape_codes_regexp = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PRZcf-ntqry=><~]))/g;
    return str
        .replace(ansi_escape_codes_regexp, ' ')
        .replace(/t?q{4,}u?/g, ' ')
        .replace(/m?q{4,}j?/g, ' ')
        .replace(/l?q{4,}j?/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .replace(/^\s*$/gm, '');
}

//if system already started then expecting the "override the previous configuration" text
function expect_override_conf(e, timeout) {
    if (isSystemStarted) {
        return Promise.resolve()
            .then(() => e.expect('Are you sure you wish to override the previous configuration', timeout))
            .then(() => e.send('y'));
    } else {
        return Promise.resolve();
    }
}

//this function will run NTP configuration from the TUI
function ntp_Configuration(configureTZ) {
    const e = new Expect({
        output: data => console.log(
            strip_ansi_from_output ? strip_ansi_escape_codes(data.toString()) : data.toString()
        )
    });

    //runing with or without TZ
    let ntpString;
    if (configureTZ) {
        ntpString = `pool.ntp.org${DOWN}US/Pacific\r`;
    } else {
        ntpString = `pool.ntp.org\r`;
    }

    return Promise.resolve()
        // the double -t -t is not a mistake! it is needed to force ssh to create a pseudo-tty eventhough stdin is a pipe
        .then(() => e.spawn('ssh', ['-t', '-t', `noobaa@${server_ip}`]))
        .then(() => expect_override_conf(e))
        .then(() => e.expect('This is a short first install wizard'))
        .then(() => e.send('\r'))
        .then(() => e.expect('NTP Configuration'))
        .then(() => e.send(`2\r`))
        .then(() => e.expect('Please supply an NTP server address and Time Zone'))
        .then(() => e.send(`${ntpString}`))
        .then(() => e.expect('6*Exit'))
        .then(() => e.send('6\r'))
        .then(() => e.expect('was configured and is ready to use'))
        .then(() => e.send('\r'))
        .then(() => e.end())
        .catch(err => {
            console.error('FAILED', err);
            process.exit(1);
        });
}

//this function will run DNS configuration from the TUI
function dns_Configuration(configureSecoundery, reachableDns) {
    const e = new Expect({
        output: data => console.log(
            strip_ansi_from_output ? strip_ansi_escape_codes(data.toString()) : data.toString()
        )
    });

    //runing with or without secoundery and wit or without valid ip
    let dnsString;
    if (configureSecoundery && reachableDns) {
        dnsString = `8.8.8.8${DOWN}8.8.4.4\r`;
    } else if (configureSecoundery && !reachableDns) {
        dnsString = `1.1.1.1${DOWN}1.1.4.4\r`;
    } else if (!configureSecoundery && reachableDns) {
        dnsString = `8.8.8.8\r`;
    } else {
        dnsString = `1.1.1.1\r`;
    }

    return Promise.resolve()
        // the double -t -t is not a mistake! it is needed to force ssh to create a pseudo-tty eventhough stdin is a pipe
        .then(() => e.spawn('ssh', ['-t', '-t', `noobaa@${server_ip}`]))
        .then(() => expect_override_conf(e, 60 * 1000))
        .then(() => e.expect('This is a short first install wizard'))
        .then(() => e.send('\r'))
        .then(() => e.expect('Networking Configuration'))
        .then(() => e.send(`1\r`))
        .then(() => e.expect('DNS Settings'))
        .then(() => e.send(`2\r`))
        .then(() => e.expect('Please supply a primary and secondary DNS servers'))
        .then(() => e.send(`${dnsString}`))
        .then(() => e.expect('4*Exit', 60 * 1000))
        .then(() => e.send('4\r'))
        .then(() => e.expect('6*Exit'))
        .then(() => e.send('6\r'))
        .then(() => e.expect('was configured and is ready to use'))
        .then(() => e.send('\r'))
        .then(() => e.end())
        .catch(err => {
            console.error('FAILED', err);
            process.exit(1);
        });
}

//this function will set hostname
function hostname_Settings() {
    const e = new Expect({
        output: data => console.log(
            strip_ansi_from_output ? strip_ansi_escape_codes(data.toString()) : data.toString()
        )
    });

    //setting empty or valid hostname.
    let hostname;
    if ((Math.floor(Math.random() * 2)) === 0) {
        hostname = 'noobaa-TUI';
    } else {
        hostname = '';
    }

    return Promise.resolve()
        // the double -t -t is not a mistake! it is needed to force ssh to create a pseudo-tty eventhough stdin is a pipe
        .then(() => e.spawn('ssh', ['-t', '-t', `noobaa@${server_ip}`]))
        .then(() => expect_override_conf(e))
        .then(() => e.expect('This is a short first install wizard'))
        .then(() => e.send('\r'))
        .then(() => e.expect('Networking Configuration'))
        .then(() => e.send(`1\r`))
        .then(() => e.expect('Hostname Settings'))
        .then(() => e.send(`3\r`))
        .then(() => e.expect('Please supply a hostname for this'))
        .then(() => e.send(`${hostname}\r`))
        .then(() => e.expect('4*Exit'))
        .then(() => e.send('4\r'))
        .then(() => e.expect('6*Exit'))
        .then(() => e.send('6\r'))
        .then(() => e.expect('was configured and is ready to use'))
        .then(() => e.send('\r'))
        .then(() => e.end())
        .catch(err => {
            console.error('FAILED', err);
            process.exit(1);
        });
}

return P.fcall(() => client.create_auth_token({
    email: 'demo@noobaa.com',
    password: 'DeMo1',
    system: 'demo'
}))
    .then(() => client.system.read_system({}))
    .then(result => {
        secret = result.cluster.shards[0].servers[0].secret;
        console.log('Secret is ' + secret);
    })
    .then(() => rpc.disconnect_all())
    .then(() => server_ops.enable_nooba_login(server_ip, secret))
    //will loop twice, one with system and the other without.
    .then(() => promise_utils.loop(2, cycle => P.resolve()
        .then(() => {
            if (cycle > 0) {
                console.log(`Running cycle without system`);
                isSystemStarted = false;
                return server_ops.clean_ova(server_ip, secret)
                    .then(() => server_ops.wait_server_recoonect(server_ip));
            } else {
                console.log(`Running cycle with System pre-configured`);
                return P.resolve();
            }
        })
        //running the main flow
        .then(() => {
            const configureTZ = Boolean(Math.floor(Math.random() * 2));
            return ntp_Configuration(configureTZ)
                .then(() => {
                    const configureSecoundery = Boolean(Math.floor(Math.random() * 2));
                    const reachableDns = Boolean(Math.floor(Math.random() * 2));
                    return dns_Configuration(configureSecoundery, reachableDns);
                })
                .then(() => dns_Configuration(true, true))
                .then(hostname_Settings);
        })
        .then(() => {
            if (cycle > 0) {
                return server_ops.validate_activation_code(server_ip)
                    .then(() => server_ops.create_system_and_check(server_ip));
            }
            return P.resolve();
        })
    ))
    .then(() => {
        console.log(`Everything finished with success!`);
        process.exit(0);
    });