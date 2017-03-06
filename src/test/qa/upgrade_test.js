/* Copyright (C) 2016 NooBaa */
'use strict';

var api = require('../../api');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const s3ops = require('../qa/s3ops');
const ops = require('../system_tests/basic_server_ops');
var AzureFunctions = require('../../deploy/azureFunctions');
var cloudCD = require('cloud-cd');
var path = require('path');
var request = require('request');
var fs = require('fs');
var argv = require('minimist')(process.argv);

var provider = 'azure-v2';
var subscription = "a3556050-2d88-42a4-a4e3-f0a2087edc60";
var resourceGroup = argv.resource || "pkgcloud-test";

var clientId = "199522b3-407d-45eb-b7fb-023d21ab6406";
var secret = "1qaz2wsx";
var domain = "noobaa.com";

var location = argv.location || 'westus2';
var storage = argv.storage || 'jenkinsnoobaastorage';

var service = {
    clientId: clientId,
    secret: secret,
    domain: domain
};

var connection = {
    provider: provider,
    subscriptionId: subscription,
    resourceGroup: resourceGroup,
    servicePrincipal: service
};

var vnet = argv.vnet || 'pkgcloud-vnet';
var noobaa_server = {
    name: '',
    flavor: 'Standard_A2_v2',
    username: 'notadmin',
    password: 'Passw0rd123!',

    storageOSDiskName: 'osdisk-noobaa',
    storageAccountName: storage,

    vnetName: vnet,
    osType: 'Linux',
};

var linux_server = {
    name: '',
    flavor: 'Standard_A2_v2',
    username: 'notadmin',
    password: 'Passw0rd123!',

    storageOSDiskName: 'osdisk-linux',
    storageAccountName: storage,

    vnetName: vnet,
    osType: 'Linux',
    imagePublisher: "Canonical",
    imageOffer: "UbuntuServer",
    imageSku: "16.04.0-LTS",
    imageVersion: "latest"
};

var basic_tar_uri = 'https://jenkinsnoobaastorage.blob.core.windows.net/tar-files/';
var version_map_tar = {
    '0.8.0': 'noobaa-NVA-0.8.0-8ac4edc.tar.gz',
    '1.0.0': 'noobaa-NVA-1.0.0-92796da.tar.gz',
    '1.1.0': 'noobaa-NVA-1.1.0-35ea489.tar.gz',
};

var basic_vhd_uri = 'https://jenkinsnoobaastorage.blob.core.windows.net/vhd-images/';
var version_map_vhd = {
    '0.8.0': 'NooBaa-0.8.0-demo.vhd',
    '1.0.0': 'NooBaa-1.0.0-demo.vhd',
};

var destroyOption = {
    destroyNics: true,
    destroyPublicIP: true,
    destroyVnet: false,
    destroyStorage: false,
    destroyFileOSDisk: true,
    destroyFileDataDisk: true
};

var procedure = [{
    "base_version": "0.8.0",
    "versions_list": ["1.1.0"]
}];

var test = './src/test/qa/agent_matrix.js';
var args = [
    '--location ' + location,
    '--resource ' + resourceGroup,
    '--storage ' + storage,
    '--vnet' + vnet,
    '--skipsetup'
];

// var json_file = require(argv.json_file);
// var agents = ['agent1', 'agent2', 'agent3'];
var oses = ['ubuntu14', 'ubuntu16', 'ubuntu12', 'centos6', 'centos7', 'redhat6', 'redhat7'];

var file_path;
var azf = new AzureFunctions(clientId, domain, secret, subscription, resourceGroup, location); // just for using one method

return P.each(procedure, upgrade_procedure => {
        var machine_name = 'upgrade-base' + upgrade_procedure.base_version.replace(new RegExp('\\.', 'g'), '-');
        var machine_ip; // the ip of the machine was just created
        var base64;
        console.log('Removing old running machine if exist');
        noobaa_server.name = machine_name;
        var destroyVMClient = new cloudCD.DestroyVMAction(connection);
        return P.fromCallback(callback => destroyVMClient.perform(noobaa_server, destroyOption, callback))
            .catch(err => {
                console.log('VM wasn\'t found', err.message);
            })
            .then(() => P.each(oses, os => {
                console.log('Removing agents:', os);
                var destroyVMagent = new cloudCD.DestroyVMAction(connection);
                linux_server.name = machine_name + os;
                return P.fromCallback(callback => destroyVMagent.perform(linux_server, destroyOption, callback))
                    .catch(err => {
                        console.log('VM wasn\'t found', err.message);
                    });
            }))
            .then(() => {
                console.log('Creating new server of version ', upgrade_procedure.base_version);
                var createVMClient = new cloudCD.CreateVMAction(connection);
                noobaa_server.storageOSDiskName = machine_name + '-osdisk';
                var uri = basic_vhd_uri + version_map_vhd[upgrade_procedure.base_version];
                noobaa_server.imageSourceUri = uri;
                return P.fromCallback(callback => createVMClient.perform(noobaa_server, callback));
            })
            .then(machine => {
                console.log('The server created is', machine.hostname);
                machine_ip = machine.hostname;
                var rpc = api.new_rpc('wss://' + machine_ip + ':8443');
                rpc.disable_validation();
                var client = rpc.new_client({});
                return P.fcall(() => {
                        var auth_params = {
                            email: 'demo@noobaa.com',
                            password: 'DeMo1',
                            system: 'demo'
                        };
                        return client.create_auth_token(auth_params);
                    })
                    .then(() => P.resolve(client.system.read_system({})))
                    .then(result => {
                        var agent_conf = {
                            address: result.base_address,
                            system: result.name,
                            access_key: '123',
                            secret_key: 'abc',
                            tier: 'nodes',
                            root_path: './agent_storage/'
                        };
                        base64 = Buffer.from(JSON.stringify(agent_conf)).toString('base64');
                        console.log('BASE64:', base64);
                    })
                    .then(() => P.each(oses, osname => {
                        console.log('Adding agent', osname);
                        var createVMagent = new cloudCD.CreateVMAction(connection);
                        linux_server.name = machine_name + osname;
                        linux_server.storageOSDiskName = machine_name + osname + '-osdisk';
                        var os = azf.getImagesfromOSname(osname);
                        linux_server.imagePublisher = os.publisher;
                        linux_server.imageOffer = os.offer;
                        linux_server.imageSku = os.sku;
                        linux_server.imageVersion = 'latest';
                        return P.fromCallback(callback => createVMagent.perform(linux_server, callback))
                            .delay(10000)
                            .then(() => {
                                var remoteExecuteClient = new cloudCD.RemoteExecute(connection);
                                var ssh_script = path.join(__dirname, '/../../deploy/init_agent.sh');
                                var args = machine_ip + ' ' + base64;
                                return P.fromCallback(callback => remoteExecuteClient.perform(linux_server, {
                                    script: ssh_script,
                                    args: args
                                }, callback));
                            });
                    }));
            })
            .delay(120000)
            .then(() => P.each(upgrade_procedure.versions_list, version => {
                console.log('Upgrading to', version);
                return s3ops.put_file_with_md5(machine_ip, 'files', '20MBFile-' + version, 20)
                    .then(filepath => {
                        file_path = filepath;
                        var file = fs.createWriteStream(version_map_tar[version]);
                        return new P((resolve, reject) => {
                            request.get({
                                    url: basic_tar_uri + version_map_tar[version],
                                    rejectUnauthorized: false
                                })
                                .pipe(file)
                                .on('error', reject)
                                .on('finish', resolve);
                        });
                    })
                    .then(() => {
                        ops.disable_rpc_validation();
                        return P.resolve(ops.upload_and_upgrade(machine_ip, version_map_tar[version]));
                    })
                    .then(() => {
                        console.log('Upgrade successful, waiting on agents to upgrade');
                        return P.resolve(ops.wait_on_agents_upgrade(machine_ip));
                    })
                    .then(() => {
                        console.log('Verifying download of 20MB file', file_path);
                        return s3ops.get_file_check_md5(machine_ip, 'files', '20MBFile-' + version);
                    })
                    .then(() => {
                        console.log('Running the desired external test', test);
                        args.push('--server_ip ' + machine_ip);
                        return promise_utils.fork(test, args);
                    })
                    .then(() => {
                        console.log('Upgrading was successful');
                    })
                    .catch(function(error) {
                        console.warn('Upgrading failed with', error, error.stack);
                    });
            }))
            .catch(function(error) {
                console.warn('Upgrading process failed with', error, error.stack);
            });
    })
    .then(() => {
        console.log(':) :) :) Upgrades were all done successfully! (: (: (:');
        process.exit(0);
    })
    .catch(err => {
        console.error(':( :( Errors during upgrades ): ):', err);
        process.exit(1);
    });
