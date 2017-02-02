"use strict";

var vsphere = require("vsphere");
var promise_utils = require('../../util/promise_utils');
var vm_helper = require('../qa/vm-helper');
var P = require('../../util/promise');
var request = require('request');
var ops = require('../system_tests/basic_server_ops');
var ssh2 = require('ssh2');
var argv = require('minimist')(process.argv);

var ssh_client = new ssh2.Client();
var host_ip = argv.host || '10.25.14.56';
var host_user = argv.host_user || 'root';
var host_password = argv.host_password || 'roonoobaa';
var vm_name = argv.guest || 'NooBaa-Community-Edition';
var vm_ip = argv.guest_ip || '10.25.14.69';
var vm_user = argv.guest_user || 'noobaaroot';
var vm_password = argv.guest_password || 'b2633625';
var snap_name = argv.base_snapshot || '0.8 official after wizard';
var upgrade_file = argv.upgrade_package;
var full_build = get_build_number(upgrade_file);
var mainversion = full_build.split('-')[0];
var build = full_build.split('-')[1];
var ova_name = argv.ova_name || 'NooBaa-' + mainversion;
var description = argv.description || 'NooBaa V' + mainversion + ' [build ' + build + ']';
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

function wait_for_server(ip, wait_for_version) {
    var isNotListening = true;
    var version;
    return promise_utils.pwhile(
        function() {
            return isNotListening;
        },
        function() {
            console.log('waiting for Web Server to start');
            return P.fromCallback(callback => request({
                    method: 'get',
                    url: 'http://' + ip + ':8080/version',
                    strictSSL: false,
                }, callback), {
                    multiArgs: true
                })
                .spread(function(response, body) {
                    if (response.statusCode !== 200) {
                        throw new Error('got error code ' + response.statusCode);
                    }
                    if (wait_for_version && body !== wait_for_version) {
                        throw new Error('version is ' + body +
                            ' wait for version ' + wait_for_version);
                    }
                    console.log('Web Server started. version is: ' + body);
                    version = body;
                    isNotListening = false;
                })
                .catch(function(err) {
                    console.log('not up yet...', err.message);
                    return P.delay(5000);
                });
        }).return(version);
}

function get_build_number(upgrade_pack) {
    var filename;
    if (upgrade_pack.indexOf('/') === -1) {
        filename = upgrade_pack;
    } else {
        filename = upgrade_pack.substring(upgrade_pack.indexOf('/'));
    }
    var version_match = filename.match(/noobaa-NVA-(.*)\.tar\.gz/);
    return version_match && version_match[1];
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
    .then(() => wait_for_server(vm_ip))
    .then(() => ops.upload_and_upgrade(vm_ip, upgrade_file))
    .then(() => wait_for_server(vm_ip, get_build_number(upgrade_file)))
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
    .then(() => console.log('machine is OFF'))
    .then(() => P.delay(5000))
    .then(() => vimPort.exportVm(vm_obj))
    .then(nfcLease => vm_helper.downloadOVF(service, vm_obj, nfcLease, host_ip, ova_name, description))
    .then(() => vimPort.logout(sessionManager))
    .then(() => console.log('All done.'))
    .then(() => process.exit(0))
    .catch(function(err) {
        console.log('jacky !', err.stack);
        process.exit(1);
    });
