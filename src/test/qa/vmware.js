"use strict";

var vsphere = require("vsphere");
var promise_utils = require('../../util/promise_utils');
var vm_helper = require('../qa/vm-helper');
var P = require('../../util/promise');
var request = require('request');
// var ops = require('../system_tests/basic_server_ops');


var vm_name = 'Jacky\'s Tiny Linux - for test';
var vm_ip = '192.168.0.114';
var snap_name = 'tiny-snap';
var service;
var sessionManager;
var ovfManager;
var vimPort;
var vm_obj;

function wait_for_server(ip) {
    var isNotListening = true;
    return promise_utils.pwhile(
        function() {
            return isNotListening;
        },
        function() {
            return P.ninvoke(request, 'get', {
                url: 'http://' + ip + ':8080/version',
                rejectUnauthorized: false,
            }).then(function(res, body) {
                console.log('Web Server started after upgrade, version is: ' + body);
                isNotListening = false;
            }, function(err) {
                console.log('waiting for Web Server to start');
                return P.delay(10000);
            });
        });
}

vsphere.vimService("185.93.0.130")
    .then(function(serv) {
        service = serv;
        sessionManager = service.serviceContent.sessionManager;
        vimPort = service.vimPort;
        return vimPort.login(sessionManager, "Administrator@lab.local", "N00b@20!6");
    })
    .then(() => vm_helper.findVMbyName(vm_name, service))
    .then(vm => {
        vm_obj = vm;
        return vm_helper.findVMrootSnapshotList(service, vm);
    })
    .then(root_snap_list => vm_helper.getSnapshotFromList(root_snap_list, snap_name, false))
    .then(snap_obj => vimPort.revertToSnapshotTask(snap_obj, null, true))
    .then(() => vimPort.powerOffVMTask(vm_obj, null))
    .then(() => vimPort.exportVm(vm_obj))
    .then(nfcLease => vm_helper.downloadOVF(service, vm_obj, nfcLease))
    .then(console.log)
    .then(() => vimPort.logout(sessionManager))
    //  .then(() => wait_for_server(vm_ip))
    //  .then(() => ops.upload_and_upgrade(server, upgrade_file))
    .catch(function(err) {
        console.log(err.message);
    });
