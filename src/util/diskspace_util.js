'use strict';

module.exports = {
    get_drives: get_drives,
    get_main_drive: get_main_drive,
};

var _ = require('lodash');
var Q = require('q');
var os = require('os');
var child_process = require('child_process');
var node_df = require('node-df');

function get_windows_drives() {
    return Q.nfcall(child_process.exec, 'wmic logicaldisk get Caption,FreeSpace,Size')
        .then(function(res) {
            var lines = res[0].split('\n');
            var drives = {};
            for (var i = 1; i < lines.length; ++i) {
                var values = lines[i].trim().match(/\s*(\S+)\s+(\S+)\s+(\S+)\s*/);
                if (!values) {
                    continue;
                }
                // the order of items is decided by wmic and seems like it's
                // a alphabetical order of the column name.
                // therefore: [1] Caption [2] FreeSpace [3] Size.
                drives[values[1]] = {
                    total: parseInt(values[3], 10),
                    free: parseInt(values[2], 10),
                };
            }
            return drives;
        });
}

function get_mac_linux_drives() {
    return Q.nfcall(node_df)
        .then(function(res) {
            var drives = {};
            _.each(res, function(info) {
                drives[info.mount] = {
                    total: info.size * 1024,
                    free: info.available * 1024,
                };
            });
            return drives;
        });
}

function get_drives() {
    if (os.type() === 'Windows_NT') {
        return get_windows_drives();
    } else {
        return get_mac_linux_drives();
    }
}

function get_main_drive() {
    if (os.type() === 'Windows_NT') {
        return get_windows_drives().get('C:');
    } else {
        return get_mac_linux_drives().get('/');
    }
}


if (require.main === module) {
    get_drives()
        .done(function(drives) {
            console.log(drives);
        });
}
