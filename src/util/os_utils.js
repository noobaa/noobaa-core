/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const os = require('os');
const fs = require('fs');
const uuid = require('uuid/v4');
const moment = require('moment-timezone');
const node_df = require('node-df');
const blockutils = require('linux-blockutils');
var spawn = require('child_process').spawn;
const ip_module = require('ip');

const P = require('./promise');
const config = require('../../config.js');
const promise_utils = require('./promise_utils');
const fs_utils = require('./fs_utils');
const dbg = require('./debug_module')(__filename);
const os_detailed_info = require('getos');
const dotenv = require('./dotenv');

const AZURE_TMP_DISK_README = 'DATALOSS_WARNING_README.txt';
const ADMIN_WIN_USERS = Object.freeze([
    'NT AUTHORITY\\SYSTEM',
    'BUILTIN\\Administrators'
]);
if (!process.env.PLATFORM) {
    console.log('loading .env file...');
    dotenv.load();
}


if (!process.env.PLATFORM) {
    console.log('loading .env file...');
    dotenv.load();
}


function os_info(count_mongo_reserved_as_free) {

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
        .then(() => _calculate_free_mem(count_mongo_reserved_as_free))
        .then(free_mem => ({
            hostname: os.hostname(),
            ostype: os.type(),
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
            uptime: Date.now() - Math.floor(1000 * os.uptime()),
            loadavg: os.loadavg(),
            totalmem: os.totalmem(),
            freemem: free_mem,
            cpus: os.cpus(),
            networkInterfaces: interfaces
        }));
}

function _calculate_free_mem(count_mongo_reserved_as_free) {
    let res = os.freemem();
    const KB_TO_BYTE = 1024;
    if (os.type() !== 'Windows_NT' && os.type() !== 'Darwin') {
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
            // get mongod cached mem
            .then(() => count_mongo_reserved_as_free &&
                _exec_and_extract_num('ps -elf | grep mongod | grep -v grep', 'root')
                .then(pid => pid && _exec_and_extract_num(`cat /proc/${pid}/status | grep VmRSS`, 'VmRSS:')
                    .then(mongo_cached_mem => {
                        res += (mongo_cached_mem * KB_TO_BYTE);
                    })))
            .return(res);
    }
    return res;
}

function _exec_and_extract_num(command, regex_line) {
    const regex = new RegExp(regex_line + '[\\s]*([\\d]*)[\\s]');
    return promise_utils.exec(command, {
            ignore_rc: true,
            return_stdout: true,
        })
        .then(res => {
            const regex_res = regex.exec(res);
            return (regex_res && regex_res[1] && parseInt(regex_res[1], 10)) || 0;
        });
}

function read_drives() {
    if (os.type() === 'Windows_NT') {
        return read_windows_drives();
    } else {
        return read_mac_linux_drives();
    }
}

function get_raw_storage() {
    if (os.type() === 'Linux') {
        return P.fromCallback(callback => blockutils.getBlockInfo({}, callback))
            .then(res => _.find(res, function(disk) {
                let expected_name = 'sda';
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
    if (os.type() === 'Windows_NT') {
        return process.env.SystemDrive;
    } else {
        return '/';
    }
}

function get_distro() {
    if (os.type() === 'Darwin') {
        return P.resolve('OSX - Darwin');
    }
    if (os.type() === 'Windows_NT') {
        return P.resolve(`${os.type()} (${os.release()})`);
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
    // sum current cpus, and substract the sum of previous cpus (take negative of prev_sum as inital val)
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
            var hds = _.filter(drives, function(hd_info) {
                if ((hd_info.drive_id.indexOf('by-uuid') < 0 &&
                        hd_info.mount.indexOf('/etc/hosts') < 0 &&
                        (hd_info.drive_id.indexOf('/dev/') >= 0 || hd_info.mount === '/') &&
                        hd_info.mount.indexOf('/boot') < 0 &&
                        hd_info.mount.indexOf('/Volumes/') < 0) ||
                    (hd_info.drive_id.length === 2 &&
                        hd_info.drive_id.indexOf(':') === 1)) {
                    dbg.log0('Found relevant volume', hd_info.drive_id);
                    return true;
                }
            });

            var mount_points = [];

            if (os.type() === 'Windows_NT') {
                _.each(hds, function(hd_info) {
                    hd_info.mount += '\\noobaa_storage\\';
                    mount_points.push(hd_info);
                });
            } else if (os.type() === 'Darwin') {
                _.each(hds, function(hd_info) {
                    hd_info.mount = './noobaa_storage/';
                    mount_points.push(hd_info);
                });
            } else {
                _.each(hds, function(hd_info) {
                    if (hd_info.mount === "/") {
                        hd_info.mount = '/noobaa_storage/';
                        mount_points.push(hd_info);
                    } else {
                        hd_info.mount = '/' + hd_info.mount + '/noobaa_storage/';
                        mount_points.push(hd_info);
                    }
                });
            }

            dbg.log0('mount_points:', mount_points);
            return mount_points;
        });
}


function get_mount_of_path(path) {
    console.log('get_mount_of_path');

    if (os.type() === 'Windows_NT') {
        return fs.realpathAsync(path)
            .then(function(fullpath) {
                // fullpath[0] = drive letter (C, D, E, ..)
                // fullpath[1] = ':'
                return fullpath[0] + fullpath[1];
            });
    } else {
        return P.fromCallback(callback => node_df({
                file: path
            }, callback))
            .then(function(drives) {
                return drives && drives[0] && drives[0].mount;
            });
    }
}

function get_drive_of_path(path) {
    if (os.type() === 'Windows_NT') {
        return fs.realpathAsync(path)
            .then(function(fullpath) {
                const drive_letter = fullpath[0] + fullpath[1];
                return wmic('volume where DriveLetter="' + drive_letter + '"');
            })
            .then(volumes =>
                volumes &&
                volumes[0] &&
                windows_volume_to_drive(volumes[0]));
    } else {
        return P.fromCallback(callback => node_df({
                file: path
            }, callback))
            .then(volumes =>
                volumes &&
                volumes[0] &&
                linux_volume_to_drive(volumes[0]));
    }
}


function remove_linux_readonly_drives(volumes) {
    // grep command to get read only filesystems from /proc/mount
    let grep_command = 'grep "\\sro[\\s,]" /proc/mounts';
    return promise_utils.exec(grep_command, {
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


function read_mac_linux_drives(include_all) {
    return P.fromCallback(callback => node_df({
            // this is a hack to make node_df append the -l flag to the df command
            // in order to get only local file systems.
            file: '-l'
        }, callback))
        .then(volumes => P.all(_.map(volumes, function(vol) {
                return fs_utils.file_must_not_exist(vol.mount + '/' + AZURE_TMP_DISK_README)
                    .then(() => linux_volume_to_drive(vol))
                    .catch(() => {
                        dbg.log0('Skipping drive', vol, 'Azure tmp disk indicated');
                        return;
                    });
            }))
            .then(res => _.compact(res)));
}


function read_windows_drives() {
    var windows_drives = {};
    return wmic('volume')
        .then(function(volumes) {
            return _.compact(_.map(volumes, function(vol) {
                // drive type codes:
                // 0 = Unknown
                // 1 = No Root Directory
                // 2 = Removable Disk
                // 3 = Local Disk
                // 4 = Network Drive
                // 5 = Compact Disc
                // 6 = RAM Disk
                if (vol.DriveType !== '3') return;
                if (!vol.DriveLetter) return;
                //Azure temporary disk
                if (vol.Label.indexOf('Temporary Storage') === 0) return;
                return windows_volume_to_drive(vol);
            }));
        })
        .then(function(local_volumes) {
            windows_drives = local_volumes;
            return wmic('netuse')
                .then(function(network_volumes) {
                    var all_drives = {};
                    if (_.compact(network_volumes).length > 0) {

                        all_drives = _(windows_drives).concat(_.compact(_.map(network_volumes, function(network_vol) {
                            return {
                                mount: network_vol.RemotePath,
                                drive_id: network_vol.LocalName,
                                storage: {
                                    total: 0,
                                    free: 0,
                                }
                            };
                        })));
                        return all_drives.value();
                    } else {
                        return windows_drives;
                    }
                });
        });
}

function linux_volume_to_drive(vol) {
    return {
        mount: vol.mount,
        drive_id: vol.filesystem,
        storage: {
            total: vol.size * 1024,
            free: vol.available * 1024,
        }
    };
}

function windows_volume_to_drive(vol) {
    return {
        mount: vol.DriveLetter,
        drive_id: vol.DriveLetter,
        storage: {
            total: parseInt(vol.Capacity, 10),
            free: parseInt(vol.FreeSpace, 10),
        }
    };
}

function wmic(topic) {
    return promise_utils.exec('wmic ' + topic + ' get /value', {
            ignore_rc: false,
            return_stdout: true,
        })
        .then(function(res) {
            return wmic_parse_list(res);
        });
}

function wmic_parse_list(text) {
    // split by double eol -
    // we get two \r between the \n, so we tolerate any whitespace
    var list = text.trim().split(/\s*\n\s*\n\s*/);
    for (var i = 0; i < list.length; i++) {
        var item = list[i].trim();
        if (!item) continue;
        var lines = item.split('\n');
        var item_obj = {};
        for (var j = 0; j < lines.length; j++) {
            var line = lines[j].trim();
            if (!line) continue;
            var index = line.indexOf('=');
            if (index < 0) continue;
            var key = line.slice(0, index).trim();
            var val = line.slice(index + 1).trim();
            item_obj[key] = val;
        }
        // OEMLogoBitmap field is an encoded bitmap image - it's big and unwanted
        delete item_obj.OEMLogoBitmap;
        list[i] = item_obj;
    }
    return list;
}

function top_single(dst) {
    var file_redirect = dst ? ' &> ' + dst : '';
    if (os.type() === 'Darwin') {
        return promise_utils.exec('top -c -l 1' + file_redirect);
    } else if (os.type() === 'Linux') {
        return promise_utils.exec('COLUMNS=512 top -c -b -n 1' + file_redirect);
    } else if (os.type() === 'Windows_NT') {
        return P.resolve();
    } else {
        throw new Error('top_single ' + os.type + ' not supported');
    }
}

function slabtop(dst) {
    const file_redirect = dst ? ' &> ' + dst : '';
    if (os.type() === 'Linux') {
        return promise_utils.exec('slabtop -o' + file_redirect);
    } else {
        return P.resolve();
    }
}

function netstat_single(dst) {
    var file_redirect = dst ? ' &> ' + dst : '';
    if (os.type() === 'Darwin') {
        return promise_utils.exec('netstat -na' + file_redirect);
    } else if (os.type() === 'Windows_NT') {
        return promise_utils.exec('netstat -na >' + dst);
    } else if (os.type() === 'Linux') {
        return promise_utils.exec('netstat -nap' + file_redirect);
    } else {
        throw new Error('netstat_single ' + os.type + ' not supported');
    }
}

function ss_single(dst) {
    var file_redirect = dst ? ' &> ' + dst : '';
    return promise_utils.exec('ss -nap' + file_redirect);
}

function set_manual_time(time_epoch, timez) {
    if (os.type() === 'Linux') {
        return _set_time_zone(timez)
            .then(() => promise_utils.exec('systemctl disable ntpd.service'))
            .then(() => promise_utils.exec('systemctl stop ntpd.service'))
            .then(() => promise_utils.exec('date +%s -s @' + time_epoch))
            .then(() => restart_rsyslogd());
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return P.resolve();
    } else {
        throw new Error('setting time/date not supported on non-Linux platforms');
    }
}

function verify_ntp_server(srv) {
    return P.resolve()
        .then(() => {
            if (os.type() === 'Linux') {
                return promise_utils.exec(`ntpdate -q ${srv}`)
                    .then(() => _.noop)
                    .catch(err => {
                        dbg.warn(`Failed NTP verification for ${srv}`);
                        throw err;
                    });
            } else {
                dbg.log0('Not supporting verification of NTP on non-Linux systems');
            }
        });
}

function get_ntp() {
    if (os.type() === 'Linux') {
        return promise_utils.exec("cat /etc/ntp.conf | grep NooBaa", {
                ignore_rc: false,
                return_stdout: true,
            })
            .then(res => {
                let regex_res = (/server (.*) iburst #NooBaa Configured NTP Server/).exec(res);
                return regex_res ? regex_res[1] : "";
            });
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return P.resolve();
    }
    throw new Error('NTP not supported on non-Linux platforms');
}

function set_ntp(server, timez) {
    if (os.type() === 'Linux') {
        var command = "sed -i 's/.*NooBaa Configured NTP Server.*/server " + server +
            " iburst #NooBaa Configured NTP Server/' /etc/ntp.conf";
        return _set_time_zone(timez)
            .then(() => promise_utils.exec(command))
            .then(() => promise_utils.exec('/sbin/chkconfig ntpd on 2345'))
            .then(() => promise_utils.exec('systemctl restart ntpd.service'))
            .then(() => restart_rsyslogd());
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return P.resolve();
    } else {
        throw new Error('setting NTP not supported on non-Linux platforms');
    }
}

function get_yum_proxy() {
    if (os.type() === 'Linux') {
        return promise_utils.exec("cat /etc/yum.conf | grep NooBaa", {
                ignore_rc: false,
                return_stdout: true,
            })
            .then(res => {
                let regex_res = (/proxy=(.*) #NooBaa Configured Proxy Server/).exec(res);
                return regex_res ? regex_res[1] : "";
            });
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return P.resolve();
    }
    throw new Error('Yum proxy not supported on non-Linux platforms');
}

function set_yum_proxy(proxy_url) {
    var command = "sed -i 's/.*NooBaa Configured Proxy Server.*/#NooBaa Configured Proxy Server/' /etc/yum.conf";
    if (os.type() === 'Linux') {
        if (!_.isEmpty(proxy_url)) {
            command = "sed -i 's/.*NooBaa Configured Proxy Server.*/proxy=" + proxy_url.replace(/\//g, '\\/') +
                " #NooBaa Configured Proxy Server/' /etc/yum.conf";
        }
        return promise_utils.exec(command);
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return P.resolve();
    } else {
        throw new Error('setting yum proxy not supported on non-Linux platforms');
    }
}


//
function _get_dns_servers_in_forwarders_file() {
    return P.resolve()
        .then(() => {
            if (os.type() !== 'Linux') return [];
            return fs_utils.find_line_in_file(config.NAMED_DEFAULTS.FORWARDERS_OPTION_FILE, 'forwarders')
                .then(line => {
                    if (!line) return [];
                    const dns_servers = line.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g);
                    return dns_servers || [];
                });
        });
}


function _get_search_domains(file, options) {
    return P.resolve()
        .then(() => {
            if (os.type() !== 'Linux') return [];
            const { dhcp } = options || {};
            if (dhcp) {
                // for dhcp configuration we look for "#NooBaa Configured Search"
                return fs_utils.find_line_in_file(file, '#NooBaa Configured Search')
                    .then(line => {
                        if (!line) return [];
                        let domains_regx_res = line.match(/".*?"/g);
                        // if null return empty array
                        if (!domains_regx_res) return [];
                        // remove double quotes from the strings
                        return domains_regx_res.map(domain => domain.replace(/"/g, ''));
                    });
            } else {
                // in static ip configuration files we look for "DOMAIN=" as a marker
                return fs_utils.find_line_in_file(file, 'DOMAIN=')
                    .then(line => {
                        if (!line) return [];
                        const domains_str = line.split('"')[1];
                        if (!domains_str) return [];
                        return domains_str.split(' ');
                    });
            }
        });
}

function get_dns_and_search_domains() {
    // return dns configuration set in /etc/sysconfig/network
    return P.join(_get_dns_servers_in_forwarders_file(), _get_search_domains('/etc/sysconfig/network'))
        .spread((dns_servers, search_domains) => ({ dns_servers, search_domains }));
}

function ensure_dns_and_search_domains(server_config) {
    const ensure_dns = _get_dns_servers_in_forwarders_file()
        .then(dns_servers => {
            // compare dns in server_config to the one written in forwarders file
            if (!_.isEqual(dns_servers, server_config.dns_servers)) {
                dbg.warn(`ensure_dns_and_search_domains: found mismatch in dns servers. db has`,
                    server_config.dns_servers,
                    `${config.NAMED_DEFAULTS.FORWARDERS_OPTION_FILE} has`, dns_servers,
                    `resetting according to db`);
                return _set_dns_server(server_config.dns_servers);
            }
        });

    const static_search_domain_files = Object.keys(os.networkInterfaces())
        .filter(nic => nic.startsWith('eth'))
        .map(nic => '/etc/sysconfig/network-scripts/ifcfg-' + nic);

    const ensure_search_domains = P.join(
            P.map(static_search_domain_files, file => _get_search_domains(file)
                .then(search_domains => ({ search_domains, file }))),
            _get_search_domains('/etc/dhclient.conf', { dhcp: true })
            .then(search_domains => ({ search_domains, file: '/etc/dhclient.conf' }))
        )
        .spread((static_domains, dhcp_domains) => {
            const domain_configs = static_domains.concat(dhcp_domains);
            const invalid_config = domain_configs.find(conf => !_.isEqual(conf.search_domains, server_config.search_domains));
            if (invalid_config) {
                dbg.warn(`found mismatch in search domains. db has`, server_config.search_domains,
                    `${invalid_config.file} has `, invalid_config.search_domains, ' resetting according to db');
                return _set_search_domains(server_config.search_domains);
            }
        });

    return P.join(ensure_dns, ensure_search_domains);
}

function set_dns_and_search_domains(dns_servers, search_domains) {
    return P.resolve()
        .then(() => {
            if (os.type() !== 'Linux') return;
            return P.join(_set_dns_server(dns_servers), _set_search_domains(search_domains));
        });
}

function _set_dns_server(servers) {
    if (!servers) return;
    const forwarders_str = (servers.length ? `forwarders { ${servers.join('; ')}; };` : `forwarders { };`) + '\nforward only;\n';
    dbg.log0('setting dns servers in named forwarders configuration');
    dbg.log0('writing', forwarders_str, 'to', config.NAMED_DEFAULTS.FORWARDERS_OPTION_FILE);
    return fs_utils.replace_file(config.NAMED_DEFAULTS.FORWARDERS_OPTION_FILE, forwarders_str)
        .then(() => {
            // perform named restart in the background
            promise_utils.exec('systemctl restart named')
                .then(() => dbg.log0('successfully restarted named after setting dns servers to', servers))
                .catch(err => dbg.error('failed on systemctl restart named when setting dns servers to', servers, err));
        });
}


function _set_search_domains(search_domains) {
    if (!search_domains) return;

    dbg.log0(`_set_search_domains: got these search domais to set:`, search_domains);

    const commands_to_exec = [];

    // prepare command for setting search domains in dhclient
    if (search_domains.length) {
        commands_to_exec.push(`sed -i 's/.*#NooBaa Configured Search.*/prepend domain-search "${search_domains.join('", "')}";\
        #NooBaa Configured Search/' /etc/dhclient.conf`);
    } else {
        commands_to_exec.push(`sed -i 's/.*#NooBaa Configured Search.*/#NooBaa Configured Search/' /etc/dhclient.conf`);
    }

    // prepare command for setting search domains in network configuration scripts
    // updating /etc/sysconfig/network does not propagate to resolve.conf, but writing to ifcfg files does
    // we will write to all of them including /etc/sysconfig/network
    let domain_command = `sed -i 's/DOMAIN=.*/DOMAIN="${search_domains.join(' ')}"/' `;

    const network_scripts_files = Object.keys(os.networkInterfaces())
        .filter(nic => nic.startsWith('eth'))
        .map(nic => '/etc/sysconfig/network-scripts/ifcfg-' + nic)
        .concat('/etc/sysconfig/network');

    dbg.log0(`setting search domains in the following files:`, network_scripts_files);
    network_scripts_files.forEach(file => commands_to_exec.push(domain_command + file));

    return P.map(commands_to_exec, command => promise_utils.exec(command), { concurrency: 5 })
        .then(() => {
            // perform network restart in the background
            promise_utils.exec('systemctl restart network')
                .then(() => dbg.log0('successfully restarted network after setting search domains to', search_domains))
                .catch(err => dbg.error('failed on systemctl restart network when setting search domains to', search_domains, err));
        });
}


function restart_rsyslogd() {
    return promise_utils.exec('/etc/init.d/rsyslog restart');
}

function get_time_config() {
    var reply = {
        srv_time: 0,
        timezone: '',
        status: false
    };

    if (os.type() === 'Linux') {
        return promise_utils.exec('/usr/bin/ntpstat | head -1', {
                ignore_rc: false,
                return_stdout: true,
            })
            .then(res => {
                if (res.indexOf('synchronized to') !== -1) {
                    reply.status = true;
                }
                return promise_utils.exec('ls -l /etc/localtime', {
                    ignore_rc: false,
                    return_stdout: true,
                });
            })
            .then(tzone => {
                if (tzone && !tzone.split('>')[1]) {
                    reply.srv_time = moment().format();
                    reply.timezone = '';
                } else {
                    var symlink = tzone.split('>')[1].split('/usr/share/zoneinfo/')[1].trim();
                    reply.srv_time = moment().tz(symlink)
                        .format();
                    reply.timezone = symlink;
                }
                return reply;
            });
    } else if (os.type() === 'Darwin') {
        reply.status = true;
        return promise_utils.exec('ls -l /etc/localtime', {
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
    } else {
        throw new Error('Getting time config only supported on linux based platforms');
    }
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

function get_all_network_interfaces() {
    return promise_utils.exec('ifconfig -a | grep ^eth | awk -F":" \'{print $1}\'', {
            ignore_rc: false,
            return_stdout: true,
        })
        .then(nics => {
            nics = nics.substring(0, nics.length - 1);
            return nics.split('\n');
        });
}

function is_folder_permissions_set(current_path) {
    if (os.type() !== 'Windows_NT') {
        return P.resolve(true);
    }
    let administrators_has_inheritance = false;
    let system_has_full_control = false;
    let found_other_permissions = false;
    return promise_utils.exec(`icacls ${current_path}`, {
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
                        if (permissions.includes('(F)') && permissions.includes('(OI)') && permissions.includes('(CI)')) administrators_has_inheritance = true;
                        else if (!permissions.includes('(F)')) found_other_permissions = true;
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

function set_win_folder_permissions(current_path) {
    if (os.type() !== 'Windows_NT') {
        return P.resolve(true);
    }
    return promise_utils.exec('attrib +H ' + current_path)
        .then(() => promise_utils.exec('icacls  ' + current_path + ' /reset /t /c /q'))
        .then(() => promise_utils.exec('icacls  ' + current_path +
            ' /grant:r administrators:(oi)(ci)F' +
            ' /grant:r system:F' +
            ' /remove:g BUILTIN\\Users' +
            ' /inheritance:r'));
}

function _set_time_zone(tzone) {
    // TODO _set_time_zone: Ugly Ugly, change to datectrl on centos7
    return promise_utils.exec('ln -sf /usr/share/zoneinfo/' +
        tzone + ' /etc/localtime');
}

function read_server_secret() {
    if (os.type() === 'Linux') {
        return fs.readFileAsync(config.CLUSTERING_PATHS.SECRET_FILE)
            .then(function(data) {
                var sec = data.toString();
                return sec.trim();
            })
            .catch(err => {
                throw new Error('Failed reading secret with ' + err);
            });
    } else if (os.type() === 'Darwin') {
        return fs.readFileAsync(config.CLUSTERING_PATHS.DARWIN_SECRET_FILE)
            .then(function(data) {
                return data.toString().trim();
            })
            .catch(err => {
                //For Darwin only, if file does not exist, create it
                //In linux its created as part of the server build process or in an upgrade
                if (err.code === 'ENOENT') {
                    var id = uuid().substring(0, 8);
                    return fs.writeFileAsync(config.CLUSTERING_PATHS.DARWIN_SECRET_FILE,
                            id)
                        .then(() => id);
                } else {
                    throw new Error('Failed reading secret with ' + err);
                }
            });
    } else { //Windows
        return uuid().substring(0, 8);
    }
}

function is_supervised_env() {
    if (os.type() === 'Linux') {
        return true;
    }
    return false;
}

function reload_syslog_configuration(conf) {
    dbg.log0('setting syslog configuration to: ', conf);
    if (os.type() !== 'Linux') {
        return P.resolve();
    }

    if (conf && conf.enabled) {
        return fs.readFileAsync('src/deploy/NVA_build/noobaa_syslog.conf')
            .then(data => {
                // Sending everything except NooBaa logs
                let add_destination = `if $syslogfacility-text != 'local0' then ${conf.protocol === 'TCP' ? '@@' : '@'}${conf.address}:${conf.port}`;
                return fs.writeFileAsync('/etc/rsyslog.d/noobaa_syslog.conf',
                    data + '\n' + add_destination);
            })
            .then(() => restart_rsyslogd());
    } else {
        return fs.readFileAsync('src/deploy/NVA_build/noobaa_syslog.conf')
            .then(data => fs.writeFileAsync('/etc/rsyslog.d/noobaa_syslog.conf', data))
            .then(() => restart_rsyslogd());
    }
}

function get_syslog_server_configuration() {
    if (os.type() !== 'Linux') {
        return P.resolve();
    }
    return fs_utils.get_last_line_in_file('/etc/rsyslog.d/noobaa_syslog.conf')
        .then(conf_line => {
            if (conf_line) {
                if (!conf_line.startsWith('#')) {
                    let regex_res = (/(@+)([\d.]+):(\d+)/).exec(conf_line);
                    return {
                        protocol: regex_res[1] === '@@' ? 'TCP' : 'UDP',
                        address: regex_res[2],
                        port: parseInt(regex_res[3], 10)
                    };
                }
            }
        });
}

function restart_services() {
    if (os.type() !== 'Linux') {
        return;
    }

    dbg.warn('RESTARTING SERVICES!!!', (new Error()).stack);

    var fname = '/tmp/spawn.log';
    var stdout = fs.openSync(fname, 'a');
    var stderr = fs.openSync(fname, 'a');
    spawn('nohup', [
        '/usr/bin/supervisorctl',
        'restart',
        'all'
    ], {
        detached: true,
        stdio: ['ignore', stdout, stderr],
        cwd: '/usr/bin/'
    });
}

function set_hostname(hostname) {
    if (os.type() !== 'Linux') {
        return P.resolve();
    }

    return promise_utils.exec(`hostname ${hostname}`)
        .then(() => promise_utils.exec(`sed -i "s/^HOSTNAME=.*/HOSTNAME=${hostname}/g" /etc/sysconfig/network`)); // keep it permanent
}

function is_valid_hostname(hostname_string) {
    const hostname_regex = /^(([a-zA-Z]|[a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z]|[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9])$/;
    return Boolean(hostname_regex.exec(hostname_string));
}

function handle_unreleased_fds() {
    if (os.type() !== 'Linux') {
        return P.resolve();
    }

    //print deleted un-released file descriptors
    return promise_utils.exec('lsof -n | grep deleted | grep REG', {
            ignore_rc: true,
            return_stdout: true,
        })
        .then(res => {
            if (res) {
                dbg.log0('Deleted FDs which were not released', res);
            }

        });
}


function is_port_range_open_in_firewall(dest_ips, start_port, end_port) {
    return P.resolve()
        .then(() => {
            if (os.type() === 'Linux') {
                return _check_ports_on_linux(dest_ips, start_port, end_port);
            } else if (os.type() === 'Windows_NT') {
                return _check_ports_on_windows(dest_ips, start_port, end_port);
            }
            return true;
        })
        .catch(err => {
            dbg.error('got error on is_port_range_open_in_firewall', err);
            return true;
        });
}


function _check_ports_on_windows(dest_ips, start_port, end_port) {
    let allowed_by_default = true;
    // get the current profile, and check if it's enabled:
    return promise_utils.exec('netsh advfirewall show currentprofile', {
            ignore_rc: false,
            return_stdout: true,
            timeout: 60000
        })
        .then(curr_profile_out => {
            const lines = curr_profile_out.trim().split('\r\n');
            // check if firewall is on for this profile. the on\off indication is in the 3rd line:
            const firewall_enabled = lines[2].split(/\s+/)[1].trim() === 'ON';
            if (firewall_enabled) {
                // get the default rule for inbound traffic:
                const policy_line = lines.find(line => line.indexOf('Firewall Policy') > -1);
                allowed_by_default = policy_line.indexOf('BlockInbound') === -1;
                // get all active inbound rules
                return _get_win_fw_rules();
            }
        })
        .then(rules => {
            // filter out non TCP rules
            const filtered_rules = rules.filter(rule => (rule.Protocol && (rule.Protocol === 'TCP' || rule.Protocol === 'Any')));
            // sort the rules so that block rules are first:
            filtered_rules.sort((a, b) => {
                if (a.Action === 'Block' && b.Action !== 'Block') return -1;
                else if (a.Action !== 'Block' && b.Action === 'Block') return 1;
                else return 0;
            });

            let ports_groups = _.groupBy(_.range(start_port, end_port + 1), port => {
                // go over all relevant rules, and look for the first matching rule (maybe partial match)
                for (const rule of filtered_rules) {
                    if (port >= rule.LocalPort[0] && port <= rule.LocalPort[1]) {
                        // the rule matches some of the range. return if accept or reject
                        return rule.Action;
                    }
                }
                // if none of the rules matches the port, return the default action
                return allowed_by_default ? 'Allow' : 'Block';
            });
            dbg.log0(`is_port_range_open_in_firewall: checked range [${start_port}, ${end_port}]:`, ports_groups);
            // for now if any port in the range is blocked, return false
            return _.isUndefined(ports_groups.Block);
        })
        .catch(err => {
            dbg.error('failed checking firewall rules on windows. treat as all ports are open', err);
            return true;
        });
}

function _get_win_fw_rules() {
    const fields_to_use = ['RemoteIP', 'Protocol', 'LocalPort', 'Rule Name', 'Action'];
    // return fs.readFileAsync('/Users/dannyzaken/Downloads/monitor.txt', 'utf8')
    return promise_utils.exec('netsh advfirewall monitor show firewall rule name=all dir=in profile=active', {
            ignore_rc: false,
            return_stdout: true,
            timeout: 60000
        })
        .then(rules_output => {
            const rules = rules_output.toString().trim()
                // split by empty line separator between different rules
                .split('\r\n\r\n')
                // map each rule to an object
                .map(block => block.split('\r\n')
                    // remove separator line
                    .filter(line => line.indexOf('---') === -1)
                    .reduce((prev_obj, line) => {
                        const split_line = line.split(':').map(word => word.trim());
                        const key = split_line[0];
                        const val = split_line[1];
                        const ret_obj = {};
                        if (key === 'LocalPort') {
                            const ports = val.split('-').map(port => parseInt(port, 10));
                            // if single port than push "end port" to be the same as start port
                            if (ports.length === 1) ports.push(ports[0]);
                            ret_obj[key] = ports;
                        } else if (fields_to_use.includes(key)) {
                            ret_obj[key] = val;
                        }
                        return Object.assign(ret_obj, prev_obj);
                    }, {})
                );

            return rules;
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
    if (os.type() !== 'Linux') {
        return P.resolve([]);
    }
    const iptables_command = 'iptables -L INPUT -nv';
    return promise_utils.exec(iptables_command, {
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
                let end_port = Math.pow(2, 16) - 1; // default to max port value
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


// EXPORTS
exports.os_info = os_info;
exports.read_drives = read_drives;
exports.get_raw_storage = get_raw_storage;
exports.remove_linux_readonly_drives = remove_linux_readonly_drives;
exports.get_main_drive_name = get_main_drive_name;
exports.get_mount_of_path = get_mount_of_path;
exports.get_drive_of_path = get_drive_of_path;
exports.top_single = top_single;
exports.slabtop = slabtop;
exports.netstat_single = netstat_single;
exports.ss_single = ss_single;
exports.set_manual_time = set_manual_time;
exports.verify_ntp_server = verify_ntp_server;
exports.set_ntp = set_ntp;
exports.get_ntp = get_ntp;
exports.set_yum_proxy = set_yum_proxy;
exports.get_yum_proxy = get_yum_proxy;
exports.get_time_config = get_time_config;
exports.get_local_ipv4_ips = get_local_ipv4_ips;
exports.get_all_network_interfaces = get_all_network_interfaces;
exports.get_networking_info = get_networking_info;
exports.read_server_secret = read_server_secret;
exports.is_supervised_env = is_supervised_env;
exports.is_folder_permissions_set = is_folder_permissions_set;
exports.set_win_folder_permissions = set_win_folder_permissions;
exports.reload_syslog_configuration = reload_syslog_configuration;
exports.get_syslog_server_configuration = get_syslog_server_configuration;
exports.set_dns_and_search_domains = set_dns_and_search_domains;
exports.get_dns_and_search_domains = get_dns_and_search_domains;
exports.restart_services = restart_services;
exports.set_hostname = set_hostname;
exports.is_valid_hostname = is_valid_hostname;
exports.get_disk_mount_points = get_disk_mount_points;
exports.get_distro = get_distro;
exports.handle_unreleased_fds = handle_unreleased_fds;
exports.calc_cpu_usage = calc_cpu_usage;
exports.is_port_range_open_in_firewall = is_port_range_open_in_firewall;
exports.get_iptables_rules = get_iptables_rules;
exports.ensure_dns_and_search_domains = ensure_dns_and_search_domains;
