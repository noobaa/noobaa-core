'use strict';

const _ = require('lodash');
const os = require('os');
const fs = require('fs');
const uuid = require('node-uuid');
const moment = require('moment-timezone');
const node_df = require('node-df');
var spawn = require('child_process').spawn;

const P = require('./promise');
const config = require('../../config.js');
const promise_utils = require('./promise_utils');
const fs_utils = require('./fs_utils');
const dbg = require('./debug_module')(__filename);
const os_detailed_info = require('getos');

const AZURE_TMP_DISK_README = 'DATALOSS_WARNING_README.txt';

function os_info(count_mongo_reserved_as_free) {

    //Convert X.Y eth name style to X-Y as mongo doesn't accept . in it's keys
    var orig_ifaces = os.networkInterfaces();
    var interfaces = _.clone(orig_ifaces);

    _.each(orig_ifaces, function(iface, name) {
        if (name.indexOf('.') !== -1) {
            var new_name = name.replace('.', '-');
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
    return promise_utils.exec(command, true, true)
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

function get_main_drive_name() {
    if (os.type() === 'Windows_NT') {
        return process.env.SystemDrive;
    } else {
        return '/';
    }
}

function get_distro() {
    return os_detailed_info((err, distro) => {
        if (err) {
            return P.reject(err);
        }
        let res;
        if (distro && distro.dist) {
            res = distro.dist;
            if (distro.release) res += ` ${distro.release}`;
            if (distro.codename) res += ` (${distro.codename})`;
        }
        return res ? P.resolve(res) : P.reject(new Error('unknown distro'));
    });
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
                    if (process.cwd().toLowerCase().indexOf(hd_info.drive_id.toLowerCase()) === 0) {
                        hd_info.mount = '.\\agent_storage\\';
                        mount_points.push(hd_info);
                    } else {
                        hd_info.mount += '\\agent_storage\\';
                        mount_points.push(hd_info);
                    }
                });
            } else {
                _.each(hds, function(hd_info) {
                    if (hd_info.mount === "/") {
                        hd_info.mount = './agent_storage/';
                        mount_points.push(hd_info);
                    } else {
                        hd_info.mount = '/' + hd_info.mount + '/agent_storage/';
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
    return promise_utils.exec(grep_command, true, true)
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
                    .catch(err => {
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
        }).then(function(local_volumes) {
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
                                    total: parseInt(0, 10),
                                    free: parseInt(0, 10),
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
    return promise_utils.exec('wmic ' + topic + ' get /value', /*ignore_rc= */ false, /*return_stdout= */ true)
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
        return promise_utils.exec('top -c -b -n 1' + file_redirect);
    } else if (os.type() === 'Windows_NT') {
        return P.resolve();
    } else {
        throw new Error('top_single ' + os.type + ' not supported');
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
            .then(() => promise_utils.exec('/sbin/chkconfig ntpd off 2345'))
            .then(() => promise_utils.exec('/etc/init.d/ntpd stop'))
            .then(() => promise_utils.exec('date +%s -s @' + time_epoch))
            .then(() => restart_rsyslogd());
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return P.resolve();
    } else {
        throw new Error('setting time/date not supported on non-Linux platforms');
    }
}

function get_ntp() {
    if (os.type() === 'Linux') {
        return promise_utils.exec("cat /etc/ntp.conf | grep NooBaa", false, true)
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
        var command = "sed -i 's/.*NooBaa Configured NTP Server.*/server " + server + " iburst #NooBaa Configured NTP Server/' /etc/ntp.conf";
        return _set_time_zone(timez)
            .then(() => promise_utils.exec(command))
            .then(() => promise_utils.exec('/sbin/chkconfig ntpd on 2345'))
            .then(() => promise_utils.exec('/etc/init.d/ntpd restart'))
            .then(() => restart_rsyslogd());
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return P.resolve();
    } else {
        throw new Error('setting NTP not supported on non-Linux platforms');
    }
}

function get_dns_servers() {
    if (os.type() === 'Linux') {
        return promise_utils.exec("cat /etc/resolv.conf | grep NooBaa", true, true)
            .then(cmd_res => {
                let conf_lines = cmd_res.split(/\n/);
                return conf_lines.map(line => {
                        let regex_res = (/nameserver (.*) #NooBaa/).exec(line);
                        return regex_res && regex_res[1];
                    })
                    .filter(regex_group => !_.isEmpty(regex_group));
            });
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return P.resolve([]);
    }
    throw new Error('DNS not supported on non-Linux platforms');
}

function set_dns_server(servers) {
    if (os.type() === 'Linux') {
        var commands_to_exec = [];
        if (servers[0]) {
            commands_to_exec.push("sed -i 's/.*NooBaa Configured Primary DNS Server.*/nameserver " +
                servers[0] + " #NooBaa Configured Primary DNS Server/' /etc/resolv.conf");
        } else {
            commands_to_exec.push("sed -i 's/.*NooBaa Configured Primary DNS Server.*/#NooBaa Configured Primary DNS Server/' /etc/resolv.conf");
        }

        if (servers[1]) {
            commands_to_exec.push("sed -i 's/.*NooBaa Configured Secondary DNS Server.*/nameserver " +
                servers[1] + " #NooBaa Configured Secondary DNS Server/' /etc/resolv.conf");
        } else {
            commands_to_exec.push("sed -i 's/.*NooBaa Configured Secondary DNS Server.*/#NooBaa Configured Secondary DNS Server/' /etc/resolv.conf");
        }

        return P.each(commands_to_exec, function(command) {
            return promise_utils.exec(command);
        });
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return P.resolve();
    } else {
        throw new Error('setting DNS not supported on non-Linux platforms');
    }
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
        return promise_utils.exec('/usr/bin/ntpstat | head -1', false, true)
            .then(res => {
                if (res.indexOf('synchronized to') !== -1) {
                    reply.status = true;
                }
                return promise_utils.exec('ls -l /etc/localtime', false, true);
            })
            .then(tzone => {
                if (tzone && !tzone.split('>')[1]) {
                    reply.srv_time = moment().format();
                    reply.timezone = '';
                } else {
                    var symlink = tzone.split('>')[1].split('/usr/share/zoneinfo/')[1].trim();
                    reply.srv_time = moment().tz(symlink).format();
                    reply.timezone = symlink;
                }
                return reply;
            });
    } else if (os.type() === 'Darwin') {
        reply.status = true;
        return promise_utils.exec('ls -l /etc/localtime', false, true)
            .then(tzone => {
                var symlink = tzone.split('>')[1].split('/usr/share/zoneinfo/')[1].trim();
                reply.srv_time = moment().tz(symlink).format();
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
            .then(() => promise_utils.exec('service rsyslog restart'));
    } else {
        return fs.readFileAsync('src/deploy/NVA_build/noobaa_syslog.conf')
            .then(data => fs.writeFileAsync('/etc/rsyslog.d/noobaa_syslog.conf', data))
            .then(() => promise_utils.exec('service rsyslog restart'));
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

    return promise_utils.exec(`hostname ${hostname}`);
}

function is_valid_hostname(hostname_string) {
    const hostname_regex = /^(([a-zA-Z]|[a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z]|[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9])$/;
    return Boolean(hostname_regex.exec(hostname_string));
}

// EXPORTS
exports.os_info = os_info;
exports.read_drives = read_drives;
exports.remove_linux_readonly_drives = remove_linux_readonly_drives;
exports.get_main_drive_name = get_main_drive_name;
exports.get_mount_of_path = get_mount_of_path;
exports.get_drive_of_path = get_drive_of_path;
exports.top_single = top_single;
exports.netstat_single = netstat_single;
exports.ss_single = ss_single;
exports.set_manual_time = set_manual_time;
exports.set_ntp = set_ntp;
exports.get_ntp = get_ntp;
exports.get_time_config = get_time_config;
exports.get_local_ipv4_ips = get_local_ipv4_ips;
exports.get_networking_info = get_networking_info;
exports.read_server_secret = read_server_secret;
exports.is_supervised_env = is_supervised_env;
exports.reload_syslog_configuration = reload_syslog_configuration;
exports.get_syslog_server_configuration = get_syslog_server_configuration;
exports.set_dns_server = set_dns_server;
exports.get_dns_servers = get_dns_servers;
exports.restart_services = restart_services;
exports.set_hostname = set_hostname;
exports.is_valid_hostname = is_valid_hostname;
exports.get_disk_mount_points = get_disk_mount_points;
exports.get_distro = get_distro;
