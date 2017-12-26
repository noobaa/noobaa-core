/* Copyright (C) 2016 NooBaa */
'use strict';



const argv = require('minimist')(process.argv);

const dbg = require('../../util/debug_module')(__filename);

const AzureFunctions = require('../../deploy/azureFunctions');
const agent_functions = require('../../test/qa/functions/agent_functions');
const sanity_build_test = require('../system_tests/sanity_build_test');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');

// Environment Setup
require('../../util/dotenv').load();
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
    cleanup,
    upgrade,
    server_ip,
    server_secret,
    js_script,
    shell_script,
    help,
    min_required_agents = 7
} = argv;

const agents = oses.map(osname => ({ name: osname + '-' + id, os: osname }));
const server = { name: name + '-' + id, ip: server_ip, secret: server_secret };
const created_agents = [];


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
                    .then(() => process.exit(0));
            }
        })
        // create server and agents vms
        .then(() => P.join(prepare_server(), prepare_agents()))
        // take agent_conf from the server and install agents
        .spread((dummy, agents_ips) => install_agents())
        .then(upgrade_test_env)
        .then(run_tests)
        .catch(err => {
            console.error('got error:', err);
            exit_code = 1;
        })
        .finally(() => {
            if (cleanup) return clean_test_env();
        })
        .finally(() => process.exit(exit_code));
}


//this function is getting servers array creating and upgrading them.
function prepare_server() {
    console.log(`prepare_server: creating server ${server.name}`);
    return azf.createServer({
            serverName: server.name,
            vnet,
            storage,
            // TODO GUY Temporary attempt to use larger VM size
            vmSize: 'Standard_A8_v2',
        })
        .then(new_secret => {
            server.secret = new_secret;
            return azf.getIpAddress(server.name + '_pip');
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
    console.log(`starting the create agents stage`);
    return P.map(agents, agent => azf.createAgent({
                vmName: agent.name,
                storage,
                vnet,
                os: azf.getImagesfromOSname(agent.os),
            })
            .then(ip => {
                console.log(`assign ip ${ip} to ${agent.name}`);
                agent.prepared = true;
                agent.ip = ip;
                created_agents.push(agent);
            })
            .catch(err => {
                console.error(`Creating agent ${agent.name} VM failed`, err);
            })
        )
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
    let num_installed = 0;
    return agent_functions.getAgentConf(server.ip, [])
        .then(agent_conf => {
            console.log(`got agent conf: ${agent_conf}`);
            return P.map(created_agents, agent => {
                    console.log(`installing agent on ${agent.name}`);
                    return azf.createAgentExtension({
                            vmName: agent.name,
                            storage,
                            vnet,
                            os: azf.getImagesfromOSname(agent.os),
                            serverName: server.ip,
                            agentConf: agent_conf,
                        })
                        .then(
                            () => { // successfully installed
                                num_installed += 1;
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
                });
        });
}



// upgrade server to the required version.
// currently using sanity_build_test.js script
function upgrade_test_env() {
    if (!upgrade) {
        return;
    }
    console.log(`upgrading server with package ${upgrade}`);
    return sanity_build_test.upgrade_and_test(server.ip, upgrade)
        .catch(err => {
            console.error('upgrade_test_env failed', err);
            throw err;
        });
}

function run_tests() {
    // disable all dbg.log output before running tests
    dbg.set_console_output(false);
    dbg.original_console();
    if (js_script) {
        console.log(`running js script ${js_script} on ${server.name}`);
        return promise_utils.fork(js_script, ['--server_name', server.name, '--server_ip', server.ip, '--server_secret', server.secret])
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
}

function clean_test_env() {
    const vms_to_delete = agents.map(agent => agent.name).concat([server.name]);
    console.log(`deleting virtual machines`, vms_to_delete);
    return P.map(vms_to_delete, vm => azf.deleteVirtualMachine(vm));
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

  --cleanup                   delete all resources from azure env after the run
  --clean_only                only delete resources from previous runs
  --upgrade                   path to an upgrade package
  --js_script                 js script to run after env is ready (receives server_name, server_ip server_secret arguments)
  --shell_script              shell script to run after env is ready
`);
}

if (require.main === module) {
    main();
}
