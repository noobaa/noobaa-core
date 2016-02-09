import ko from 'knockout';

// Hold the current ui state.
export let uiState = ko.observable({
    layout: 'empty'
});

// Hold a refresh counter that allows view models to act when it
// changes.
export let refreshCounter = ko.observable(0);

// Hold the current route context.
export let routeContext = ko.observable();

// Hold login state information.
export let loginInfo = ko.observable({
    retryCount: 0
});

// Hold current session information.
export let sessionInfo = ko.observable();

// Hold the state of the server.
export let serverInfo = ko.observable();

// Hold current system information.
export let systemInfo = ko.observable();

// Hold summary information on the current system.
export let systemSummary = ko.observable();

// Hold agent installation information.
export let agentInstallationInfo = ko.observable();

// Hold the current bucket list. deriv`ed` from system info.
export let bucketList = ko.observableArray(); 
bucketList.sortedBy = ko.observable('name')
bucketList.order = ko.observable(1);

// Hold the current bucket info.
export let bucketInfo = ko.observable();

// Hold the current bucket object list.
export let bucketObjectList = ko.observableArray();
bucketObjectList.count = ko.observable(0);
bucketObjectList.sortedBy = ko.observable('name');
bucketObjectList.order = ko.observable(1);
bucketObjectList.filter = ko.observable();
bucketObjectList.page = ko.observable(0);

// Hold the current tier information.
export let tierInfo = ko.observable();

// Hold the current cloud sync information.
export let cloudSyncInfo = ko.observable();
export let awsCredentialList = ko.observableArray();
export let awsBucketList = ko.observableArray();

// Hold the current pool list. derived from system info.
export let poolList = ko.observableArray();
poolList.sortedBy = ko.observable('name');
poolList.order = ko.observable(1);

// Hold the current pool info.
export let poolInfo = ko.observable();

// Hold a list of all the nodes in the system.
export let nodeList = ko.observableArray(null);

// Hold the current pool node list.
export let poolNodeList = ko.observableArray();
poolNodeList.count = ko.observable(0);
poolNodeList.sortedBy = ko.observable('name');
poolNodeList.order = ko.observable(1);
poolNodeList.filter = ko.observable();
poolNodeList.page = ko.observable(0);


// Hold the current node info.
export let nodeInfo = ko.observable();

// Hold the parts that are stored on the curr node.
export let nodeStoredPartList = ko.observableArray();
nodeStoredPartList.page = ko.observable(0);
nodeStoredPartList.count = ko.observable(0);

// Hold the current node info.
export let objectInfo = ko.observable();

// Hold the parts of the curr object.
export let objectPartList = ko.observableArray();
objectPartList.count = ko.observable(0);
objectPartList.page = ko.observable(0);

// Hold the recent uploads.
export let recentUploads = ko.observableArray();

// Hold the audit log 
export let auditLog = ko.observableArray();
auditLog.loadedCategories = ko.observable();

// Hold the current account list
export let accountList = ko.observableArray();

// Hold node test results.
export let nodeTestResults = ko.observableArray();
nodeTestResults.timestemp = ko.observable();

// hold system upgrade status.
export let upgradeStatus = ko.observable();

// Hold debug collection info.
export let debugCollectionInfo = ko.observable();
