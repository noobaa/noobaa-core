'use strict';

var request = require('request');
var fs = require('fs');
var P = require('../../util/promise');

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

function downloadOVF(service, vmObj, nfcLease) {
    var vim = service.vim;
    var vimPort = service.vimPort;
    var ovfManager = service.serviceContent.ovfManager;
    return getProperty(service, nfcLease, 'info')
        .then(function(info) {
            var vmdk_url = info.deviceUrl[0].url;
            var diskFileName = vmdk_url.substring(vmdk_url.lastIndexOf("/") + 1);
            var ovfFileName = diskFileName.split(".")[0] + ".ovf";
            var ovf_file = new vim.OvfFile();
            var size = 0;
            // ovf_file.size = 1024;
            console.log('Downloading: ', vmdk_url);
            var file = fs.createWriteStream(diskFileName);
            return new P((resolve, reject) => {
                    request.get({
                            url: vmdk_url,
                            rejectUnauthorized: false,
                        })
                        .on('data', function(chunk) {
                            size += chunk.length;
                            process.stdout.write('.');
                        })
                        .on('error', reject)
                        .pipe(file)
                        .on('error', reject)
                        .on('finish', resolve);
                })
                .then(() => vimPort.httpNfcLeaseProgress(nfcLease, 100))
                .then(() => vimPort.httpNfcLeaseComplete(nfcLease))
                .then(function() {
                    process.stdout.write('\r\n');
                    ovf_file.path = diskFileName;
                    ovf_file.deviceId = info.deviceUrl[0].key;
                    ovf_file.size = size;
                    var ovfDescParams = new vim.OvfCreateDescriptorParams();
                    ovfDescParams.ovfFiles = [ovf_file];
                    return vimPort.createDescriptor(ovfManager, vmObj, ovfDescParams);
                })
                .then(function(descriptor) {
                    fs.writeFile(ovfFileName, descriptor.ovfDescriptor);
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
            console.log('Found ME!!!!');
            snapmor = node.snapshot;
        } else {
            var childTree = node.childSnapshotList;
            snapmor = getSnapshotFromList(childTree, findName, print);
        }
    });
    return snapmor;
}

exports.findVMbyName = findVMbyName;
exports.downloadOVF = downloadOVF;
exports.findVMrootSnapshotList = findVMrootSnapshotList;
exports.getSnapshotFromList = getSnapshotFromList;
