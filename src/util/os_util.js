'use strict';

module.exports = {
    os_info: os_info,
    read_drives: read_drives,
    get_main_drive_name: get_main_drive_name,
    get_mount_of_path: get_mount_of_path,
    top_single: top_single,
    netstat_single: netstat_single,
    set_manual_time: set_manual_time,
    set_ntp: set_ntp,
    get_time_config: get_time_config,
};

var _ = require('lodash');
var P = require('../util/promise');
var os = require('os');
var fs = require('fs');
var child_process = require('child_process');
var node_df = require('node-df');
var promise_utils = require('./promise_utils');

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

function read_mac_linux_drives() {
    console.log('read_mac_linux_drives');
    return P.nfcall(node_df, {
            // this is a hack to make node_df append the -l flag to the df command
            // in order to get only local file systems.
            file: '-l'
        })
        .then(function(drives) {
            return _.compact(_.map(drives, function(drive) {
                return {
                    mount: drive.mount,
                    drive_id: drive.filesystem,
                    storage: {
                        total: drive.size * 1024,
                        free: drive.available * 1024,
                    }
                };
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
                return {
                    mount: vol.DriveLetter,
                    drive_id: vol.DriveLetter,
                    storage: {
                        total: parseInt(vol.Capacity, 10),
                        free: parseInt(vol.FreeSpace, 10),
                    }
                };
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
    if (os.type() === 'Darwin' || os.type() === 'Windows_NT') {
        return promise_utils.promised_exec('netstat -na' + file_redirect);
    } else if (os.type() === 'Linux') {
        return promise_utils.promised_exec('netstat -nap' + file_redirect);
    } else {
        throw new Error('netstat_single ' + os.type + ' not supported');
    }
}

function set_manual_time(time_epoch) {
    if (os.type() === 'Linux') {
        return promise_utils.promised_exec('/sbin/chkconfig ntpd off 2345')
            .then(() =>  promise_utils.promised_exec('/etc/init.d/ntpd stop'))
            .then(() => promise_utils.promised_exec('date +%s -s @' + time_epoch))
            .then(() => restart_rsyslogd());
    } else {
        throw new Error('setting time/date not supported on non-Linux platforms');
    }
}

function set_ntp(server, timez) {
    if (os.type() === 'Linux') {
        var tz_components = timez.split('/');
        var command = "sed -i 's/.*NooBaa Configured NTP Server.*/server " + server + " iburst #NooBaa Configured NTP Server/' /etc/ntp.conf";

        return promise_utils.promised_exec('/sbin/chkconfig ntpd on 2345')
            .then(() => promise_utils.promised_exec('ln -sf /usr/share/zoneinfo/' +
                tz_components[0] + '/' + tz_components[1] + ' /etc/localtime'))
            .then(() => promise_utils.promised_exec('/etc/init.d/ntpd restart'))
            .then(() => promise_utils.promised_exec(command))
            .then(() => restart_rsyslogd());
    } else {
        throw new Error('setting NTP not supported on non-Linux platforms');
    }
}

function restart_rsyslogd() {
    return promise_utils.promised_exec('/etc/init.d/rsyslog restart');
}

function get_time_config() {
    if (os.type() === 'Linux') {
        return promise_utils.promised_exec('/usr/bin/ntpstat | head -1', false, true);
    } else {
        throw new Error('setting time/date not supported on non-Linux platforms');
    }
}


if (require.main === module) {
    read_drives().done(function(drives) {
        console.log(drives);
    });
}
