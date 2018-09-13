/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv, { string: ['server_secret'] });
const dbg = require('../../util/debug_module')(__filename);

const fs = require('fs');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const agent_functions = require('../utils/agent_functions');
const server_functions = require('../utils/server_functions');
const AzureFunctions = require('../../deploy/azureFunctions');
const sanity_build_test = require('../system_tests/sanity_build_test');
const ssh = require('../utils/ssh_functions');


const version_map = 'src/deploy/version_map.json';

// Environment Setup
var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

const oses = agent_functions.supported_oses();

const {
    resource,
    storage,
    vnet,
    name,
    id = 0,
    location = 'westus2',
    clean_only,
    clean_by_id,
    cleanup,
    upgrade,
    rerun_upgrade,
    server_ip,
    server_secret,
    js_script,
    shell_script,
    container,
    skip_agent_creation = false,
    skip_server_creation = false,
    skip_configuration = false,
    create_lg = false,
    lg_ip,
    server_external_ip = false,
    num_agents = oses.length,
    vm_size = 'B',
    agents_disk_size = 'default',
    random_base_version = false,
    min_version = '2.1',
    pool_name = 'first.pool',
} = argv;

let {
    min_required_agents = 7,
} = argv;

dbg.set_process_name('test_env_builder');

const agents = create_agents_plan();
const server = { name: name + '-' + id, ip: server_ip, secret: server_secret };
const lg = { name: 'loadGenerator-' + name + '-' + id, ip: lg_ip };
const created_agents = [];
let vmSize;

const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

function exit_on_error(msg, err) {
    console.error(msg, err);
    process.exit(1);
}

async function main() {
    let exit_code = 0;
    if (argv.help) {
        print_usage();
        process.exit();
    }
    await azf.authenticate();

    if (clean_only) {
        try {
            await clean_test_env();
            process.exit(0);
        } catch (err) {
            exit_on_error('got error on cleanup (clean only):', err);
        }
    }

    try {
        await P.all([
            prepare_server(),
            prepare_agents(),
            prepare_lg()
        ]);

        await install_agents();
    } catch (err) {
        exit_on_error('failed to prepare system for tests:', err);
    }

    try {
        await upgrade_test_env();
        await run_tests();
    } catch (err) {
        console.error('failed running tests:', err);
        exit_code = 1;
    }

    if (cleanup) {
        try {
            await clean_test_env();
        } catch (err) {
            console.error('failed cleaning environment');
        }
    }

    process.exit(exit_code);
}

async function get_random_base_version() {
    let will_retry = true;
    let version;
    const buf = await fs.readFileAsync(version_map);
    const ver_map = JSON.parse(buf.toString());
    if (ver_map.versions.length > 1) {
        while (will_retry) {
            version = ver_map.versions[Math.floor((Math.random() * ver_map.versions.length))];
            if (version.ver.split('.')[0] >= String(min_version).split('.')[0]) {
                if (version.ver.split('.')[1] >= String(min_version).split('.')[1]) {
                    will_retry = false;
                }
            }
        }
    } else {
        version = ver_map.versions[0];
    }
    return version.vhd;
}

//this function is getting servers array creating and upgrading them.
async function prepare_server() {
    if (skip_server_creation) {
        console.log('skipping server creation');
        if (!server_ip || !server_secret) {
            console.error('Cannot skip server creation without ip and secret supplied, please use --server_ip and --server_secret');
            throw new Error('Failed using existing server');
        }
        return;
    }
    console.log(`prepare_server: creating server ${server.name}`);
    console.log(`NooBaa server vmSize is: ${vmSize}`);
    server.version = 'latest';
    let createServerParams = {
        serverName: server.name,
        vnet,
        storage,
        vmSize,
        latestRelease: true,
        createSystem: true,
        createPools: []
    };
    if (random_base_version) {
        createServerParams.imagename = await get_random_base_version();
        server.version = createServerParams.imagename.replace('.vhd', '');
    }
    try {
        server.secret = await azf.createServer(createServerParams);
        if (server_external_ip) {
            server.ip = await azf.getIpAddress(server.name + '_pip');
        } else {
            server.ip = await azf.getPrivateIpAddress(`${server.name}_nic`, `${server.name}_ip`);
        }
        console.log(`server_info is`, server);

        // for docker\podman we need to copy the upgrade package and build docker image from it
        if (container) {
            await prepare_container_env();
        }
    } catch (err) {
        console.error(`prepare_server failed. server name: ${server.name}`, err);
        throw err;
    }
}



async function prepare_container_env() {
    console.log(`creating ssh connection to ${server.ip} with secret ${server.secret}`);
    const ssh_client = await ssh.ssh_connect({
        host: server.ip,
        username: 'noobaaroot',
        password: server.secret,
        keepaliveInterval: 5000,
    });
    await server_functions.enable_noobaa_login(server.ip, server.secret);
    // copy package to remote server
    console.log(`uploading package ${upgrade} to server ${server.ip}`);
    await promise_utils.exec(`scp -o "StrictHostKeyChecking no" ${upgrade} noobaaroot@${server.ip}:/tmp/noobaa-NVA.tar.gz`);
    ssh.ssh_exec(ssh_client, `sudo supervisorctl stop all`);
    ssh.ssh_exec(ssh_client, `sudo tar -xzf /tmp/noobaa-NVA.tar.gz -C /root/node_modules/`);
    ssh.ssh_exec(ssh_client, `sudo cp /tmp/noobaa-NVA.tar.gz /root/node_modules/noobaa-core/`);
    ssh.ssh_exec(ssh_client, `sudo /root/node_modules/noobaa-core/src/test/framework/prepare_podman_env.sh`);
}

async function prepare_agents() {
    if (skip_agent_creation) {
        console.log('skipping agents creation');
        return;
    }
    console.log(`starting the create agents stage`);
    await P.map(agents, async agent => {
        try {
            const hasImage = azf.getImagesfromOSname(agent.os).hasImage;
            if (hasImage) {
                console.log('Creating new agent from an image');
                agent.ip = await azf.createAgentFromImage({
                    vmName: agent.name,
                    storage,
                    vnet,
                    os: agent.os,
                    vmSize,
                    diskSizeGB: agents_disk_size,
                    server_ip: server_ip,
                    shouldInstall: false
                });
            } else {
                console.log('Creating new agent from the marketplace');
                agent.ip = await azf.createAgent({
                    vmName: agent.name,
                    storage,
                    vnet,
                    diskSizeGB: agents_disk_size,
                    os: agent.os,
                    vmSize,
                    server_ip
                });
            }
            console.log(`agent created: ip ${agent.ip} name ${agent.name} of type ${agent.os}`);
            agent.prepared = true;
            created_agents.push(agent);
        } catch (err) {
            console.error(`Creating agent ${agent.name} VM failed`, err);
        }
    });
    if (created_agents.length < min_required_agents) {
        console.error(`could not create the minimum number of required agents (${min_required_agents})`);
        throw new Error(`could not create the minimum number of required agents (${min_required_agents})`);
    } else {
        console.log(`Created ${created_agents.length}`);
    }
}

function install_agents() {
    if (skip_agent_creation) {
        console.log('skipping agents installation');
        return P.resolve();
    }
    let num_installed = 0;
    console.log(`Starting to install ${created_agents.length} Agents`);
    return agent_functions.getAgentConf(server.ip, [], pool_name)
        .then(agent_conf => P.map(created_agents, agent => {
                const os = azf.getImagesfromOSname(agent.os);
                return P.resolve()
                    .then(() => {
                        if (os.hasImage) {
                            console.log(`installing agent ${agent.name} type ${agent.os} using ssh`);
                            return (agent_functions.getAgentConfInstallString(server.ip, os.osType, [], pool_name))
                                .then(inst_string => agent_functions.runAgentCommandViaSsh(
                                    agent.ip,
                                    AzureFunctions.QA_USER_NAME,
                                    AzureFunctions.ADMIN_PASSWORD,
                                    inst_string,
                                    os.osType));
                        } else {
                            console.log(`installing agent ${agent.name} type ${agent.os} using extension`);
                            return azf.createAgentExtension({
                                vmName: agent.name,
                                storage,
                                vnet,
                                ip: agent.ip,
                                os,
                                agentConf: agent_conf,
                                serverIP: server.ip
                            });
                        }
                    })
                    .then(
                        () => { // successfully installed
                            num_installed += 1;
                            console.log(`Finished creating agent extension on ${agent.name}`);
                        },
                        err => { // failed installation
                            console.error(`failed installing agent on ${agent.name}`, err);
                        });
            })
            .then(() => {
                if (num_installed < min_required_agents) {
                    console.error(`could not install the minimum number of required agents (${min_required_agents})`);
                    throw new Error(`could not install the minimum number of required agents (${min_required_agents})`);
                }
                console.log('All required agents were installed');
            }));
}

async function prepare_lg() {
    if (create_lg) {
        try {
            await azf.authenticate();
            await azf.createLGFromImage({
                vmName: lg.name,
                vnet: argv.vnet,
                storage: argv.storage,
            });
            if (server_external_ip) {
                lg.ip = await azf.getIpAddress(lg.name + '_pip');
            } else {
                lg.ip = await azf.getPrivateIpAddress(`${lg.name}_nic`, `${lg.name}_ip`);
            }
            console.log(`lg_info is: `, lg);
        } catch (err) {
            console.error(`prepare_lg failed. lg name: ${lg.name}`, err);
            throw err;
        }
    }
}

// upgrade server to the required version.
// currently using sanity_build_test.js script
async function upgrade_test_env() {
    if (!upgrade || random_base_version) {
        return;
    }
    console.log(`upgrading server with package ${upgrade}`);
    try {
        await sanity_build_test.run_test(server.ip, upgrade, false, skip_configuration);
    } catch (err) {
        console.error('upgrade_test_env failed', err);
        throw err;
    }
    if (rerun_upgrade) {
        console.log(`Got rerun_upgrade flag. running upgrade again from the new version to the same version (${upgrade})`);
        try {
            await sanity_build_test.run_test(server.ip, upgrade, true, true); /*skip configuration*/
        } catch (err) {
            console.error(`Failed upgrading from the new version ${upgrade}`, err);
            throw err;
        }
    }
}

function run_tests() {
    // disable all dbg.log output before running tests
    dbg.set_console_output(false);
    dbg.original_console();
    return P.resolve()
        .then(() => {
            if (js_script) {
                console.log(`running js script ${js_script} on ${server.name}`);
                return promise_utils.fork(js_script, [
                        '--server_name', server.name, '--server_ip', server.ip, '--server_secret', server.secret,
                        '--lg_name', lg.name, '--lg_ip', lg.ip, '--version', server.version
                    ].concat(process.argv))
                    .catch(err => {
                        console.log('Failed running script', err);
                        throw err;
                    });
            } else if (shell_script) {
                console.log(`running bash script ${shell_script} on ${server.name}`);
                return promise_utils.spawn(shell_script, [server.name, server.ip, server.secret])
                    .catch(err => {
                        console.log('Failed running script', err);
                        throw err;
                    });
            }
        })
        .finally(() => {
            dbg.wrapper_console();
            dbg.set_console_output(true);
        });
}

async function clean_test_env() {
    if (clean_by_id) {
        const vms_list = await azf.listVirtualMachines('', '');
        const vms_to_delete = vms_list.filter(vm => (vm.includes(id) && vm.includes(name)));
        console.log(`deleting virtual machines`, vms_to_delete);
        await P.map(vms_to_delete, vm =>
            azf.deleteVirtualMachine(vm)
            .catch(err => console.error(`failed deleting ${vm} with error: `, err.message))
        );
    } else {
        let vms_to_delete = [
            ...agents.map(agent => agent.name),
            server.name.replace(/_/g, '-')
        ];
        console.log(`deleting virtual machines`, vms_to_delete);
        await P.map(vms_to_delete, vm =>
            azf.deleteVirtualMachine(vm)
            .catch(err => console.error(`failed deleting ${vm} with error: `, err.message))
        );
    }
}

function create_agents_plan() {
    let plan = [];
    let osname;
    let curOs = 0;
    if (skip_agent_creation) {
        return plan;
    }
    for (let i = 0; i < num_agents; i++) {
        osname = oses[curOs];
        plan.push({ name: osname + '-' + id, os: osname });
        curOs += 1;
        if (curOs === oses.length) {
            curOs = 0;
        }
    }
    return plan;
}

function verify_args() {
    //verifying the vm_size
    if (vm_size === 'A') {
        vmSize = 'Standard_A2_v2';
    } else if (vm_size === 'B') {
        vmSize = 'Standard_B2s';
    } else {
        console.error('vm_size can be only A or B');
        process.exit(1);
    }
    //verifying agents disk size.
    if (agents_disk_size !== 'default') {
        if (agents_disk_size > 1023) {
            console.error(`Max disk size is 1023 GB`);
            process.exit(1);
        } else if (agents_disk_size < 40) {
            console.error(`Min disk size is 40 GB`);
            process.exit(1);
        }
    }
    //if number of requested agents is less then the min required then changing the min to agent number
    if (num_agents < min_required_agents) {
        min_required_agents = num_agents;
    }

    if (clean_by_id) {
        if (id === 0) {
            console.error(`When using --clean_by_id we must use also --id <id>`);
            process.exit(1);
        }
    }
}

function print_usage() {
    console.log(`
Usage:  node ${process.argv0} --resource <resource-group> --vnet <vnet> --storage <storage-account> --name <server-name> --id <run id>
  --help                        -   show this usage
  --resource <resource-group>   -   the azure resource group to use
  --storage <storage-account>   -   the azure storage account to use
  --vnet <vnet>                 -   the azure virtual network to use
  --name                        -   the vm name
  --id                          -   run id - will be added to server name and agents
  --clean_only                  -   only delete resources from previous runs
  --clean_by_id                 -   delete all the machines with the specified id
  --cleanup                     -   delete all resources from azure env after the run
  --upgrade                     -   path to an upgrade package
  --rerun_upgrade               -   rerunning the upgrade after the first upgrade
  --server_ip                   -   existing server ip
  --server_secret               -   existing server secret
  --js_script                   -   js script to run after env is ready (receives server_name, server_ip server_secret arguments)
  --shell_script                -   shell script to run after env is ready
  --skip_agent_creation         -   do not create new agents
  --skip_server_creation        -   do not create a new server, --server_ip and --server_secret must be supplied
  --skip_configuration          -   do not create configuration
  --create_lg                   -   create lg
  --lg_ip                       -   existing lg ip
  --server_external_ip          -   running with the server external ip (default: internal)
  --num_agents                  -   number of agents to create, default is (default: ${num_agents})
  --min_required_agents         -   min number of agents required to run the desired tests (default: ${
      min_required_agents}), will fail if could not create this number of agents
  --vm_size                     -   vm size can be A (A2) or B (B2) (default: ${vm_size})
  --random_base_version         -   will create a random version of base noobaa server
  --agents_disk_size            -   created agents with different disk size in GB (min: 40, max 1023)
`);
}

if (require.main === module) {
    verify_args();
    main();
}
