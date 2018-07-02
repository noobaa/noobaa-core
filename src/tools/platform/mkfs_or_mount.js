/* Copyright (C) 2016 NooBaa */
'use strict';

const { inspect } = require('util');
const { execSync } = require('child_process');
const {
    _: [, , action] = ['list'],
    mnt = '/mntdev',
    fstype = 'xfs',
} = require('minimist')(process.argv);

// read devices from lsblk
function lsblk() {
    return execSync('lsblk -bpP -o NAME,TYPE,FSTYPE,LABEL,MOUNTPOINT,UUID,SIZE,STATE,MODEL,VENDOR,SERIAL,KNAME,PKNAME')
        .toString()
        .trim()
        .split('\n')
        .map(line => {
            const dev = {};
            let l = line;
            while (l) {
                const match = (/^\s*(\w+)="([^"]*)"\s*/).exec(l);
                if (!match) {
                    console.warn(`unrecognized device ${line}`);
                    break;
                }
                if (dev[match[1]]) {
                    console.warn(`duplicate device property on field ${match[1]} ${line}`);
                    continue;
                }
                dev[match[1]] = match[2];
                l = l.slice(match[0].length);
            }
            return dev;
        });
}

function filter_device(dev, partitioned) {
    if (!dev.NAME.startsWith('/dev/sd')) return false;
    if (partitioned.has(dev.KNAME)) return false;
    if (dev.MOUNTPOINT && !dev.MOUNTPOINT.startsWith(mnt)) return false;
    return true;
}

function mount_device(dev) {
    if (!dev.FSTYPE) {
        console.warn(`*** device has no filesystem, call with 'mkfs' to format`);
        return false;
    }
    if (dev.MOUNTPOINT) {
        console.warn(`*** device already mounted, call with 'umount' to unmount`);
        return false;
    }
    const name = dev.NAME;
    const dir = `${mnt}/${name.replace('/dev/', '')}`;
    console.log(`*** mount ${name} ${dir}`);
    execSync(`mkdir -p ${dir}`);
    execSync(`mount ${name} ${dir}`);
    return true;
}

function umount_device(dev) {
    if (!dev.MOUNTPOINT) {
        console.warn(`*** device not mounted`);
        return false;
    }
    console.log(`*** umount ${dev.MOUNTPOINT}`);
    execSync(`umount ${dev.MOUNTPOINT}`);
    return true;
}

function mkfs_device(dev) {
    if (dev.MOUNTPOINT) {
        console.warn(`*** device already mounted, call with 'umount' to unmount`);
        return false;
    }
    if (dev.FSTYPE) {
        console.warn(`*** device already formatted, call with 'wipe' to wipefs`);
        return false;
    }
    const name = dev.NAME;
    console.warn(`*** mkfs -t ${fstype} ${name}`);
    execSync(`mkfs -t ${fstype} ${name}`);
}

function wipe_device(dev) {
    if (dev.MOUNTPOINT) {
        console.warn(`*** device already mounted, call with 'umount' to unmount`);
        return false;
    }
    const name = dev.NAME;
    console.warn(`*** wipefs -a ${name}`);
    execSync(`wipefs -a ${name}`);
}

function show_device(dev) {
    if (!dev.FSTYPE) {
        console.warn(`*** device has no filesystem, call with 'mkfs' to format`);
        return false;
    }
    if (!dev.MOUNTPOINT) {
        console.warn(`*** device not mounted, call with 'mount' to mount`);
        return false;
    }
    return true;
}

function main() {
    const devices = lsblk();
    // keep all devices that have partitions, in order to skip them
    const partitioned = new Set();
    for (const dev of devices) {
        if (dev.PKNAME && dev.TYPE === 'part') {
            partitioned.add(dev.PKNAME);
        }
    }
    for (const dev of devices) {
        if (!filter_device(dev, partitioned)) continue;
        console.log();
        console.log(inspect(dev, { colors: true, breakLength: Infinity }));
        console.log();
        if (action === 'mount') {
            mount_device(dev);
        } else if (action === 'umount') {
            umount_device(dev);
        } else if (action === 'mkfs') {
            mkfs_device(dev);
        } else if (action === 'wipe') {
            wipe_device(dev);
        } else {
            show_device(dev);
        }
        console.log(`*** done.`);
    }
    console.log();
}

if (require.main === module) main();
