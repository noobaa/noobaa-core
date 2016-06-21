import * as model from 'model';
import page from 'page';
import api from 'services/api';
import config from 'config';
import * as routes from 'routes';

import { isDefined, isUndefined, last, makeArray, execInOrder, realizeUri,
    downloadFile, generateAccessKeys } from 'utils';

// TODO: resolve browserify issue with export of the aws-sdk module.
// The current workaround use the AWS that is set on the global window object.
import 'aws-sdk';
let AWS = window.AWS;

// Use preconfigured hostname or the addrcess of the serving computer.
let endpoint = window.location.hostname;

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
        .done();
}

// -----------------------------------------------------
// Navigation actions
// -----------------------------------------------------
export function navigateTo(route = window.location.pathname, params = {},  query = {}) {
    logAction('navigateTo', { route, params, query });

    page.show(
        realizeUri(route, Object.assign({}, model.routeContext().params, params), query)
    );
}

export function redirectTo(route = window.location.pathname, params = {}, query = {}) {
    logAction('redirectTo', { route, params, query });

    page.redirect(
        realizeUri(route, Object.assign({}, model.routeContext().params, params), query)
    );
}

export function reloadTo(route = window.location.pathname, params = {},  query = {}) {
    logAction('reloadTo', { route, params, query });

    // Force full browser refresh
    window.location.href = realizeUri(
        route, Object.assign({}, model.routeContext().params, params), query
    );
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

    if (session) {
        redirectTo(routes.system, { system: session.system });

    } else {
        model.uiState({
            layout: 'login-layout',
            returnUrl: ctx.query.returnUrl
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
            { route: 'system' }
        ],
        panel: 'overview'
    });
}

export function showBuckets() {
    logAction('showBuckets');

    model.uiState({
        layout: 'main-layout',
        title: 'BUCKETS',
        breadcrumbs: [
            { route: 'system' },
            { route: 'buckets', label: 'BUCKETS' }
        ],
        panel: 'buckets'
    });
}

export function showBucket() {
    logAction('showBucket');

    let ctx = model.routeContext();
    let { bucket, tab = 'data-placement' } = ctx.params;
    let { filter, sortBy = 'name', order = 1, page = 0 } = ctx.query;

    model.uiState({
        layout: 'main-layout',
        title: bucket,
        breadcrumbs: [
            { route: 'system' },
            { route: 'buckets', label: 'BUCKETS' },
            { route: 'bucket', label: bucket }
        ],
        panel: 'bucket',
        tab: tab
    });

    loadBucketObjectList(bucket, filter, sortBy, parseInt(order), parseInt(page));
}

export function showObject() {
    logAction('showObject');

    let ctx = model.routeContext();
    let { object, bucket, tab = 'details' } = ctx.params;
    let { page = 0 } = ctx.query;

    model.uiState({
        layout: 'main-layout',
        title: object,
        breadcrumbs: [
            { route: 'system' },
            { route: 'buckets', label: 'BUCKETS' },
            { route: 'bucket', label: bucket },
            { route: 'object', label: object }
        ],
        panel: 'object',
        tab: tab
    });

    loadObjectMetadata(bucket, object);
    loadObjectPartList(bucket, object, parseInt(page));
}

export function showResources() {
    logAction('showResources');

    let ctx = model.routeContext();
    let { tab = 'pools' } = ctx.params;
    model.uiState({
        layout: 'main-layout',
        title: 'POOLS',
        breadcrumbs: [
            { route: 'system' },
            { route: 'pools', label: 'RESOURCES'}
        ],
        panel: 'resources',
        tab: tab
    });
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
            { route: 'system' },
            { route: 'pools', label: 'POOLS'},
            { route: 'pool', label: pool }
        ],
        panel: 'pool',
        tab: tab
    });

    loadPoolNodeList(pool, filter, sortBy, parseInt(order), parseInt(page));
}

export function showNode() {
    logAction('showNode');

    let ctx = model.routeContext();
    let { pool, node, tab = 'details' } = ctx.params;
    let { page = 0 } = ctx.query;

    model.uiState({
        layout: 'main-layout',
        title: node,
        breadcrumbs: [
            { route: 'system' },
            { route: 'pools', label: 'POOLS'},
            { route: 'pool', label: pool },
            { route: 'node', label: node }
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
            { route: 'system' },
            { route: 'management', label: 'SYSTEM MANAGEMENT' }
        ],
        panel: 'management',
        tab: tab
    });
}

export function showCreateBucketWizard() {
    logAction('showCreateBucketModal');
}

export function openDrawer() {
    logAction('openDrawer');

    model.uiState(
        Object.assign(model.uiState(), { drawer: true })
    );
}

export function closeDrawer() {
    logAction('closeDarwer');

    model.uiState(
        Object.assign(model.uiState(), { drawer: false })
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

                        model.sessionInfo({ user: email, system: system });
                        model.loginInfo({ retryCount: 0 });

                        if (isUndefined(redirectUrl)) {
                            redirectTo(routes.system, { system });
                        } else {
                            redirectTo(decodeURIComponent(redirectUrl));
                        }
                    });
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
                    P2PConfig: reply.n2n_config,
                    owner: reply.owner.email,
                    timeConfig: reply.time_config,
                    debugLevel: reply.debug_level,
                    maintenance: reply.maintenance_mode,
                    phoneHomeConfig: reply.phone_home_config,
                    remoteSyslogConfig: reply.remote_system_config,
                    capacity: reply.storage.total,
                    bucketCount: reply.buckets.length,
                    objectCount: reply.objects,
                    poolCount: reply.pools.length,
                    nodeCount: reply.nodes.count,
                    onlineNodeCount: reply.nodes.online,
                    offlineNodeCount: reply.nodes.count - reply.nodes.online,
                    baseAddress: reply.base_address,
                    buckets: reply.buckets,
                    pools: reply.pools,
                    agentDownloadUris: {
                        windows: reply.web_links.agent_installer,
                        linux: reply.web_links.linux_agent_installer
                    }
                });
            }
        )
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
    if (!!model.objectInfo() && model.objectInfo().key !== objectName) {
        model.objectInfo(null);
    }

    let { accessKey = '' ,secretKey = '' } = model.systemInfo();
    let s3 = new AWS.S3({
        endpoint: endpoint,
        credentials: {
            accessKeyId:  accessKey,
            secretAccessKey:  secretKey
        },
        s3ForcePathStyle: true,
        sslEnabled: false,
        signatureVersion: 'v4',
        region: 'eu-central-1'
    });

    api.object.read_object_md({
        bucket: bucketName,
        key: objectName,
        get_parts_count: true
    })
        .then(
            objInfo => {
                let s3_signed_url = s3.getSignedUrl(
                    'getObject',
                    { Bucket: bucketName, Key: objectName, Expires: 604800 }
                );

                model.objectInfo(
                    Object.assign(objInfo, { s3_signed_url })
                );
            }
        )
        .done();
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

export function loadPoolNodeList(poolName, filter, sortBy, order, page) {
    logAction('loadPoolNodeList', { poolName, filter, sortBy, order, page });

    api.node.list_nodes({
        query: {
            pools: [ poolName ],
            filter: filter
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
                model.poolNodeList.page(page);
            }
        )
        .done();
}

export function loadNodeList() {
    logAction('loadNodeList');

    model.nodeList([]);
    api.node.list_nodes({})
        .then(
            ({ nodes }) => model.nodeList(nodes)
        )
        .done();
}

export function loadNodeInfo(nodeName) {
    logAction('loadNodeInfo', { nodeName });

    if (model.nodeInfo() && model.nodeInfo().name !== nodeName) {
        model.nodeInfo(null);
    }

    api.node.read_node({ name: nodeName })
        .then(model.nodeInfo)
        .done();
}

export function loadNodeStoredPartsList(nodeName, page) {
    logAction('loadNodeStoredPartsList', { nodeName, page });

    api.object.read_node_mappings({
        name: nodeName,
        skip: config.paginationPageSize * page,
        limit: config.paginationPageSize,
        adminfo: true
    })
        .then(
            ({ objects, total_count }) => {
                let parts = objects
                    .map(
                        obj => obj.parts.map(
                            part => ({
                                object: obj.key,
                                bucket: obj.bucket,
                                info: part
                            })
                        )
                    )
                    .reduce(
                        (list, objParts) => {
                            list.push(...objParts);
                            return list;
                        },
                        []
                    );

                model.nodeStoredPartList(parts);
                model.nodeStoredPartList.page(page);
                model.nodeStoredPartList.count(total_count);
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
            .done();
    }
}

export function exportAuditEnteries(categories) {
    logAction('exportAuditEnteries', { categories });

    let filter = categories
        .map(
            category => `(^${category}.)`
        )
        .join('|');

    api.system.export_activity_log({ event: filter || '^$' })
        .then(downloadFile)
        .done();
}

export function loadAccountList() {
    logAction('loadAccountList');

    api.account.list_accounts()
        .then(
            ({ accounts }) => model.accountList(accounts)
        )
        .done();
}

export function loadAccountInfo(email) {
    logAction('loadAccountInfo', { email });

    api.account.read_account({
        email: email
    })
        .then(model.accountInfo)
        .done();
}

export function loadTier(name) {
    logAction('loadTier', { name });

    api.tier.read_tier({ name })
        .then(model.tierInfo)
        .done();
}

export function loadCloudSyncInfo(bucket) {
    logAction('loadCloudSyncInfo', { bucket });

    api.bucket.get_cloud_sync({ name: bucket })
        .then(model.cloudSyncInfo)
        .done();
}

export function loadS3Connections() {
    logAction('loadS3Connections');

    api.account.get_account_sync_credentials_cache()
        .then(model.S3Connections)
        .done();
}

export function loadS3BucketList(connection) {
    logAction('loadS3BucketList', { connection });

    api.bucket.get_cloud_buckets({
        connection: connection
    })
        .then(
            model.S3BucketList,
            () => model.S3BucketList(null)
        )
        .done();
}

// -----------------------------------------------------
// Managment actions.
// -----------------------------------------------------
export function createSystemAccount(system, email, password, dnsName) {
    logAction('createSystemAccount', { system, email, password, dnsName });

    let accessKeys = system === 'demo' && email === 'demo@noobaa.com' ?
        { access_key: '123', secret_key: 'abc' } :
        generateAccessKeys();

    api.account.create_account({
        name: system,
        email: email,
        password: password,
        access_keys: accessKeys
    })
        .then(
            ({ token }) => {
                api.options.auth_token = token;
                localStorage.setItem('sessionToken', token);
                model.sessionInfo({ user: email, system: system});
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
            () => redirectTo(routes.system, { system })
        )
        .done();
}

export function createAccount(name, email, password, accessKeys, S3AccessList) {
    logAction('createAccount', { name, email, password, accessKeys,     S3AccessList });

    api.account.create_account({
        name: name,
        email: email,
        password: password,
        access_keys: accessKeys,
        allowed_buckets: S3AccessList
    })
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
                    .then(
                        () => policy
                    );
            }
        )
        .then(
            policy => api.bucket.create_bucket({
                name: name,
                tiering: policy.name
            })
        )
        .then(loadSystemInfo)
        .done();
}

export function deleteBucket(name) {
    logAction('deleteBucket', { name });

    api.bucket.delete_bucket({ name })
        .then(loadSystemInfo)
        .done();
}

export function updateTier(name, dataPlacement, pools) {
    logAction('updateTier', { name, dataPlacement, pools });

    api.tier.update_tier({
        name: name,
        data_placement: dataPlacement,
        pools: pools
    })
        .then(
            () => loadTier(name)
        )
        .done();
}

export function createPool(name, nodes) {
    logAction('createPool', { name, nodes });

    api.pool.create_pool({ name, nodes })
        .then(loadSystemInfo)
        .done();
}

export function deletePool(name) {
    logAction('deletePool', { name });

    api.pool.delete_pool({ name })
        .then(loadSystemInfo)
        .done();
}

export function assignNodes(name, nodes) {
    logAction('assignNodes', { name, nodes });

    api.pool.assign_nodes_to_pool({
        name: name,
        nodes: nodes
    })
        .then(loadSystemInfo)
        .done();
}

export function uploadFiles(bucketName, files) {
    logAction('uploadFiles', { bucketName, files });

    let recentUploads = model.recentUploads;

    let { accessKey , secretKey } = model.systemInfo();
    let s3 = new AWS.S3({
        endpoint: endpoint,
        credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey
        },
        s3ForcePathStyle: true,
        sslEnabled: false
    });

    let uploadRequests = Array.from(files).map(
        file => new Promise(
            resolve => {
                // Create an entry in the recent uploaded list.
                let entry = {
                    name: file.name,
                    targetBucket: bucketName,
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

    Promise.all(uploadRequests)
        .then(
            results => results.reduce(
                (sum, result) => sum += result
            )
        )
        .then(
            completedCount => completedCount > 0 && refresh()
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
        count: targetCount,
        source: source
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
                            };
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

                            return api.node.test_node_network(stepRequest)
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
                    );
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
        xhr.onload = () => reloadTo(routes.system, undefined, { afterupgrade: true });
        xhr.onerror = () => setTimeout(ping, 10000);
        xhr.send();
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
        });
    };

    xhr.onload = function() {
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
            upgradeStatus.assign({ state: 'FAILED' });
        }
    };

    xhr.onerror = function() {
        upgradeStatus.assign({
            state: 'FAILED'
        });
    };

    xhr.onabort = function() {
        upgradeStatus.assign({
            state: 'CANCELED'
        });
    };

    let formData = new FormData();
    formData.append('upgrade_file', upgradePackage);
    xhr.send(formData);
}

export function downloadNodeDiagnosticPack(nodeName) {
    logAction('downloadDiagnosticFile', { nodeName });

    api.node.collect_agent_diagnostics({ name: nodeName })
        .then(
            url => downloadFile(url)
        )
        .done();
}


export function downloadSystemDiagnosticPack() {
    logAction('downloadSystemDiagnosticPack');

    api.system.diagnose()
        .then(downloadFile)
        .done();
}

export function setNodeDebugLevel(node, level) {
    logAction('setNodeDebugLevel', { node, level });

    api.node.read_node({ name: node })
        .then(
            node => api.node.set_debug_node({
                name: node.name,
                level: level
            })
        )
        .then(
            () => loadNodeInfo(node)
        )
        .done();
}

export function setSystemDebugLevel(level){
    logAction('setSystemDebugLevel', { level });

    api.system.set_debug_level({ level })
        .then(loadSystemInfo)
        .done();
}

export function setCloudSyncPolicy(bucket, connection, targetBucket, direction, frequency, syncDeletions) {
    logAction('setCloudSyncPolicy', { bucket, connection, targetBucket, direction, frequency, syncDeletions });

    api.bucket.set_cloud_sync({
        name: bucket,
        connection: connection,
        target_bucket: targetBucket,
        policy: {
            n2c_enabled: Boolean(direction & 1),
            c2n_enabled: Boolean(direction & 2),
            schedule_min: frequency,
            additions_only: !syncDeletions
        }
    })
        .then(
            () => {
                loadCloudSyncInfo(bucket);
                loadSystemInfo();
            }
        )
        .done();
}

export function updateCloudSyncPolicy(bucket, direction, frequency, syncDeletions) {
    logAction('updateCloudSyncPolicy', { bucket, direction, frequency, syncDeletions });

    api.bucket.update_cloud_sync({
        name: bucket,
        policy: {
            n2c_enabled: Boolean(direction & 1),
            c2n_enabled: Boolean(direction & 2),
            schedule_min: frequency,
            additions_only: !syncDeletions
        }
    })
        .then(
            () => {
                loadCloudSyncInfo(bucket);
                loadSystemInfo();
            }
        );
}

export function removeCloudSyncPolicy(bucket) {
    logAction('removeCloudSyncPolicy', { bucket });

    api.bucket.delete_cloud_sync({ name: bucket })
        .then(
            () => model.cloudSyncInfo(null)
        )
        .then(loadSystemInfo);
}

export function toogleCloudSync(bucket, pause) {
    logAction('toogleCloudSync', { bucket, pause });

    api.bucket.toggle_cloud_sync({
        name: bucket,
        pause: pause
    })
        .then(
            () => {
                loadCloudSyncInfo(bucket);
                loadSystemInfo();
            }
        )
        .done();
}


export function checkS3Connection(endpoint, accessKey, secretKey) {
    logAction('checkS3Connection', { endpoint, accessKey, secretKey });

    let credentials = {
        endpoint: endpoint,
        access_key: accessKey,
        secret_key: secretKey
    };

    api.account.check_account_sync_credentials(credentials)
        .then(model.isS3ConnectionValid)
        .done();
}

export function addS3Connection(name, endpoint, accessKey, secretKey) {
    logAction('addS3Connection', { name, endpoint, accessKey, secretKey });

    let credentials = {
        name: name,
        endpoint: endpoint,
        access_key: accessKey,
        secret_key: secretKey
    };

    api.account.add_account_sync_credentials_cache(credentials)
        .then(loadS3Connections)
        .done();
}

export function notify(message, severity = 'INFO') {
    logAction('notify', { message, severity });

    model.lastNotification({ message, severity });
}

export function loadBucketS3ACL(bucketName) {
    logAction('loadBucketS3ACL', { bucketName });

    api.bucket.list_bucket_s3_acl({
        name: bucketName
    })
        .then(model.bucketS3ACL)
        .done();
}

export function updateBucketS3ACL(bucketName, acl) {
    logAction('updateBucketS3ACL', { bucketName, acl });

    api.bucket.update_bucket_s3_acl({
        name: bucketName,
        access_control: acl
    })
        .then(
            () => model.bucketS3ACL(acl)
        )
        .done();
}

export function loadAccountS3ACL(email) {
    logAction('loadAccountS3ACL', { email });

    api.account.list_account_s3_acl({
        email: email
    })
        .then(model.accountS3ACL)
        .done();
}

export function updateAccountS3ACL(email, acl) {
    logAction('updateAccountS3ACL', { email, acl });

    api.account.update_account_s3_acl({
        email: email,
        access_control: acl
    })
        .then(
            () => model.accountS3ACL
        )
        .then(loadAccountList)
        .done();
}


export function updateServerTime(timezone, epoch) {
    logAction('updateServerTime', { timezone, epoch });

    api.system.update_time_config({
        config_type: 'MANUAL',
        timezone: timezone,
        epoch: epoch
    })
        .then(loadSystemInfo)
        .done();
}

export function updateServerNTP(timezone, server) {
    logAction('updateServerNTP', { timezone, server });

    api.system.update_time_config({
        config_type: 'NTP',
        timezone: timezone,
        server: server
    })
        .then(loadSystemInfo)
        .done();
}

export function enterMaintenanceMode(duration) {
    logAction('enterMaintenanceMode', { duration });

    api.system.set_maintenance_mode({ duration })
        .then(loadSystemInfo)
        .done();
}

export function exitMaintenanceMode() {
    logAction('exitMaintenanceMode');

    api.system.set_maintenance_mode({ duration: 0 })
        .then(loadSystemInfo)
        .done();
}

export function updatePhoneHomeConfig(proxyAddress) {
    logAction('updatePhoneHomeConfig', { proxyAddress });

    api.system.update_phone_home_config({ proxy_address: proxyAddress })
        .then(loadSystemInfo)
        .done();
}

export function enableRemoteSyslog(protocol, address, port) {
    logAction ('enableRemoteSyslog', { protocol, address, port });

    api.system.configure_remote_syslog({ enabled: true, protocol, address, port })
        .then(loadSystemInfo)
        .done();
}

export function disableRemoteSyslog() {
    logAction ('disableRemoteSyslog');

    api.system.configure_remote_syslog({ enabled: false })
        .then(loadSystemInfo)
        .done();
}
