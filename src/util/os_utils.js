/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const os = require('os');
const fs = require('fs');
const ps = require('ps-node');
const util = require('util');
const path = require('path');
const moment = require('moment-timezone');
const node_df = require('node-df');
const blockutils = require('linux-blockutils');
const child_process = require('child_process');
const ip_module = require('ip');

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const dotenv = require('./dotenv');
const config = require('../../config.js');
const fs_utils = require('./fs_utils');
const net_utils = require('./net_utils');
const kube_utils = require('./kube_utils');
const os_detailed_info = require('getos');
const { get_default_ports } = require('../util/addr_utils');

const AZURE_TMP_DISK_README = 'DATALOSS_WARNING_README.txt';
const ADMIN_WIN_USERS = Object.freeze([
    'NT AUTHORITY\\SYSTEM',
    'BUILTIN\\Administrators'
]);

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const IS_DOCKER = process.env.container === 'docker';
const IS_LINUX_VM = IS_LINUX && !IS_DOCKER;
//TEST_CONTAINER is env variable that is being set by the tests.Dockerfile
const IS_TEST_CONTAINER = process.env.TEST_CONTAINER;

if (!process.env.PLATFORM) {
    console.log('loading .env file...');
    dotenv.load();
}

const exec_async = util.promisify(child_process.exec);
// const fork_async = util.promisify(child_process.fork);
// const spawn_async = util.promisify(child_process.spawn);

/**
 * @param {string} command
 * @param {{
 *  timeout?: number,
 *  ignore_rc?: boolean,
 *  return_stdout?: boolean,
 *  trim_stdout?: boolean,
 * }} [options]
 */
async function exec(command, options) {
    const timeout_ms = (options && options.timeout) || 0;
    const ignore_rc = (options && options.ignore_rc) || false;
    const return_stdout = (options && options.return_stdout) || false;
    const trim_stdout = (options && options.trim_stdout) || false;
    try {
        dbg.log2('promise exec', command, ignore_rc);
        const res = await exec_async(command, {
            maxBuffer: 5000 * 1024, //5MB, should be enough
            timeout: timeout_ms,
        });
        if (return_stdout) {
            return trim_stdout ? res.stdout.trim() : res.stdout;
        }
    } catch (err) {
        if (ignore_rc) {
            dbg.warn(`${command} exited with error ${err} and ignored`);
        } else {
            throw err;
        }
    }
}

/*
 * Run a node child process spawn wrapped by a promise
 */
function fork(command, input_args, opts, ignore_rc) {
    return new Promise((resolve, reject) => {
        let options = opts || {};
        let args = input_args || [];
        dbg.log0('fork:', command, args.join(' '), options, ignore_rc);
        options.stdio = options.stdio || 'inherit';
        var proc = child_process.fork(command, args, options);
        proc.on('exit', code => {
            if (code === 0 || ignore_rc) {
                resolve();
            } else {
                const err = new Error('fork "' +
                    command + ' ' + args.join(' ') +
                    '" exit with error code ' + code);
                Object.assign(err, { code });
                reject(err);
            }
        });
        proc.on('error', error => {
            if (ignore_rc) {
                dbg.warn('fork ' +
                    command + ' ' + args.join(' ') +
                    ' exited with error ' + error +
                    ' and ignored');
                resolve();
            } else {
                reject(new Error('fork ' +
                    command + ' ' + args.join(' ') +
                    ' exited with error ' + error));
            }
        });
    });
}

/*
 * Run child process spawn wrapped by a promise
 */
function spawn(command, args, options, ignore_rc, unref, timeout_ms) {
    return new Promise((resolve, reject) => {
        options = options || {};
        args = args || [];
        dbg.log0('spawn:', command, args.join(' '), options, ignore_rc);
        options.stdio = options.stdio || 'inherit';
        var proc = child_process.spawn(command, args, options);
        proc.on('exit', code => {
            if (code === 0 || ignore_rc) {
                resolve();
            } else {
                reject(new Error('spawn "' +
                    command + ' ' + args.join(' ') +
                    '" exit with error code ' + code));
            }
        });
        proc.on('error', error => {
            if (ignore_rc) {
                dbg.warn('spawn ' +
                    command + ' ' + args.join(' ') +
                    ' exited with error ' + error +
                    ' and ignored');
                resolve();
            } else {
                reject(new Error('spawn ' +
                    command + ' ' + args.join(' ') +
                    ' exited with error ' + error));
            }
        });
        if (timeout_ms) {
            setTimeout(() => {
                const pid = proc.pid;
                proc.kill();
                reject(new Error(`Timeout: Execution of ${command + args.join(' ')} took longer than ${timeout_ms} ms. killed process (${pid})`));
            }, timeout_ms);
        }
        if (unref) proc.unref();
    });
}


function os_info() {

    //Convert X.Y eth name style to X-Y as mongo doesn't accept . in it's keys
    var orig_ifaces = os.networkInterfaces();
    var interfaces = _.clone(orig_ifaces);

    _.each(orig_ifaces, function(iface, name) {
        if (name.indexOf('.') !== -1) {
            var new_name = name.replace(/\./g, '-');
            interfaces[new_name] = iface;
            delete interfaces[name];
        }
    });
    return P.resolve()
        .then(() => _calculate_free_mem())
        .then(free_mem => ({
            hostname: os.hostname(),
            ostype: os.type(),
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
            uptime: Date.now() - Math.floor(1000 * os.uptime()),
            loadavg: os.loadavg(),
            totalmem: config.CONTAINER_MEM_LIMIT,
            freemem: free_mem,
            cpus: os.cpus(),
            networkInterfaces: interfaces
        }));
}

function _calculate_free_mem() {
    let res = os.freemem();
    const KB_TO_BYTE = 1024;
    if (!IS_MAC) {
        return P.resolve()
            // get OS cached mem
            .then(() => _exec_and_extract_num('cat /proc/meminfo | grep Buffers', 'Buffers:')
                .then(buffers_mem_in_kb => {
                    res += (buffers_mem_in_kb * KB_TO_BYTE);
                }))
            .then(() => _exec_and_extract_num('cat /proc/meminfo | grep Cached | grep -v SwapCached', 'Cached:')
                .then(cached_mem_in_kb => {
                    res += (cached_mem_in_kb * KB_TO_BYTE);
                }))
            .then(() => res);
    }
    return res;
}

async function _exec_and_extract_num(command, regex_line) {
    const regex = new RegExp(regex_line + '[\\s]*([\\d]*)[\\s]');
    const res = await exec(command, {
        ignore_rc: true,
        return_stdout: true,
    });
    const regex_res = regex.exec(res);
    return (regex_res && regex_res[1] && parseInt(regex_res[1], 10)) || 0;
}

function read_drives() {
    if (IS_DOCKER) {
        return read_kubernetes_agent_drives();
    } else {
        return read_mac_linux_drives();
    }
}

function get_agent_platform_path() {
    return IS_DOCKER ? '/noobaa_storage/' : './';
}

function get_raw_storage() {
    // on containered environments the disk name is not consistent, just return the root mount size.
    //later on we want to change it to return the size of the persistent volume mount
    if (IS_LINUX_VM) {
        return P.fromCallback(callback => blockutils.getBlockInfo({}, callback))
            .then(res => _.find(res, function(disk) {
                let expected_name;
                switch (process.env.PLATFORM) {
                    case 'alyun':
                        expected_name = 'vda';
                        break;
                    case 'aws':
                        expected_name = 'xvda';
                        break;
                    default:
                        expected_name = 'sda';
                }
                return disk.NAME === expected_name;
            }))
            .then(disk => parseInt(disk.SIZE, 10));
    } else {
        return read_drives()
            .then(drives => {
                let root = drives.find(drive => drive.mount === '/');
                if (root) {
                    return root.storage.total;
                } else {
                    return 0;
                }
            });
    }
}

function get_main_drive_name() {
    return '/';
}

function get_distro() {
    if (IS_MAC) {
        return P.resolve('OSX - Darwin');
    }
    return P.fromCallback(callback => os_detailed_info(callback))
        .then(distro => {
            let res = '';
            if (distro && distro.dist) {
                res = distro.dist;
                if (distro.release) res += ` ${distro.release}`;
                if (distro.codename) res += ` (${distro.codename})`;
            }
            if (!res) throw new Error('unknown distro');
            return res;
        });
}

// calculate cpu)
function calc_cpu_usage(current_cpus, previous_cpus) {
    previous_cpus = previous_cpus || [{ times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0, } }];
    let previous_cpus_reduced = previous_cpus.map(cpu => cpu.times).reduce((prev, curr) => ({
        user: prev.user + curr.user,
        nice: prev.nice + curr.nice,
        sys: prev.sys + curr.sys,
        idle: prev.idle + curr.idle,
        irq: prev.irq + curr.irq
    }));
    // sum current cpus, and subtract the sum of previous cpus (take negative of prev_sum as initial val)
    let current_cpus_reduced = current_cpus.map(cpu => cpu.times).reduce((prev, curr) => ({
            user: prev.user + curr.user,
            nice: prev.nice + curr.nice,
            sys: prev.sys + curr.sys,
            idle: prev.idle + curr.idle,
            irq: prev.irq + curr.irq
        }),
        _.mapValues(previous_cpus_reduced, val => (-1) * val));
    let total = _.reduce(current_cpus_reduced, (a, b) => a + b);
    let usage = 1 - (current_cpus_reduced.idle / total); // return the time not in idle

    return usage;
}


function get_disk_mount_points() {
    return read_drives()
        .then(drives => remove_linux_readonly_drives(drives))
        .then(function(drives) {
            dbg.log0('drives:', drives, ' current location ', process.cwd());
            if (IS_DOCKER) {
                const storage_drives = _.filter(drives, drive => drive.mount === '/noobaa_storage');
                if (storage_drives.length) return storage_drives;
            }
            return _.filter(drives, drive => {
                const { mount, drive_id } = drive;
                if (IS_DOCKER && mount !== '/') return false;
                const is_linux_drive =
                    (mount === '/') ||
                    (mount.startsWith('/') && drive_id.startsWith('/dev/'));
                const exclude_drive =
                    mount.includes('/Volumes/') ||
                    mount.startsWith('/etc/') ||
                    mount.startsWith('/boot') ||
                    mount.startsWith('/private/') || // mac
                    drive_id.includes('by-uuid');
                if (is_linux_drive && !exclude_drive) {
                    // TODO GUY appending noobaa_storage is bizarr in this generic context
                    drive.mount = path.join(mount, 'noobaa_storage');
                    dbg.log0('Found relevant volume', drive_id);
                    return true;
                }
            });
        });
}


function get_mount_of_path(file_path) {
    console.log('get_mount_of_path');
    return P.fromCallback(callback => node_df({
            file: file_path
        }, callback))
        .then(function(drives) {
            return drives && drives[0] && drives[0].mount;
        });
}


async function get_block_device_sizes() {
    const block_devices = await P.fromCallback(cb => blockutils.getBlockInfo({}, cb));
    if (!block_devices) return [];

    return block_devices.reduce((res, bd) => {
        res[`/dev/${bd.NAME}`] = Number(bd.SIZE);
        return res;
    }, {});
}

async function get_drive_of_path(file_path) {
    const volumes = await P.fromCallback(callback => node_df({ file: file_path }, callback));
    const vol = volumes && volumes[0];
    if (vol) {
        const size_by_bd = await get_block_device_sizes();
        return linux_volume_to_drive(vol, size_by_bd);
    }
}


function remove_linux_readonly_drives(volumes) {
    if (IS_MAC) return volumes;
    // grep command to get read only filesystems from /proc/mount
    let grep_command = 'grep "\\sro[\\s,]" /proc/mounts';
    return exec(grep_command, {
            ignore_rc: true,
            return_stdout: true,
        })
        .then(grep_res => {
            let ro_drives = grep_res.split('\n').map(drive => drive.split(' ')[0]);
            // only use volumes that are not one of the ro_drives.
            let ret_vols = volumes.filter(vol => ro_drives.indexOf(vol.drive_id) === -1);
            return ret_vols;
        });
}

async function read_mac_linux_drives() {
    const volumes = await P.fromCallback(callback => node_df({
        // this is a hack to make node_df append the -l flag to the df command
        // in order to get only local file systems.
        file: '-l'
    }, callback));

    if (!volumes) {
        return [];
    }

    let size_by_bd;
    if (IS_LINUX) {
        size_by_bd = await get_block_device_sizes();
    }
    return _.compact(await Promise.all(volumes.map(async vol => {
        try {
            await fs_utils.file_must_not_exist(vol.mount + '/' + AZURE_TMP_DISK_README);
            return linux_volume_to_drive(vol, size_by_bd);

        } catch (_unused_) {
            dbg.log0('Skipping drive', vol, 'Azure tmp disk indicated');
            return linux_volume_to_drive(vol, size_by_bd, true);
        }
    })));
}

async function read_kubernetes_agent_drives() {
    const volumes = await P.fromCallback(cb => node_df({
        // this is a hack to make node_df append the -l flag to the df command
        // in order to get only local file systems.
        file: '-a'
    }, cb));

    const size_by_bd = await get_block_device_sizes();
    return _.compact(volumes.map(vol =>
        linux_volume_to_drive(vol, size_by_bd)
    ));
}

function linux_volume_to_drive(vol, size_by_bd, skip) {
    return _.omitBy({
        mount: vol.mount,
        drive_id: vol.filesystem,
        storage: {
            total: (size_by_bd && size_by_bd[vol.filesystem]) || (vol.size * 1024),
            free: vol.available * 1024,
        },
        temporary_drive: skip
    }, _.isUndefined);
}

function top_single(dst) {
    var file_redirect = dst ? ' &> ' + dst : '';
    if (IS_MAC) {
        return exec('top -c -l 1' + file_redirect);
    } else if (IS_LINUX) {
        return exec('COLUMNS=512 top -c -b -n 1' + file_redirect);
    } else {
        throw new Error('top_single ' + os.type + ' not supported');
    }
}

function slabtop(dst) {
    const file_redirect = dst ? ' &> ' + dst : '';
    if (IS_LINUX) {
        return exec('slabtop -o' + file_redirect);
    } else {
        return P.resolve();
    }
}

function _get_dns_servers_in_forwarders_file() {
    return P.resolve()
        .then(() => {
            if (!IS_LINUX_VM) return [];
            return fs_utils.find_line_in_file(config.NAMED_DEFAULTS.FORWARDERS_OPTION_FILE, 'forwarders')
                .then(line => {
                    if (!line) return [];
                    const dns_servers = line.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g);
                    return dns_servers || [];
                });
        });
}

function get_dns_config() {
    // return dns configuration set in /etc/sysconfig/network
    return _get_dns_servers_in_forwarders_file()
        .then(dns => ({ dns_servers: dns }));
}

function set_dns_config(dns_servers) {
    return P.resolve()
        .then(() => {
            if (!IS_LINUX) return;
            return P.resolve(_set_dns_server(dns_servers));
        });
}

function _set_dns_server(servers) {
    if (!servers) return;
    if (IS_DOCKER) return;
    const forwarders_str = (servers.length ? `forwarders { ${servers.join('; ')}; };` : `forwarders { };`) + '\nforward only;\n';
    dbg.log0('setting dns servers in named forwarders configuration');
    dbg.log0('writing', forwarders_str, 'to', config.NAMED_DEFAULTS.FORWARDERS_OPTION_FILE);
    return fs_utils.replace_file(config.NAMED_DEFAULTS.FORWARDERS_OPTION_FILE, forwarders_str)
        .then(() => {
            // perform named restart in the background
            exec('systemctl restart named')
                .then(() => dbg.log0('successfully restarted named after setting dns servers to', servers))
                .catch(err => dbg.error('failed on systemctl restart named when setting dns servers to', servers, err));
        });
}

function get_time_config() {
    var reply = {
        srv_time: 0,
        timezone: '',
        status: false
    };
    reply.status = true;
    return exec('ls -l /etc/localtime', {
            ignore_rc: false,
            return_stdout: true,
        })
        .then(tzone => {
            var symlink = tzone.split('>')[1].split('/zoneinfo/')[1].trim();
            reply.srv_time = moment().tz(symlink)
                .format();
            reply.timezone = symlink;
            return reply;
        });
}

function get_local_ipv4_ips() {
    var ifaces = os.networkInterfaces();
    var ips = [];
    _.each(ifaces, function(iface) {
        _.each(iface, function(ifname) {
            //Don't count non IPv4 or Internals
            if (ifname.family !== 'IPv4' ||
                ifname.internal !== false) {
                return;
            }
            ips.push(ifname.address);
        });
    });
    return ips;
}

function get_networking_info() {
    var ifaces = os.networkInterfaces();
    return ifaces;
}

function is_folder_permissions_set(current_path) {
    let administrators_has_inheritance = false;
    let system_has_full_control = false;
    let found_other_permissions = false;
    return exec(`icacls ${current_path}`, {
            ignore_rc: false,
            return_stdout: true
        })
        .then(acl_response => {
            dbg.log0('is_folder_permissions_set called with:', acl_response, current_path);
            const path_removed = acl_response.replace(current_path, '');
            const cut_index = path_removed.indexOf('Successfully processed');
            if (cut_index < 0) {
                return false;
            }
            const omited_response = path_removed.substring(0, cut_index);
            return omited_response.split('\n')
                .forEach(line => {
                    const [user, permissions = ''] = line.trim().split(':');
                    if (user === ADMIN_WIN_USERS[1]) { // Administrators
                        if (permissions.includes('(F)') &&
                            permissions.includes('(OI)') &&
                            permissions.includes('(CI)')) {
                            administrators_has_inheritance = true;
                        } else if (!permissions.includes('(F)')) {
                            found_other_permissions = true;
                        }
                    } else if (user === ADMIN_WIN_USERS[0]) { // SYSTEM
                        if (permissions.includes('(F)')) {
                            system_has_full_control = true;
                        } else {
                            found_other_permissions = true;
                        }
                    } else if (user !== '') {
                        found_other_permissions = true;
                    }
                });
        })
        .then(() => {
            dbg.log1('is_folder_permissions_set: System has FC:', system_has_full_control,
                ', Administrators is FC with inheritance:', administrators_has_inheritance,
                ', No Other user with permissions:', !found_other_permissions);
            return system_has_full_control && administrators_has_inheritance && !found_other_permissions;
        });
}

function read_server_secret() {
    if (process.env.SERVER_SECRET) {
        return process.env.SERVER_SECRET;
    } else {
        // in kubernetes we must have SERVER_SECRET loaded from a kubernetes secret
        if (process.env.CONTAINER_PLATFORM === 'KUBERNETES') {
            throw new Error('SERVER_SECRET env variable not found. it must exist when running in kubernetes');
        }
        // for all non kubernetes platforms (docker, local, etc.) return a dummy secret
        return '12345678';
    }
}

function is_supervised_env() {
    if (IS_LINUX && !IS_TEST_CONTAINER) {
        return true;
    }
    return false;
}

// returns the ppid of the first process that matches the command
async function get_process_parent_pid(proc) {
    const ps_info = await P.fromCallback(callback => ps.lookup({ command: proc }, callback)) || [];
    return ps_info[0] && ps_info[0].ppid;
}

async function get_services_ps_info(services) {
    try {
        // look for the service name in "arguments" and not "command".
        // for node services the command is node, and for mongo_wrapper it's bash
        const ps_data = await P.map_with_concurrency(1, services, async srv => {
            const ps_info = await P.fromCallback(callback => ps.lookup({
                arguments: srv,
                psargs: '-elf'
            }, callback));
            ps_info.forEach(info => {
                info.srv = srv;
            });
            return ps_info;
        });
        return _.groupBy(_.flatten(ps_data), 'srv');
    } catch (err) {
        dbg.error('got error on get_services_ps_info:', err);
        throw err;
    }
}

function restart_noobaa_services() {
    if (!IS_LINUX) {
        return;
    }

    dbg.warn('RESTARTING SERVICES!!!', (new Error()).stack);

    var fname = '/tmp/spawn.log';
    var stdout = fs.openSync(fname, 'a');
    var stderr = fs.openSync(fname, 'a');
    spawn('nohup', [
        '/usr/bin/supervisorctl',
        'restart',
        'webserver bg_workers hosted_agents s3rver'
    ], {
        detached: true,
        stdio: ['ignore', stdout, stderr],
        cwd: '/usr/bin/'
    });
}

function set_hostname(hostname) {
    if (!IS_LINUX) {
        return P.resolve();
    }

    return exec(`hostname ${hostname}`)
        .then(() => exec(`sed -i "s/^HOSTNAME=.*/HOSTNAME=${hostname}/g" /etc/sysconfig/network`)); // keep it permanent
}

function is_valid_hostname(hostname_string) {
    const hostname_regex = /^(([a-zA-Z]|[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9])\.)*([A-Za-z]|[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9])$/;
    return Boolean(hostname_regex.exec(hostname_string));
}


function is_port_range_open_in_firewall(dest_ips, start_port, end_port) {
    return P.resolve()
        .then(() => {
            if (IS_LINUX) {
                return _check_ports_on_linux(dest_ips, start_port, end_port);
            }
            return true;
        })
        .catch(err => {
            dbg.error('got error on is_port_range_open_in_firewall', err);
            return true;
        });
}


function _check_ports_on_linux(dest_ips, start_port, end_port) {
    // get iptables rules and check port range against it.
    return get_distro()
        .then(distro => {
            // for now skip centos 7 since it is not using iptables
            if (distro.startsWith('Centos 7')) return [];
            return get_iptables_rules();
        })
        .then(rules => {
            const filtered_rules = rules.filter(rule => {
                if (
                    // filter out rules on loopback interface
                    rule.in === 'lo' ||

                    // remove reject rules on specific interfaces, since we don't know on which interface
                    // we will receive packets. we prefer to not give false positive (on firewall blocking)
                    (rule.target === 'REJECT' && rule.in !== '*') ||

                    // filter out rules that are not relevant for the given ips.
                    // TODO: this is not a perfect solution. the real solution should be to get both the
                    // interface name and address, and check for match on both. we still do not know on
                    // what interface the traffic is coming so it's still need to be resolved
                    dest_ips.every(dest_ip => !ip_module.cidrSubnet(rule.dst).contains(dest_ip)) ||

                    // filter non tcp rules
                    (rule.protocol !== 'tcp' && rule.protocol !== 'all') ||

                    // filter out rules that are not relevant to new connections
                    !rule.new_connection

                ) {
                    return false;
                }
                // otherwise return true
                return true;
            });
            if (!filtered_rules.length) {
                return true;
            }

            let ports_groups = _.groupBy(_.range(start_port, end_port + 1), port => {
                // go over all relevant rules, and look for the first matching rule (maybe partial match)
                for (const rule of filtered_rules) {
                    if (port >= rule.start_port && port <= rule.end_port) {
                        // the rule matches some of the range. return if accept or reject
                        return rule.allow ? 'allowed' : 'blocked';
                    }
                }
                return 'allowed';
            });
            dbg.log0(`is_port_range_open_in_firewall: checked range [${start_port}, ${end_port}]:`, ports_groups);
            // for now if any port in the range is blocked, return false
            return _.isUndefined(ports_groups.blocked);
        });
}

function get_iptables_rules() {
    if (!IS_LINUX) {
        return P.resolve([]);
    }
    const iptables_command = 'iptables -L INPUT -nv';
    return exec(iptables_command, {
            ignore_rc: false,
            return_stdout: true,
            timeout: 10000
        })
        .then(output => {
            // split output to lines, and remove first two lines (title lines) and empty lines
            let raw_rules = output.split('\n')
                .slice(2)
                .filter(line => Boolean(line.length));
            return raw_rules.map(line => {
                line = line.trim();
                // split by spaces to different attributes, but limit to 9. the last attribute
                // can contain spaces, so we will extract it separately
                let attributes = line.split(/\s+/, 9);
                if (attributes.length !== 9) {
                    throw new Error('Failed parsing iptables output. expected split to return 9 fields');
                }
                // split again by the last attribute, and take the last element
                const last_attr = attributes[8];
                const last_attr_split = line.split(last_attr);
                const info = last_attr_split[last_attr_split.length - 1].trim();
                // get the port out of the additional information
                let start_port = 0; // default to 0
                let end_port = (2 ** 16) - 1; // default to max port value
                const dpt = 'dpt:';
                const dports = 'dports ';
                const dpt_index = info.indexOf(dpt);
                const dports_index = info.indexOf(dports);
                if (dpt_index !== -1) {
                    // cut info to start with the port number
                    const dpt_substr = info.substring(dpt_index + dpt.length);
                    start_port = parseInt(dpt_substr.split(' ')[0], 10);
                    end_port = start_port;
                } else if (dports_index > -1) {
                    // port range rule
                    const dports_substr = info.substring(dports_index + dports.length);
                    const ports_str = dports_substr.split(' ')[0];
                    const ports = ports_str.split(':');
                    start_port = parseInt(ports[0], 10);
                    if (ports.length === 2) {
                        end_port = parseInt(ports[1], 10);
                    } else {
                        end_port = start_port;
                    }
                }
                // is the rule relevant for new connections
                const new_connection = info.indexOf('state ') === -1 || info.indexOf('NEW') > -1;
                return {
                    allow: attributes[2] === 'ACCEPT',
                    protocol: attributes[3],
                    in: attributes[5],
                    src: attributes[7],
                    dst: attributes[8],
                    new_connection,
                    start_port,
                    end_port,
                };
            });
        })
        .catch(err => {
            dbg.error(`got error on get_iptables_rules:`, err);
            return [];
        });
}

async function discover_k8s_services(app = config.KUBE_APP_LABEL) {
    if (process.env.CONTAINER_PLATFORM !== 'KUBERNETES') {
        throw new Error('discover_k8s_services is only supported in kubernetes envs');
    }

    if (!app) {
        throw new Error(`Invalid app name, got: ${app}`);
    }


    let routes = [];
    try {
        routes = await _list_openshift_routes(`app=${app}`);
    } catch (err) {
        dbg.warn('discover_k8s_services: could not list OpenShift routes: ', err);
    }

    let services = [];
    try {
        const { items } = await kube_utils.list_resources('service', `app=${app}`);
        services = items;
    } catch (err) {
        dbg.warn('discover_k8s_services: could not list k8s services: ', err);
    }

    const list = _.flatMap(services, service_info => {
        const { metadata, spec = {}, status } = service_info;
        const { externalIPs = [] } = spec;
        const { ingress } = status.loadBalancer;
        const internal_hostname = `${metadata.name}.${metadata.namespace}.svc.cluster.local`;
        const external_hostnames = [
            ..._.flatMap(ingress, item => [item.ip, item.hostname].filter(Boolean)),
            ...externalIPs, // see: https://kubernetes.io/docs/concepts/services-networking/service/#external-ips
        ];

        const service_routes = routes
            .filter(route_info => {
                const { kind, name } = route_info.spec.to;
                return kind.toLowerCase() === 'service' && name === metadata.name;
            });

        return _.flatMap(spec.ports, port_info => {
            const routes_to_port = service_routes.filter(route_info =>
                route_info.spec.port.targetPort === port_info.name
            );

            const api = port_info.name
                .replace('-https', '')
                .replace(/-/g, '_');

            const defaults = {
                service: metadata.name,
                port: port_info.port,
                secure: port_info.name.endsWith('https'),
                api: api,
                weight: 0
            };

            return [{
                    ...defaults,
                    kind: 'INTERNAL',
                    hostname: internal_hostname,
                },
                ...external_hostnames.map(hostname => ({
                    ...defaults,
                    kind: 'EXTERNAL',
                    hostname,
                })),
                ...routes_to_port.map(route_info => ({
                    ...defaults,
                    kind: 'EXTERNAL',
                    hostname: route_info.spec.host,
                    port: route_info.spec.tls ? 443 : 80,
                    secure: Boolean(route_info.spec.tls),
                    weight: route_info.spec.to.weight
                }))
            ];
        });
    });

    return sort_address_list(list);
}

async function _list_openshift_routes(selector) {
    const has_route_crd = await kube_utils.api_exists('route.openshift.io');
    if (!has_route_crd) {
        return [];
    }

    const { items } = await kube_utils.list_resources('route', selector);
    return items;
}

async function discover_virtual_appliance_address(app = config.KUBE_APP_LABEL) {
    const public_ip = await net_utils.retrieve_public_ip();
    if (!public_ip || public_ip === ip_module.address()) {
        return [];
    }

    // Addr rpc services ports.
    const list = Object.entries(get_default_ports())
        .map(([api, port]) => ({
            kind: 'EXTERNAL',
            service: 'noobaa-mgmt',
            hostname: public_ip,
            port,
            api,
            secure: true,
            weight: 0
        }));

    return sort_address_list(list);
}

function sort_address_list(address_list) {
    const sort_fields = ['kind', 'service', 'hostname', 'port', 'api', 'secure', 'weight'];
    return address_list.sort((item, other) => {
        const item_key = sort_fields.map(field => item[field]).join();
        const other_key = sort_fields.map(field => other[field]).join();
        return (
            (item_key < other_key && -1) ||
            (item_key > other_key && 1) ||
            0
        );
    });
}

async function restart_services(services) {
    if (services) {
        if (services.length === 0) {
            return;
        }

        let status = '';
        try {
            status = await exec('supervisorctl status', { return_stdout: true });

        } catch (err) {
            console.error('restart_services: Could not list supervisor services');
            throw new Error('Could not list supervisor services');
        }

        const all_services = status
            .split('\n')
            .map(line => line.substr(0, line.indexOf(' ')).trim())
            .filter(Boolean);


        const unknown_services = services
            .filter(name => !all_services.includes(name));

        if (unknown_services.length > 0) {
            throw new Error(`restart_services: Unknown services ${unknown_services.join(', ')}`);
        }
    } else {
        services = ['all'];
    }

    try {
        dbg.log0(`restart_services: restarting noobaa services: ${services.join(', ')}`);
        await spawn('supervisorctl', ['restart', ...services], { detached: true }, false);
        await P.delay(5000);

    } catch (err) {
        const msg = `Failed to restart services: ${services.join(', ')}`;
        console.error(`restart_services: ${msg}`);
        throw new Error(msg);
    }
}


// EXPORTS
exports.IS_WIN = IS_WIN;
exports.IS_MAC = IS_MAC;
exports.IS_LINUX = IS_LINUX;
exports.exec = exec;
exports.fork = fork;
exports.spawn = spawn;
exports.os_info = os_info;
exports.read_drives = read_drives;
exports.get_raw_storage = get_raw_storage;
exports.remove_linux_readonly_drives = remove_linux_readonly_drives;
exports.get_main_drive_name = get_main_drive_name;
exports.get_mount_of_path = get_mount_of_path;
exports.get_drive_of_path = get_drive_of_path;
exports.top_single = top_single;
exports.slabtop = slabtop;
exports.get_time_config = get_time_config;
exports.get_local_ipv4_ips = get_local_ipv4_ips;
exports.get_networking_info = get_networking_info;
exports.read_server_secret = read_server_secret;
exports.is_supervised_env = is_supervised_env;
exports.is_folder_permissions_set = is_folder_permissions_set;
exports.set_dns_config = set_dns_config;
exports.get_dns_config = get_dns_config;
exports.restart_noobaa_services = restart_noobaa_services;
exports.set_hostname = set_hostname;
exports.is_valid_hostname = is_valid_hostname;
exports.get_disk_mount_points = get_disk_mount_points;
exports.get_distro = get_distro;
exports.calc_cpu_usage = calc_cpu_usage;
exports.is_port_range_open_in_firewall = is_port_range_open_in_firewall;
exports.get_iptables_rules = get_iptables_rules;
exports.get_services_ps_info = get_services_ps_info;
exports.get_process_parent_pid = get_process_parent_pid;
exports.get_agent_platform_path = get_agent_platform_path;
exports.discover_k8s_services = discover_k8s_services;
exports.discover_virtual_appliance_address = discover_virtual_appliance_address;
exports.restart_services = restart_services;
