/* Copyright (C) 2016 NooBaa */
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { KubernetesFunctions, IS_IN_POD } = require('../../deploy/kubernetes_functions');
const argv = require('minimist')(process.argv);
const server_functions = require('../utils/server_functions');
const agent_functions = require('../utils/agent_functions');
const promise_utils = require('../../util/promise_utils');
const P = require('../../util/promise');

const dbg = require('../../util/debug_module')(__filename);
dbg.set_process_name('test_env_builder_k8s');


const {
    server_image,
    namespace_prefix,
    clean,
    agent_image,
    noobaa_core_yaml = "src/deploy/NVA_build/noobaa_core.yaml",
    context,
    num_agents = 0,
    debug,
    test,
    exec,
    output_dir = os.tmpdir(),
    server_cpu,
    server_mem,
    agent_cpu,
    agent_mem,
    node_ip,
    pv,
} = argv;

if (debug) {
    dbg.set_level(3, 'core');
} else {
    dbg.set_level(-1, 'core');
}


function exit_with_error(msg, err) {
    console.error('Error:', msg, err || '');
    process.exit(1);
}

function print_usage() {
    console.log(`
    Usage:  node ${process.argv[1]} [options]
      --help                    -   Show this usage
      --image                   -   Set the image to use
      --namespace_prefix        -   Run env in a new namespace and name it with the given perfix. can be used when running externally only
      --clean                   -   Delete new namespace if used namespace_prefix
      --env                     -   pass environment variable to the test env containers. more than one can be passed e.g: --env ENV1=one --env ENV2=two
      --context                 -   The name of the kubeconfig context to use (default to current context)
      --node_ip                 -   Pass a node ip to access pods using nodePort
      --noobaa_core_yaml        -   Set the NooBaa core yaml
      --num_agents              -   Change the number of agents from the agent yaml default 
      --agent_cpu               -   Amount of cpu to request for agent pods
      --agent_mem               -   Amount of memory to request for agent pods
      --server_cpu              -   Amount of cpu to request for server pod
      --server_mem              -   Amount of memory to request for server pod
      --pv                      -   Use persistent volumes for deployed images. default is false
      --output_dir              -   Path to store test output
      --debug                   -   run in debug mode
    `);
}


function get_envs() {
    // if env is not an array make it an array
    if (argv.env) {
        const envs = Array.isArray(argv.env) ? argv.env : [argv.env];
        return envs.map(env => {
            const [name, value] = env.split('=');
            if (!name || !value) {
                exit_with_error('--env flag must be in the format "--env NAME=VALUE"');
            }
            return { name, value };
        });
    }
}

async function main() {
    // let exit_code = 0;
    if (argv.help) {
        print_usage();
        process.exit(0);
    }

    if (IS_IN_POD && namespace_prefix) {
        exit_with_error('namespace_prefix is invalid. cannot create a new namespace when running inside a pod');
    }

    const kf = new KubernetesFunctions({
        context,
        output_dir,
        namespace_prefix,
        node_ip
    });
    try {
        await kf.init();
        console.log(`deploying noobaa server image ${server_image} in namespace ${kf._namespace}`);
        const server_details = await kf.deploy_server({
            image: server_image,
            server_yaml: noobaa_core_yaml,
            envs: get_envs(),
            cpu: server_cpu,
            mem: server_mem,
            pv,
        });
        console.log(`noobaa server deployed:`);
        console.log(`\tmanagement address: ${server_details.services.mgmt.address} ports:`, server_details.services.mgmt.ports);
        console.log(`\ts3 server address : ${server_details.services.s3.address} ports:`, server_details.services.s3.ports);

        // TODO: rewrite server_functions and agent_functions used here in a more clean and generic way.
        // create system 
        const { address: mgmt_address, ports: mgmt_ports } = server_details.services.mgmt;
        await server_functions.create_system(mgmt_address, mgmt_ports['mgmt-https']);

        const pool_name = 'first.pool';
        console.log(`creating new pool '${pool_name}'`);
        await server_functions.create_pool(mgmt_address, mgmt_ports['mgmt-https'], pool_name);
        console.log(`deploying ${num_agents} agents in ${pool_name}`);
        const agents_yaml = await agent_functions.get_agents_yaml(mgmt_address, mgmt_ports['mgmt-https'], pool_name, IS_IN_POD ? 'INTERNAL' : 'EXTERNAL');
        const agents_yaml_path = path.join(output_dir, 'agents.yaml');
        await fs.writeFileSync(agents_yaml_path, agents_yaml);
        await kf.deploy_agents({
            image: agent_image,
            num_agents,
            agents_yaml: agents_yaml_path,
            envs: get_envs(),
            cpu: agent_cpu,
            mem: agent_mem,
            pv
        });

        console.log(`waiting for ${num_agents} agents to be in optimal state`);
        await wait_for_agents_optimal(mgmt_address, mgmt_ports['mgmt-https'], num_agents);
        console.log(`all agents are in optimal state`);

        // run test\remote command
        let exit_code = 0;
        try {
            if (test) {
                await run_test(test, server_details.services);
            } else if (exec) {
                console.log(`executing commad on server pod: ${exec}`);
                await kf.kubectl(`exec ${server_details.pod_name} -- ${exec}`);
            }
        } catch (err) {
            if (err.code && Number.isInteger(err.code)) {
                exit_code = err.code;
            } else {
                exit_code = 1;
            }
        }

        if (clean && namespace_prefix) {
            await kf.delete_namespace();
        }

        if (exit_code === 0) {
            console.log('Completed successfully');
        } else {
            console.log('Completed with error');
        }
        process.exit(exit_code);
    } catch (err) {
        exit_with_error('test_env_builder failed with error:', err);
    }

}

async function run_test(test_file, services) {
    try {
        console.log(`running test ${test_file}`);
        //pass as args all test_env args with addition of services info 
        const args = process.argv.concat([
            '--mgmt_ip', services.mgmt.address,
            '--mgmt_port', services.mgmt.ports.mgmt,
            '--mgmt_port_https', services.mgmt.ports['mgmt-https'],
            '--s3_ip', services.s3.address,
            '--s3_port', services.s3.ports.s3,
            '--s3_port_https', services.s3.ports['s3-https'],
        ]);
        await promise_utils.fork(test_file, args);
    } catch (err) {
        console.log(`Test ${test_file} failed with error:`, err);
        throw err;
    }
}


async function wait_for_agents_optimal(server_ip, server_port, expected_num_optimal, timeout) {
    // default timeout of 5 minutes
    timeout = timeout || 5 * 60000;
    await P.resolve()
        .then(async () => {
            while (await server_functions.get_num_optimal_agents(server_ip, server_port) !== expected_num_optimal) {
                await P.delay(5000);
            }
        })
        .timeout(timeout);

}

if (require.main === module) {
    main();
}
