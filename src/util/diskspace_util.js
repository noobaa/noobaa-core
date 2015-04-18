'use strict';
var os = require('os');
var child_process = require('child_process');
var path = require('path');

function check(drive, callback) {
    var total = 0;
    var free = 0;
    var status = null;

    if (!drive) {
        status = 'NOTFOUND';
        var error = new Error('Necessary parameter absent');

        return callback ?
            callback(error, total, free, status) :
            console.error(error);
    }

    //Windows
    if (os.type() === 'Windows_NT') {
        var execCmd = path.join('./node_modules/diskspace', 'drivespace.exe');
        execCmd = '\"' + execCmd + '\" drive-' + drive; // handle path with spaces
        child_process.exec(execCmd, function(error, stdout, stderr) {
            if (error) {
                status = 'STDERR';
                callback ? callback(error, total, free, status) : console.error(stderr);
            } else {
                var disk_info = stdout.split(',');

                total = disk_info[0];
                free = disk_info[1];
                status = disk_info[2];

                callback && callback(null, total, free, status);
            }
        });
    } else {
        child_process.exec("df -k '" + drive.replace(/'/g, "'\\''") + "'", function(error, stdout, stderr) {
            if (error) {
                if (stderr.indexOf("No such file or directory") !== -1) {
                    status = 'NOTFOUND';
                } else {
                    status = 'STDERR';
                }
                callback ? callback(error, total, free, status) : console.error(stderr);
            } else {
                var lines = stdout.trim().split("\n");

                var str_disk_info = lines[lines.length - 1].replace(/[\s\n\r]+/g, ' ');
                var disk_info = str_disk_info.split(' ');

                total = disk_info[1] * 1024;
                free = disk_info[3] * 1024;
                status = 'READY';

                callback && callback(null, total, free, status);
            }
        });
    }
}

// Export public API
module.exports = {
    check: check
};
