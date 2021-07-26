/* Copyright (C) 2016 NooBaa */
'use strict';

const os = require('os');
const path = require('path');
const argv = require('minimist')(process.argv);

const dbg = require('../../util/debug_module')(__filename);
dbg.set_process_name('test_env_builder_k8s');

const P = require('../../util/promise');
const os_utils = require('../../util/os_utils');
const server_functions = require('../utils/server_functions');
const Semaphore = require('../../util/semaphore');
const { KubernetesFunctions } = require('../../deploy/kubernetes_functions');

//Define colors 
const GREEN = "\x1b[32;1m";
const RED = "\x1b[31;1m";
const NC = "\x1b[0m";

if (process.env.SUPPRESS_LOGS) {
    dbg.set_module_level(-5, 'core');
}

const {
    context,
    output_dir = os.tmpdir(),
    image,
    noobaa_core_yaml = "src/deploy/NVA_build/noobaa_core.yaml",
    tests_list,
    single_test,
    exec,
    node_ip,
    clean: clean_single_test,
    debug,
    delete_on_fail = false,
    concurrency = 1
} = argv;

if (debug) {
    dbg.set_module_level(3, 'core');
} else {
    dbg.set_module_level(-1, 'core');
}

const deleted_namespaces = [];

function print_usage() {
    console.log(`
    Usage:  node ${process.argv[1]} [options]
      --help                    -   Show this usage
      --image                   -   Set the image to use
      --namespace_prefix        -   Prefix for created namespaces
      --clean                   -   Delete new namespace if used namespace_prefix
      --env                     -   pass environment variable to the test env containers. more than one can be passed e.g: --env ENV1=one --env ENV2=two
      --context                 -   The name of the kubeconfig context to use (default to current context)
      --node_ip                 -   Pass a node ip to access pods using nodePort
      --noobaa_core_yaml        -   Set the NooBaa core yaml
      --agent_cpu               -   Amount of cpu to request for agent pods
      --agent_mem               -   Amount of memory to request for agent pods
      --server_cpu              -   Amount of cpu to request for server pod
      --server_mem              -   Amount of memory to request for server pod
      --pv                      -   Use persistent volumes for deployed images. default is false
      --pull_always             -   Change image pull policy to always (not recommended but required if overriding an image tag with a different version)
      --single_test             -   Path to a single node.js test to run against the created environment
      --exec                    -   Command to run on the created server pod. if single_test is provided the command will run before the test
      --tests_list              -   Path to a js file containing tests list
      --concurrency             -   Maximum number of pods to run in parallel (server and agents). (default: ${concurrency})
      --output_dir              -   Path to store test output
      --delete_on_fail          -   Delete the test namespace on failed test (default ${delete_on_fail}).
      --debug                   -   run in debug mode
    `);
}


/**
 * returns array of env vars passed in argv, in the format [{name, value}]
 */
function get_env_vars() {
    // if env is not an array make it an array
    if (argv.env) {
        const envs = Array.isArray(argv.env) ? argv.env : [argv.env];
        return envs.map(env => {
            const [name, value] = env.split('=');
            if (!name || !value) {
                throw new Error(`failed to parse env vars. expecting format --env NAME=VALUE`);
            }
            return { name, value };
        });
    }
}

/**
 * @param {KubernetesFunctions} kf 
 */
async function build_env(kf, params) {
    const {
        server_cpu,
        server_mem,
        agent_cpu,
        agent_mem,
        pv,
        pull_always,
    } = params;
    try {
        console.log(`deploying noobaa server image ${image} in namespace ${kf.namespace}`);
        const envs = get_env_vars() || [];
        envs.push({ name: 'CREATE_SYS_NAME', value: 'demo' });
        envs.push({ name: 'CREATE_SYS_EMAIL', value: 'demo@noobaa.com' });
        envs.push({ name: 'CREATE_SYS_PASSWD', value: 'DeMo1' });

        const agent_profile = {
            image: image,
            use_persistent_storage: Boolean(pv),
            cpu: agent_cpu,
            memory: agent_mem
        };

        const server_details = await kf.deploy_server({
            image,
            server_yaml: noobaa_core_yaml,
            envs,
            cpu: server_cpu,
            mem: server_mem,
            pv,
            pull_always,
            agent_profile
        });
        console.log(`noobaa server deployed:`);
        console.log(`\tmanagement address: ${server_details.services.mgmt.address} ports:`, server_details.services.mgmt.ports);
        console.log(`\ts3 server address : ${server_details.services.s3.address} ports:`, server_details.services.s3.ports);

        // TODO: rewrite server_functions and agent_functions used here in a more clean and generic way.
        // create system
        const { address: mgmt_address, ports: mgmt_ports } = server_details.services.mgmt;
        const { address: s3_address, ports: s3_ports } = server_details.services.s3;
        console.log('waiting for system to be ready');
        await server_functions.wait_for_system_ready(mgmt_address, mgmt_ports['mgmt-https'], 'wss');

        // return services access information to pass to test
        return {
            mgmt_ip: mgmt_address,
            mgmt_port: mgmt_ports.mgmt,
            mgmt_port_https: mgmt_ports['mgmt-https'],
            s3_ip: s3_address,
            s3_port: s3_ports.s3,
            s3_port_https: s3_ports['s3-https'],
            pod_name: server_details.pod_name,
            kf
        };
    } catch (err) {
        console.error('failed building test environment', err);
        throw err;
    }

}

function get_flags(flags_obj) {
    const flags_arr = [];
    if (flags_obj !== undefined) {
        for (const flag of Object.keys(flags_obj)) {
            flags_arr.push('--' + flag);
            flags_arr.push(String(flags_obj[flag]));
        }
    }
    return flags_arr;
}

function should_delete_namespace(should_delete_on_fail, test_failed, clean, should_clean_single_test) {
    if (clean || should_clean_single_test) {
        if (should_delete_on_fail) {
            if (test_failed) {
                return false;
            } else {
                return true;
            }
        }
        return true;
    }
    return false;
}

async function run_single_test_env(params) {
    console.log(`Running single test env`);
    const {
        namespace,
        command,
        test,
        name,
        clean,
        await_clean,
        flags,
    } = params;

    const test_name = name || path.basename(test);
    let test_failed = false;

    const kf = new KubernetesFunctions({
        context,
        output_dir,
        node_ip,
        namespace,
    });

    try {
        await kf.init();
        const test_context = await build_env(kf, params);
        const {
            mgmt_ip,
            mgmt_port,
            mgmt_port_https,
            s3_ip,
            s3_port,
            s3_port_https,
            pod_name
        } = test_context;


        if (command) {
            try {
                console.log(`executing command on server pod: ${command}`);
                await kf.kubectl(`exec ${pod_name} -- ${command}`);
            } catch (err) {
                console.error(`failed running command on pod ${pod_name}. command: ${command}. error:`, err);
                test_failed = true;
            }
        }
        if (test && !test_failed) {
            const log_file = path.join(output_dir, `${test_name}.log`);
            console.log(`running test ${test_name}. test log: ${log_file}`);
            const additional_flags = get_flags(flags);
            //pass as args all test_env args with addition of services info 
            const args = [...process.argv, '--mgmt_ip', mgmt_ip,
                '--mgmt_port', mgmt_port,
                '--mgmt_port_https', mgmt_port_https,
                '--s3_ip', s3_ip,
                '--s3_port', s3_port,
                '--s3_port_https', s3_port_https,
                '--log_file', log_file,
                ...additional_flags
            ];
            await os_utils.fork(test, args, { env: process.env });
            console.log(`test ${test_name} passed`);
        }
    } catch (err) {
        test_failed = true;
        console.log(`test ${test_name} failed. ${err}`);
    }

    //Will not delete the namespace if the test has failed.
    if (should_delete_namespace(delete_on_fail, test_failed, clean, clean_single_test)) {
        console.log(`cleaning test environment - deleting namespace ${namespace}`);
        try {
            // for now by default delete namespaces in background. if running tests concurrently we might want to await
            if (await_clean) {
                await kf.delete_namespace();
            } else {
                deleted_namespaces.push(kf.delete_namespace());
            }
        } catch (err) {
            console.error(`failed to delete namespace ${namespace}`);
        }
    }

    if (test_failed) {
        throw new Error(`test failure`);
    }

}

async function run_multiple_test_envs(params) {
    console.log(`Running multiple test envs`);
    const {
        tests_list: tests_list_file,
        concurrency: tests_concurrency,
        namespace_prefix
    } = params;
    let tests;

    try {
        tests = require(tests_list_file); // eslint-disable-line global-require
    } catch (err) {
        console.error(`Failed to load tests list from ${tests_list_file}`);
        throw err;
    }

    try {
        if (tests_concurrency > 1) {
            await run_test_concurrently(tests_concurrency, tests, namespace_prefix, params);
        } else {
            await run_test_serially(tests, namespace_prefix, params);
        }
    } catch (err) {
        console.error(`something went wrong when running test list ${tests_list_file}`, err.message);
        throw err;
    }

    console.log('============================== Tests report: ==============================');
    for (const test of tests) {
        console.log(`${test.passed ? `${GREEN}===PASSED===${NC}` : `${RED}===FAILED===${NC}`} ${test.name}`);
    }
    console.log('===========================================================================');

    const any_failure = tests.some(test => !test.passed);
    if (any_failure) {
        throw new Error('Test run failed');
    }
}

async function run_test_concurrently(tests_concurrency, tests, namespace_prefix, params) {
    console.log(`Running tests with concurrently: ${tests_concurrency}`);
    const sem = new Semaphore(tests_concurrency);
    await P.all(tests.map(async test => {
        await sem.surround_count(1, () => run_test(namespace_prefix, test, params));
    }));
}

async function run_test_serially(tests, namespace_prefix, params) {
    console.log(`Running tests serially`);
    for (const test of tests) {
        await run_test(namespace_prefix, test, params);
    }
}

async function run_test(namespace_prefix, test, params) {
    const namespace = `${namespace_prefix}-${test.name}-${Date.now()}`;
    console.log(`=============== running test ${test.name} in namespace ${namespace} ===============`);
    // when running multiple envs force clean at the end of each run
    const test_params = { ...params, ...test, namespace, clean: true };
    try {
        await run_single_test_env(test_params);
        test.passed = true;
    } catch (err) {
        test.passed = false;
    }
}

async function main() {
    // let exit_code = 0;
    if (argv.help) {
        print_usage();
        process.exit(0);
    }


    let exit_code = 0;
    try {
        if (tests_list) {
            // run multiple tests
            await run_multiple_test_envs(argv);
        } else if (single_test || exec) {
            // build env and run a single test
            await run_single_test_env({ ...argv, command: exec, test: single_test, namespace: argv.namespace_prefix });
        } else {
            // just build env
            const namespace = argv.namespace_prefix;
            const kf = new KubernetesFunctions({
                context,
                output_dir,
                node_ip,
                namespace,
            });
            await kf.init();
            await build_env(kf, { ...argv, namespace });
        }

        // wait for all namespaces to be deleted
        await P.all(deleted_namespaces);
    } catch (err) {
        console.error('test_env_builder failed with error:', err);
        exit_code = 1;
    }

    if (exit_code === 0) {
        console.log('Test run completed successfully');
    } else {
        console.log('Test run failed!!');
    }

    process.exit(exit_code);
}



if (require.main === module) {
    main();
}
