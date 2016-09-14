"use strict";

var vsphere = require("vsphere");
// var promise_utils = require('../../util/promise_utils');
var vm_helper = require('../qa/vm-helper');
var P = require('../../util/promise');
// var request = require('request');
var ops = require('../system_tests/basic_server_ops');
var ssh2 = require('ssh2');
var argv = require('minimist')(process.argv);

var ssh_client = new ssh2.Client();
var host_ip = argv.host || '192.168.1.127';
var host_user = argv.host_user || 'root';
var host_password = argv.host_password || 'roonoobaa';
var vm_name = argv.guest || 'NooBaa-Community-Edition';
var vm_ip = argv.guest_ip || '192.168.1.211';
var vm_user = argv.guest_user || 'noobaaroot';
var vm_password = argv.guest_password || '2ea29727';
var snap_name = argv.base_snapshot || 'NooBaa-after-wizard';
var upgrade_file = argv.upgrade_package || '/Users/jacky/Downloads/noobaa-NVA-0.5.1-e3707c4.tar.gz';
var service;
var sessionManager;
var vimPort;
var vm_obj;

function ssh_connect(client, options) {
    return new P((resolve, reject) => client
        .once('ready', resolve)
        .once('error', reject)
        .connect(options));
}

function ssh_exec(client, command, options) {
    return P.fromCallback(callback => client.exec(command, options, callback))
        .then(stream => new P((resolve, reject) => {
            stream.on('data', data => console.log('ssh_exec: output', data.toString()))
                .on('error', reject)
                .on('end', () => {
                    console.log('ssh_exec: Done');
                    resolve();
                });
        }));
}

vsphere.vimService(host_ip)
    .then(function(serv) {
        service = serv;
        sessionManager = service.serviceContent.sessionManager;
        vimPort = service.vimPort;
        return vimPort.login(sessionManager, host_user, host_password);
    })
    .then(() => vm_helper.findVMbyName(vm_name, service))
    .then(vm => {
        vm_obj = vm;
        console.log('found VM', vm_name);
        return vm_helper.findVMrootSnapshotList(service, vm);
    })
    .then(root_snap_list => vm_helper.getSnapshotFromList(root_snap_list, snap_name, false))
    .then(snap_obj => vimPort.revertToSnapshotTask(snap_obj, null, true))
    .then(task => vm_helper.completeTask(service, task))
    .then(() => console.log('reverted to wanted snapshot ' + snap_name))
    .then(() => console.log('powering machine ON'))
    .then(() => vimPort.powerOnVMTask(vm_obj, null))
    .then(task => vm_helper.completeTask(service, task))
    .then(() => console.log('machine is ON'))
    .then(() => ops.wait_for_server(vm_ip))
    .then(() => ops.upload_and_upgrade(vm_ip, upgrade_file))
    .then(() => ops.wait_for_server(vm_ip))
    .then(() => ssh_connect(ssh_client, {
        host: vm_ip,
        username: vm_user,
        password: vm_password
    }))
    .then(() => ssh_exec(
        ssh_client,
        'sudo bash /root/node_modules/noobaa-core/src/deploy/NVA_build/clean_ova.sh', {
            pty: true
        }))
    .then(() => ssh_client.end())
    .then(() => console.log('cleaned the OVA'))
    .then(() => console.log('powering machine OFF'))
    .then(() => vimPort.powerOffVMTask(vm_obj, null))
    // .then(() => vimPort.exportVm(vm_obj))
    // .then(nfcLease => vm_helper.downloadOVF(service, vm_obj, nfcLease))
    // .then(console.log)
    .then(task => vm_helper.completeTask(service, task))
    .then(() => console.log('machine is OFF'))
    .then(() => vimPort.logout(sessionManager))
    .then(() => console.log('All done.'))
    .catch(function(err) {
        console.log(err.message);
    });
