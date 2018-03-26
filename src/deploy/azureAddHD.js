/* Copyright (C) 2016 NooBaa */
'use strict';

const AzureFunctions = require('../deploy/azureFunctions');
const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const argv = require('minimist')(process.argv);
dbg.set_process_name('azureAddHD');

const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

const {
    resource,
    storage,
    location = 'westus2',
    agent_name,
    add = 1,
    size = 16, //size in GB
    help = false
} = argv;

function usage() {
    console.log(`
    --location      -   azure location (default: ${location})
    --resource      -   azure resource group
    --storage       -   azure storage on the resource group
    --agent_name    -   The agent name
    --size          -   HD size (default: ${size})
    --add           -   number of HD to add (default: ${add})
    --clean         -   will only delete the env and exit.
    --help          -   show this help
    `);
}

if (help) {
    usage();
    process.exit(1);
}

function saveErrorAndResume(message) {
    console.error(message);
    process.exit(1);
}

var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

// function runExtensions(machineName, script_name, flags = '') {
//     return P.resolve()
//         .then(() => azf.deleteVirtualMachineExtension(machineName)
//             .catch(err => console.log(err.message)))
//         .then(() => P.resolve()
//             .then(() => {
//                 console.log(`running extention: ${script_name}`);
//                 var extension = {
//                     publisher: 'Microsoft.OSTCExtensions',
//                     virtualMachineExtensionType: 'CustomScriptForLinux', // it's a must - don't beleive Microsoft
//                     typeHandlerVersion: '1.5',
//                     autoUpgradeMinorVersion: true,
//                     settings: {
//                         fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/" + script_name + ".sh"],
//                         commandToExecute: 'bash ' + script_name + '.sh ' + flags
//                     },
//                     protectedSettings: {
//                         storageAccountName: "pluginsstorage",
//                         storageAccountKey: "bHabDjY34dXwITjXEasmQxI84QinJqiBZHiU+Vc1dqLNSKQxvFrZbVsfDshPriIB+XIaFVaQ2R3ua1YMDYYfHw=="
//                     },
//                     location: location,
//                 };
//                 var os = azf.getImagesfromOSname(machineName);
//                 if (os.osType === 'Windows') {
//                     extension.publisher = 'Microsoft.Compute';
//                     extension.virtualMachineExtensionType = 'CustomScriptExtension';
//                     extension.typeHandlerVersion = '1.7';
//                     extension.settings = {
//                         fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/" + script_name + ".ps1"],
//                         commandToExecute: 'powershell -ExecutionPolicy Unrestricted -File ' + script_name + '.ps1 ' + flags
//                     };
//                 }
//                 return azf.createVirtualMachineExtension(machineName, extension)
//                     .catch(saveErrorAndResume);
//             }));
// }

function addDisksToMachine(machineName, diskSize, numberToAdd) {
    console.log(`machineName: ${machineName}, diskSize ${diskSize}, numberToAdd ${numberToAdd}`);
    console.log(`adding disks to the agents machine`);
    // for (let i = 0; i < numberToAdd; i++) {
    return P.resolve()
        .then(() => {
            console.log(`adding data disk to vm ${machineName} of size ${diskSize}`);
            return azf.addDataDiskToVM(machineName, diskSize, storage);
        });
    // }
}

function main() {
    return azf.authenticate()
        .then(() => addDisksToMachine(agent_name, size, add));
    // .then(() => runExtensions('map_new_disk'));
}

main();
