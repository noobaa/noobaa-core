import ko from 'knockout';

// Hold the current ui state.
export const uiState = ko.observable({
    layout: 'empty'
});

// Hold a refresh counter that allows view models to act when it
// changes.
export const refreshCounter = ko.observable(0);

// Hold the current route context. The rate limit delay the route context change notification
// in order to let knockout time t teardown and dispose view models that may be depended on
// the route context value (mainly it's parameters).
export const routeContext = ko.observable()
    .extend({ rateLimit: 1 });

// Hold login state information.
export const loginInfo = ko.observable({
    retryCount: 0
});

// Hold current session information.
export const sessionInfo = ko.observable();

// Hold the state of the server.
export const serverInfo = ko.observable();

// Hold current system information.
export const systemInfo = ko.observable();

// Hold agent installation information.
export const agentInstallationInfo = ko.observable();

// Hold the current bucket info.
export const bucketInfo = ko.observable();

// Hold the current bucket object list.
export const bucketObjectList = ko.observableArray();
bucketObjectList.count = ko.observable(0);
bucketObjectList.sortedBy = ko.observable('name');
bucketObjectList.order = ko.observable(1);
bucketObjectList.filter = ko.observable();
bucketObjectList.page = ko.observable(0);

// Hold the current bucket S3 access permissions.
export const bucketS3ACL = ko.observableArray();

// Hold the current tier information.
export const tierInfo = ko.observable();

// Hold the current cloud sync information.
export const cloudSyncInfo = ko.observable();
export const S3Connections = ko.observableArray();
export const S3BucketList = ko.observableArray();
export const isS3ConnectionValid = ko.observable(true)
    .extend({ notify: 'always' });

// Hold the current pool info.
export const poolInfo = ko.observable();

// Hold a list of all the nodes in the system.
export const nodeList = ko.observableArray(null);

// Hold the current pool node list.
export const poolNodeList = ko.observableArray();
poolNodeList.count = ko.observable(0);
poolNodeList.sortedBy = ko.observable('name');
poolNodeList.order = ko.observable(1);
poolNodeList.filter = ko.observable();
poolNodeList.page = ko.observable(0);


// Hold the current node info.
export const nodeInfo = ko.observable();

// Hold the parts that are stored on the curr node.
export const nodeStoredPartList = ko.observableArray();
nodeStoredPartList.page = ko.observable(0);
nodeStoredPartList.count = ko.observable(0);

// Hold the current node info.
export const objectInfo = ko.observable();

// Hold the parts of the curr object.
export const objectPartList = ko.observableArray();
objectPartList.count = ko.observable(0);
objectPartList.page = ko.observable(0);

// Hold the recent uploads.
export const recentUploads = ko.observableArray();

// Hold the audit log
export const auditLog = ko.observableArray();
auditLog.loadedCategories = ko.observableArray();

// Hold the current account list
export const accountList = ko.observableArray();

// Hold current account information.
export const accountInfo = ko.observable();

export const accountS3ACL = ko.observableArray();

// Hold node test information.
export const nodeTestInfo = ko.observable();

// hold system upgrade status.
export const upgradeStatus = ko.observable();

// Hold debug collection info.
export const debugCollectionInfo = ko.observable();

// Hold the last notifiction.
export const lastNotification = ko.observable();
