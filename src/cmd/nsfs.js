/* Copyright (C) 2020 NooBaa */
'use strict';
/* eslint-disable complexity */

require('../util/dotenv').load();
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nsfs');
dbg.original_console();

// NC nsfs deployments specifying process.env.LOCAL_MD_SERVER=true deployed together with a db
// when a system_store object is initialized VaccumAnalyzer is being called once a day.
// when NC nsfs deployed without db we would like to avoid running VaccumAnalyzer in any flow there is
// because running it will cause a panic.
if (process.env.LOCAL_MD_SERVER !== 'true') {
    process.env.NC_NSFS_NO_DB_ENV = 'true';
}
const config = require('../../config');

const os = require('os');
const fs = require('fs');
const util = require('util');
const minimist = require('minimist');

if (process.env.LOCAL_MD_SERVER === 'true') {
    require('../server/system_services/system_store').get_instance({ standalone: true });
}

//const js_utils = require('../util/js_utils');
const nb_native = require('../util/nb_native');
//const schema_utils = require('../util/schema_utils');
const RpcError = require('../rpc/rpc_error');
const ObjectSDK = require('../sdk/object_sdk');
const NamespaceFS = require('../sdk/namespace_fs');
const BucketSpaceSimpleFS = require('../sdk/bucketspace_simple_fs');
const BucketSpaceFS = require('../sdk/bucketspace_fs');
const SensitiveString = require('../util/sensitive_string');
const endpoint_stats_collector = require('../sdk/endpoint_stats_collector');
const path = require('path');
const json_utils = require('../util/json_utils');
//const { RPC_BUFFERS } = require('../rpc');
const pkg = require('../../package.json');
const AccountSDK = require('../sdk/account_sdk');
const AccountSpaceFS = require('../sdk/accountspace_fs');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;

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

    --http_port <port>         (default 6001)   Set the S3 endpoint listening HTTP port to serve.
    --https_port <port>        (default 6443)   Set the S3 endpoint listening HTTPS port to serve.
    --https_port_sts <port>    (default -1)     Set the S3 endpoint listening HTTPS port for STS.
    --https_port_iam <port>    (default -1)     Set the endpoint listening HTTPS port for IAM.
    --metrics_port <port>      (default -1)     Set the metrics listening port for prometheus.
    --forks <n>                (default none)   Forks spread incoming requests (config.ENDPOINT_FORKS used if flag is not provided).
    --debug <level>            (default 0)      Increase debug level.

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

class NsfsObjectSDK extends ObjectSDK {
    constructor(fs_root, fs_config, account, versioning, config_root) {
        // const rpc_client_hooks = new_rpc_client_hooks();
        // rpc_client_hooks.account.read_account_by_access_key = async ({ access_key }) => {
        //     if (access_key) {
        //         return { access_key };
        //     }
        // };
        // rpc_client_hooks.bucket.read_bucket_sdk_info = async ({ name }) => {
        //     if (name) {
        //         return { name };
        //     }
        // };
        let bucketspace;
        if (config_root) {
            bucketspace = new BucketSpaceFS({ config_root });
        } else {
            bucketspace = new BucketSpaceSimpleFS({ fs_root });
        }
        super({
            rpc_client: null,
            internal_rpc_client: null,
            object_io: null,
            bucketspace,
            stats: endpoint_stats_collector.instance(),
        });
        this.nsfs_config_root = nsfs_config_root;
        this.nsfs_fs_root = fs_root;
        this.nsfs_fs_config = fs_config;
        this.nsfs_account = account;
        this.nsfs_versioning = versioning;
        this.nsfs_namespaces = {};
        if (!config_root) {
            this._get_bucket_namespace = bucket_name => this._simple_get_single_bucket_namespace(bucket_name);
            this.load_requesting_account = auth_req => this._simple_load_requesting_account(auth_req);
            this.read_bucket_sdk_policy_info = bucket_name => this._simple_read_bucket_sdk_policy_info(bucket_name);
            this.read_bucket_sdk_config_info = () => undefined;
            this.read_bucket_usage_info = () => undefined;
            this.read_bucket_sdk_website_info = () => undefined;
            this.read_bucket_sdk_namespace_info = () => undefined;
            this.read_bucket_sdk_caching_info = () => undefined;
        }
    }

    async _simple_get_single_bucket_namespace(bucket_name) {
        const existing_ns = this.nsfs_namespaces[bucket_name];
        if (existing_ns) return existing_ns;
        const ns_fs = new NamespaceFS({
            fs_backend: this.nsfs_fs_config.backend,
            bucket_path: this.nsfs_fs_root + '/' + bucket_name,
            bucket_id: 'nsfs',
            namespace_resource_id: undefined,
            access_mode: undefined,
            versioning: this.nsfs_versioning,
            stats: endpoint_stats_collector.instance(),
            force_md5_etag: false,
        });
        this.nsfs_namespaces[bucket_name] = ns_fs;
        return ns_fs;
    }

    async _simple_load_requesting_account(auth_req) {
        const access_key = this.nsfs_account.access_keys?.[0]?.access_key;
        if (access_key) {
            const token = this.get_auth_token();
            if (!token) {
                throw new RpcError('UNAUTHORIZED', `Anonymous access to bucket not allowed`);
            }
            if (token.access_key !== access_key.unwrap()) {
                throw new RpcError('INVALID_ACCESS_KEY_ID', `Account with access_key not found`);
            }
        }
        this.requesting_account = this.nsfs_account;
    }

    async _simple_read_bucket_sdk_policy_info(bucket_name) {
        return {
            s3_policy: {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['*'],
                    Resource: ['*'],
                    Principal: [new SensitiveString('*')],
                }]
            },
            system_owner: new SensitiveString('nsfs'),
            bucket_owner: new SensitiveString('nsfs'),
        };
    }
}

// NsfsAccountSDK was based on NsfsObjectSDK
// simple flow was not implemented
class NsfsAccountSDK extends AccountSDK {
    constructor(fs_root, fs_config, account, config_root) {
        let bucketspace;
        let accountspace;
        if (config_root) {
            bucketspace = new BucketSpaceFS({ config_root });
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

async function init_nsfs_system(config_root) {
    const system_data_path = path.join(config_root, 'system.json');
    const system_data = new json_utils.JsonFileWrapper(system_data_path);

    const data = await system_data.read();
    const hostname = os.hostname();
    // If the system data already exists, we should not create it again
    if (data?.[hostname]?.current_version) return;

    try {
        await system_data.update({
            ...data,
            [hostname]: {
                current_version: pkg.version,
                upgrade_history: {
                    successful_upgrades: [],
                    last_failure: undefined
                }
            }
        });
        console.log('created NSFS system data with version: ', pkg.version);
    } catch (err) {
        const msg = 'failed to create NSFS system data due to - ' + err.message;
        const error = new Error(msg);
        console.error(msg, err);
        throw error;
    }
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        config.DB_TYPE = 'none';
        config.NSFS_VERSIONING_ENABLED = true;
        // when using data buckets on noobaa standalone we should set it to true
        config.ENABLE_OBJECT_IO_SEMAPHORE_MONITOR = false;

        if (argv.help || argv.h) return print_usage();
        if (argv.debug) {
            const debug_level = Number(argv.debug) || 5;
            dbg.set_module_level(debug_level, 'core');
            nb_native().fs.set_debug_level(debug_level);
        }
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
        const metrics_port = Number(argv.metrics_port) || config.EP_METRICS_SERVER_PORT;
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
            metrics_port,
            backend,
            forks,
            access_key,
            secret_key,
            uid,
            gid,
            nsfs_config_root,
        });

        if (!simple_mode) await init_nsfs_system(nsfs_config_root);

        const endpoint = require('../endpoint/endpoint');
        await endpoint.main({
            http_port,
            https_port,
            https_port_sts,
            https_port_iam,
            metrics_port,
            forks,
            nsfs_config_root,
            init_request_sdk: (req, res) => {
                req.object_sdk = new NsfsObjectSDK(fs_root, fs_config, account, versioning, nsfs_config_root);
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
