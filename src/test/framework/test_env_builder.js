/* Copyright (C) 2016 NooBaa */
'use strict';



const argv = require('minimist')(process.argv);

const dbg = require('../../util/debug_module')(__filename);

const AzureFunctions = require('../../deploy/azureFunctions');
const agent_functions = require('../utils/agent_functions');
const sanity_build_test = require('../system_tests/sanity_build_test');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');

// Environment Setup
var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

const oses = ['ubuntu14', 'ubuntu16', 'ubuntu12', 'centos6', 'centos7', 'redhat6', 'redhat7', 'win2008', 'win2012', 'win2016'];

const {
    resource,
    storage,
    vnet,
    name,
    id,
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
    skip_agent_creation = false,
    skip_server_creation = false,
    create_lg = false,
    lg_ip,
    server_external_ip = false,
    num_agents = oses.length,
    help,
    min_required_agents = 7,
    vm_size = 'B'
} = argv;

dbg.set_process_name('test_env_builder');

const agents = create_agents_plan();
const server = { name: name + '-' + id, ip: server_ip, secret: server_secret };
const lg = { name: 'loadGenerator-' + name + '-' + id, ip: lg_ip };
const created_agents = [];
let vmSize;

const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);


function main() {
    let exit_code = 0;
    if (help) {
        print_usage();
        process.exit();
    }
    return azf.authenticate()
        .then(() => {
            if (clean_only) {
                return clean_test_env()
                    .then(() => process.exit(0))
                    .catch(err => {
                        console.error('got error on cleanup (clean only):', err);
                        process.exit(1);
                    });
            }
        })
        // create server and agents vms
        .then(() => P.join(prepare_server(), prepare_agents(), prepare_lg()))
        .spread((dummy, agents_ips) => install_agents())
        .then(upgrade_test_env)
        .then(run_tests)
        .catch(err => {
            console.error('got error:', err);
            exit_code = 1;
        })
        .then(() => {
            if (cleanup) return clean_test_env();
        })
        .catch(err => {
            console.error('got error on cleanup:', err);
            exit_code = 1;
        })
        .then(() => process.exit(exit_code));
}


//this function is getting servers array creating and upgrading them.
function prepare_server() {
    if (skip_server_creation) {
        console.log('skipping server creation');
        if (!server_ip || !server_secret) {
            console.error('Cannot skip server creation without ip and secret supplied, please use --server_ip and --server_secret');
            throw new Error('Failed using existing server');
        }
        return P.resolve();
    }
    console.log(`prepare_server: creating server ${server.name}`);
    console.log(`NooBaa server vmSize is: ${vmSize}`);
    return azf.createServer({
            serverName: server.name,
            vnet,
            storage,
            vmSize,
            latestRelease: true,
            createSystem: true
        })
        .then(new_secret => {
            server.secret = new_secret;
            if (server_external_ip) {
                return azf.getIpAddress(server.name + '_pip');
            } else {
                return azf.getPrivateIpAddress(`${server.name}_nic`, `${server.name}_ip`);
            }
        })
        .then(ip => {
            server.ip = ip;
            console.log(`server_info is`, server);
        })
        .catch(err => {
            console.error(`prepare_server failed. server name: ${server.name}`, err);
            throw err;
        });
}

function prepare_agents() {
    if (skip_agent_creation) {
        console.log('skipping agents creation');
        return P.resolve();
    }
    console.log(`starting the create agents stage`);
    return P.map(agents, agent => {
            const hasImage = azf.getImagesfromOSname(agent.os).hasImage;
            return P.resolve()
                .then(() => {
                    if (hasImage) {
                        console.log('Creating new agent from an image');
                        return azf.createAgentFromImage({
                            vmName: agent.name,
                            storage,
                            vnet,
                            os: agent.os,
                            vmSize,
                            server_ip: server_ip,
                            shouldInstall: false
                        });
                    } else {
                        console.log('Creating new agent from the marketplace');
                        return azf.createAgent({
                            vmName: agent.name,
                            storage,
                            vnet,
                            os: agent.os,
                            vmSize,
                            serverIP: server_ip
                        });
                    }
                })
                .then(ip => {
                    console.log(`agent created: ip ${ip} name ${agent.name} of type ${agent.os}`);
                    agent.prepared = true;
                    agent.ip = ip;
                    created_agents.push(agent);
                })
                .catch(err => {
                    console.error(`Creating agent ${agent.name} VM failed`, err);
                });
        })
        .then(() => {
            if (created_agents.length < min_required_agents) {
                console.error(`could not create the minimum number of required agents (${min_required_agents})`);
                throw new Error(`could not create the minimum number of required agents (${min_required_agents})`);
            } else {
                console.log(`Created ${created_agents.length}`);
            }
        });
}

function install_agents() {
    if (skip_agent_creation) {
        console.log('skipping agents installation');
        return P.resolve();
    }
    let num_installed = 0;
    console.log(`Starting to install ${created_agents.length} Agents`);
    return agent_functions.getAgentConf(server.ip, [])
        .then(agent_conf => P.map(created_agents, agent => {
                const os = azf.getImagesfromOSname(agent.os);
                return P.resolve()
                    .then(() => {
                        if (os.hasImage) {
                            console.log(`installing agent ${agent.name} type ${agent.os} using ssh`);
                            return (agent_functions.getAgentConfInstallString(server.ip, os.osType, []))
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

function prepare_lg() {
    if (create_lg) {
        return azf.authenticate()
            .then(() => azf.createLGFromImage({
                vmName: lg.name,
                vnet: argv.vnet,
                storage: argv.storage,
            }))
            .then(() => {
                if (server_external_ip) {
                    return azf.getIpAddress(lg.name + '_pip');
                } else {
                    return azf.getPrivateIpAddress(`${lg.name}_nic`, `${lg.name}_ip`);
                }
            })
            .then(ip => {
                lg.ip = ip;
                console.log(`lg_info is`, lg);
            })
            .catch(err => {
                console.error(`prepare_lg failed. lg name: ${lg.name}`, err);
                throw err;
            });
    } else {
        return P.resolve();
    }
}

// upgrade server to the required version.
// currently using sanity_build_test.js script
function upgrade_test_env() {
    if (!upgrade) {
        return;
    }
    console.log(`upgrading server with package ${upgrade}`);
    return sanity_build_test.run_test(server.ip, upgrade, false)
        .catch(err => {
            console.error('upgrade_test_env failed', err);
            throw err;
        })
        .then(() => {
            if (rerun_upgrade) {
                console.log(`Got rerun_upgrade flag. running upgrade again from the new version to the same version (${upgrade})`);
                return sanity_build_test.run_test(server.ip, upgrade, true)
                    .catch(err => {
                        console.error(`Failed upgrading from the new version ${upgrade}`, err);
                        throw err;
                    });
            }
        });
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
                        '--lg_name', lg.name, '--lg_ip', lg.ip
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

function clean_test_env() {
    if (clean_by_id) {
        return azf.listVirtualMachinesBySuffix(id)
            .then(vms_to_delete => {
                console.log(`deleting virtual machines`, vms_to_delete);
                return P.map(vms_to_delete, vm =>
                    azf.deleteVirtualMachine(vm)
                    .catch(err => console.error(`failed deleting ${vm} with error: `, err.message))
                );
            });
    } else {
        let vms_to_delete = [
            ...agents.map(agent => agent.name),
            server.name.replace(/_/g, '-')
        ];
        console.log(`deleting virtual machines`, vms_to_delete);
        return P.map(vms_to_delete, vm =>
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
}

function print_usage() {
    console.log(`
Usage:  node ${process.argv0} --resource <resource-group> --vnet <vnet> --storage <storage-account> --name <server-name> --id <run id>
  --help               show this usage
  --resource <resource-group> the azure resource group to use
  --storage <storage-account> the azure storage account to use
  --vnet <vnet>               the azure virtual network to use
  --name                      the vm name
  --id                        run id - will be added to server name and agents
  --clean_only                only delete resources from previous runs
  --clean_by_id               delete all the machines with the specifyed id
  --cleanup                   delete all resources from azure env after the run
  --upgrade                   path to an upgrade package
  --rerun_upgrade             reruning the upgrade after the first upgrade
  --server_ip                 existing server ip
  --server_secret             existing server secret
  --js_script                 js script to run after env is ready (receives server_name, server_ip server_secret arguments)
  --shell_script              shell script to run after env is ready
  --skip_agent_creation       do not create new agents
  --skip_server_creation      do not create a new server, --server_ip and --server_secret must be supplied
  --create_lg                 create lg
  --lg_ip                     existing lg ip
  --server_external_ip        running with the server external ip (default: internal)
  --num_agents                number of agents to create, default is (default: ${num_agents})
  --min_required_agents       min number of agents required to run the desired tests, will fail if could not create this number of agents
  --min_required_agents       the minimum number of required agents (default: ${min_required_agents})
  --vm_size                   vm size can be A (A2) or B (B2) (default: ${vm_size})
`);
}

if (require.main === module) {
    verify_args();
    main();
}
