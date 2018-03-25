/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const util = require('util');
const child_process = require('child_process');
const argv = require('minimist')(process.argv);
const server_ops = require('../utils/server_functions');
const promise_utils = require('../../util/promise_utils');
const dbg = require('../../util/debug_module')(__filename);
dbg.set_process_name('TUI');
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


const api = require('../../api');
let rpc = api.new_rpc(`wss://${server_ip}:8443`);
let client = rpc.new_client({});

function usage() {
    console.log(`
    --server_ip     -   noobaa server ip
    --dont_strip    -   Will show the TUI
    --cycles        -   Number of cycles (default ${cycles})
    --help          -   Show this help
    `);
}

if (help) {
    usage();
    process.exit(1);
}

//define colors
const YELLOW = "\x1b[33;1m";
//const RED = "\x1b[31m";
const NC = "\x1b[0m";

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
        return P.resolve()
            .then(() => e.expect('Are you sure you wish to override the previous configuration', timeout))
            .delay(5 * 1000)
            .then(() => e.send('y'));
    } else {
        return P.resolve();
    }
}

function expect_an_error_and_get_back(e, errorMassage, timeout) {
    return P.resolve()
        .then(() => e.expect(errorMassage, timeout))
        .delay(5 * 1000)
        .then(() => e.send(`${SHIFTTAB}\r`));
}

function expect_a_resoult_and_get_back(e, text, timeout) {
    // console.log('expect_a_resoult_and_get_back:: text: ' + text);
    return P.resolve()
        .then(() => e.expect(text, timeout))
        .delay(5 * 1000)
        .then(() => e.send(`${SHIFTTAB}\r`));
}


//this function will run NTP configuration from the TUI
function ntp_Configuration(configureTZ = true, reachable = true) {
    const e = new Expect({
        output: data => console.log(
            strip_ansi_from_output ? strip_ansi_escape_codes(data.toString()) : data.toString()
        )
    });

    //runing with or without TZ
    let ntpString;
    let toExpect;
    expectFail = false;
    if (Math.floor(Math.random() * 5) === 0) {
        expectFail = true;
        ntpString = `${DELETE}${DOWN}${DELETE}Asia/Jerusalem\r`;
    } else if (configureTZ && reachable) {
        console.log('Configuring reachable NTP with TZ');
        ntpString = `${DELETE}pool.ntp.org${DOWN}${DELETE}Asia/Jerusalem\r`;
        toExpect = 'pool.ntp.org';
    } else if (!configureTZ && reachable) {
        console.log('Configuring reachable NTP without TZ');
        ntpString = `${DELETE}pool.ntp.org${DOWN}${DELETE}\r`;
        toExpect = 'pool.ntp.org';
    } else if (configureTZ && !reachable) {
        console.log('Configuring unreachable NTP with TZ');
        ntpString = `${DELETE}unreachable${DOWN}${DELETE}Asia/Jerusalem\r`;
        toExpect = 'unreachable';
    } else if (configureTZ && !reachable) {
        console.log('Configuring unreachable NTP without TZ');
        ntpString = `${DELETE}unreachable${DOWN}${DELETE}\r`;
        toExpect = 'unreachable';
    } else {
        //making sure that we are not missing states... 
        console.log('Configuring reachable NTP with TZ');
        ntpString = `${DELETE}pool.ntp.org${DOWN}${DELETE}Asia/Jerusalem\r`;
        toExpect = 'pool.ntp.org';
    }

    return P.resolve()
        // the double -t -t is not a mistake! it is needed to force ssh to create a pseudo-tty eventhough stdin is a pipe
        .then(() => e.spawn('ssh', ['-t', '-t', `noobaa@${server_ip}`]))
        .then(() => expect_override_conf(e, 120 * 1000))
        .then(() => e.expect('This is a short first install wizard'))
        .then(() => e.send('\r'))
        .then(() => e.expect('NTP Configuration'))
        .then(() => e.send(`2\r`))
        .then(() => e.expect('Please supply an NTP server address and Time Zone'))
        .then(() => e.send(`${ntpString}\r`))
        .delay(30 * 1000)
        .then(() => {
            if (expectFail) {
                return expect_an_error_and_get_back(e, 'NTP Server must be set', 120 * 1000);
            } else {
                return e.expect('NTP Configuration')
                    .then(() => e.send(`2\r`))
                    .then(() => expect_a_resoult_and_get_back(e, toExpect, 120 * 1000));
            }
        })
        .then(() => e.expect('6*Exit'))
        .delay(1 * 1000)
        .then(() => e.send('6\r'))
        .delay(5 * 1000)
        .then(() => e.expect('was configured and is ready to use', 120 * 1000))
        .delay(1 * 1000)
        .then(() => e.end())
        .catch(err => {
            console.error('FAILED', err);
            process.exit(1);
        });
}

//this function will run DNS configuration from the TUI
function dns_Configuration(configurePrimary = true, configureSecondary = true, reachablePrimaryDns = true, reachableSecondaryDns = true) {
    const e = new Expect({
        output: data => console.log(
            strip_ansi_from_output ? strip_ansi_escape_codes(data.toString()) : data.toString()
        )
    });

    //runing with or without Secondary and wit or without valid ip
    let dnsString;
    let toExpect;
    expectFail = false;
    if (Math.floor(Math.random() * 9) === 0) {
        expectFail = true;
        if (Math.floor(Math.random() * 2) === 0) {
            console.log('Configuring primary DNS ip with wrong ip format');
            dnsString = `${DELETE}8,8.8.8${DOWN}${DELETE}\r`;
        } else {
            console.log('Configuring secondary DNS ip with wrong ip format');
            dnsString = `${DELETE}8.8.8.8${DOWN}${DELETE}8,8.4.4\r`;
            toExpect = '8.8.8.8';
        }
    } else if (configurePrimary && configureSecondary && reachablePrimaryDns && reachableSecondaryDns) {
        console.log('Configuring reachable Primary DNS with reachable Secondary DNS');
        dnsString = `${DELETE}8.8.8.8${DOWN}${DELETE}8.8.4.4\r`;
        toExpect = '8.8.8.8';
    } else if (configurePrimary && configureSecondary && !reachablePrimaryDns && !reachableSecondaryDns) {
        console.log('Configuring unreachable Primary DNS with unreachable Secondary DNS');
        dnsString = `${DELETE}1.1.1.1${DOWN}${DELETE}1.1.4.4\r`;
        toExpect = '1.1.1.1';
    } else if (configurePrimary && configureSecondary && !reachablePrimaryDns && reachableSecondaryDns) {
        console.log('Configuring unreachable Primary DNS with reachable Secondary DNS');
        dnsString = `${DELETE}1.1.1.1${DOWN}${DELETE}8.8.4.4\r`;
        toExpect = '1.1.1.1';
    } else if (configurePrimary && configureSecondary && reachablePrimaryDns && !reachableSecondaryDns) {
        console.log('Configuring reachable Primary DNS with unreachable Secondary DNS');
        dnsString = `${DELETE}8.8.8.8${DOWN}${DELETE}1.1.4.4\r`;
        toExpect = '8.8.8.8';
    } else if (configurePrimary && !configureSecondary && reachablePrimaryDns) {
        console.log('Configuring reachable Primary DNS without Secondary DNS');
        dnsString = `${DELETE}8.8.8.8${DOWN}${DELETE}\r`;
        toExpect = '8.8.8.8';
    } else if (configurePrimary && !configureSecondary && !reachablePrimaryDns) {
        console.log('Configuring unreachable Primary DNS without Secondary DNS');
        dnsString = `${DELETE}1.1.1.1${DOWN}${DELETE}\r`;
        toExpect = '1.1.1.1';
    } else if (!configurePrimary && configureSecondary && reachableSecondaryDns) {
        expectFail = true;
        console.log('Configuring reachable Secondary DNS without Primary DNS');
        dnsString = `${DELETE}${DOWN}8.8.8.8${DELETE}\r`;
    } else if (!configurePrimary && configureSecondary && !reachableSecondaryDns) {
        expectFail = true;
        console.log('Configuring unreachable Secondary DNS without Primary DNS');
        dnsString = `${DELETE}${DOWN}1.1.1.1${DELETE}\r`;
    } else {
        //making sure that we are not missing states... 
        console.log('Configuring reachable Primary DNS with reachable Secondary DNS');
        dnsString = `${DELETE}8.8.8.8${DOWN}${DELETE}8.8.4.4\r`;
        toExpect = '8.8.8.8';
    }

    return P.resolve()
        // the double -t -t is not a mistake! it is needed to force ssh to create a pseudo-tty eventhough stdin is a pipe
        .then(() => e.spawn('ssh', ['-t', '-t', `noobaa@${server_ip}`]))
        .then(() => expect_override_conf(e, 120 * 1000))
        .then(() => e.expect('This is a short first install wizard'))
        .then(() => e.send('\r'))
        .then(() => e.expect('Networking Configuration'))
        .then(() => e.send(`1\r`))
        .then(() => e.expect('DNS Settings'))
        .then(() => e.send(`2\r`))
        .then(() => e.expect('Please supply a primary and secondary DNS servers'))
        .then(() => e.send(`${dnsString}\r`))
        .delay(30 * 1000)
        .then(() => {
            if (expectFail) {
                return expect_an_error_and_get_back(e, 'DNS server is not valid', 120 * 1000);
            } else {
                return e.expect('DNS Settings', 120 * 1000)
                    .then(() => e.send(`2\r`))
                    .then(() => expect_a_resoult_and_get_back(e, toExpect, 120 * 1000));
            }
        })
        .then(() => e.expect('4*Exit'))
        .delay(1 * 1000)
        .then(() => e.send('4\r'))
        .delay(5 * 1000)
        .then(() => e.expect('6*Exit'))
        .delay(1 * 1000)
        .then(() => e.send('6\r'))
        .delay(5 * 1000)
        .then(() => e.expect('was configured and is ready to use'))
        .delay(1 * 1000)
        .then(() => e.send('\r'))
        .delay(5 * 1000)
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
    expectFail = false;
    if ((Math.floor(Math.random() * 2)) === 0) {
        hostname = 'noobaa-TUI';
    } else {
        expectFail = true;
        hostname = '';
    }

    return P.resolve()
        // the double -t -t is not a mistake! it is needed to force ssh to create a pseudo-tty eventhough stdin is a pipe
        .then(() => e.spawn('ssh', ['-t', '-t', `noobaa@${server_ip}`]))
        .then(() => expect_override_conf(e, 120 * 1000))
        .then(() => e.expect('This is a short first install wizard'))
        .then(() => e.send('\r'))
        .then(() => e.expect('Networking Configuration'))
        .delay(1 * 1000)
        .then(() => e.send(`1\r`))
        .then(() => e.expect('Hostname Settings'))
        .delay(1 * 1000)
        .then(() => e.send(`3\r`))
        .then(() => e.expect('Please supply a hostname for this'))
        .then(() => e.send(`${DELETE}${hostname}\r`))
        .delay(30 * 1000)
        .then(() => {
            if (expectFail) {
                return P.resolve();
            } else {
                // console.log('Verifing Hostname results');
                return e.expect('Hostname Settings')
                    .then(() => e.send(`3\r`))
                    .then(() => expect_a_resoult_and_get_back(e, hostname, 120 * 1000));
            }
        })
        .then(() => e.expect('4*Exit'))
        .delay(1 * 1000)
        .then(() => e.send('4\r'))
        .delay(5 * 1000)
        .then(() => e.expect('6*Exit'))
        .delay(1 * 1000)
        .then(() => e.send('6\r'))
        .delay(5 * 1000)
        .then(() => e.expect('was configured and is ready to use'))
        .delay(1 * 1000)
        .then(() => e.send('\r'))
        .delay(5 * 1000)
        .then(() => e.end())
        .catch(err => {
            console.error('FAILED', err);
            process.exit(1);
        });
}

function authenticate() {
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
        .then(() => rpc.disconnect_all());
}

return authenticate()
    .then(() => server_ops.set_first_install_mark(server_ip, secret))
    .then(() => server_ops.enable_nooba_login(server_ip, secret))
    //will loop twice, one with system and the other without.
    .then(() => promise_utils.loop(cycles, cycle => P.resolve()
        .then(() => {
            console.log(`${YELLOW}Starting cycle numer: ${cycle}${NC}`);
            if (cycle % 2 > 0) {
                console.log(`Running cycle without system`);
                // currently we are running only in azure. 
                // clea_ova does not delete /etc/first_install.mrk on platform other then esx
                // system is always consider started. 
                //isSystemStarted = false;
                return server_ops.clean_ova(server_ip, secret, true)
                    .then(() => server_ops.wait_server_recoonect(server_ip))
                    .then(() => {
                        rpc = api.new_rpc(`wss://${server_ip}:8443`);
                        client = rpc.new_client({});
                    });
            } else {
                console.log(`Running cycle with System pre-configured`);
                return P.resolve()
                    .then(() => {
                        rpc = api.new_rpc(`wss://${server_ip}:8443`);
                        client = rpc.new_client({});
                    })
                    .then(authenticate);
            }
        })
        //running the main flow
        .then(() => {
            const configureTZ = Boolean(Math.floor(Math.random() * 2));
            return ntp_Configuration(configureTZ, false)
                .then(() => ntp_Configuration(configureTZ))
                .then(ntp_Configuration)
                .then(() => {
                    const configurePrimary = Boolean(Math.floor(Math.random() * 2));
                    const configureSecondary = Boolean(Math.floor(Math.random() * 2));
                    const reachablePrimaryDns = Boolean(Math.floor(Math.random() * 2));
                    const reachableSecondaryDns = Boolean(Math.floor(Math.random() * 2));
                    return dns_Configuration(configurePrimary, configureSecondary, reachablePrimaryDns, reachableSecondaryDns);
                })
                .then(dns_Configuration)
                .then(hostname_Settings);
        })
        .then(() => {
            if (cycle % 2 > 0) {
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
