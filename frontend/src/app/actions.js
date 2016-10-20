import * as model from 'model';
import page from 'page';
import api from 'services/api';
import config from 'config';
import * as routes from 'routes';

import { isDefined, last, makeArray, execInOrder, realizeUri, waitFor,
    downloadFile, generateAccessKeys, deepFreeze, flatMap, httpWaitForResponse } from 'utils';

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

    api.options.auth_token =
        sessionStorage.getItem('sessionToken') ||
        localStorage.getItem('sessionToken');

    return api.auth.read_auth()
        // Try to restore the last session
        .then(({ account, system }) => {
            if (isDefined(account)) {
                model.sessionInfo({
                    user: account.email,
                    system: system.name,
                    mustChangePassword: account.must_change_password
                });
            }
        })
        .catch(err => {
            if (err.rpc_code === 'UNAUTHORIZED') {
                if (api.options.auth_token) {
                    console.info('Signing out on unauthorized session.');
                    signOut(false);
                }
            } else {
                console.error(err);
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
export function navigateTo(route = model.routeContext().pathname, params = {},  query = {}) {
    logAction('navigateTo', { route, params, query });

    page.show(
        realizeUri(route, Object.assign({}, model.routeContext().params, params), query)
    );
}

export function redirectTo(route = model.routeContext().pathname, params = {}, query = {}) {
    logAction('redirectTo', { route, params, query });

    route = route || model.routeContext().pathname;

    page.redirect(
        encodeURI(
            realizeUri(route, Object.assign({}, model.routeContext().params, params), query)
        )
    );
}

export function reload() {
    logAction('reload');

    window.location.reload();
}

export function reloadTo(route = model.routeContext().pathname, params = {},  query = {}) {
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

    let ctx = model.routeContext();

    model.uiState({
        layout: 'login-layout',
        returnUrl: ctx.query.returnUrl
    });

    loadServerInfo();
}

export function showOverview() {
    logAction('showOverview');

    model.uiState({
        layout: 'main-layout',
        title: 'Overview',
        breadcrumbs: [
            { route: 'system', label: 'Overview' }
        ],
        panel: 'overview',
        useBackground: true
    });
}

export function showBuckets() {
    logAction('showBuckets');

    model.uiState({
        layout: 'main-layout',
        title: 'Buckets',
        breadcrumbs: [
            { route: 'system', label: 'Overview' },
            { route: 'buckets', label: 'Buckets' }
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
            { route: 'system', label: 'Overview' },
            { route: 'buckets', label: 'Buckets' },
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
    let { object, bucket, tab = 'parts' } = ctx.params;
    let { page = 0 } = ctx.query;

    model.uiState({
        layout: 'main-layout',
        title: object,
        breadcrumbs: [
            { route: 'system', label: 'Overview' },
            { route: 'buckets', label: 'Buckets' },
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
        title: 'Resources',
        breadcrumbs: [
            { route: 'system', label: 'Overview' },
            { route: 'pools', label: 'Resources' }
        ],
        panel: 'resources',
        tab: tab
    });
}

export function showPool() {
    logAction('showPool');

    let ctx = model.routeContext();
    let { pool, tab = 'nodes' } = ctx.params;

    model.uiState({
        layout: 'main-layout',
        title: pool,
        breadcrumbs: [
            { route: 'system', label: 'Overview' },
            { route: 'pools', label: 'Resources'},
            { route: 'pool', label: pool }
        ],
        panel: 'pool',
        tab: tab
    });

    let { filter, hasIssues, sortBy = 'name', order = 1, page = 0 } = ctx.query;
    loadPoolNodeList(pool, filter, hasIssues, sortBy, parseInt(order), parseInt(page));
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
            { route: 'system', label: 'Overview' },
            { route: 'pools', label: 'Resources'},
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
        title: 'System Management',
        breadcrumbs: [
            { route: 'system', label: 'Overview' },
            { route: 'management', label: 'System Management' }
        ],
        panel: 'management',
        tab: tab,
        working: model.uiState().working
    });
}

export function showCluster() {
    logAction('showCluster');

    model.uiState({
        layout: 'main-layout',
        title: 'Cluster',
        breadcrumbs: [
            { route: 'system', label: 'Overview' },
            { route: 'cluster', label: 'Cluster' }
        ],
        panel: 'cluster'
    });
}

export function handleUnknownRoute() {
    logAction('handleUnknownRoute');

    let system = model.sessionInfo().system;
    let uri = realizeUri(routes.system, { system });
    redirectTo(uri);
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
export function signIn(email, password, keepSessionAlive = false) {
    logAction('signIn', { email, password, keepSessionAlive });

    api.create_auth_token({ email, password })
        .then(() => api.system.list_systems())
        .then(
            ({ systems }) => {
                let system = systems[0].name;

                return api.create_auth_token({ system, email, password })
                    .then(({ token, info }) => {
                        let storage = keepSessionAlive ? localStorage : sessionStorage;
                        storage.setItem('sessionToken', token);

                        let mustChangePassword = info.account.must_change_password;
                        model.sessionInfo({
                            user: email,
                            system: system,
                            mustChangePassword: mustChangePassword
                        });

                        model.loginInfo({ retryCount: 0 });
                        refresh();
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

export function signOut(shouldRefresh = true) {
    sessionStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionToken');
    model.sessionInfo(null);
    api.options.auth_token = undefined;

    if (shouldRefresh) {
        refresh();
    }
}

// -----------------------------------------------------
// Information retrieval actions.
// -----------------------------------------------------
export function loadServerInfo() {
    logAction('loadServerInfo');

    model.serverInfo(null);
    api.account.accounts_status()
        .then(
            reply => reply.has_accounts ?
                { initialized: true } :
                api.cluster_server.read_server_config().then(
                    config => ({
                        initialized: false,
                        address: endpoint,
                        config: config
                    })
                )
        )
        .then(model.serverInfo)
        .done();
}

export function loadSystemInfo() {
    logAction('loadSystemInfo');

    model.uiState.assign({
        working: true
    });

    api.system.read_system()
        .then(
            reply => model.systemInfo(
                deepFreeze(Object.assign(reply, { endpoint }))
            )
        )
        .then(
            () => model.uiState.assign({
                working: false
            })
        )
        .done();
}

export function loadBucketObjectList(bucketName, filter, sortBy, order, page) {
    logAction('loadBucketObjectList', { bucketName, filter, sortBy, order, page });

    api.object.list_objects({
        bucket: bucketName,
        key_query: filter,
        sort: sortBy,
        order: order,
        skip: config.paginationPageSize * page,
        limit: config.paginationPageSize,
        pagination: true
    })
        .then(model.bucketObjectList)
        .done();
}

export function loadObjectMetadata(bucketName, objectName) {
    logAction('loadObjectMetadata', { bucketName, objectName });

    // Drop previous data if of diffrent object.
    if (!!model.objectInfo() && model.objectInfo().key !== objectName) {
        model.objectInfo(null);
    }

    api.object.read_object_md({
        bucket: bucketName,
        key: objectName,
        adminfo: {
            signed_url_endpoint: endpoint
        }
    })
        .then(model.objectInfo)
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

export function loadPoolNodeList(poolName, filter, hasIssues, sortBy, order, page) {
    logAction('loadPoolNodeList', { poolName, filter, hasIssues, sortBy, order, page });

    api.node.list_nodes({
        query: {
            pools: [ poolName ],
            filter: filter,
            has_issues: hasIssues
        },
        sort: sortBy,
        order: order,
        skip: config.paginationPageSize * page,
        limit: config.paginationPageSize,
        pagination: true
    })
        .then(
            reply => model.poolNodeList(
                deepFreeze(reply)
            )
        )
        .done();
}

export function loadNodeList(filter, pools, online, decommissioned) {
    logAction('loadNodeList', { filter, pools, online, decommissioned});

    api.node.list_nodes({
        query: {
            filter: filter,
            pools: pools,
            online: online,
            decommissioned: decommissioned,
            decommissioning: decommissioned
        }
    })
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
            ({ objects, total_count }) => ({
                total_count: total_count,
                parts: flatMap(
                    objects,
                    obj => obj.parts.map(
                        part => Object.assign(
                            {
                                object: obj.key,
                                bucket: obj.bucket
                            },
                            part
                        )
                    )
                )
            })
        )
        .then(model.nodeStoredPartList)
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
        .catch(
            err => {
                notify('Exporting activity log failed', 'error');
                throw err;
            }
        )
        .then(downloadFile)
        .done();
}

export function loadCloudConnections() {
    logAction('loadCloudConnections');

    api.account.get_account_sync_credentials_cache()
        .then(model.CloudConnections)
        .done();
}

export function loadCloudBucketList(connection) {
    logAction('loadCloudBucketList', { connection });

    api.bucket.get_cloud_buckets({
        connection: connection
    })
        .then(
            model.CloudBucketList,
            () => model.CloudBucketList(null)
        )
        .done();
}

// -----------------------------------------------------
// Managment actions.
// -----------------------------------------------------
export function createSystem(
    activationCode,
    email,
    password,
    systemName,
    dnsName,
    dnsServers,
    timeConfig
) {
    logAction('createSystem', {
        activationCode, email, password, systemName, dnsName,
        dnsServers, timeConfig
    });

    let accessKeys = (systemName === 'demo' && email === 'demo@noobaa.com') ?
        { access_key: '123', secret_key: 'abc' } :
        generateAccessKeys();

    api.system.create_system({
        activation_code: activationCode,
        name: systemName,
        email: email,
        password: password,
        access_keys: accessKeys,
        dns_name: dnsName,
        dns_servers: dnsServers,
        time_config: timeConfig
    })
        .then(
            ({ token }) => {
                api.options.auth_token = token;
                sessionStorage.setItem('sessionToken', token);

                // Update the session info and redirect to system screen.
                model.sessionInfo({
                    user: email,
                    system: systemName
                });

                redirectTo(
                    routes.system,
                    { system: systemName },
                    { welcome: true }
                );
            }
        )
        .done();
}

export function createAccount(name, email, password, accessKeys, S3AccessList) {
    logAction('createAccount', { name, email, password, accessKeys, S3AccessList });

    api.account.create_account({
        name: name,
        email: email,
        password: password,
        must_change_password: true,
        access_keys: accessKeys,
        allowed_buckets: S3AccessList
    })
        .then(
            () => notify(`Account ${email} created successfully`, 'success'),
            () => notify(`Account ${email} creation failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function deleteAccount(email) {
    logAction('deleteAccount', { email });

    api.account.delete_account({ email })
        .then(
            () => {
                let user = model.sessionInfo() && model.sessionInfo().user;
                if (email === user) {
                    signOut();
                } else {
                    loadSystemInfo();
                }
            }
        )
        .then(
            () => notify(`Account ${email} deleted successfully`, 'success'),
            () => notify(`Account ${email} deletion failed`, 'error')
        )
        .done();
}

export function resetAccountPassword(email, password) {
    logAction('resetAccountPassword', { email, password });

    api.account.update_account({
        email,
        password,
        must_change_password: true
    })
        .then(
            () => notify(`${email} password has been reset successfully`, 'success'),
            () => notify(`Resetting ${email}'s password failed`, 'error')
        )
        .done();
}

export function updateAccountPassword (email, password) {
    logAction('updateAccountPassword', { email, password });

    api.account.update_account({
        email,
        password,
        must_change_password: false
    })
        .then(
            () => model.sessionInfo.assign({
                mustChangePassword: false
            })
        )
        .then(refresh)
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
        node_pools: pools
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
        .then(
            () => notify(`Bucket ${name} created successfully`, 'success'),
            () => notify(`Bucket ${name} creation failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function deleteBucket(name) {
    logAction('deleteBucket', { name });

    api.bucket.delete_bucket({ name })
        .then(
            () => notify(`Bucket ${name} deleted successfully`, 'success'),
            () => notify(`Bucket ${name} deletion failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function updateBucketPlacementPolicy(tierName, placementType, node_pools) {
    logAction('updateBucketPlacementPolicy', { tierName, placementType, node_pools });

    let bucket = model.systemInfo().buckets.find(
        bucket => bucket.tiering.tiers.find(
            entry => entry.tier === tierName
        )
    );

    api.tier.update_tier({
        name: tierName,
        data_placement: placementType,
        node_pools: node_pools
    })
        .then(
            () => notify(`${bucket.name} placement policy updated successfully`, 'success'),
            () => notify(`Updating ${bucket.name} placement policy failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function updateBucketBackupPolicy(tierName, cloudResources) {
    logAction('updateBucketBackupPolicy', { tierName, cloudResources });

    let bucket = model.systemInfo().buckets.find(
        bucket => bucket.tiering.tiers.find(
            entry => entry.tier === tierName
        )
    );

    api.tier.update_tier({
        name: tierName,
        cloud_pools: cloudResources
    })
        .then(
            () => notify(`${bucket.name} cloud storage policy updated successfully`, 'success'),
            () => notify(`Updating ${bucket.name} cloud storage policy failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function createPool(name, nodes) {
    logAction('createPool', { name, nodes });

    nodes = nodes.map(name => ({ name }));

    api.pool.create_nodes_pool({ name, nodes })
        .then(
            () => notify(`Pool ${name} created successfully`, 'success'),
            () => notify(`Pool ${name} creation failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function deletePool(name) {
    logAction('deletePool', { name });

    api.pool.delete_pool({ name })
        .then(
            () => notify(`Pool ${name} deleted successfully`, 'success'),
            () => notify(`Pool ${name} deletion failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function assignNodes(name, nodes) {
    logAction('assignNodes', { name, nodes });

    api.pool.assign_nodes_to_pool({
        name: name,
        nodes: nodes.map(name => ({ name }))
    })
        .then(
            () => notify(`${nodes.length} nodes has been assigend to pool ${name}`, 'success'),
            () => notify(`Assinging nodes to pool ${name} failed`, 'error')
        )
        .then(refresh)
        .done();
}

export function createCloudResource(name, connection, cloudBucket) {
    logAction('createCloudResource', { name, connection, cloudBucket });

    api.pool.create_cloud_pool({
        name: name,
        connection: connection,
        target_bucket: cloudBucket
    })
        .then(
            () => notify(`Cloud resource ${name} created successfully`, 'success'),
            () => notify(`Pool ${name} creation failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function deleteCloudResource(name) {
    logAction('deleteCloudResource', { name });

    api.pool.delete_pool({ name })
        .then(
            () => notify(`Cloud resource ${name} deleted successfully`, 'success'),
            () => notify(`Cloud resource ${name} deletion failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function uploadFiles(bucketName, files) {
    logAction('uploadFiles', { bucketName, files });

    let recentUploads = model.recentUploads;

    let { access_key , secret_key } = model.systemInfo().owner.access_keys[0];
    let s3 = new AWS.S3({
        endpoint: endpoint,
        credentials: {
            accessKeyId: access_key,
            secretAccessKey: secret_key
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
                            resolve(true);

                        } else {
                            entry.state = 'FAILED';
                            entry.error = error;

                            // This is not a bug we want to resolve failed uploads
                            // in order to finalize the entire upload process.
                            resolve(false);
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

    Promise.all(uploadRequests).then(
        results => {
            let { completed, failed } = results.reduce(
                (stats, result) => {
                    result ? ++stats.completed : ++stats.failed;
                    return stats;
                },
                { completed: 0, failed: 0 }
            );

            if (failed === 0) {
                notify(
                    `Uploading ${
                        completed
                    } file${
                        completed === 1 ? '' : 's'
                    } to ${
                        bucketName
                    } completed successfully`,
                    'success'
                );

            } else if (completed === 0) {
                notify(
                    `Uploading ${
                        failed
                    } file${
                        failed === 1 ? '' : 's'
                    } to ${
                        bucketName
                    } failed`,
                    'error'
                );

            } else {
                notify(
                    `Uploading to ${
                        bucketName
                    } completed. ${
                        completed
                    } file${
                        completed === 1 ? '' : 's'
                    } uploaded successfully, ${
                        failed
                    } file${
                        failed === 1 ? '' : 's'
                    } failed`,
                    'warning'
                );
            }

            if (completed > 0) {
                refresh();
            }
        }
    );
}

export function testNode(source, testSet) {
    logAction('testNode', { source, testSet });

    const regexp = /=>(\w{3}):\/\/([0-9.]+):(\d+)/;
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
                                targetIp: '',
                                targetPort: '',
                                protocol: '',
                                state: 'WAITING',
                                time: 0,
                                position: 0,
                                speed: 0,
                                progress: 0
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
                                        let [,protocol, ip, port] = session.match(regexp);
                                        result.protocol = protocol;
                                        result.targetIp = ip;
                                        result.targetPort = port;
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
            () => {
                if (nodeTestInfo().state === 'ABORTING') {
                    nodeTestInfo(null);
                } else {
                    nodeTestInfo.assign({
                        state: 'COMPLETED'
                    });
                }
            }
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
        .then(
            () => notify('Peer to peer settings updated successfully', 'success'),
            () => notify('Peer to peer settings update failed', 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function updateHostname(hostname) {
    logAction('updateHostname', { hostname });

    api.system.update_hostname({ hostname })
        // The system changed it's name, reload the page using the new IP/Name
        .then(
            () => {
                let { protocol, port } = window.location;
                let baseAddress = `${protocol}//${hostname}:${port}`;

                reloadTo(
                    `${baseAddress}${routes.management}`,
                    { tab: 'settings' }
                );
            }
        )
        .done();
}

export function upgradeSystem(upgradePackage) {
    logAction('upgradeSystem', { upgradePackage });

    function ping() {
        let xhr = new XMLHttpRequest();
        xhr.open('GET', '/version', true);
        xhr.onload = () => reloadTo(routes.system, undefined, { afterupgrade: true });
        xhr.onerror = () => setTimeout(ping, 3000);
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

                    setTimeout(ping, 3000);
                },
                20000
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

// TODO: Notificaitons - remove message
export function uploadSSLCertificate(SSLCertificate) {
    logAction('uploadSSLCertificate', { SSLCertificate });

    let uploadStatus = model.sslCertificateUploadStatus;
    uploadStatus({
        state: 'IN_PROGRESS',
        progress: 0,
        error: ''
    });

    let xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload_certificate', true);

    xhr.onload = function(evt) {
        if (xhr.status !== 200) {
            let error = evt.target.responseText;

            uploadStatus.assign ({
                state: 'FAILED',
                error: error
            });

            notify(`Uploading SSL cartificate failed: ${error}`, 'error');

        } else {
            uploadStatus.assign ({
                state: 'SUCCESS'
            });

            notify('SSL cartificate uploaded successfully', 'success');
        }
    };

    xhr.upload.onprogress = function(evt) {
        uploadStatus.assign({
            progress: evt.lengthComputable && (evt.loaded / evt.total)
        });
    };

    xhr.onerror = function(evt) {
        let error = evt.target.responseText;

        uploadStatus.assign({
            state: 'FAILED',
            error: error
        });

        notify(`Uploading SSL cartificate failed: ${error}`, 'error');
    };

    xhr.onabort = function() {
        uploadStatus.assign ({
            state: 'CANCELED'
        });

        notify('Uploading SSL cartificate canceled', 'info');
    };

    let formData = new FormData();
    formData.append('upload_file', SSLCertificate);
    xhr.send(formData);
}

export function downloadNodeDiagnosticPack(nodeName) {
    logAction('downloadDiagnosticFile', { nodeName });

    notify('Collecting data... might take a while');
    api.system.diagnose_node({ name: nodeName })
        .catch(
            err => {
                notify(`Packing diagnostic file for ${nodeName} failed`, 'error');
                throw err;
            }
        )
        .then(
            url => downloadFile(url)
        )
        .done();
}

export function downloadServerDiagnosticPack(targetSecret, targetHostname) {
    logAction('downloadServerDiagnosticPack', { targetSecret, targetHostname });

    notify('Collecting data... might take a while');
    api.cluster_server.diagnose_system({
        target_secret: targetSecret
    })
        .catch(
            err => {
                notify(`Packing server diagnostic file for ${targetHostname} failed`, 'error');
                throw err;
            }
        )
        .then(downloadFile)
        .done();
}

export function downloadSystemDiagnosticPack() {
    logAction('downloadSystemDiagnosticPack');

    notify('Collecting data... might take a while');
    api.cluster_server.diagnose_system()
        .catch(
            err => {
                notify('Packing system diagnostic file failed', 'error');
                throw err;
            }
        )
        .then(downloadFile)
        .done();
}

export function setNodeDebugLevel(node, level) {
    logAction('setNodeDebugLevel', { node, level });

    api.node.read_node({ name: node })
        .then(
            node => api.node.set_debug_node({
                node: {
                    name: node.name
                },
                level: level
            })
        )
        .then(
            () => notify(
                `Debug level has been ${level === 0 ? 'lowered' : 'rasied'} for node ${node}`,
                'success'
            ),
            () => notify(
                `Cloud not ${level === 0 ? 'lower' : 'raise'} debug level for node ${node}`,
                'error'
            )
        )
        .then(
            () => loadNodeInfo(node)
        )
        .done();
}

export function setServerDebugLevel(targetSecret, targetHostname, level){
    logAction('setServerDebugLevel', { targetSecret, targetHostname, level });

    api.cluster_server.set_debug_level({
        target_secret: targetSecret,
        level: level
    })
        .then(
            () => notify(
                `Debug level has been ${level === 0 ? 'lowered' : 'rasied'} for server ${targetHostname}`,
                'success'
            ),
            () => notify(
                `Cloud not ${level === 0 ? 'lower' : 'raise'} debug level for server ${targetHostname}`,
                'error'
            )
        )
        .then(loadSystemInfo)
        .done();
}

export function setSystemDebugLevel(level){
    logAction('setSystemDebugLevel', { level });

    api.cluster_server.set_debug_level({ level })
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
            () => notify(`${bucket} cloud sync policy was set successfully`, 'success'),
            () => notify(`Setting ${bucket} cloud sync policy failed`, 'error')
        )
        .then(loadSystemInfo)
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
            () => notify(`${bucket} cloud sync policy updated successfully`, 'success'),
            () => notify(`Updating ${bucket} cloud sync policy failed`, 'error')
        )
        .then(loadSystemInfo);
}

export function removeCloudSyncPolicy(bucket) {
    logAction('removeCloudSyncPolicy', { bucket });

    api.bucket.delete_cloud_sync({ name: bucket })
        .then(
            () => notify(`${bucket} cloud sync policy removed successfully`, 'success'),
            () => notify(`Removing ${bucket} cloud sync policy failed`, 'error')
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
            () => notify(`${bucket} cloud sync has been ${pause ? 'paused' : 'resumed'}`, 'success'),
            () => notify(`${pause ? 'Pausing' : 'Resuming'} ${bucket} cloud sync failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}


export function checkCloudConnection(endpointType, endpoint, identity, secret) {
    logAction('checkCloudConnection', { endpointType, endpoint, identity, secret });

    let credentials = {
        endpoint_type: endpointType,
        endpoint: endpoint,
        identity: identity,
        secret: secret
    };

    api.account.check_account_sync_credentials(credentials)
        .then(model.isCloudConnectionValid)
        .done();
}

export function addCloudConnection(name, endpointType, endpoint, identity, secret) {
    logAction('addCloudConnection', { name, endpointType, endpoint, identity, secret });

    let credentials = {
        name: name,
        endpoint_type: endpointType,
        endpoint: endpoint,
        identity: identity,
        secret: secret
    };

    api.account.add_account_sync_credentials_cache(credentials)
        .then(loadCloudConnections)
        .done();
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
            () => notify(`${bucketName} S3 access control updated successfully`, 'success'),
            () => notify(`Updating ${bucketName} S3 access control failed`, 'error')
        )
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
            () => notify(`${email} S3 accces control updated successfully`, 'success'),
            () => notify(`Updating ${email} S3 access control failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function enterMaintenanceMode(duration) {
    logAction('enterMaintenanceMode', { duration });

    api.system.set_maintenance_mode({ duration })
        .then(loadSystemInfo)
        .then(
            () => setTimeout(
                loadSystemInfo,
                (duration * 60 + 1) * 1000
            )
        )
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
        .then(
            () => notify('Phone home proxy settings updated successfully', 'success'),
            () => notify('Updating phone home proxy settings failed', 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function enableRemoteSyslog(protocol, address, port) {
    logAction ('enableRemoteSyslog', { protocol, address, port });

    api.system.configure_remote_syslog({ enabled: true, protocol, address, port })
        .then(
            () => notify('Remote syslog has been enabled', 'success'),
            () => notify('Enabling remote syslog failed', 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function disableRemoteSyslog() {
    logAction ('disableRemoteSyslog');

    api.system.configure_remote_syslog({ enabled: false })
        .then(
            () => notify('Remote syslog has been disabled', 'success'),
            () => notify('Enabling remote syslog failed', 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function attachServerToCluster(serverAddress, serverSecret) {
    logAction('attachServerToCluster', { serverAddress, serverSecret });

    api.cluster_server.add_member_to_cluster({
        address: serverAddress,
        secret: serverSecret,
        role: 'REPLICA',
        shard: 'shard1'
    })
        .then(
            () => notify(`Server ${serverAddress} attached to cluster successfully`, 'success'),
            () => notify(`Adding ${serverAddress} to cluster failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function updateServerDNSSettings(serverSecret, primaryDNS, secondaryDNS) {
    logAction('updateServerDNSSettings', { primaryDNS, secondaryDNS });

    let dnsServers = [primaryDNS, secondaryDNS].filter(
        server => server
    );

    api.cluster_server.update_dns_servers({
        target_secret: serverSecret,
        dns_servers: dnsServers
    })
        .then( () => waitFor(5000) )
        .then( () => httpWaitForResponse('/version') )
        .then(reload)
        .done();
}

export function loadServerTime(serverSecret) {
    logAction('loadServerTime', { serverSecret });


    api.cluster_server.read_server_time({ target_secret: serverSecret })
        .then(
            time => model.serverTime({
                server: serverSecret,
                time: time
            })
        )
        .done();
}

export function updateServerClock(serverSecret, timezone, epoch) {
    logAction('updateServerClock', { serverSecret, timezone, epoch });

    let { address } = model.systemInfo().cluster.shards[0].servers.find(
        server => server.secret === serverSecret
    );

    api.cluster_server.update_time_config({
        target_secret: serverSecret,
        timezone: timezone,
        epoch: epoch
    })
        .then(
            () => notify(`${address} time settings updated successfully`, 'success'),
            () => notify(`Updating ${address} time settings failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}
export function updateServerNTPSettings(serverSecret, timezone, ntpServerAddress) {
    logAction('updateServerNTP', { serverSecret, timezone, ntpServerAddress });

    let { address } = model.systemInfo().cluster.shards[0].servers.find(
        server => server.secret === serverSecret
    );

    api.cluster_server.update_time_config({
        timezone: timezone,
        ntp_server: ntpServerAddress
    })
        .then(
            () => notify(`${address} time settings updated successfully`, 'success'),
            () => notify(`Updating ${address} time settings failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function notify(message, severity = 'info') {
    logAction('notify', { message, severity });

    model.lastNotification({ message, severity });
}

export function validateActivation(code, email) {
    logAction('validateActivation', { code, email });

    api.system.validate_activation({ code, email })
        .then(
            reply => waitFor(500, reply)
        )
        .then(
            ({ valid, reason }) => model.activationState({ code, email, valid, reason })
        )

        .done();
}

export function attemptResolveSystemName(name) {
    logAction('attemptResolveServerName', { name });

    api.system.attempt_dns_resolve({
        dns_name: name
    })
        .then(
            reply => waitFor(500, reply)
        )
        .then(
            ({ valid, reason }) => model.nameResolutionState({ name, valid, reason })
        )
        .done();
}

export function dismissUpgradedCapacityNotification() {
    logAction('dismissUpgradedCapacityNotification');

    api.system.phone_home_capacity_notified()
        .then(loadSystemInfo)
        .done();
}

export function decommissionNode(name) {
    logAction('decommissionNode', { name });

    api.node.decommission_node({ name })
        .then(
            () => notify(`Node ${name} deactivated successfully`, 'success'),
            () => notify(`Deactivating node ${name} failed`, 'error')
        )
        .then(refresh)
        .done();
}

export function recommissionNode(name) {
    logAction('recommissionNode', { name });

    api.node.recommission_node({ name })
        .then(
            () => notify(`Node ${name} activated successfully`, 'success'),
            () => notify(`Activating node ${name} failed`, 'error')
        )
        .then(refresh)
        .done();
}
