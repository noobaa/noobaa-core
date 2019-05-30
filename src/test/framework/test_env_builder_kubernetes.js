/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const KubernetesFunctions = require('../../deploy/kubernetes_functions');
const argv = require('minimist')(process.argv, { string: ['server_secret'] });

dbg.set_process_name('test_env_builder_kubernetes');

const {
    image_tag,
    // noobaa_core_yaml = "src/deploy/NVA_build/noobaa_core.yaml",
    namespace = "",
    skip_agent_creation,
    clean_only,
} = argv;

function print_usage() {
    console.log(`
    Usage:  node ${process.argv[1]} [options]
      --help                    -   Show this usage
      --image_tag               -   Set the image tag
      --namespace               -   Set the Namespace
      --noobaa_core_yaml        -   Set the NooBaa core yaml
      --skip_agent_creation     -   Do not create new agents
      --num_agents              -   Change the number of agents from the agent yaml default
      --clean_only              -   Only delete resources from previous runs
    `);
}

async function main() {
    const kf = new KubernetesFunctions(image_tag);
    // let exit_code = 0;
    if (argv.help) {
        print_usage();
        process.exit(0);
    }

    // await kf.check_pod_is_running({ namespace, pod_name: "noobaa-server-0" });
    // process.exit();

    await kf.authenticate();

    if (clean_only) {
        try {
            await kf.delete_namespace({ namespace });
            process.exit(0);
        } catch (err) {
            console.error('got error on cleanup (clean only):', err);
            process.exit(1);
        }
    }
    // await kf.create_server({ yaml_path: noobaa_core_yaml, namespace });
    if (skip_agent_creation) {
        console.log('skipping agents creation');
    } else {
        await kf.create_agent({ namespace });
    }

}

if (require.main === module) {
    main();
}
