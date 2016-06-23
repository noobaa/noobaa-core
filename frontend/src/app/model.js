import ko from 'knockout';

// Hold the current ui state.
export const uiState = ko.observable({
    layout: 'empty'
});

// Hold a refresh counter that allows view models to act when it
// changes.
export const refreshCounter = ko.observable(0);

// Hold the current route context.
export const routeContext = ko.observable();

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

// Hold summary information on the current system.
export const systemSummary = ko.observable();

// Hold agent installation information.
export const agentInstallationInfo = ko.observable();

// Hold the current bucket list. deriv`ed` from system info.
export const bucketList = ko.observableArray();
bucketList.sortedBy = ko.observable('name');
bucketList.order = ko.observable(1);

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

// Hold the current pool list. derived from system info.
export const poolList = ko.observableArray();
poolList.sortedBy = ko.observable('name');
poolList.order = ko.observable(1);

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

// hold system upload ssl certificate status.
export const sslCertificateUploadStatus = ko.observable();
