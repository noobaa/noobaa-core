'use strict';

module.exports = {
    os_info: os_info,
    read_drives: read_drives,
    get_main_drive_name: get_main_drive_name,
};

var _ = require('lodash');
var Q = require('q');
var os = require('os');
var child_process = require('child_process');
var node_df = require('node-df');

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

function read_mac_linux_drives() {
    return Q.nfcall(node_df)
        .then(function(drives) {
            return _.compact(_.map(drives, function(drive) {
                // for now only consider the root mount
                // to use other mounts we should check the type of disk/fs
                // and only return local disks, and filter ramfs mounts, automounts, etc.
                if (drive.mount !== '/') return;
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
                    drive_id: vol.DriveId,
                    storage: {
                        total: parseInt(vol.Capacity, 10),
                        free: parseInt(vol.FreeSpace, 10),
                    }
                };
            }));
        });
}

function wmic(topic) {
    return Q.nfcall(child_process.exec, 'wmic ' + topic + ' get /value')
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


if (require.main === module) {
    read_drives().done(function(drives) {
        console.log(drives);
    });
}
