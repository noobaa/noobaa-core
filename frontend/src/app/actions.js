import * as model from 'model';
import page from 'page';
import api from 'services/api';
import config from 'config';
import { hostname } from 'server-conf';

import {
    isDefined, isUndefined, encodeBase64, cmpStrings, cmpInts, cmpBools,
    randomString, last, clamp,  makeArray, execInOrder, realizeUri, downloadFile
} from 'utils';

// TODO: resolve browserify issue with export of the aws-sdk module.
// The current workaround use the AWS that is set on the global window object.
import 'aws-sdk';
AWS = window.AWS;

// Use preconfigured hostname or the addrcess of the serving computer.
let endpoint = hostname || window.location.hostname;

// -----------------------------------------------------
// Utility function to log actions.
// -----------------------------------------------------
function logAction(action, payload) {
    if (typeof payload !== 'undefined') {
        console.info(`action dispatched: ${action} with`, payload);
    } else {
        console.info(`action dispatched: ${action}`);
    }
}

// -----------------------------------------------------
// Applicaiton start action
// -----------------------------------------------------
export function start() {
    logAction('start');

    api.options.auth_token = localStorage.getItem('sessionToken');
    return api.auth.read_auth()
        // Try to restore the last session
        .then(({account, system}) => {
            if (isDefined(account)) {
                model.sessionInfo({
                    user: account.email,
                    system: system.name
                });
            }
        })
        // Start the router.
        .then(
            () => page.start()
        )
        .done()
}

// -----------------------------------------------------
// Navigation actions
// -----------------------------------------------------
export function navigateTo(path = window.location.pathname, query = {}) {
    logAction('navigateTo', { path, query });

    page.show(
        realizeUri(path, model.routeContext().params, query)
    );
}

export function redirectTo(path = window.location.pathname, query = {}) {
    logAction('redirectTo', { path, query });

    page.redirect(
        realizeUri(path, model.routeContext().params, query)
    );
}

export function reloadTo(path = window.location.pathname, query = {}) {
    logAction('reloadTo', { path, query });

    // Force full browser refresh
    window.location.href = realizeUri(path, model.routeContext().params, query)
}

export function refresh() {
    logAction('refresh');

    let { pathname, search } = window.location;

    // Refresh the current path
    page.redirect(pathname + search);

    model.refreshCounter(model.refreshCounter() + 1);
}

// -----------------------------------------------------
// High level UI update actions.
// -----------------------------------------------------
export function showLogin() {
    logAction('showLogin');

    let session = model.sessionInfo();
    let ctx = model.routeContext();

    if (!!session) {
        redirectTo(`/fe/systems/${session.system}`);

    } else {
        model.uiState({
            layout: 'login-layout',
            returnUrl: ctx.query.returnUrl,
        });

        loadServerInfo();
    }
}

export function showOverview() {
    logAction('showOverview');

    model.uiState({
        layout: 'main-layout',
        title: 'OVERVIEW',
        breadcrumbs: [
            { href: 'fe/systems/:system' }
        ],
        panel: 'overview'
    });

    loadSystemSummary();
}

export function showBuckets() {
    logAction('showBuckets');

    model.uiState({
        layout: 'main-layout',
        title: 'BUCKETS',
        breadcrumbs: [
            { href: 'fe/systems/:system' },
            { href: 'buckets', label: 'BUCKETS' }
        ],
        panel: 'buckets',
    });

    let { sortBy, order } = model.routeContext().query;
    loadBucketList(sortBy, order);
}

export function showBucket() {
    logAction('showBucket');

    let ctx = model.routeContext();
    let { bucket, tab = 'objects' } = ctx.params;
    let { filter, sortBy = 'name', order = 1, page = 0 } = ctx.query;

    model.uiState({
        layout: 'main-layout',
        title: bucket,
        breadcrumbs: [
            { href: 'fe/systems/:system' },
            { href: 'buckets', label: 'BUCKETS' },
            { href: ':bucket', label: bucket }
        ],
        panel: 'bucket',
        tab: tab
    });

    loadBucketInfo(bucket);
    loadBucketObjectList(bucket, filter, sortBy, parseInt(order), parseInt(page));
}

export function showObject() {
    logAction('showObject');

    let ctx = model.routeContext();
    let { object, bucket, tab = 'parts' } = ctx.params;
    let { page = 0 } = ctx.query;

    model.uiState({
        layout: 'main-layout',
        title: object,
        breadcrumbs: [
            { href: 'fe/systems/:system' },
            { href: 'buckets', label: 'BUCKETS' },
            { href: ':bucket', label: bucket },
            { href: 'objects/:object', label: object }
        ],
        panel: 'object',
        tab: tab
    });

    loadObjectMetadata(bucket, object)
    loadObjectPartList(bucket, object, parseInt(page));
}

export function showPools() {
    logAction('showPools');

    model.uiState({
        layout: 'main-layout',
        title: 'POOLS',
        breadcrumbs: [
            { href: 'fe/systems/:system' },
            { href: 'pools', label: 'POOLS'}
        ],
        panel: 'pools'
    });

    let { sortBy, order } = model.routeContext().query;
    loadPoolList(sortBy, order);
}

export function showPool() {
    logAction('showPool');

    let ctx = model.routeContext();
    let { pool, tab = 'nodes' } = ctx.params;
    let { filter, sortBy = 'name', order = 1, page = 0 } = ctx.query;


    model.uiState({
        layout: 'main-layout',
        title: pool,
        breadcrumbs: [
            { href: 'fe/systems/:system' },
            { href: 'pools', label: 'POOLS' },
            { href: ':pool', label: pool }
        ],
        panel: 'pool',
        tab: tab
    });

    loadPoolInfo(pool);
    loadPoolNodeList(pool, filter, sortBy, parseInt(order), parseInt(page));
}

export function showNode() {
    logAction('showNode');

    let ctx = model.routeContext();
    let { pool, node, tab = 'info' } = ctx.params;
    let { page = 0 } = ctx.query;

    model.uiState({
        layout: 'main-layout',
        title: node,
        breadcrumbs: [
            { href: 'fe/systems/:system' },
            { href: 'pools', label: 'POOLS' },
            { href: ':pool', label: pool },
            { href: 'nodes/:node', label: node }
        ],
        panel: 'node',
        tab: tab
    });

    loadNodeInfo(node);
    loadNodeStoredPartsList(node, parseInt(page));
}

export function showManagement() {
    logAction('showManagement');

    let { tab = 'accounts' } = model.routeContext().params;

    model.uiState({
        layout: 'main-layout',
        title: 'SYSTEM MANAGEMENT',
        breadcrumbs: [
            { href: "fe/systems/:system" },
            { href: "management", label: 'SYSTEM MANAGEMENT' }
        ],
        panel: 'management',
        tab: tab
    });
}

export function showCreateBucketWizard() {
    loadAction('showCreateBucketModal')
}

export function openAuditLog() {
    logAction('openAuditLog');

    model.uiState(
        Object.assign(model.uiState(), {
            tray: { componentName: 'audit-pane' }
        })
    );
}

export function closeTray() {
    logAction('closeTray');

    model.uiState(
        Object.assign(model.uiState(), { tray: null })
    );
}

// -----------------------------------------------------
// Sign In/Out actions.
// -----------------------------------------------------
export function signIn(email, password, redirectUrl) {
    logAction('signIn', { email, password, redirectUrl });

    api.create_auth_token({ email, password })
        .then(() => api.system.list_systems())
        .then(
            ({ systems }) => {
                let system = systems[0].name;

                return api.create_auth_token({ system, email, password })
                    .then(({ token }) => {
                        localStorage.setItem('sessionToken', token);

                        model.sessionInfo({ user: email, system: system })
                        model.loginInfo({ retryCount: 0 });

                        if (isUndefined(redirectUrl)) {
                            redirectUrl = `/fe/systems/${system}`;
                        }

                        redirectTo(decodeURIComponent(redirectUrl));
                    })
            }
        )
        .catch(
            err => {
                if (err.rpc_code === 'UNAUTHORIZED') {
                    model.loginInfo({
                        retryCount: model.loginInfo().retryCount + 1
                    });

                } else {
                    throw err;
                }
            }
        )
        .done();
}

export function signOut() {
    localStorage.removeItem('sessionToken');
    model.sessionInfo(null);
    refresh();
}

// -----------------------------------------------------
// Information retrieval actions.
// -----------------------------------------------------
export function loadServerInfo() {
    logAction('loadServerInfo');

    api.account.accounts_status()
        .then(
            reply => model.serverInfo({
                initialized: reply.has_accounts
            })
        )
        .done();
}

export function loadSystemInfo() {
    logAction('loadSystemInfo');

    api.system.read_system()
        .then(
            reply => {
                let { access_key, secret_key } = reply.owner.access_keys[0];

                model.systemInfo({
                    status: 'active',
                    name: reply.name,
                    version: reply.version,
                    endpoint: endpoint,
                    ipAddress: reply.ip_address,
                    dnsName: reply.dns_name,
                    port: reply.web_port,
                    sslPort: reply.ssl_port,
                    accessKey: access_key,
                    secretKey: secret_key,
                    P2PConfig: reply.n2n_config
                });
            }
        )
        .done();
}

export function loadSystemSummary() {
    logAction('loadSystemSummary');

    api.system.read_system()
        .then(
            reply => model.systemSummary({
                capacity: reply.storage.total,
                bucketCount: reply.buckets.length,
                objectCount: reply.objects,
                poolCount: reply.pools.length,
                nodeCount: reply.nodes.count,
                onlineNodeCount: reply.nodes.online,
                offlineNodeCount: reply.nodes.count - reply.nodes.online
            })
        )
        .done();
}

const bucketCmpFuncs = Object.freeze({
    state: (b1, b2) => cmpBools(b1.state, b2.state),
    name: (b1, b2) => cmpStrings(b1.name, b2.name),
    filecount: (b1, b2) => cmpInts(b1.num_objects, b2.num_objects),
    totalsize: (b1, b2) => cmpInts(b1.storage.total, b2.storage.total),
    freesize: (b1, b2) => cmpInts(b1.storage.free, b2.storage.free),
    cloudsync: (b1, b2) => cmpStrings(b1.cloud_sync_status, b2.cloud_sync_status)
});

export function loadBucketList(sortBy = 'name', order = 1) {
    logAction('loadBucketList', { sortBy, order });

    // Normalize the order.
    order = clamp(order, -1, 1);

    let bucketList = model.bucketList;
    api.system.read_system()
        .then(
            ({ buckets }) => {
                bucketList(
                    buckets.sort(
                        (b1, b2) => order * bucketCmpFuncs[sortBy](b1, b2)
                    )
                );
                bucketList.sortedBy(sortBy);
                bucketList.order(order);
            }
        )
        .done();
}

const poolCmpFuncs = Object.freeze({
    state: (p1, p2) => cmpBools(true, true),
    name: (p1, p2) => cmpStrings(p1.name, p2.name),
    nodecount: (p1, p2) => cmpInts(p1.nodes.count, p2.nodes.count),
    onlinecount: (p1, p2) => cmpInts(p1.nodes.online, p2.nodes.online),
    offlinecount: (p1, p2) => cmpInts(
        p1.nodes.count - p1.nodes.online,
        p2.nodes.count - p2.nodes.online,
    ),
    usage: (p1, p2) => cmpInts(p1.storage.used, p2.storage.used),
    capacity: (p1, p2) => cmpInts(p1.storage.total, p2.storage.total),
});

export function loadPoolList(sortBy = 'name', order = 1) {
    logAction('loadPoolList', { sortBy, order });

    // Normalize the order.
    order = clamp(order, -1, 1);

    let poolList = model.poolList;
    api.system.read_system()
        .then(
            ({ pools }) => {
                poolList(
                    pools.sort(
                        (b1, b2) => order * poolCmpFuncs[sortBy](b1, b2)
                    )
                );
                poolList.sortedBy(sortBy);
                poolList.order(order);
            }
        )
        .done();
}

export function loadAgentInstallationInfo() {
    logAction('loadAgentInstallationInfo');

    let { agentInstallationInfo } = model;
    api.system.read_system()
        .then(
            reply => {
                let keys = reply.owner.access_keys[0];

                agentInstallationInfo({
                    agentConf: encodeBase64({
                        address: reply.base_address,
                        system: reply.name,
                        access_key: keys.access_key,
                        secret_key: keys.secret_key,
                        tier: 'nodes',
                        root_path: './agent_storage/'
                    }),
                    downloadUris: {
                        windows: reply.web_links.agent_installer,
                        linux: reply.web_links.linux_agent_installer
                    }
                });
            }
        )
        .done();
}

export function loadBucketInfo(name) {
    logAction('loadBucketInfo', { name });

    api.bucket.read_bucket({ name })
        .then(model.bucketInfo)
        .done();
}

export function loadBucketPolicy(name) {
    logAction('loadBucketPolicy', { name });

    model.bucketPolicy(null);
    api.tiering_policy.read_policy({ name })
        .then(model.bucketPolicy)
        .done();
}

export function loadBucketObjectList(bucketName, filter, sortBy, order, page) {
    logAction('loadBucketObjectList', { bucketName, filter, sortBy, order, page });

    let bucketObjectList = model.bucketObjectList;

    api.object.list_objects({
            bucket: bucketName,
            key_query: filter,
            sort: sortBy,
            order: order,
            skip: config.paginationPageSize * page,
            limit: config.paginationPageSize,
            pagination: true
        })
        .then(
            reply => {
                bucketObjectList(reply.objects);
                bucketObjectList.sortedBy(sortBy);
                bucketObjectList.filter(filter);
                bucketObjectList.order(order);
                bucketObjectList.page(page);
                bucketObjectList.count(reply.total_count);
            }
        )
        .done();
}

export function loadObjectMetadata(bucketName, objectName) {
    logAction('loadObjectMetadata', { bucketName, objectName });

    // Drop previous data if of diffrent object.
    if (!!model.objectInfo() && model.objectInfo().name !== objectName) {
        model.objectInfo(null);
    }

    let objInfoPromise = api.object.read_object_md({
         bucket: bucketName,
         key: objectName,
         get_parts_count: true
    });

    let S3Promise = api.system.read_system()
        .then(
            reply => {
                let { access_key, secret_key } = reply.owner.access_keys[0];

                return new AWS.S3({
                    endpoint: endpoint,
                    credentials: {
                        accessKeyId:  access_key,
                        secretAccessKey:  secret_key
                    },
                    s3ForcePathStyle: true,
                    sslEnabled: false,
                    signatureVersion: 'v4',
                    region: 'eu-central-1'
                })
            }
        );

    Promise.all([objInfoPromise, S3Promise])
        .then(
            ([objInfo, s3]) => model.objectInfo({
                name: objectName,
                bucket: bucketName,
                info: objInfo,
                s3Url: s3.getSignedUrl(
                    'getObject',
                    { Bucket: bucketName, Key: objectName }
                )
            })
        );
}

export function loadObjectPartList(bucketName, objectName, page) {
    logAction('loadObjectPartList', { bucketName, objectName, page });

    api.object.read_object_mappings({
        bucket: bucketName,
        key: objectName,
        skip: config.paginationPageSize * page,
        limit: config.paginationPageSize,
        adminfo: true
    })
        .then(
            ({ total_parts, parts }) => {
                model.objectPartList(parts);
                model.objectPartList.page(page);
                model.objectPartList.count(total_parts);
            }
        )
        .done();
}

export function loadPoolInfo(name) {
    logAction('loadPoolInfo', { name });

    if (model.poolInfo() && model.poolInfo().name !== name) {
        model.poolInfo(null);
    }

    api.pool.read_pool({ name })
        .then(model.poolInfo)
        .done();
}

export function loadPoolNodeList(poolName, filter, sortBy, order, page) {
    logAction('loadPoolNodeList', { poolName, filter, sortBy, order, page });

    api.node.list_nodes({
        query: {
            pools: [ poolName ],
            name: filter
        },
        sort: sortBy,
        order: order,
        skip: config.paginationPageSize * page,
        limit: config.paginationPageSize,
        pagination: true
    })
        .then(
            reply => {
                model.poolNodeList(reply.nodes);
                model.poolNodeList.count(reply.total_count);
                model.poolNodeList.filter(filter);
                model.poolNodeList.sortedBy(sortBy);
                model.poolNodeList.order(order);
                model.poolNodeList.page(page)
            }
        )
        .done();
}

export function loadNodeList() {
    logAction('loadNodeList');

    model.nodeList([]);
    api.node.list_nodes({})
        .then(
            ({nodes}) => model.nodeList(nodes)
        )
        .done();
}

export function loadNodeInfo(nodeName) {
    logAction('loadNodeInfo', { nodeName });

    if (model.nodeInfo() && model.nodeInfo().name !== nodeName) {
        model.nodeInfo(null);
    }

    api.node.read_node({ name: nodeName })
        .then(
            // TODO: remove assign after implementing trusted in the server.
            nodeInfo => model.nodeInfo(
                Object.assign(nodeInfo, { trusted: true })
            )
        )
        .done();
}

export function loadNodeStoredPartsList(nodeName, page) {
    logAction('loadNodeStoredPartsList', { nodeName, page });

    api.node.read_node_maps({ name: nodeName })
        .then(
            reply => {
                let parts = reply.objects
                    .map(
                        obj => obj.parts.map(
                            part => {
                                return {
                                    object: obj.key,
                                    bucket: obj.bucket,
                                    info: part
                                }
                            }
                        )
                    )
                    .reduce(
                        (list, objParts) => {
                            list.push(...objParts);
                            return list;
                        },
                        []
                    );

                // TODO: change to server side paganation when avaliable.
                let pageParts = parts.slice(
                    config.paginationPageSize * page,
                    config.paginationPageSize * (page + 1),
                );

                model.nodeStoredPartList(pageParts);
                model.nodeStoredPartList.page(page);
                model.nodeStoredPartList.count(parts.length);
            }
        )
        .done();
}

export function loadAuditEntries(categories, count) {
    logAction('loadAuditEntries', { categories, count });

    let auditLog = model.auditLog;
    let filter = categories
        .map(
            category => `(^${category}.)`
        )
        .join('|');

    if (filter !== '') {
        api.system.read_activity_log({
            event: filter || '^$',
            limit: count
        })
            .then(
                ({ logs }) => {
                    auditLog(logs.reverse());
                    auditLog.loadedCategories(categories);
                }
            )
            .done();

    } else {
        auditLog([]);
        auditLog.loadedCategories([]);
    }
}

export function loadMoreAuditEntries(count) {
    logAction('loadMoreAuditEntries', { count });

    let auditLog = model.auditLog;
    let lastEntryTime = last(auditLog()).time;
    let filter = model.auditLog.loadedCategories()
        .map(
            category => `(^${category}.)`
        )
        .join('|');

    if (filter !== '') {
        api.system.read_activity_log({
            event: filter,
            till: lastEntryTime,
            limit: count
        })
            .then(
                ({ logs }) => auditLog.push(...logs.reverse())
            )
            .done()
    }
}

export function loadAccountList() {
    logAction('loadAccountList');

    api.account.list_accounts()
        .then(
            ({ accounts }) => model.accountList(accounts)
        )
        .done()
}

export function loadTier(name) {
    logAction('loadTier', { name });

    api.tier.read_tier({ name })
        .then(model.tierInfo)
        .done();
}

export function loadCloudSyncInfo(bucket) {
    logAction('loadCloudSyncInfo', { bucket });

    api.bucket.get_cloud_sync_policy({ name: bucket })
        .then(model.cloudSyncInfo)
        .done();
}

export function loadAccountAwsCredentials() {
    logAction('loadAccountAwsCredentials');

    api.account.get_account_sync_credentials_cache()
        .then(model.awsCredentialsList)
        .done();
}

export function loadAwsBucketList(accessKey, secretKey,endPoint) {
    logAction('loadAwsBucketList', { accessKey, secretKey,endPoint})

    api.bucket.get_cloud_buckets({
        endpoint: endPoint,
        access_key: accessKey,
        secret_key: secretKey
    })
        .then(
            model.awsBucketList,
            () => model.awsBucketList(null)
        )
        .done();
}

// -----------------------------------------------------
// Managment actions.
// -----------------------------------------------------
export function createSystemAccount(systemName, email, password, dnsName) {
    logAction('createSystemAccount', { systemName, email, password, dnsName });

    api.account.create_account({ name: systemName, email: email, password: password })
        .then(
            ({ token }) => {
                api.options.auth_token = token;
                localStorage.setItem('sessionToken', token);
                model.sessionInfo({ user: email, system: systemName});
            }
        )
        .then(
            () => {
                if (dnsName) {
                    return api.system.update_hostname({
                        hostname: dnsName
                    });
                }
            }
        )
        .then(
            () => redirectTo(`/fe/systems/${systemName}`)
        )
        .done();
}

export function createAccount(name, email, password) {
    logAction('createAccount', { name, email, password });

    api.account.create_account({ name, email, password })
        .then(loadAccountList)
        .done();
}

export function deleteAccount(email) {
    logAction('deleteAccount', { email });

    api.account.delete_account({ email })
        .then(loadAccountList)
        .done();
}

export function resetAccountPassword(email, password) {
    logAction('resetAccountPassword', { email, password });

    api.account.update_account({ email, password })
        .done();
}

export function createBucket(name, dataPlacement, pools) {
    logAction('createBucket', { name, dataPlacement, pools });

    let { bucketList } = model;

    // TODO: remove the random string after patching the server
    // with a delete bucket that deletes also the policy
    let bucket_with_suffix = `${name}#${Date.now().toString(36)}`;

    api.tier.create_tier({
        name: bucket_with_suffix,
        data_placement: dataPlacement,
        pools: pools
    })
        .then(
            tier => {
                let policy = {
                    name: bucket_with_suffix,
                    tiers: [ { order: 0, tier: tier.name } ]
                };

                return api.tiering_policy.create_policy(policy)
                    .then(() => policy)
            }
        )
        .then(
            policy => api.bucket.create_bucket({
                name: name,
                tiering: policy.name
            })
        )
        .then(
            () => loadBucketList(bucketList.sortedBy(), bucketList.order())
        )
        .done();
}

export function deleteBucket(name) {
    logAction('deleteBucket', { name });

    api.bucket.delete_bucket({ name })
        .then(refresh)
        .done();
}

export function updateTier(name, dataPlacement, pools) {
    logAction('updateTier', { name, dataPlacement, pools });

    api.tier.update_tier({
        name: name,
        data_placement: dataPlacement,
        pools: pools
    })
        .done();
}

export function createPool(name, nodes) {
    logAction('createPool', { name, nodes });

    let { poolList } = model;
    api.pool.create_pool({ name, nodes })
        .then(
            () => loadPoolList(poolList.sortedBy(), poolList.order())
        )
        .done();
}

export function deletePool(name) {
    logAction('deletePool', { name });

    api.pool.delete_pool({ name })
        .then(refresh)
        .done();
}

export function assignNodes(name, nodes) {
    logAction('assignNodes', { name, nodes });

    api.pool.assign_nodes_to_pool({
        name: name,
        nodes: nodes
    })
        .then(refresh)
        .done();
}

export function uploadFiles(bucketName, files) {
    logAction('uploadFiles', { bucketName, files });

    let recentUploads = model.recentUploads;
    api.system.read_system()
        .then(
            reply => {
                let { access_key, secret_key } = reply.owner.access_keys[0];

                return new AWS.S3({
                    endpoint: endpoint,
                    credentials: {
                        accessKeyId:  access_key,
                        secretAccessKey:  secret_key
                    },
                    s3ForcePathStyle: true,
                    sslEnabled: false,
                })
            }
        )
        .then(
            s3 => {
                let uploadRequests = Array.from(files).map(
                    file => new Promise(
                        (resolve, reject) => {
                            // Create an entry in the recent uploaded list.
                            let entry = {
                                name: file.name,
                                state: 'UPLOADING',
                                progress: 0,
                                error: null
                            };
                            recentUploads.unshift(entry);

                            // Start the upload.
                            s3.upload(
                                {
                                    Key: file.name,
                                    Bucket: bucketName,
                                    Body: file,
                                    ContentType: file.type
                                },
                                {
                                    partSize: 64 * 1024 * 1024,
                                    queueSize: 4
                                },
                                error => {
                                    if (!error) {
                                        entry.state = 'COMPLETED';
                                        entry.progress = 1;
                                        resolve(1);

                                    } else {
                                        entry.state = 'FAILED';
                                        entry.error = error;

                                        // This is not a bug we want to resolve failed uploads
                                        // in order to finalize the entire upload process.
                                        resolve(0);
                                    }

                                    // Use replace to trigger change event.
                                    recentUploads.replace(entry, entry);
                                }
                            )
                            //  Report on progress.
                            .on('httpUploadProgress',
                                ({ loaded, total }) => {
                                    entry.progress = loaded / total;

                                    // Use replace to trigger change event.
                                    recentUploads.replace(entry, entry);
                                }
                            );
                        }
                    )
                );

                return Promise.all(uploadRequests);
            }
        )
        .then(
            results => results.reduce(
                (sum, result) => sum += result
            )
        )
        .then(
            completedCount => {
                completedCount > 0 && refresh()
            }
        );
}

export function testNode(source, testSet) {
    logAction('testNode', { source, testSet });

    let { nodeTestInfo } = model;
    nodeTestInfo({
        source: source,
        tests: testSet,
        timestemp: Date.now(),
        results: [],
        state:'IN_PROGRESS'
    });

    let { targetCount, testSettings } = config.nodeTest;
    api.node.get_test_nodes({
        count: targetCount
    })
        .then(
            // Aggregate selected tests.
            targets => [].concat(
                ...testSet.map(
                    testType => targets.map(
                        ({ name, rpc_address }) => {
                            let result = {
                                testType: testType,
                                targetName: name,
                                targetAddress: rpc_address,
                                state: 'WAITING',
                                time: 0,
                                position: 0,
                                speed: 0,
                                progress: 0,
                                session: ''
                            }
                            nodeTestInfo().results.push(result);

                            return {
                                testType: testType,
                                source: source,
                                target: rpc_address,
                                result: result
                            };
                        }
                    )
                )
            )
        )
        .then(
            // Execute the tests in order.
            tests => execInOrder(
                tests,
                ({ source, target, testType, result }) => {
                    if (nodeTestInfo().state === 'ABORTING') {
                        result.state = 'ABORTED';
                        nodeTestInfo.valueHasMutated();
                        return;
                    }

                    let { stepCount, requestLength, responseLength, count, concur } = testSettings[testType];
                    let stepSize = count * (requestLength + responseLength);
                    let totalTestSize = stepSize * stepCount;

                    // Create a step list for the test.
                    let steps = makeArray(
                        stepCount,
                        {
                            source: source,
                            target: target,
                            request_length: requestLength,
                            response_length: responseLength,
                            count: count,
                            concur: concur
                        }
                    );

                    // Set start time.
                    let start = Date.now();
                    result.state = 'RUNNING';

                    // Execute the steps in order.
                    return execInOrder(
                        steps,
                        stepRequest => {
                            if (nodeTestInfo().state === 'ABORTING'){
                                return true;
                            }

                            return api.node.self_test_to_node_via_web(stepRequest)
                                .then(
                                    ({ session }) => {
                                        result.session = session;
                                        result.time = Date.now() - start;
                                        result.position = result.position + stepSize;
                                        result.speed = result.position / result.time;
                                        result.progress = totalTestSize > 0 ?
                                            result.position / totalTestSize :
                                            1;

                                        // Notify subscribers on the change.
                                        nodeTestInfo.valueHasMutated();
                                    }
                                );
                        }
                    )
                    .then(
                        res => res === true ? 'ABORTED' : 'COMPLETED',
                        () => 'FAILED'
                    )
                    .then(
                        state => {
                            // Notify subscribers on the change.
                            result.state = state;
                            nodeTestInfo.valueHasMutated();
                        }
                    )
                }
            )
        )
        .then(
            () => nodeTestInfo.assign({
                state: nodeTestInfo().state === 'ABORTING' ? 'ABORTED' : 'COMPLETED'
            })
        )
        .done();
}

export function abortNodeTest() {
    logAction('abortNodeTest');

    let nodeTestInfo = model.nodeTestInfo;
    if (nodeTestInfo().state === 'IN_PROGRESS') {
        nodeTestInfo.assign({
            state: 'ABORTING'
        });
    }
}

export function updateP2PSettings(minPort, maxPort) {
    logAction('updateP2PSettings', { minPort, maxPort });

    let tcpPermanentPassive = minPort !== maxPort ?
        { min: minPort, max: maxPort } :
        { port: minPort };

    api.system.update_n2n_config({
        tcp_permanent_passive: tcpPermanentPassive
    })
        .then(loadSystemInfo)
        .done();
}

export function updateHostname(hostname) {
    logAction('updateHostname', { hostname });

    api.system.update_hostname({ hostname })
        .then(loadSystemInfo)
        .done();
}

export function upgradeSystem(upgradePackage) {
    logAction('upgradeSystem', { upgradePackage });

    function ping() {
        let xhr = new XMLHttpRequest();
        xhr.open('GET', '/version', true);
        xhr.onload = () => reloadTo('/fe/systems/:system', { afterupgrade: true });
        xhr.onerror = evt => setTimeout(ping, 10000);
        xhr.send()
    }

    let { upgradeStatus } = model;
    upgradeStatus({
        step: 'UPLOAD',
        progress: 0,
        state: 'IN_PROGRESS'
    });

    let xhr = new XMLHttpRequest();
    xhr.open('POST', '/upgrade', true);

    xhr.upload.onprogress = function(evt) {
        upgradeStatus.assign({
            progress: evt.lengthComputable && evt.loaded / evt.total
        })
    };

    xhr.onload = function(evt) {
        if (xhr.status === 200) {
            setTimeout(
                () => {
                    upgradeStatus({
                        step: 'INSTALL',
                        progress: 0,
                        state: 'IN_PROGRESS'
                    });

                    setTimeout(ping, 7000);
                },
                3000
            );
        } else {
            upgradeStatus.assign({
                state: 'FAILED',
            });
        }    };

    xhr.onerror = function(evt) {
        upgradeStatus.assign({
            state: 'FAILED'
        });
    };

    xhr.onabort = function(evt) {
        upgradeStatus.assign({
            state: 'CANCELED'
        });
    };

    let formData = new FormData();
    formData.append('upgrade_file', upgradePackage);
    xhr.send(formData);
}

export function downloadDiagnosticPack(nodeName) {
    logAction('downloadDiagnosticFile', { nodeName });

    api.node.read_node({ name: nodeName })
        .then(
            node => api.node.collect_agent_diagnostics({ target: node.rpc_address })
        )
        .then(
            url => downloadFile(url)
        )
        .done();
}

export function raiseNodeDebugLevel(node) {
    logAction('raiseNodeDebugLevel', { node });

    api.node.read_node({ name: node })
        .then(
            node => api.node.set_debug_node({
                target: node.rpc_address
            })
        )
        .then(
            () => loadNodeInfo(node)
        )
        .done();
}

export function setCloudSyncPolicy(bucket, awsBucket, credentials, direction, frequency, sycDeletions) {
    logAction('setCloudSyncPolicy', { bucket, awsBucket, credentials, direction, frequency,
        sycDeletions });

    let policy_endpoint =  credentials.endpoint||'https://s3.amazonaws.com';
    delete credentials.endpoint;

    api.bucket.set_cloud_sync({
        name: bucket,
        policy: {
            endpoint:policy_endpoint,
            target_bucket: awsBucket,
            access_keys: [ credentials ],
            c2n_enabled: direction === 'AWS2NB' || direction === 'BI',
            n2c_enabled: direction === 'NB2AWS' || direction === 'BI',
            schedule: frequency,
            additions_only: !sycDeletions
        }
    })
        .then(refresh)
        .done();
}

export function removeCloudSyncPolicy(bucket) {
    logAction('removeCloudSyncPolicy', { bucket });

    api.bucket.delete_cloud_sync({ name: bucket })
        .then(
            () => model.cloudSyncInfo(null)
        )
        .then(refresh)
        .done();
}

export function addAWSCredentials(accessKey, secretKey, endPoint) {
    logAction('addAWSCredentials', { accessKey, secretKey, endPoint });

    let credentials = {
        endpoint: endPoint,
        access_key: accessKey,
        secret_key: secretKey
    };

    // TODO: the call to get_cloud_sync is used here to check that the keys are valid,
    // and the server can access S3 using this keys. Need to replace this with a sort of
    // s3 ping when avaliable in server side.
    api.bucket.get_cloud_buckets(credentials)
        .then(
            () => api.account.add_account_sync_credentials_cache(credentials)
        )
        .then(loadAccountAwsCredentials)
        .done();
}

export function notify(message, severity = 'INFO') {
    logAction('notifyInfo', { message, severity });

    model.lastNotification({ message, severity });
}
