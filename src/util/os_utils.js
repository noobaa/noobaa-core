'use strict';

module.exports = {
    os_info: os_info,
    read_drives: read_drives,
    get_main_drive_name: get_main_drive_name,
    get_mount_of_path: get_mount_of_path,
    get_drive_of_path: get_drive_of_path,
    top_single: top_single,
    netstat_single: netstat_single,
    set_manual_time: set_manual_time,
    set_ntp: set_ntp,
    get_time_config: get_time_config,
    get_local_ipv4_ips: get_local_ipv4_ips,
    get_networking_info: get_networking_info,
    read_server_secret: read_server_secret,
    is_supervised_env: is_supervised_env,
};

var _ = require('lodash');
var moment = require('moment-timezone');
var os = require('os');
var fs = require('fs');
var child_process = require('child_process');
var node_df = require('node-df');
var uuid = require('node-uuid');
var promise_utils = require('./promise_utils');
var P = require('./promise');
var config = require('../../config.js');

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
        return P.nfcall(fs.realpath, path)
            .then(function(fullpath) {
                // fullpath[0] = drive letter (C, D, E, ..)
                // fullpath[1] = ':'
                return fullpath[0] + fullpath[1];
            });
    } else {
        return P.nfcall(node_df, {
                file: path
            })
            .then(function(drives) {
                return drives && drives[0] && drives[0].mount;
            });
    }
}

function get_drive_of_path(path) {
    if (os.type() === 'Windows_NT') {
        return P.nfcall(fs.realpath, path)
            .then(function(fullpath) {
                const drive_letter = fullpath[0] + fullpath[1];
                return wmic('volume where DriveLetter="' + drive_letter + '"');
            })
            .then(volumes =>
                volumes &&
                volumes[0] &&
                windows_volume_to_drive(volumes[0]));
    } else {
        return P.nfcall(node_df, {
                file: path
            })
            .then(volumes =>
                volumes &&
                volumes[0] &&
                linux_volume_to_drive(volumes[0]));
    }
}


function read_mac_linux_drives() {
    return P.nfcall(node_df, {
            // this is a hack to make node_df append the -l flag to the df command
            // in order to get only local file systems.
            file: '-l'
        })
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
    return P.nfcall(child_process.exec, 'wmic ' + topic + ' get /value')
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
        return promise_utils.promised_exec('top -l 1' + file_redirect);
    } else if (os.type() === 'Linux') {
        return promise_utils.promised_exec('top -b -n 1' + file_redirect);
    } else if (os.type() === 'Windows_NT') {
        return;
    } else {
        throw new Error('top_single ' + os.type + ' not supported');
    }
}

function netstat_single(dst) {
    var file_redirect = dst ? ' &> ' + dst : '';
    if (os.type() === 'Darwin') {
        return promise_utils.promised_exec('netstat -na' + file_redirect);
    } else if (os.type() === 'Windows_NT') {
        return promise_utils.promised_exec('netstat -na >' + dst);
    } else if (os.type() === 'Linux') {
        return promise_utils.promised_exec('netstat -nap' + file_redirect);
    } else {
        throw new Error('netstat_single ' + os.type + ' not supported');
    }
}

function set_manual_time(time_epoch, timez) {
    if (os.type() === 'Linux') {
        return _set_time_zone(timez)
            .then(() => promise_utils.promised_exec('/sbin/chkconfig ntpd off 2345'))
            .then(() => promise_utils.promised_exec('/etc/init.d/ntpd stop'))
            .then(() => promise_utils.promised_exec('date +%s -s @' + time_epoch))
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
            .then(() => promise_utils.promised_exec('/sbin/chkconfig ntpd on 2345'))
            .then(() => promise_utils.promised_exec('/etc/init.d/ntpd restart'))
            .then(() => promise_utils.promised_exec(command))
            .then(() => restart_rsyslogd());
    } else if (os.type() === 'Darwin') { //Bypass for dev environment
        return;
    } else {
        throw new Error('setting NTP not supported on non-Linux platforms');
    }
}

function restart_rsyslogd() {
    return promise_utils.promised_exec('/etc/init.d/rsyslog restart');
}

function get_time_config() {
    var reply = {
        srv_time: 0,
        timezone: '',
        status: false
    };

    if (os.type() === 'Linux') {
        return promise_utils.promised_exec('/usr/bin/ntpstat | head -1', false, true)
            .then((res) => {
                if (res.indexOf('synchronized to') !== -1) {
                    reply.status = true;
                }
                return promise_utils.promised_exec('ls -l /etc/localtime', false, true);
            })
            .then((tzone) => {
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
        return promise_utils.promised_exec('ls -l /etc/localtime', false, true)
            .then((tzone) => {
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
    //TODO:: Ugly Ugly, change to datectrl on centos7
    return promise_utils.promised_exec('ln -sf /usr/share/zoneinfo/' +
        tzone + ' /etc/localtime');
}

function read_server_secret() {
    if (os.type() === 'Linux') {
        return P.nfcall(fs.readFile, config.CLUSTERING_PATHS.SECRET_FILE)
            .then(function(data) {
                var sec = data.toString();
                return sec.substring(0, sec.length - 1);
            });
    } else {        
        return uuid().substring(0, 8);
    }
}

function is_supervised_env() {
    if (os.type() === 'Linux') {
        return true;
    }
    return false;
}

if (require.main === module) {
    read_drives().done(function(drives) {
        console.log(drives);
    });
}
