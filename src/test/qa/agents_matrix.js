/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('../../util/promise');
const _ = require('lodash');
var AzureFunctions = require('../../deploy/azureFunctions');
var crypto = require('crypto');
const s3ops = require('../utils/s3ops');
const af = require('../utils/agent_functions');
const ops = require('../utils/basic_server_ops');

// Environment Setup
require('../../util/dotenv').load();
var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
var shasum = crypto.createHash('sha1');
shasum.update(Date.now().toString());

const dbg = require('../../util/debug_module')(__filename);
const testName = 'agents_matrix';
dbg.set_process_name(testName);

// Sample Config
var argv = require('minimist')(process.argv);
console.log(JSON.stringify(argv));

let {
    resource,
    storage,
    vnet,
    skipsetup = false,
    clean = false,
    help = false
} = argv;

const {
    location = 'westus2',
    bucket = 'first.bucket',
    server_ip,
} = argv;

const upgrade_pack = argv.upgrade_pack === true ? undefined : argv.upgrade_pack;

function usage() {
    console.log(`
    --location      -   azure location (default: ${location})
    --bucket        -   bucket to run on (default: ${bucket})
    --server_ip     -   noobaa server ip
    --resource      -   azure resource group
    --storage       -   azure storage on the resource group
    --vnet          -   azure vnet on the resource group
    --upgrade_pack  -   location of the file for upgrade
    --skipsetup     -   skipping creation and deletion of agents.
    --clean         -   will only delete the env and exit.
    --help          -   show this help
    `);
}

if (help) {
    usage();
    process.exit(1);
}

//define colors
const Yellow = "\x1b[33;1m";
const Red = "\x1b[31m";
const NC = "\x1b[0m";

//noobaa rpc
var api = require('../../api');
var rpc = api.new_rpc('wss://' + server_ip + ':8443');
var client = rpc.new_client({});
const oses = [
    'ubuntu12', 'ubuntu14', 'ubuntu16',
    'centos6', 'centos7',
    'redhat6', 'redhat7',
    'win2008', 'win2012', 'win2016'
];

const size = 16; //size in GB
let nodes = [];
let errors = [];
let initial_node_number;

var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
    process.exit(1);
}

function runClean() {
    //deleting the VM machines with the same name as the OS we want to install.
    return P.map(oses, osname => azf.deleteVirtualMachine(osname)
        .catch(() => console.log(`VM ${osname} not found - skipping...`)))
        //running all all the VM machines and deleating all the disks.
        .then(() => P.map(oses, osname => azf.deleteBlobDisks(osname)
            .catch(saveErrorAndResume)))
        // when clean is called, exiting after delete all agents machine.
        .then(() => clean && process.exit(0));
}

function createAgents(isInclude, excludeList) {
    let agentConf;
    let test_nodes_names = [];
    console.log(`starting the create agents stage`);
    return af.list_nodes(server_ip)
        .then(res => {
            initial_node_number = res.length;
            const decommissioned_nodes = res.filter(node => node.mode === 'DECOMMISSIONED');
            console.log(`${Yellow}Number of deactivated agents: ${decommissioned_nodes.length}${NC}`);
            const Online_node_number = res.length - decommissioned_nodes.length;
            console.warn(`${Yellow}Num nodes before the test is: ${
                res.length}, ${Online_node_number} Online and ${
                decommissioned_nodes.length} deactivated.${NC}`);
            if (decommissioned_nodes.length !== 0) {
                const deactivated_nodes = decommissioned_nodes.map(node => node.name);
                console.log(`${Yellow}activating all the deactivated agents:${NC} ${deactivated_nodes}`);
                af.activeAgents(server_ip, deactivated_nodes);
            }
        })
        .then(() => af.getAgentConf(server_ip, excludeList))
        .then(res => {
            agentConf = res;
        })
        .then(() => af.getTestNodes(server_ip, oses))
        .then(res => {
            test_nodes_names = res;
        })
        .then(() => {
            if (isInclude) {
                return P.map(oses, osname => azf.createAgent({
                    vmName: osname,
                    storage,
                    vnet,
                    os: osname,
                    agentConf,
                    serverIP: server_ip
                }))
                    .catch(saveErrorAndResume);
            } else {
                return runExtensions('init_agent', `${server_ip} ${agentConf}`)
                    .catch(saveErrorAndResume);
            }
        })
        .tap(() => console.warn(`Will now wait for a 2 min for agents to come up...`))
        .delay(120000)
        .then(() => af.isIncluded({
            server_ip,
            previous_agent_number: test_nodes_names.length,
            additional_agents: oses.length,
            print: 'create agent',
            oses
        }));
}

function runCreateAgents(isInclude, excludeList) {
    if (!skipsetup) {
        return createAgents(isInclude, excludeList);
    }
    return af.list_nodes(server_ip)
        .then(res => {
            let node_number_after_create = res.length;
            console.log(`${Yellow}Num nodes after create is: ${node_number_after_create}${NC}`);
            nodes = [];
            console.warn(`Node names are ${res.map(node => node.name)}`);
        });
}

function runAgentDiagnostics() {
    console.warn(`Will take diagnostics from all the agents`);
    return P.map(nodes, name => client.node.collect_agent_diagnostics({ name })
        .catch(saveErrorAndResume));
}

function runAgentDebug() {
    console.warn(`Will put all agents in debug mode`);
    return P.map(nodes, name => client.node.set_debug_node({
        node: {
            name
        },
        level: 5,
    }).catch(saveErrorAndResume));
}

function verifyAgent() {
    console.log(`Starting the verify agents stage`);
    return s3ops.put_file_with_md5(server_ip, bucket, '100MB_File', 100, 1048576)
        .then(() => s3ops.get_file_check_md5(server_ip, bucket, '100MB_File'))
        .then(runAgentDiagnostics)
        .then(runAgentDebug);
}

function runExtensions(script_name, flags = '') {
    return P.map(oses, osname => azf.deleteVirtualMachineExtension(osname)
        .catch(err => console.log(err.message)))
        .then(() => P.map(oses, osname => {
            console.log(`running extention: ${script_name}`);
            var extension = {
                publisher: 'Microsoft.OSTCExtensions',
                virtualMachineExtensionType: 'CustomScriptForLinux', // it's a must - don't beleive Microsoft
                typeHandlerVersion: '1.5',
                autoUpgradeMinorVersion: true,
                settings: {
                    fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/" + script_name + ".sh"],
                    commandToExecute: 'bash ' + script_name + '.sh ' + flags
                },
                protectedSettings: {
                    storageAccountName: "pluginsstorage",
                    storageAccountKey: "bHabDjY34dXwITjXEasmQxI84QinJqiBZHiU+Vc1dqLNSKQxvFrZbVsfDshPriIB+XIaFVaQ2R3ua1YMDYYfHw=="
                },
                location: location,
            };
            var os = azf.getImagesfromOSname(osname);
            if (os.osType === 'Windows') {
                extension.publisher = 'Microsoft.Compute';
                extension.virtualMachineExtensionType = 'CustomScriptExtension';
                extension.typeHandlerVersion = '1.7';
                extension.settings = {
                    fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/" + script_name + ".ps1"],
                    commandToExecute: 'powershell -ExecutionPolicy Unrestricted -File ' + script_name + '.ps1 ' + flags
                };
            }
            return azf.createVirtualMachineExtension(osname, extension)
                .catch(saveErrorAndResume);
        }));
}

function upgradeAgent() {
    // if upgrade pack is not specifyed then skipping this stage.
    console.log(`Upgrade_pack: ${upgrade_pack}`);
    if (!_.isUndefined(upgrade_pack)) {
        console.log('Starting the upgrade agents stage');
        return runExtensions('replace_version_on_agent')
            .then(() => client.system.read_system({})
                .then(result => ops.upload_and_upgrade(server_ip, upgrade_pack))
                .then(() => {
                    console.log(`Upgrade successful, waiting on agents to upgrade`);
                    return ops.wait_on_agents_upgrade(server_ip);
                }));
    }
}

function deleteAgent() {
    console.log(`Starting the delete agents stage`);
    return client.host.list_hosts({})
        .then(res => P.map(res.hosts, host => {
            console.log('deleting', host.name);
            return client.host.delete_host({ name: host.name });
        }))
        .delay(120 * 1000)
        .then(() => af.list_nodes(server_ip))
        .then(res => {
            nodes = [];
            console.warn(`Node names are ${res.map(node => node.name)}`);
            if (res.length === initial_node_number) {
                console.warn(`${Yellow}Num nodes after the delete agent are ${
                    res.length
                    } - the same as before - good${NC}`);
            } else {
                const error = `Num nodes after the delete agent are ${
                    res.length
                    } - something went wrong... suppose to go back to initial size ${
                    initial_node_number
                    }`;
                console.error(`${Yellow}${error}${NC}`);
                throw new Error(error);
            }
        });
}

function addDisksToMachine(diskSize) {
    console.log(`adding disks to the agents machine`);
    return P.map(oses, osname => {
        console.log(`adding data disk to vm ${osname} of size ${diskSize}`);
        return azf.addDataDiskToVM(osname, diskSize, storage);
    });
}

function checkIncludeDisk() {
    return af.getTestNodes(server_ip, oses)
        .then(number_befor_adding_disks => {
            console.log(`${Yellow}Num nodes before adding disks is: ${number_befor_adding_disks.length}${NC}`);
            return addDisksToMachine(size)
                //map the disks
                .then(() => runExtensions('map_new_disk'))
                .delay(120000)
                .then(() => af.isIncluded({
                    server_ip,
                    previous_agent_number: number_befor_adding_disks.length,
                    additional_agents: oses.length,
                    oses
                }));
        });
}

function addExcludeDisks(excludeList, number_befor_adding_disks) {
    return P.resolve()
        //adding disk to exclude them
        .tap(() => console.log(`${Yellow}Num nodes before adding disks is: ${number_befor_adding_disks}${NC}`))
        .then(() => addDisksToMachine(size))
        .then(() => runExtensions('map_new_disk', '-e'))
        .delay(120000)
        .then(() => isExcluded(excludeList))
        //adding a small disk
        .then(() => addDisksToMachine(15))
        .then(() => runExtensions('map_new_disk'))
        .delay(120000)
        .then(() => af.isIncluded({
            server_ip,
            previous_agent_number: number_befor_adding_disks,
            additional_agents: 0,
            print: 'exluding small disks',
            oses
        }))
        //adding disk to check that it is not getting exclude
        .then(() => addDisksToMachine(size))
        .then(() => runExtensions('map_new_disk'))
        .delay(120000)
        .then(() => {
            af.isIncluded({
                server_ip,
                previous_agent_number: number_befor_adding_disks,
                additional_agents: oses.length,
                print: 'exlude',
                oses
            });
            const number_of_disks = number_befor_adding_disks + oses.length;
            return number_of_disks;
        });
}

function checkExcludeDisk(excludeList) {
    let number_befor_adding_disks;
    return af.getTestNodes(server_ip, oses)
        .then(nodes_befor_adding_disks => {
            const includesE = nodes_befor_adding_disks.filter(node => node.includes('-E-'));
            const includesF = nodes_befor_adding_disks.filter(node => node.includes('-F-'));
            const includes_exclude1 = nodes_befor_adding_disks.filter(node => node.includes('exclude1'));
            const prevNum = nodes_befor_adding_disks.length - includesE.concat(includesF.concat(includes_exclude1)).length;
            return addExcludeDisks(excludeList, prevNum);
        })
        .then(res => number_befor_adding_disks)
        //verifying write, read, diag and debug level.
        .then(verifyAgent)
        //activate a deactivated node
        .then(() => af.getTestNodes(server_ip, oses)
            .then(test_nodes_names => {
                const includesE = test_nodes_names.filter(node => node.includes('-E-'));
                const includes_exclude1 = test_nodes_names.filter(node => node.includes('exclude1'));
                // return includesE.concat(includes_exclude1);
                return af.activeAgents(server_ip, includesE.concat(includes_exclude1));
            }))
        // .then(res => af.activeAgents(server_ip, res)))
        //verifying write, read, diag and debug level.
        .then(verifyAgent)
        //adding disk after disable and enable entire host
        .then(() => addDisksToMachine(size))
        .then(() => runExtensions('map_new_disk'))
        .delay(120000)
        .then(() => af.isIncluded({
            server_ip,
            previous_agent_number: number_befor_adding_disks,
            additional_agents: oses.length,
            print: 'disable and enable entire host',
            oses
        }))
        //verifying write, read, diag and debug level.
        .then(verifyAgent)
        //deactivate agents (mounts)
        .then(() => af.getTestNodes(server_ip, oses)
            .then(test_nodes_names => {
                const excludeE = test_nodes_names.filter(node => node.includes('-E-'));
                const excludeF = test_nodes_names.filter(node => node.includes('-F-'));
                const excludes_exclude = test_nodes_names.filter(node => node.includes('exclude'));
                return excludeE.concat(excludeF).concat(excludes_exclude);
            })
            .then(activated_nodes_list => af.deactiveAgents(server_ip, activated_nodes_list)));
}

//check how many agents there are now, expecting agent not to be included.
function isExcluded(excludeList) {
    return af.list_nodes(server_ip)
        .then(countExclude => {
            console.warn(`Node names are ${countExclude.map(node => node.name)}`);
            const excludedCount = countExclude.map(node => node.drive.mount)
                .map(mount => {
                    if (mount.length === 2 && mount.indexOf(':') === 1) {
                        return mount + '\\';
                    }
                    return mount;
                })
                .filter(mount => excludeList.includes(mount)).length;
            // excludeListPerOSType assums that excludeList contain 2 pathes per os.
            const excludeListPerOSType = 2;
            const expectedExcludedCount = (excludeList.length / excludeListPerOSType * oses.length);
            if (excludedCount === expectedExcludedCount) {
                console.warn(`${Yellow}Num of exclude live nodes are ${
                    excludedCount} as expected${NC}`);
            } else {
                const error = `Num of exclude live nodes are ${
                    excludedCount
                    } - something went wrong... expected ${expectedExcludedCount}`;
                console.error(`${Yellow}${error}${NC}`);
                throw new Error(error);
            }
        });
}

function includeExcludeCycle(isInclude) {
    let excludeList;
    if (isInclude) {
        excludeList = [];
        console.warn(`${Red}starting include cycle${NC}`);
    } else {
        excludeList = ['E:\\', 'F:\\', '/exclude1', '/exclude2'];
        console.warn(`${Red}starting exclude cycle${NC}`);
    }
    return (isInclude ? af.getAgentConf(server_ip) : af.getAgentConf(server_ip, excludeList))
        .then(() => isInclude || runExtensions('map_new_disk', '-r'))
        // creating agents on the VM - diffrent oses.
        .then(() => runCreateAgents(isInclude, excludeList))
        // verifying write, read, diag and debug level.
        .then(verifyAgent)
        // Deploy on an already deployed agent //need to find a way to run quit on win.
        // .then(() => {
        //     console.log(`Deploy on an already deployed agent`);
        //     return runExtensions('init_agent', `${server_ip} ${agentConf}`)
        //         .catch(saveErrorAndResume);
        // })
        // verifying write, read, diag and debug level.
        .then(verifyAgent)
        // adding phisical disks to the machines.
        .then(() => (isInclude ? checkIncludeDisk() : checkExcludeDisk(excludeList)))
        //verifying write, read, diag and debug level.
        .then(verifyAgent)
        //enableing the entire host or enabling with random number of agents enabled
        .then(() => af.deactiveAllHosts(server_ip))
        //verifying write, read, diag and debug level.
        .then(verifyAgent)
        //disabling the entire host
        .then(() => af.activeAllHosts(server_ip))
        // Upgrade to same version before uninstalling
        .then(upgradeAgent)
        //verifying write, read, diag and debug level after the upgrade.
        .then(verifyAgent)
        // Cleaning the machine Extention and installing new one that remove nodes.
        .then(() => skipsetup || deleteAgent());
}

function main() {
    //running the main cycle:
    return azf.authenticate()
        .then(() => P.fcall(() => client.create_auth_token({
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        })))
        //deleteing the previous test agents machins.
        .then(() => skipsetup || runClean())
        // checking the include disk cycle (happy path).
        .then(() => includeExcludeCycle(true))
        // checking the exclude disk cycle.
        .then(() => includeExcludeCycle(false))
        .catch(saveErrorAndResume)
        .then(() => rpc.disconnect_all())
        .then(() => {
            console.warn('End of Test, cleaning.');
            if (errors.length === 0) {
                if (!skipsetup) {
                    console.log('deleing the virtual machines.');
                    return runClean();
                }
                console.log('All is good :) - exiting...');
                process.exit(0);
            } else {
                console.log('Got the following errors in test:');
                _.each(errors, error => {
                    console.error('Error:: ', error);
                });
                console.log('Failures in test :( - exiting...');
                process.exit(1);
            }
        });
}

main();
