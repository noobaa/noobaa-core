'use strict';

const _ = require('lodash');
const os = require('os');
const fs = require('fs');
const uuid = require('node-uuid');
const moment = require('moment-timezone');
const node_df = require('node-df');

const P = require('./promise');
const config = require('../../config.js');
const promise_utils = require('./promise_utils');

function os_info() {

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

    return {
        hostname: os.hostname(),
        ostype: os.type(),
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        uptime: Date.now() - Math.floor(1000 * os.uptime()),
        loadavg: os.loadavg(),
        totalmem: os.totalmem(),
        freemem: os.freemem(),
        cpus: os.cpus(),
        networkInterfaces: interfaces
    };
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


function read_mac_linux_drives() {
    return P.fromCallback(callback => node_df({
            // this is a hack to make node_df append the -l flag to the df command
            // in order to get only local file systems.
            file: '-l'
        }, callback))
        .then(function(volumes) {
            return _.compact(_.map(volumes, function(vol) {
                return linux_volume_to_drive(vol);
            }));
        });
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
    return promise_utils.exec('wmic ' + topic + ' get /value')
        .then(function(res) {
            return wmic_parse_list(res[0]);
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
        return promise_utils.exec('top -l 1' + file_redirect);
    } else if (os.type() === 'Linux') {
        return promise_utils.exec('top -b -n 1' + file_redirect);
    } else if (os.type() === 'Windows_NT') {
        return;
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

function set_manual_time(time_epoch, timez) {
    if (os.type() === 'Linux') {
        return _set_time_zone(timez)
            .then(() => promise_utils.exec('/sbin/chkconfig ntpd off 2345'))
            .then(() => promise_utils.exec('/etc/init.d/ntpd stop'))
            .then(() => promise_utils.exec('date +%s -s @' + time_epoch))
            .then(() => restart_rsyslogd());
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return;
    } else {
        throw new Error('setting time/date not supported on non-Linux platforms');
    }
}

function set_ntp(server, timez) {
    if (os.type() === 'Linux') {
        var command = "sed -i 's/.*NooBaa Configured NTP Server.*/server " + server + " iburst #NooBaa Configured NTP Server/' /etc/ntp.conf";
        return _set_time_zone(timez)
            .then(() => promise_utils.exec('/sbin/chkconfig ntpd on 2345'))
            .then(() => promise_utils.exec('/etc/init.d/ntpd restart'))
            .then(() => promise_utils.exec(command))
            .then(() => restart_rsyslogd());
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return;
    } else {
        throw new Error('setting NTP not supported on non-Linux platforms');
    }
}

function set_dns_server(servers) {
    if (os.type() === 'Linux') {
        var commands_to_exec = [];
        if (servers[0]) {
            commands_to_exec.push("sed -i 's/.*NooBaa Configured Primary DNS Server.*/nameserver " +
                servers[0] + " #NooBaa Configured Primary DNS Server/' /etc/resolv.conf");
        }

        if (servers[1]) {
            commands_to_exec.push("sed -i 's/.*NooBaa Configured Secondary DNS Server.*/nameserver " +
                servers[1] + " #NooBaa Configured Secondary DNS Server/' /etc/resolv.conf");
        }

        return P.each(commands_to_exec, function(command) {
            return promise_utils.exec(command);
        });
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return;
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
                return sec.substring(0, sec.length - 1);
            });
    } else if (os.type() === 'Darwin') {
        return fs.readFileAsync(config.CLUSTERING_PATHS.DARWIN_SECRET_FILE)
            .then(function(data) {
                var sec = data.toString();
                return sec.substring(0, sec.length - 1);
            })
            .catch(err => {
                //For Darwin only, if file does not exist, create it
                //In linux its created as part of the server build process or in an upgrade
                if (err.code === 'ENOENT') {
                    var id = uuid().substring(0, 8);
                    return fs.writeFileAsync(config.CLUSTERING_PATHS.DARWIN_SECRET_FILE,
                            JSON.stringify(id))
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
    if (os.type() !== 'Linux') {
        return;
    }

    if (conf.enabled) {
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


// EXPORTS
exports.os_info = os_info;
exports.read_drives = read_drives;
exports.get_main_drive_name = get_main_drive_name;
exports.get_mount_of_path = get_mount_of_path;
exports.get_drive_of_path = get_drive_of_path;
exports.top_single = top_single;
exports.netstat_single = netstat_single;
exports.set_manual_time = set_manual_time;
exports.set_ntp = set_ntp;
exports.get_time_config = get_time_config;
exports.get_local_ipv4_ips = get_local_ipv4_ips;
exports.get_networking_info = get_networking_info;
exports.read_server_secret = read_server_secret;
exports.is_supervised_env = is_supervised_env;
exports.reload_syslog_configuration = reload_syslog_configuration;
exports.set_dns_server = set_dns_server;
