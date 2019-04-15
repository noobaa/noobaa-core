/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const _ = require('lodash');
const crypto = require('crypto');
const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');
const af = require('../utils/agent_functions');
const ops = require('../utils/basic_server_ops');
const AzureFunctions = require('../../deploy/azureFunctions');

// Environment Setup
const domain = process.env.DOMAIN;
const clientId = process.env.CLIENT_ID;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
const shasum = crypto.createHash('sha1');
shasum.update(Date.now().toString());

const dbg = require('../../util/debug_module')(__filename);
const testName = 'agents_matrix';
const suffixName = 'am';
dbg.set_process_name(testName);

// Sample Config
const argv = require('minimist')(process.argv);
console.log(JSON.stringify(argv));

let {
    resource,
    storage,
    vnet,
    skip_setup = false,
    keep_env = false,
    update_env = false,
    clean = false,
    help = false
} = argv;

const {
    location = 'westus2',
        bucket = 'first.bucket',
        server_ip,
        id = 0,
        min_required_agents = 3,
} = argv;

const s3ops = new S3OPS({
    ip: server_ip
});

const upgrade_pack = argv.upgrade_pack === true ? undefined : argv.upgrade_pack;

function usage() {
    console.log(`
    --location              -   azure location (default: ${location})
    --bucket                -   bucket to run on (default: ${bucket})
    --server_ip             -   noobaa server ip
    --resource              -   azure resource group
    --storage               -   azure storage on the resource group
    --vnet                  -   azure vnet on the resource group
    --id                    -   an id that is attached to the agents name
    --min_required_agents   -   min number of agents required to run the desired tests (default: ${
        min_required_agents}), will fail if could not create this number of agents
    --upgrade_pack          -   location of the file for upgrade
    --skip_setup             -   skipping creation and deletion of agents.
    --keep_env               -   skipping deletion of agents at the of the test
    --update_env             -   checking for existing agents and adding missing ones
    --clean                 -   will only delete the env and exit.
    --help                  -   show this help
    `);
}

const suffix = suffixName + '-' + id;

if (help) {
    usage();
    process.exit(1);
}

//define colors
const Yellow = "\x1b[33;1m";
const Red = "\x1b[31m";
const NC = "\x1b[0m";

//noobaa rpc
const api = require('../../api');
const rpc = api.new_rpc_from_base_address('wss://' + server_ip + ':8443');
const client = rpc.new_client({});
const oses = af.supported_oses();

const size = 16; //size in GB
let nodes = [];
let errors = [];
let initial_node_number;
const created_agents = [];

const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

function saveErrorAndExit(message) {
    console.error(message);
    errors.push(message);
    process.exit(1);
}

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

async function runClean() {
    //deleting the VM machines with the same name as the OS we want to install.
    await P.map(oses, async osname => {
        try {
            await azf.deleteVirtualMachine(osname + suffix);
        } catch (e) {
            console.log(`VM ${osname}-${id} not found - skipping...`);
        }
    });
    //running all all the VM machines and deleting all the disks.
    await P.map(oses, async osname => {
        try {
            await azf.deleteBlobDisks(osname + suffix);
        } catch (e) {
            saveErrorAndExit(e);
        }
    });
    // when clean is called, exiting after delete all agents machine.
    if (clean) {
        process.exit(0);
    }
}

async function createAgentMachines(osname, exclude_drives) {
    if (osname === 'ubuntu12' || osname === 'ubuntu14' || osname === 'ubuntu18') {
        console.log(`skipping creation of ${osname}`);
        // try {
        //     await azf.createAgentFromImage({
        //         vmName: osname + suffix,
        //         vnet: argv.vnet,
        //         storage: argv.storage,
        //         server_ip,
        //         os: osname,
        //         vmSize: 'Standard_B2s',
        //         exclude_drives,
        //         shouldInstall: true,
        //     });
        //     created_agents.push(osname + suffix);
        // } catch (e) {
        //     // saveErrorAndResume(e);
        //     saveErrorAndExit(e);
        // }
    } else {
        try {
            await azf.createAgent({
                vmName: osname + suffix,
                storage,
                vnet,
                os: osname,
                agentConf: await af.getAgentConf(server_ip, exclude_drives),
                server_ip
            });
            created_agents.push(osname + suffix);
        } catch (e) {
            saveErrorAndResume(e);
        }
    }
}

async function createAgents(isInclude, excludeList) {
    console.log(`starting the create agents stage`);
    const list_nodes = await af.list_nodes(server_ip);
    initial_node_number = list_nodes.length;
    const decommissioned_nodes = list_nodes.filter(node => node.mode === 'DECOMMISSIONED');
    console.log(`${Yellow}Number of deactivated agents: ${decommissioned_nodes.length}${NC}`);
    const Online_node_number = list_nodes.length - decommissioned_nodes.length;
    console.warn(`${Yellow}Num nodes before the test is: ${
                list_nodes.length}, ${Online_node_number} Online and ${
                decommissioned_nodes.length} deactivated.${NC}`);
    if (decommissioned_nodes.length !== 0) {
        const deactivated_nodes = decommissioned_nodes.map(node => node.name);
        console.log(`${Yellow}activating all the deactivated agents:${NC} ${deactivated_nodes}`);
        af.activeAgents(server_ip, deactivated_nodes);
    }
    const test_nodes_names = await af.getTestNodes(server_ip, suffix);
    let osesToCreate = oses.slice();
    //setting the agent list to empty in case of skip_setup
    if (skip_setup) {
        osesToCreate = [];
    }
    //getting the list of missing agents in case of updating environment
    if (update_env) {
        for (let i = 0; i < test_nodes_names.length; i++) {
            for (let j = 0; j < oses.length; j++) {
                if (test_nodes_names[i].startsWith(oses[j])) {
                    osesToCreate.splice(j, 1);
                }
            }
        }
    }
    if (isInclude) {
        await P.map(osesToCreate, async osname => {
            await createAgentMachines(osname, excludeList);
        });
        if (created_agents.length < min_required_agents) {
            saveErrorAndExit(`Could not create the minimum number of required agents (${min_required_agents})`);
        } else {
            console.log(`Created ${created_agents.length} agents`);
        }
    } else {
        try {
            const agentConf = await af.getAgentConf(server_ip, excludeList);
            await runExtensions(created_agents, 'init_agent', `${server_ip} ${agentConf}`);
        } catch (e) {
            saveErrorAndExit(e);
        }
    }
    console.warn(`Will now wait for a 3 min for agents to come up...`);
    await P.delay(180 * 1000);
    await af.isIncluded({
        server_ip,
        previous_agent_number: test_nodes_names.length,
        additional_agents: created_agents.length,
        print: 'create agent',
        suffix
    });
}

async function runCreateAgents(isInclude, excludeList) {
    await createAgents(isInclude, excludeList);
    const list_nodes = await af.list_nodes(server_ip);
    let node_number_after_create = list_nodes.length;
    console.log(`${Yellow}Num nodes after create is: ${node_number_after_create}${NC}`);
    console.warn(`Node names are ${list_nodes.map(node => node.name)}`);
}

async function runAgentDiagnostics() {
    console.warn(`Will take diagnostics from all the agents`);
    await P.map(nodes, async name => {
        try {
            await client.node.collect_agent_diagnostics({ name });
        } catch (e) {
            saveErrorAndExit(e);
        }
    });
}

async function runAgentDebug() {
    console.warn(`Will put all agents in debug mode`);
    await P.map(nodes, async name => {
        try {
            await client.node.set_debug_node({
                node: {
                    name
                },
                level: 5,
            });
        } catch (e) {
            saveErrorAndExit(e);
        }
    });
}

async function verifyAgent() {
    console.log(`Starting the verify agents stage`);
    await s3ops.put_file_with_md5(bucket, '100MB_File', 100, 1048576);
    await s3ops.get_file_check_md5(bucket, '100MB_File');
    await runAgentDiagnostics();
    await runAgentDebug();
}

async function runExtensions(vms, script_name, flags = '') {
    await P.map(vms, async osname => {
        try {
            await azf.deleteVirtualMachineExtension(osname);
        } catch (err) {
            console.log(err.message);
        }
    });
    await P.map(vms, async osname => {
        console.log(`running extension: ${script_name}`);
        const buf = fs.readFileSync("/tmp/details.json");
        const azure_details = JSON.parse(buf.toString());
        const extension = {
            publisher: 'Microsoft.OSTCExtensions',
            virtualMachineExtensionType: 'CustomScriptForLinux', // it's a must - don't believe Microsoft
            typeHandlerVersion: '1.5',
            autoUpgradeMinorVersion: true,
            settings: {
                fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/" + script_name + ".sh"],
                commandToExecute: 'bash ' + script_name + '.sh ' + flags
            },
            protectedSettings: {
                storageAccountName: azure_details.AZURE.storageAccountName,
                storageAccountKey: azure_details.AZURE.storageAccountKey
            },
            location: location,
        };
        const os = azf.getImagesfromOSname(osname.replace(suffix, ''));
        if (os.osType === 'Windows') {
            extension.publisher = 'Microsoft.Compute';
            extension.virtualMachineExtensionType = 'CustomScriptExtension';
            extension.typeHandlerVersion = '1.7';
            extension.settings = {
                fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/" + script_name + ".ps1"],
                commandToExecute: 'powershell -ExecutionPolicy Unrestricted -File ' + script_name + '.ps1 ' + flags
            };
        }
        try {
            await azf.createVirtualMachineExtension(osname, extension);
        } catch (e) {
            saveErrorAndExit(e);
        }
    });
}

async function upgradeAgent() {
    // if upgrade pack is not specified then skipping this stage.
    console.log(`Upgrade_pack: ${upgrade_pack}`);
    if (!_.isUndefined(upgrade_pack)) {
        console.log('Starting the upgrade agents stage');
        await runExtensions(created_agents, 'replace_version_on_agent');
        await ops.upload_and_upgrade(server_ip, upgrade_pack);
        console.log(`Upgrade successful, waiting on agents to upgrade`);
        await ops.wait_on_agents_upgrade(server_ip);
    }
}

async function deleteAgent() {
    console.log(`Starting the delete agents stage`);
    const listHost = await client.host.list_hosts({});
    await P.map(listHost.hosts, async host => {
        console.log('deleting', host.name);
        await client.host.delete_host({ name: host.name });
    });
    await P.delay(120 * 1000);
    const listNods = await af.list_nodes(server_ip);
    console.warn(`Node names are ${listNods.map(node => node.name)}`);
    if (listNods.length === initial_node_number) {
        console.warn(`${Yellow}Num nodes after the delete agent are ${
                    listNods.length
                    } - the same as before - good${NC}`);
    } else {
        const error = `Num nodes after the delete agent are ${
                    listNods.length
                    } - something went wrong... suppose to go back to initial size ${
                    initial_node_number
                    }`;
        console.error(`${Yellow}${error}${NC}`);
        throw new Error(error);
    }
}

async function addDisksToMachine(vms, diskSize) {
    console.log(`adding disks to the agents machine`);
    await P.map(vms, async vm => {
        console.log(`adding data disk to vm ${vm} of size ${diskSize}`);
        await azf.addDataDiskToVM({
            vm,
            size: diskSize,
            storage,
        });
    });
}

async function checkIncludeDisk() {
    const number_before_adding_disks = await af.getTestNodes(server_ip, suffix);
    console.log(`${Yellow}Num nodes before adding disks is: ${number_before_adding_disks.length}${NC}`);
    await addDisksToMachine(created_agents, size);
    //map the disks
    await runExtensions(created_agents, 'map_new_disk');
    await P.delay(120 * 1000);
    await af.isIncluded({
        server_ip,
        previous_agent_number: number_before_adding_disks.length,
        additional_agents: created_agents.length,
        suffix
    });
}

async function addExcludeDisks(excludeList, number_before_adding_disks) {
    //adding disk to exclude them
    console.log(`${Yellow}Num nodes before adding disks is: ${number_before_adding_disks}${NC}`);
    await addDisksToMachine(created_agents, size);
    await runExtensions(created_agents, 'map_new_disk', '-e');
    await P.delay(120 * 1000);
    await isExcluded(excludeList);
    //adding a small disk
    await addDisksToMachine(created_agents, 15);
    await runExtensions(created_agents, 'map_new_disk');
    await P.delay(120 * 1000);
    await af.isIncluded({
        server_ip,
        previous_agent_number: number_before_adding_disks,
        additional_agents: 0,
        print: 'excluding small disks',
        suffix
    });
    //adding disk to check that it is not getting exclude
    await addDisksToMachine(created_agents, size);
    await runExtensions(created_agents, 'map_new_disk');
    await P.delay(120 * 1000);
    await af.isIncluded({
        server_ip,
        previous_agent_number: number_before_adding_disks,
        additional_agents: created_agents.length,
        print: 'exclude',
        suffix
    });
    return number_before_adding_disks + created_agents.length;
}

async function checkExcludeDisk(excludeList) {
    const nodes_before_adding_disks = await af.list_optimal_agents(server_ip, suffix);
    let includesE = nodes_before_adding_disks.filter(node => node.includes('-E-'));
    const includesF = nodes_before_adding_disks.filter(node => node.includes('-F-'));
    let includes_exclude1 = nodes_before_adding_disks.filter(node => node.includes('exclude1'));
    const prevNum = nodes_before_adding_disks.length - includesE.concat(includesF.concat(includes_exclude1)).length;
    const number_before_adding_disks = await addExcludeDisks(excludeList, prevNum);
    console.log(`The number of agents before adding disks is: ${number_before_adding_disks}`);
    //verifying write, read, diag and debug level.
    await verifyAgent();
    //activate a deactivated node
    let test_nodes_names = await af.list_optimal_agents(server_ip, suffix);
    includesE = test_nodes_names.filter(node => node.includes('-E-'));
    includes_exclude1 = test_nodes_names.filter(node => node.includes('exclude1'));
    // return includesE.concat(includes_exclude1);
    await af.activeAgents(server_ip, includesE.concat(includes_exclude1));
    // .then(res => af.activeAgents(server_ip, res)))
    //currently we are using a machine with max 4 disks. skipping the below.
    /*
    //verifying write, read, diag and debug level.
    .then(verifyAgent)
    //adding disk after disable and enable entire host
    .then(() => addDisksToMachine(created_agents, size))
    .then(() => runExtensions(created_agents, 'map_new_disk'))
    .delay(120000)
    .then(() => af.isIncluded({
        server_ip,
        previous_agent_number: number_before_adding_disks,
        additional_agents: created_agents.length,
        print: 'disable and enable entire host',
        suffix
    }))
    //verifying write, read, diag and debug level.
    .then(verifyAgent)
    */
    //deactivate agents (mounts)
    test_nodes_names = await af.list_optimal_agents(server_ip, suffix);
    const excludeE = test_nodes_names.filter(node => node.includes('-E-'));
    const excludeF = test_nodes_names.filter(node => node.includes('-F-'));
    const excludes_exclude = test_nodes_names.filter(node => node.includes('exclude'));
    const activated_nodes_list = await excludeE.concat(excludeF).concat(excludes_exclude);
    await af.deactivateAgents(server_ip, activated_nodes_list);
}

//check how many agents there are now, expecting agent not to be included.
async function isExcluded(excludeList) {
    const countExclude = await af.list_nodes(server_ip);
    console.warn(`Node names are ${countExclude.map(node => node.name)}`);
    const excludedCount = countExclude.map(node => node.drive.mount)
        .map(mount => {
            if (mount.length === 2 && mount.indexOf(':') === 1) {
                return mount + '\\';
            }
            return mount;
        })
        .filter(mount => excludeList.includes(mount)).length;
    // excludeListPerOSType assume that excludeList contain 2 paths per os.
    const excludeListPerOSType = 2;
    const expectedExcludedCount = (excludeList.length / excludeListPerOSType * created_agents.length);
    if (excludedCount === expectedExcludedCount) {
        console.warn(`${Yellow}Num of exclude live nodes are ${
                    excludedCount} as expected${NC}`);
    } else {
        const error = `Num of exclude live nodes are ${
                    excludedCount} - something went wrong... expected ${expectedExcludedCount}`;
        console.error(`${Yellow}${error}${NC}`);
        throw new Error(error);
    }

}

async function includeExcludeCycle(isInclude) {
    let excludeList;
    if (isInclude) {
        excludeList = [];
        console.warn(`${Red}starting include cycle${NC}`);
    } else {
        excludeList = ['E:\\', 'F:\\', '/exclude1', '/exclude2'];
        console.warn(`${Red}starting exclude cycle${NC}`);
    }
    if (isInclude) {
        await af.getAgentConf(server_ip);
    } else {
        await af.getAgentConf(server_ip, excludeList);
        await runExtensions(created_agents, 'map_new_disk', '-r');
    }
    // creating agents on the VM - different oses.
    await runCreateAgents(isInclude, excludeList);
    // verifying write, read, diag and debug level.
    console.log(``);
    // .then(verifyAgent)
    // Deploy on an already deployed agent //need to find a way to run quit on win.
    // .then(() => {
    //     console.log(`Deploy on an already deployed agent`);
    //     return runExtensions(created_agents, 'init_agent', `${server_ip} ${agentConf}`)
    //         .catch(saveErrorAndResume);
    // })
    // verifying write, read, diag and debug level.
    await verifyAgent();
    // adding physical disks to the machines.
    if (isInclude) {
        await checkIncludeDisk();
    } else {
        await checkExcludeDisk(excludeList);
    }
    //verifying write, read, diag and debug level.
    await verifyAgent();
    //enabling the entire host or enabling with random number of agents enabled
    await af.deactivateAllHosts(server_ip);
    //verifying write, read, diag and debug level.
    await verifyAgent();
    //disabling the entire host
    await af.activeAllHosts(server_ip);
    // Upgrade to same version before uninstalling
    await upgradeAgent();
    //verifying write, read, diag and debug level after the upgrade.
    await verifyAgent();
    // Cleaning the machine Extension and installing new one that remove nodes.
    if (!skip_setup) {
        await deleteAgent();
    }
}

async function main() {
    //running the main cycle:
    try {
        await azf.authenticate();
        await client.create_auth_token({
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        });
    } catch (e) {
        console.error(`Could not connect to Azure`, e);
        process.exit(1);
    }
    //deleting the previous test agents machines.
    if (!(skip_setup || update_env)) {
        await runClean();
    }
    // checking the include disk cycle (happy path).
    try {
        await includeExcludeCycle(true);
        // checking the exclude disk cycle.
        await includeExcludeCycle(false);
    } catch (e) {
        saveErrorAndExit(e);
    }
    await rpc.disconnect_all();
    console.warn('End of Test, cleaning.');
    if (errors.length === 0) {
        if (!skip_setup && !keep_env) {
            console.log('deleing the virtual machines.');
            await runClean();
            console.log('All is good - exiting...');
            process.exit(0);
        }
        console.log('All is good - exiting...');
        process.exit(0);
    } else {
        console.log('Got the following errors in test:');
        for (const error of errors) {
            console.error('Error:: ', error);
        }
        console.log('Failures in test - exiting...');
        process.exit(1);
    }

}

main();
