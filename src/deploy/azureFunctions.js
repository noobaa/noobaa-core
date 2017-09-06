/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const msRestAzure = require('ms-rest-azure');
const ComputeManagementClient = require('azure-arm-compute');
const NetworkManagementClient = require('azure-arm-network');

const P = require('../util/promise');
const api = require('../api');
const promise_utils = require('../util/promise_utils');
const azure_storage = require('../util/azure_storage_wrap');

require('../util/dotenv').load();

const adminUsername = 'notadmin';
const adminPassword = 'Passw0rd123!';
const DEFAULT_SIZE = 'Standard_A2_v2';

const DEV_ACTIVATION_KEY = "pe^*pT%*&!&kmJ8nj@jJ6h3=Ry?EVns6MxTkz+JBwkmk_6e" +
    "k&Wy%*=&+f$KE-uB5B&7m$2=YXX9tf&$%xAWn$td+prnbpKb7MCFfdx6S?txE=9bB+SVtKXQay" +
    "zLVbAhqRWHW-JZ=_NCAE!7BVU_t5pe#deWy*d37q6m?KU?VQm?@TqE+Srs9TSGjfv94=32e_a#" +
    "3H5Q7FBgMZd=YSh^J=!hmxeXtFZE$6bG+^r!tQh-Hy2LEk$+V&33e3Z_mDUVd";

const NOOBAA_IMAGE = 'https://jenkinsnoobaastorage.blob.core.windows.net/staging-vhds/image1-4-1-fixed.vhd';

const system = {
    name: 'demo',
    email: 'demo@noobaa.com',
    password: 'DeMo1',
    activation_code: DEV_ACTIVATION_KEY
};

const blobSvc = azure_storage.createBlobService();

function _makeArray(size, handler) {
    return [...Array(30).keys()].map(handler);
}


class AzureFunctions {

    constructor(clientId, domain, secret, subscriptionId, resourceGroupName, location) {
        this.clientId = clientId;
        this.domain = domain;
        this.secret = secret;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.location = location;
    }

    authenticate() {
        console.log('Connecting to Azure: ');
        return P.fromCallback(callback => msRestAzure.loginWithServicePrincipalSecret(this.clientId, this.secret, this.domain, callback))
            .then(credentials => {
                this.computeClient = new ComputeManagementClient(credentials, this.subscriptionId);
                this.networkClient = new NetworkManagementClient(credentials, this.subscriptionId);
            })
            .catch(err => console.log('Error', err));
    }

    getImagesfromOSname(osname) {
        var os = {
            // Ubuntu 14 config - default
            publisher: 'Canonical',
            offer: 'UbuntuServer',
            sku: '14.04.5-LTS',
            version: 'latest',
            osType: 'Linux'
        };
        if (osname === 'ubuntu16') {
            // Ubuntu 16 config
            os.publisher = 'Canonical';
            os.offer = 'UbuntuServer';
            os.sku = '16.04.0-LTS';
            os.version = 'latest';
            os.osType = 'Linux';
        } else if (osname === 'ubuntu12') {
            // Ubuntu 12 config
            os.publisher = 'Canonical';
            os.offer = 'UbuntuServer';
            os.sku = '12.04.5-LTS';
            os.version = 'latest';
            os.osType = 'Linux';
        } else if (osname === 'centos6') {
            // Centos 6.8 config
            os.publisher = 'OpenLogic';
            os.offer = 'CentOS';
            os.sku = '6.8';
            os.version = 'latest';
            os.osType = 'Linux';
        } else if (osname === 'centos7') {
            // Centos 6.8 config
            os.publisher = 'OpenLogic';
            os.offer = 'CentOS';
            os.sku = '7.2';
            os.version = 'latest';
            os.osType = 'Linux';
        } else if (osname === 'redhat6') {
            // RHEL 6.8 config
            os.publisher = 'RedHat';
            os.offer = 'RHEL';
            os.sku = '6.8';
            os.version = 'latest';
            os.osType = 'Linux';
        } else if (osname === 'redhat7') {
            // RHEL 7.2 config
            os.publisher = 'RedHat';
            os.offer = 'RHEL';
            os.sku = '7.2';
            os.version = 'latest';
            os.osType = 'Linux';
        } else if (osname === 'win2012') {
            // Windows 2012R2 config
            os.publisher = 'MicrosoftWindowsServer';
            os.offer = 'WindowsServer';
            os.sku = '2012-R2-Datacenter';
            os.version = 'latest';
            os.osType = 'Windows';
        } else if (osname === 'win2008') {
            // Windows 2008R2 config
            os.publisher = 'MicrosoftWindowsServer';
            os.offer = 'WindowsServer';
            os.sku = '2008-R2-SP1';
            os.version = 'latest';
            os.osType = 'Windows';
        } else if (osname === 'win2016') {
            // Windows 2016 config
            os.publisher = 'MicrosoftWindowsServer';
            os.offer = 'WindowsServer';
            os.sku = '2016-Datacenter';
            os.version = 'latest';
            os.osType = 'Windows';
        }
        return os;
    }

    getSubnetInfo(vnetName) {
        console.log('Getting subnet info for: ' + vnetName);
        return P.fromCallback(callback => this.networkClient.subnets.get(this.resourceGroupName, vnetName, 'default', callback));
    }

    getIpAddress(pipName) {
        console.log('Getting IP for: ' + pipName);
        return P.fromCallback(callback => this.networkClient.publicIPAddresses.get(this.resourceGroupName, pipName, callback))
            .then(res => res.ipAddress);
    }

    createAgent(vmName, storage, vnet, os, server_name, agent_conf) {
        return this.getSubnetInfo(vnet)
            .then(subnetInfo => this.createPublicIp(vmName + '_pip')
                .then(ipInfo => [subnetInfo, ipInfo])
            )
            .then(([subnetInfo, ipinfo]) => this.createNIC(subnetInfo, ipinfo, vmName + '_nic', vmName + '_ip'))
            .then(nic => {
                console.log('Created Network Interface!');
                var image = {
                    publisher: os.publisher,
                    offer: os.offer,
                    sku: os.sku,
                    version: 'latest'
                };
                let diskSizeGB = 40;
                if (os.osType === 'Windows') {
                    diskSizeGB = 140;
                }
                return this.createVirtualMachine(vmName, nic.id, image, storage, diskSizeGB);
            })
            .then(() => {
                console.log('Started the Virtual Machine!');
                var extension = {
                    publisher: 'Microsoft.OSTCExtensions',
                    virtualMachineExtensionType: 'CustomScriptForLinux', // it's a must - don't beleive Microsoft
                    typeHandlerVersion: '1.5',
                    autoUpgradeMinorVersion: true,
                    settings: {
                        fileUris: ['https://pluginsstorage.blob.core.windows.net/agentscripts/init_agent.sh'],
                        commandToExecute: 'bash init_agent.sh ' + server_name + ' ' + agent_conf
                    },
                    protectedSettings: {
                        storageAccountName: 'pluginsstorage',
                        storageAccountKey: 'bHabDjY34dXwITjXEasmQxI84QinJqiBZHiU+Vc1dqLNSKQxvFrZbVsfDshPriIB+XIaFVaQ2R3ua1YMDYYfHw=='
                    },
                    location: this.location,
                };
                if (os.osType === 'Windows') {
                    extension.publisher = 'Microsoft.Compute';
                    extension.virtualMachineExtensionType = 'CustomScriptExtension';
                    extension.typeHandlerVersion = '1.7';
                    extension.settings = {
                        fileUris: ['https://pluginsstorage.blob.core.windows.net/agentscripts/init_agent.ps1'],
                        commandToExecute: 'powershell -ExecutionPolicy Unrestricted -File init_agent.ps1 ' + server_name +
                        ' ' + agent_conf
                    };
                }
                return this.createVirtualMachineExtension(vmName, extension);
            });
    }

    cloneVM(originalVM, newVmName, networkInterfaceName, ipConfigName, vnet) {
        var subnetInfo;
        return this.getSubnetInfo(vnet)
            .then(result => {
                subnetInfo = result;
                return this.createPublicIp(newVmName + '_pip');
            })
            .then(ipinfo => this.createNIC(subnetInfo, ipinfo, networkInterfaceName, ipConfigName))
            .then(nicInfo => this.cloneVirtualMachine(originalVM, newVmName, nicInfo.id))
            .then(result => {
                console.log(result);
            });
    }

    createNIC(subnetInfo, publicIPInfo, networkInterfaceName, ipConfigName) {
        var nicParameters = {
            location: this.location,
            ipConfigurations: [{
                name: ipConfigName,
                privateIPAllocationMethod: 'Dynamic',
                subnet: subnetInfo,
                // publicIPAddress: publicIPInfo
            }]
        };
        if (publicIPInfo) {
            nicParameters.ipConfigurations[0].publicIPAddress = publicIPInfo;
            console.log('Using public IP');
        }
        console.log('Creating Network Interface: ' + networkInterfaceName);
        return P.fromCallback(callback => this.networkClient.networkInterfaces.createOrUpdate(this.resourceGroupName, networkInterfaceName,
            nicParameters, callback));
    }

    createPublicIp(publicIPName) {
        var publicIPParameters = {
            location: this.location,
            publicIPAllocationMethod: 'Static',
            // dnsSettings: {
            //     domainNameLabel: domainNameLabel
            // }
        };
        console.log('Creating public IP: ' + publicIPName);
        return P.fromCallback(callback => this.networkClient.publicIPAddresses.createOrUpdate(this.resourceGroupName, publicIPName,
            publicIPParameters, callback));
    }

    findVMImage(os) {
        console.log(util.format('Finding a VM Image for location %s from ' +
            'publisher %s with offer %s and sku %s', this.location, os.publisher, os.offer, os.sku));
        return P.fromCallback(callback => this.computeClient.virtualMachineImages.list(this.location, os.publisher, os.offer, os.sku, {
            top: 1
        }, callback));
    }

    createVirtualMachine(vmName, nicId, imageReference, storageAccountName, diskSizeGB) {
        if (!diskSizeGB) {
            throw new Error('must Enter disk size in GB');
        }
        var vmParameters = {
            location: this.location,
            // tags: {
            //     env: serverName,
            //     agent_conf: agentConf,
            // },
            osProfile: {
                computerName: vmName,
                adminUsername: adminUsername,
                adminPassword: adminPassword
            },
            hardwareProfile: {
                vmSize: DEFAULT_SIZE
            },
            storageProfile: {
                imageReference: imageReference,
                osDisk: {
                    name: vmName + '_disk',
                    diskSizeGB,
                    caching: 'None',
                    createOption: 'fromImage',
                    vhd: {
                        uri: 'https://' + storageAccountName + '.blob.core.windows.net/osdisks/' + vmName + '-os.vhd'
                    }
                },
            },
            networkProfile: {
                networkInterfaces: [{
                    id: nicId,
                    primary: true
                }]
            },
            diagnosticsProfile: {
                bootDiagnostics: {
                    enabled: true,
                    storageUri: 'https://wusdiagnostics.blob.core.windows.net/'
                }
            }
        };
        console.log('Creating Virtual Machine: ' + vmName);
        return P.fromCallback(callback => this.computeClient.virtualMachines.createOrUpdate(
            this.resourceGroupName, vmName, vmParameters, callback));
    }

    createVirtualMachineFromImage(vmName, image, vnet, storageAccountName, osType, plan) {
        var vmParameters = {
            location: this.location,
            plan: plan,
            osProfile: {
                computerName: vmName,
                adminUsername: adminUsername,
                adminPassword: adminPassword
            },
            hardwareProfile: {
                vmSize: DEFAULT_SIZE
            },
            storageProfile: {
                osDisk: {
                    name: vmName + '_disk',
                    // diskSizeGB: 1023,
                    caching: 'None',
                    createOption: 'fromImage',
                    osType: osType,
                    vhd: {
                        uri: 'https://' + storageAccountName + '.blob.core.windows.net/osdisks/' + vmName + '-os.vhd'
                    },
                    image: {
                        uri: image
                    }
                },
            },
            networkProfile: {
                networkInterfaces: [{
                    primary: true
                }]
            },
            diagnosticsProfile: {
                bootDiagnostics: {
                    enabled: true,
                    storageUri: 'https://wusdiagnostics.blob.core.windows.net/'
                }
            }
        };
        var subnetInfo;
        return this.getSubnetInfo(vnet)
            .then(result => {
                subnetInfo = result;
                return this.createPublicIp(vmName + '_pip');
            })
            .then(ipinfo => this.createNIC(subnetInfo, ipinfo, vmName + '_nic', vmName + '_ip'))
            .then(nic => {
                vmParameters.networkProfile.networkInterfaces[0].id = nic.id;
                return P.fromCallback(callback => this.computeClient.virtualMachines.createOrUpdate(this.resourceGroupName,
                    vmName, vmParameters, callback));
            });
    }

    cloneVirtualMachine(origMachine, newMachine, nicId) {
        console.log('Cloning Virtual Machine: ' + origMachine);
        return P.fromCallback(callback => this.computeClient.virtualMachines.get(this.resourceGroupName, origMachine, callback))
            .then(machine_info => {
                var pos = machine_info.storageProfile.osDisk.vhd.uri.lastIndexOf('/');
                var new_vhd = machine_info.storageProfile.osDisk.vhd.uri.substring(0, pos) + '/' + newMachine + '-os.vhd';
                var vmParameters = {
                    location: machine_info.location,
                    plan: machine_info.plan,
                    osProfile: {
                        computerName: newMachine,
                        adminUsername: adminUsername,
                        adminPassword: adminPassword
                    },
                    hardwareProfile: machine_info.hardwareProfile,
                    storageProfile: {
                        osDisk: {
                            name: machine_info.storageProfile.osDisk.name,
                            // diskSizeGB: 1023,
                            caching: machine_info.storageProfile.osDisk.caching,
                            createOption: 'fromImage',
                            osType: machine_info.storageProfile.osDisk.osType,
                            vhd: {
                                uri: new_vhd
                            },
                            image: {
                                uri: machine_info.storageProfile.osDisk.vhd.uri
                            }
                        },
                    },
                    networkProfile: {
                        networkInterfaces: [{
                            id: nicId,
                            primary: true
                        }]
                    },
                    diagnosticsProfile: machine_info.diagnosticsProfile
                };
                return P.fromCallback(callback => this.computeClient.virtualMachines.createOrUpdate(this.resourceGroupName,
                    newMachine, vmParameters, callback));
            });
    }

    addDataDiskToVM(vm, size, storageAccountName) {
        console.log('Adding DataDisk to Virtual Machine: ' + vm);
        return P.fromCallback(callback => this.computeClient.virtualMachines.get(this.resourceGroupName, vm, callback))
            .then(machine_info => {
                if (!machine_info.storageProfile.dataDisks) {
                    machine_info.storageProfile.dataDisks = [];
                }
                var disk_number = machine_info.storageProfile.dataDisks.length + 1;
                machine_info.storageProfile.dataDisks.push({
                    name: 'dataDisk' + disk_number,
                    diskSizeGB: size,
                    lun: disk_number - 1,
                    vhd: {
                        uri: 'https://' + storageAccountName + '.blob.core.windows.net/datadisks/' + vm + '-data' + disk_number + '.vhd'
                    },
                    createOption: 'Empty'
                });
                return P.fromCallback(callback => this.computeClient.virtualMachines.createOrUpdate(this.resourceGroupName,
                    vm, machine_info, callback));
            });
    }

    startVirtualMachine(vmName) {
        console.log('Starting Virtual Machine: ' + vmName);
        return P.fromCallback(callback => this.computeClient.virtualMachines.start(this.resourceGroupName, vmName, callback));
    }

    captureVirtualMachine(vmName, vhdname, container, overwrite) { // some kind of taking snapshot
        var snapshotParameters = {
            vhdPrefix: vhdname,
            destinationContainerName: container,
            overwriteVhds: overwrite
        };
        console.log('Capturing Virtual Machine: ' + vmName);
        console.log('Stopping Virtual Machine: ' + vmName);
        return P.fromCallback(callback => this.computeClient.virtualMachines.powerOff(
            this.resourceGroupName, vmName, callback))
            .tap(() => {
                console.log('Virtual Machine stopped');
                console.log('Generalizing Virtual Machine: ' + vmName);
            })
            .then(() => P.fromCallback(callback => this.computeClient.virtualMachines.generalize(
                this.resourceGroupName, vmName, callback)))
            .tap(res => {
                console.log('Virtual Machine generalized', res);
                console.log('capturing Virtual Machine: ' + vmName);
            })
            .then(res => P.fromCallback(callback => this.computeClient.virtualMachines.capture(
                this.resourceGroupName, vmName, snapshotParameters, callback)))
            .then(res => res.output.resources[0].properties.storageProfile.osDisk.image.uri);
    }

    startVirtualMachineFromVHD(vmName, vhdname) { // some kind of revert to snapshot
        console.log('Reverting Virtual Machine:', vmName);
        var machine_info;
        return P.fromCallback(callback => this.computeClient.virtualMachines.get(this.resourceGroupName, vmName, callback))
            .then(machine => {
                machine_info = machine;
                console.log('deleting machine:', vmName);
                return P.fromCallback(callback => this.computeClient.virtualMachines.deleteMethod(
                    this.resourceGroupName, vmName, callback));
            })
            .then(() => {
                var parts = machine_info.storageProfile.osDisk.vhd.uri.split('/');
                var container = parts[parts.length - 2];
                var vhd = parts[parts.length - 1];
                console.log('deleting blob:', vhd);
                return P.fromCallback(callback => blobSvc.deleteBlob(container, vhd, callback));
            })
            .then(() => {
                console.log(machine_info.plan);
                var vmParameters = {
                    location: machine_info.location,
                    plan: machine_info.plan,
                    osProfile: {
                        computerName: vmName,
                        adminUsername: adminUsername,
                        adminPassword: adminPassword
                    },
                    hardwareProfile: machine_info.hardwareProfile,
                    storageProfile: {
                        osDisk: {
                            name: machine_info.storageProfile.osDisk.name,
                            caching: machine_info.storageProfile.osDisk.caching,
                            createOption: 'fromImage',
                            osType: machine_info.storageProfile.osDisk.osType,
                            vhd: {
                                uri: machine_info.storageProfile.osDisk.vhd.uri
                            },
                            image: {
                                uri: vhdname
                            }
                        },
                    },
                    networkProfile: machine_info.networkProfile,
                    diagnosticsProfile: machine_info.diagnosticsProfile
                };
                console.log('starting machine from vhd for:', vmName);
                return P.fromCallback(callback => this.computeClient.virtualMachines.createOrUpdate(
                    this.resourceGroupName, vmName, vmParameters, callback));
            });
    }

    restartVirtualMachine(vmName) {
        console.log('Restarting Virtual Machine: ' + vmName);
        return P.fromCallback(callback => this.computeClient.virtualMachines.restart(
            this.resourceGroupName, vmName, callback));
    }

    stopVirtualMachine(vmName) {
        console.log('Stopping Virtual Machine: ' + vmName);
        return P.fromCallback(callback => this.computeClient.virtualMachines.powerOff(
            this.resourceGroupName, vmName, callback));
    }

    deleteVirtualMachine(vmName) {
        console.log('Deleting Virtual Machine: ' + vmName);
        return P.fromCallback(callback => this.computeClient.virtualMachines.deleteMethod(
            this.resourceGroupName, vmName, callback))
            .then(() => P.fromCallback(callback => this.networkClient.networkInterfaces.deleteMethod(
                this.resourceGroupName, vmName + '_nic', callback)))
            .then(() => P.fromCallback(callback => this.networkClient.publicIPAddresses.deleteMethod(
                this.resourceGroupName, vmName + '_pip', callback)))
            .then(() => P.fromCallback(callback => blobSvc.deleteBlob('osdisks', vmName + '-os.vhd', callback)))
            .then(() => P.fromCallback(callback => blobSvc.doesContainerExist('datadisks', callback)))
            .then(result => {
                if (result.exists) {
                    return P.fromCallback(callback => blobSvc.listBlobsSegmentedWithPrefix('datadisks', vmName, null, callback));
                }
            })
            .then(result => {
                if (result && result.entries && (result.entries.length > 0)) {
                    console.log('Deleting data disks', result.entries);
                    return P.map(result.entries, blob => P.fromCallback(
                        callback => blobSvc.deleteBlob('datadisks', blob.name, callback)));
                }
            });
    }

    deleteBlobDisks(vmName, container = 'datadisks') {
        console.log('Deleting data disks of: ', vmName);
        return P.all(
            _makeArray(30, i => {
                const disk = `${vmName}-data${i + 1}.vhd`;
                return P.fromCallback(callback => blobSvc.deleteBlob(container, disk, callback))
                    .catch(() => true);
            })
        );
    }

    listVirtualMachines(prefix, status) {
        return P.fromCallback(callback => this.computeClient.virtualMachines.list(this.resourceGroupName, callback))
            .then(machines_in_rg => {
                var machines_with_prefix = [];
                return P.map(machines_in_rg, machine => {
                    if (machine.name.startsWith(prefix)) {
                        if (status) {
                            return this.getMachineStatus(machine.name)
                                .then(machine_status => {
                                    if (machine_status === status) {
                                        machines_with_prefix.push(machine.name);
                                    }
                                });
                        }
                        machines_with_prefix.push(machine.name);
                    }
                })
                    .then(() => machines_with_prefix);
            });
    }

    getRandomMachine(prefix, status) {
        return this.listVirtualMachines(prefix, status)
            .then(machines => {
                let rand = Math.floor(Math.random() * machines.length);
                return machines[rand];
            });
    }

    getMachineStatus(machine) {
        return P.fromCallback(callback => this.computeClient.virtualMachines.get(this.resourceGroupName, machine, {
            expand: 'instanceView',
        }, callback))
            .then(machine_info => {
                if (machine_info.instanceView.statuses[1]) {
                    return machine_info.instanceView.statuses[1].displayStatus;
                }
                return 'VM Failure';
            });
    }

    countOnMachines(prefix) {
        var count = 0;
        var index = 0;
        return this.listVirtualMachines(prefix)
            .then(machines => promise_utils.pwhile(() => index < machines.length, () => {
                index += 1;
                this.getMachineStatus(machines[index]).then(state => {
                    if (state === 'VM running') {
                        count += 1;
                    }
                });
            }))
            .then(() => count);
    }

    waitMachineState(machine, state) {
        var c_state;
        console.log('Waiting for machine state to be ' + state);
        return promise_utils.pwhile(() => c_state !== state, () =>
            P.fromCallback(callback => this.computeClient.virtualMachines.get(this.resourceGroupName, machine, {
                expand: 'instanceView',
            }, callback))
                .then(machine_info => {
                    if (machine_info.instanceView.statuses[1]) {
                        c_state = machine_info.instanceView.statuses[1].displayStatus;
                    }
                    console.log('Current state is: ' + c_state + ' waiting for: ' + state + ' - will wait for extra 5 seconds');
                })
                .delay(5000)
        );
    }

    createVirtualMachineExtension(vmName, extensionParameters) {
        console.log('Running Virtual Machine Desired extension');
        return P.fromCallback(callback => this.computeClient.virtualMachineExtensions.createOrUpdate(this.resourceGroupName, vmName,
            vmName + '_ext', extensionParameters, callback));
    }

    deleteVirtualMachineExtension(vmName) {
        console.log('Deleting Virtual Machine Desired extension');
        return P.fromCallback(callback => this.computeClient.virtualMachineExtensions.deleteMethod(this.resourceGroupName, vmName,
            vmName + '_ext', callback));
    }


    createServer(serverName, vnet, storage) { // creates new noobaa server and returns it's secret
        const CONTAINER_NAME = 'staging-vhds';
        var rpc;
        var client;
        var isDone = false;
        return P.fromCallback(callback => blobSvc.doesContainerExist(CONTAINER_NAME, callback))
            .then(({ exists }) => !exists && P.fromCallback(callback => blobSvc.createContainer(CONTAINER_NAME, callback)))
            .then(() => P.fromCallback(callback => blobSvc.doesBlobExist(CONTAINER_NAME, 'image.vhd', callback)))
            .then(({ exists }) => !exists && P.fromCallback(
                callback => blobSvc.startCopyBlob(NOOBAA_IMAGE, CONTAINER_NAME, 'image.vhd', callback))
                .then(() => promise_utils.pwhile(() => !isDone, () =>
                    P.fromCallback(callback => blobSvc.getBlobProperties(CONTAINER_NAME, 'image.vhd', callback))
                        .then(result => {
                            if (result.copy) {
                                console.log('Copying Image...', result.copy.progress);
                                if (result.copy.status === 'success') {
                                    isDone = true;
                                } else if (result.copy.status !== 'pending') {
                                    throw new Error('got wrong status while copying', result.copy.status);
                                }
                            }
                        })
                        .delay(10000)
                )))
            .then(() => this.createVirtualMachineFromImage(serverName, 'https://' + storage + '.blob.core.windows.net/staging-vhds/image.vhd', vnet, storage, 'Linux'))
            .delay(20000)
            .then(() => this.getIpAddress(serverName + '_pip'))
            .tap(ip => console.log(`server name: ${serverName}, ip: ${ip}`))
            .then(ip => {
                rpc = api.new_rpc('wss://' + ip + ':8443');
                client = rpc.new_client({});
                rpc.disable_validation();
                return P.resolve(client.system.create_system(system));
            })
            .then(res => {
                client.options.auth_token = res.token;
            })
            .then(() => P.resolve(client.system.read_system({})))
            .then(res => {
                var secret = res.cluster.master_secret;
                console.log('Server ', serverName, 'was successfuly created');
                return secret;
            })
            .finally(() => rpc.disconnect_all());
    }

    addServerToCluster(master_ip, slave_ip, slave_secret, slave_name) {
        var rpc = api.new_rpc('wss://' + master_ip + ':8443');
        var client = rpc.new_client({});
        return P.fcall(() => {
            var auth_params = {
                email: 'demo@noobaa.com',
                password: 'DeMo1',
                system: 'demo'
            };
            return client.create_auth_token(auth_params);
        })
            .then(() => P.resolve(client.cluster_server.add_member_to_cluster({
                address: slave_ip,
                secret: slave_secret,
                role: 'REPLICA',
                shard: 'shard1',
                new_hostname: slave_name
            })))
            .tap(() => {
                console.log(`the master ip is: ${master_ip}`);
                console.log(`sleeping for 5 min then adding ${slave_ip} to the cluster`);
            })
            .delay(5 * 60 * 1000)
            .then(() => {
                let should_run = true;
                const WAIT_INTERVAL = 10 * 1000;
                const limit = Date.now() + (3 * 60 * 1000);
                return promise_utils.pwhile(
                    () => should_run,
                    () => client.system.read_system({})
                        .tap(res => console.log(`cluster members: ${JSON.stringify(res.cluster.shards[0].servers)}`))
                        .then(res => {
                            const { servers } = res.cluster.shards[0];
                            should_run = servers.every(srv => srv.address !== slave_ip) && Date.now() < limit;
                            return P.delay(should_run ? WAIT_INTERVAL : 0);
                        })
                        .catch(err => console.log(`Caught ${err}, supressing`))
                );
            })
            .tap(() => console.log(`successfully added server ${slave_ip} to cluster, with master ${master_ip}`))
            .finally(() => rpc.disconnect_all());
    }
}

module.exports = AzureFunctions;
