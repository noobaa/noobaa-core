/* Copyright (C) 2016 NooBaa */
'use strict';

var request = require('request');
var fs = require('fs');
var stream = require('stream');
var P = require('../../util/promise');
var promise_utils = require('../../util/promise_utils');
var crypto = require('crypto');

function findVMbyName(vmName, service) {
    var propertyCollector = service.serviceContent.propertyCollector;
    var rootFolder = service.serviceContent.rootFolder;
    var viewManager = service.serviceContent.viewManager;
    var vim = service.vim;
    var vimPort = service.vimPort;
    var retVal;
    return vimPort.createContainerView(viewManager, rootFolder, ["VirtualMachine"], true)
        .then(function(containerView) {
            var propertySpec = new vim.PropertySpec({
                type: "VirtualMachine",
                pathSet: ["name"]
            });
            var objectSpec = new vim.ObjectSpec({
                obj: containerView,
                skip: true,
                selectSet: new vim.TraversalSpec({
                    path: "view",
                    type: "ContainerView"
                })
            });
            var propertyFilterSpec = new vim.PropertyFilterSpec({
                objectSet: objectSpec,
                propSet: propertySpec
            });
            var options = new vim.RetrieveOptions();
            return vimPort.retrievePropertiesEx(propertyCollector, [propertyFilterSpec], options);
        })
        .then(function(result) {
            var listobcont = result.objects;
            if (listobcont !== null) {
                listobcont.forEach(function(oc) {
                    var mr = oc.obj;
                    var dps = oc.propSet;
                    var vmnm = null;
                    if (dps !== null) {
                        dps.forEach(function(dp) {
                            vmnm = dp.val;
                        });
                    }
                    if (vmnm !== null && vmnm === vmName) {
                        retVal = mr;
                    }
                });
            }
            return retVal;
        });
}

function findVMrootSnapshotList(service, vmObj) {
    return getProperty(service, vmObj, 'snapshot')
        .then(value => value.rootSnapshotList);
}

function findVMipAddress(service, vmObj) {
    return getProperty(service, vmObj, 'guest');
}

function downloadOVF(service, vmObj, nfcLease, host_ip, ova_name, description) {
    var vim = service.vim;
    var vimPort = service.vimPort;
    var ovfManager = service.serviceContent.ovfManager;
    var vmdk_hash = crypto.createHash('sha1');
    vmdk_hash.setEncoding('hex');
    var ovf_hash = crypto.createHash('sha1');
    ovf_hash.setEncoding('hex');
    return getProperty(service, nfcLease, 'info')
        .then(function(info) {
            info.leaseTimeout = 300 * 1000 * 1000;
            // var diskCapacity = info.totalDiskCapacityInKB * 1024;
            var vmdk_url = info.deviceUrl[0].url.replace('*', host_ip);
            var diskFileName = ova_name + "-disk1.vmdk";
            var ovfFileName = ova_name + ".ovf";
            var ovaFileName = ova_name + ".ova";
            var mfFileName = ova_name + ".mf";
            var ovf_file = new vim.OvfFile();
            var update = 0;
            var size = 0;
            // ovf_file.size = 1024;
            console.log('Downloading: ', vmdk_url);
            var file = fs.createWriteStream(diskFileName);
            return vimPort.httpNfcLeaseProgress(nfcLease, 0)
                .then(() => new P((resolve, reject) => {
                    request.get({
                            url: vmdk_url,
                            rejectUnauthorized: false
                        })
                        .on('error', reject)
                        .pipe(new stream.Transform({
                            transform: function(chunk, encoding, next) {
                                vmdk_hash.write(chunk);
                                size += chunk.length;
                                update += 1;
                                var percantage = Math.floor(100 * (size / (3 * 1024 * 1024 * 1024)));
                                if (update === 2500) {
                                    update = 0;
                                    process.stdout.write('.');
                                    return vimPort.httpNfcLeaseProgress(nfcLease, percantage).then(() => {
                                        this.push(chunk);
                                        next();
                                    });
                                }
                                this.push(chunk);
                                next();
                            }
                        }))
                        .pipe(file)
                        .on('error', reject)
                        .on('finish', resolve);
                }))
                //.then(() => console.log('finished download. size = ', size, 'capacity on disk=', diskCapacity))
                .then(() => vmdk_hash.end())
                .then(() => vimPort.httpNfcLeaseComplete(nfcLease))
                .then(function() {
                    process.stdout.write('\r\n');
                    console.log('creating OVF file:', ovfFileName);
                    ovf_file.path = diskFileName;
                    ovf_file.deviceId = info.deviceUrl[0].key;
                    ovf_file.size = size;
                    var ovfDescParams = new vim.OvfCreateDescriptorParams();
                    ovfDescParams.ovfFiles = [ovf_file];
                    ovfDescParams.description = description;
                    ovfDescParams.name = 'NooBaa';
                    console.log(description);
                    return vimPort.createDescriptor(ovfManager, vmObj, ovfDescParams);
                })
                .then(function(descriptor) {
                    fs.writeFile(ovfFileName, descriptor.ovfDescriptor);
                    ovf_hash.write(descriptor.ovfDescriptor);
                    ovf_hash.end();
                    console.log('creating MF file:', mfFileName);
                    fs.writeFile(mfFileName, 'SHA1(' + ovfFileName + ')= ' + ovf_hash.read() + '\n' +
                        'SHA1(' + diskFileName + ')= ' + vmdk_hash.read() + '\n');
                })
                .then(() => {
                    console.log('Taring into OVA file:', ovaFileName);
                    return promise_utils.exec('tar -cvf ' + ovaFileName + ' ' + ovfFileName + ' ' + mfFileName + ' ' + diskFileName);
                })
                .then(() => {
                    console.log('Removing extra files:', ovfFileName, mfFileName, diskFileName);
                    return promise_utils.exec('rm -rf ' + ovfFileName + ' ' + mfFileName + ' ' + diskFileName);
                });
        });
}

function getProperty(service, vmObj, props) {
    var propertyCollector = service.serviceContent.propertyCollector;
    var vim = service.vim;
    var vimPort = service.vimPort;
    var retVal;
    var propertySpec = new vim.PropertySpec({
        type: vmObj.type,
        pathSet: [props]
    });
    var objectSpec = new vim.ObjectSpec({
        obj: vmObj
    });
    var propertyFilterSpec = new vim.PropertyFilterSpec({
        objectSet: objectSpec,
        propSet: propertySpec
    });
    var options = new vim.RetrieveOptions();
    return vimPort.retrievePropertiesEx(propertyCollector, [propertyFilterSpec], options)
        .then(function(result) {
            var oCont = result.objects;
            // console.log(oCont);
            if (oCont !== null) {
                oCont.forEach(function(oc) {
                    var dps = oc.propSet;
                    // console.log(dps);
                    if (dps !== null) {
                        dps.forEach(function(dp) {
                            if (dp.name === props) {
                                retVal = dp.val;
                            }
                        });
                    }
                });
            }
            return retVal;
        });
}

function getSnapshotFromList(snapTree, findName, print) {
    var snapmor = null;
    if (snapTree === null) {
        return snapmor;
    }
    snapTree.forEach(function(node) {
        if (print) {
            console.log('Snapshot Name : ' + node.name);
        }
        if (node.name === findName) {
            console.log('found snapshot ' + findName);
            snapmor = node.snapshot;
        } else {
            var childTree = node.childSnapshotList;
            snapmor = getSnapshotFromList(childTree, findName, print);
        }
    });
    return snapmor;
}

function completeTask(service, task) {
    var propertyCollector = service.serviceContent.propertyCollector;
    var vim = service.vim;
    var vimPort = service.vimPort;
    var waiting = true;
    var version = "";

    return promise_utils.pwhile(
        function() {
            return waiting;
        },
        function() {
            return vimPort.createFilter(propertyCollector,
                    new vim.PropertyFilterSpec({
                        objectSet: new vim.ObjectSpec({
                            obj: task,
                            skip: false
                        }),
                        propSet: new vim.PropertySpec({
                            type: task.type,
                            pathSet: ["info.state", "info.error"]
                        })
                    }), true)
                .then(function() {
                    return vimPort.waitForUpdatesEx(propertyCollector, version)
                        .then(updateSet => {
                            version = updateSet.version;
                            var cs = updateSet.filterSet[0].objectSet[0].changeSet;
                            return cs.forEach(change => {
                                process.stdout.write('.');
                                if (change.name === "info.error" && change.val !== undefined) {
                                    throw Error(change.val.localizedMessage);
                                }
                                if (change.name === "info.state" && change.val === vim.TaskInfoState.success) {
                                    waiting = false;
                                    process.stdout.write('\r\n');
                                }
                            });
                        });
                });
        });
}

exports.findVMbyName = findVMbyName;
exports.completeTask = completeTask;
exports.downloadOVF = downloadOVF;
exports.findVMipAddress = findVMipAddress;
exports.findVMrootSnapshotList = findVMrootSnapshotList;
exports.getSnapshotFromList = getSnapshotFromList;
