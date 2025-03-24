/* Copyright (C) 2020 NooBaa */
'use strict';
/* eslint-disable complexity */

// DO NOT PUT NEW REQUIREMENTS BEFORE SETTING process.env.NC_NSFS_NO_DB_ENV = 'true' 
// NC nsfs deployments specifying process.env.LOCAL_MD_SERVER=true deployed together with a db
// when a system_store object is initialized VaccumAnalyzer is being called once a day.
// when NC nsfs deployed without db we would like to avoid running VaccumAnalyzer in any flow there is
// because running it will cause a panic.
if (process.env.LOCAL_MD_SERVER !== 'true') {
    process.env.NC_NSFS_NO_DB_ENV = 'true';
}
require('../util/dotenv').load();
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nsfs');
dbg.original_console();

const config = require('../../config');

const os = require('os');
const fs = require('fs');
const util = require('util');
const minimist = require('minimist');
const { ConfigFS } = require('../sdk/config_fs');

if (process.env.LOCAL_MD_SERVER === 'true') {
    require('../server/system_services/system_store').get_instance({ standalone: true });
}

//const js_utils = require('../util/js_utils');
const nb_native = require('../util/nb_native');
//const schema_utils = require('../util/schema_utils');
const { cluster } = require('../util/fork_utils');
const BucketSpaceSimpleFS = require('../sdk/bucketspace_simple_fs');
const BucketSpaceFS = require('../sdk/bucketspace_fs');
const SensitiveString = require('../util/sensitive_string');
const endpoint_stats_collector = require('../sdk/endpoint_stats_collector');
//const { RPC_BUFFERS } = require('../rpc');
const AccountSDK = require('../sdk/account_sdk');
const NsfsObjectSDK = require('../sdk/nsfs_object_sdk');
const AccountSpaceFS = require('../sdk/accountspace_fs');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;
const { set_debug_level } = require('../manage_nsfs/manage_nsfs_cli_utils');
const { NCUpgradeManager } = require('../upgrade/nc_upgrade_manager');

const HELP = `
Help:

    "nsfs" is a noobaa-core command runs a local S3 endpoint on top of a filesystem.
    Each sub directory of the root filesystem represents an S3 bucket.
    Objects data and meta-data is stored and retrieved from the files.
    For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    node src/cmd/nsfs <root-path> [options...]
`;

const ARGUMENTS = `
Arguments:

    <root-path>      Set the root of the filesystem where each subdir is a bucket.
`;

const OPTIONS = `
Options:

    --http_port <port>          (default 6001)      Set the S3 endpoint listening HTTP port to serve.
    --https_port <port>         (default 6443)      Set the S3 endpoint listening HTTPS port to serve.
    --https_port_sts <port>     (default -1)        Set the S3 endpoint listening HTTPS port for STS.
    --https_port_iam <port>     (default -1)        Set the endpoint listening HTTPS port for IAM.
    --http_metrics_port <port>      (default 7004)    Set the metrics listening HTTP port for prometheus.
    --https_metrics_port <port>     (default 9443)    Set the metrics listening HTTPS port for prometheus.
    --forks <n>                     (default none)  Forks spread incoming requests (config.ENDPOINT_FORKS used if flag is not provided).
    --debug <level>                 (default 0)     Increase debug level.

    ## single user mode

    --simple <boolean>   (default false)        Starts a single user/fs mode
    --uid <uid>          (default as process)   Send requests to the Filesystem with uid.
    --gid <gid>          (default as process)   Send requests to the Filesystem with gid.
    --access_key <key>      (default none)      Authenticate incoming requests for this access key only (default is no auth).
    --secret_key <key>      (default none)      The secret key pair for the access key.

    ## multi user mode

    --config_root <dir>     (default ${config.NSFS_NC_DEFAULT_CONF_DIR})    Configuration files for Noobaa standalon NSFS. It includes config files for environment variables(<config_root>/.env), 
                                                            local configuration(<config_root>/config-local.js), authentication (<config_root>/accounts/<access-key>.json) and 
                                                            bucket schema (<config_root>/buckets/<bucket-name>.json).

    ## features

    --backend <fs>          (default none)      Use custom backend fs to CEPH_FS 'GPFS', 'NFSv4').
    --versioning <mode>   (default DISABLED)    Set versioning mode to DISABLED | ENABLED | SUSPENDED.

`;

const ANONYMOUS_AUTH_WARNING = `

WARNING:

    !!! AUTHENTICATION is not enabled !!!
    
    This means that any access/secret signature or unsigned (anonymous) requests
    will allow access to the filesystem over the network.
`;

function print_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(ARGUMENTS.trimStart());
    console.warn(OPTIONS.trimStart());
    process.exit(1);
}

let nsfs_config_root;


// NsfsAccountSDK was based on NsfsObjectSDK
// simple flow was not implemented
class NsfsAccountSDK extends AccountSDK {
    constructor(fs_root, fs_config, account, config_root) {
        let bucketspace;
        let accountspace;
        if (config_root) {
            bucketspace = new BucketSpaceFS({ config_root }, endpoint_stats_collector.instance());
            accountspace = new AccountSpaceFS({ config_root });
        } else {
            bucketspace = new BucketSpaceSimpleFS({ fs_root });
            accountspace = new AccountSpaceFS({ fs_root });
        }
        super({
            rpc_client: null,
            internal_rpc_client: null,
            bucketspace: bucketspace,
            accountspace: accountspace,
        });
        this.nsfs_config_root = nsfs_config_root;
        this.nsfs_fs_root = fs_root;
        this.nsfs_fs_config = fs_config;
        this.nsfs_account = account;
        this.nsfs_namespaces = {};
    }
}

/* eslint-disable max-statements */
async function main(argv = minimist(process.argv.slice(2))) {
    try {
        config.DB_TYPE = 'none';
        config.EVENT_LOGGING_ENABLED = true;
        config.NSFS_VERSIONING_ENABLED = true;
        // when using data buckets on noobaa standalone we should set it to true
        config.ENABLE_OBJECT_IO_SEMAPHORE_MONITOR = false;

        if (argv.help || argv.h) return print_usage();
        if (argv.debug) set_debug_level(argv.debug);
        const simple_mode = Boolean(argv.simple);
        if (!simple_mode) {
            nsfs_config_root = config.NSFS_NC_CONF_DIR;
            if (argv.config_root) {
                nsfs_config_root = String(argv.config_root);
                config.NSFS_NC_CONF_DIR = nsfs_config_root;
                require('../../config').load_nsfs_nc_config();
                require('../../config').reload_nsfs_nc_config();
            }
        }
        const http_port = Number(argv.http_port) || config.ENDPOINT_PORT;
        const https_port = Number(argv.https_port) || config.ENDPOINT_SSL_PORT;
        const https_port_sts = Number(argv.https_port_sts) || config.ENDPOINT_SSL_STS_PORT;
        const https_port_iam = Number(argv.https_port_iam) || config.ENDPOINT_SSL_IAM_PORT;
        const http_metrics_port = Number(argv.http_metrics_port) || config.EP_METRICS_SERVER_PORT;
        const https_metrics_port = Number(argv.https_metrics_port) || config.EP_METRICS_SERVER_SSL_PORT;
        const forks = Number(argv.forks) || config.ENDPOINT_FORKS;
        if (forks > 0) process.env.ENDPOINT_FORKS = forks.toString(); // used for argv.forks to take effect
        const uid = Number(argv.uid) || process.getuid();
        const gid = Number(argv.gid) || process.getgid();
        const access_key = argv.access_key && new SensitiveString(String(argv.access_key));
        const secret_key = argv.secret_key && new SensitiveString(String(argv.secret_key));
        const backend = argv.backend || (process.env.GPFS_DL_PATH ? 'GPFS' : '');
        const versioning = argv.versioning || 'DISABLED';
        const fs_root = argv._[0] || '';

        const fs_config = {
            uid,
            gid,
            backend,
            warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
        };
        verify_gpfslib();
        const account = {
            email: new SensitiveString('nsfs@noobaa.io'),
            nsfs_account_config: fs_config,
            access_keys: access_key && [{ access_key, secret_key }],
        };

        if (fs_root !== '' && !fs.existsSync(fs_root)) {
            console.error('Error: Root path not found', fs_root);
            return print_usage();
        }
        if (nsfs_config_root && access_key) {
            console.error('Error: Access key and IAM dir cannot be used together');
            return print_usage();
        }
        if (Boolean(access_key) !== Boolean(secret_key)) {
            console.error('Error: Access and secret keys should be either both set or else both unset');
            return print_usage();
        }
        if (!access_key && !nsfs_config_root) {
            console.log(ANONYMOUS_AUTH_WARNING);
        }

        console.log('nsfs: setting up ...', {
            fs_root,
            http_port,
            https_port,
            https_port_sts,
            https_port_iam,
            http_metrics_port,
            https_metrics_port,
            backend,
            forks,
            access_key,
            secret_key,
            uid,
            gid,
            nsfs_config_root,
        });

        let system_data;
        if (!simple_mode) {
            // Do not move this function - we need to create/update RPM changes before starting the endpoint
            const config_fs = new ConfigFS(nsfs_config_root);
            system_data = await config_fs.get_system_config_file({ silent_if_missing: true });
            if (system_data && system_data[os.hostname()]) {
                const nc_upgrade_manager = new NCUpgradeManager(config_fs);
                await nc_upgrade_manager.update_rpm_upgrade();
            } else {
                system_data = await config_fs.register_hostname_in_system_json();
            }
        }

        const endpoint = require('../endpoint/endpoint');
        await endpoint.main({
            http_port,
            https_port,
            https_port_sts,
            https_port_iam,
            http_metrics_port,
            https_metrics_port,
            forks,
            nsfs_config_root,
            init_request_sdk: (req, res) => {
                req.object_sdk = new NsfsObjectSDK(fs_root, fs_config, account, versioning, nsfs_config_root, system_data);
                req.account_sdk = new NsfsAccountSDK(fs_root, fs_config, account, nsfs_config_root);
            }
        });
        if (config.ALLOW_HTTP) {
            console.log('nsfs: listening on', util.inspect(`http://localhost:${http_port}`));
        }
        console.log('nsfs: listening on', util.inspect(`https://localhost:${https_port}`));
        if (https_port_iam > 0) {
            console.log('nsfs: IAM listening on', util.inspect(`https://localhost:${https_port_iam}`));
        }
    } catch (err) {
        console.error('nsfs: exit on error', err.stack || err);
        //noobaa crashed
        new NoobaaEvent(NoobaaEvent.S3_CRASHED).create_event(undefined, undefined, err);
        process.exit(2);
    }
}

function verify_gpfslib() {
    if (!nb_native().fs.gpfs) {
        new NoobaaEvent(NoobaaEvent.GPFSLIB_MISSING).create_event(undefined, { gpfs_dl_path: process.env.GPFS_DL_PATH }, undefined);
        return;
    }
    if (cluster.isPrimary) {
        const gpfs_noobaa_args = {
            version: 0,
            delay: Number(config.GPFS_DOWN_DELAY),
            flags: 0
        };
        nb_native().fs.gpfs.register_gpfs_noobaa(gpfs_noobaa_args);
    }
}

// TODO: uncomment
// /**
//  * @returns {nb.APIClient}
//  */
// function new_rpc_client_hooks() {
//     return {
//         account: {},
//         bucket: {},
//         auth: {},
//         system: {},
//         tier: {},
//         node: {},
//         host: {},
//         object: {},
//         events: {},
//         agent: {},
//         block_store: {},
//         stats: {},
//         scrubber: {},
//         debug: {},
//         redirector: {},
//         tiering_policy: {},
//         pool: {},
//         cluster_server: {},
//         cluster_internal: {},
//         server_inter_process: {},
//         hosted_agents: {},
//         func: {},
//         func_node: {},
//         replication: {},
//         options: {},
//         RPC_BUFFERS,
//         async create_auth_token(params) {
//             return {};
//         },
//         async create_access_key_auth(params) {
//             return {};
//         },
//         async create_k8s_auth(params) {
//             return {};
//         },
//     };
// }
// 

exports.main = main;

if (require.main === module) main();
