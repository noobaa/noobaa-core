import ko from 'knockout';

export const previewMode = ko.observable(false);

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

// Hold the current bucket object list.
export const bucketObjectList = ko.observable();

// Hold the current bucket S3 access permissions.
export const bucketS3ACL = ko.observableArray();

// Hold the current cloud sync information.
export const CloudConnections = ko.observableArray();
export const CloudBucketList = ko.observableArray();
export const isCloudConnectionValid = ko.observable(true)
    .extend({ notify: 'always' });

// Hold a list of all the nodes in the system.
export const nodeList = ko.observableArray(null);

// Hold the current pool node list.
export const poolNodeList = ko.observable();

// Hold the current node info.
export const nodeInfo = ko.observable();

// Hold the parts that are stored on the curr node.
export const nodeStoredPartList = ko.observableArray();

// Hold the current node info.
export const objectInfo = ko.observable();

// Hold the parts of the curr object.
export const objectPartList = ko.observableArray();
objectPartList.count = ko.observable(0);
objectPartList.page = ko.observable(0);

export const uploads = ko.observableArray();
uploads.lastRequestFileCount = ko.observable(0);
uploads.stats = ko.pureComputed(
    () => uploads().reduce(
        (stats, upload) => {
            let { archived, completed, error } = upload;
            stats.count += 1;
            stats.uploading += Number(!completed);
            stats.failed += Number(completed && Boolean(error));
            stats.uploaded += Number(completed && !error);

            if (!archived) {
                let { size, progress } = upload;
                stats.batch.size += size;
                stats.batch.progress += progress;
            }

            return stats;
        },
        {
            count: 0,
            uploading: 0,
            uploaded: 0,
            failed: 0,
            batch: { size: 0, progress: 0 }
        }
    )
);

// Hold the audit log
export const auditLog = ko.observableArray();
auditLog.loadedCategories = ko.observableArray();

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

// Used to replay read server time events.
export const serverTime = ko.observable();

// Hold system activation information.
export const activationState = ko.observable();

// Hold system name resolution attempt
export const nameResolutionState = ko.observable();

// Hold diagnostics information
export const collectDiagnosticsState = ko.observable({});

// Hold funcs information
export const funcInfo = ko.observable();
export const funcList = ko.observableArray();
export const funcCodeFiles = ko.observableArray();
