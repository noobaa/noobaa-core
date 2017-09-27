/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

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

// Hold the current cloud sync information.
export const cloudBucketList = ko.observableArray();
export const isCloudConnectionValid = ko.observable(true)
    .extend({ notify: 'always' });

// Hold the parts that are stored on the curr node.
export const nodeStoredPartList = ko.observableArray();

// Hold the current node info.
export const objectInfo = ko.observable();

// Hold the parts of the curr object.
export const objectPartList = ko.observableArray();
objectPartList.count = ko.observable(0);
objectPartList.page = ko.observable(0);

// Hold the audit log
export const auditLog = ko.observableArray();
auditLog.loadedCategories = ko.observableArray();

// Hold node test information.
export const nodeTestInfo = ko.observable();

// hold system upgrade status.
export const upgradeStatus = ko.observable();

// hold system upload ssl certificate status.
export const sslCertificateUploadStatus = ko.observable();

// Used to replay read server time events.
export const serverTime = ko.observable();

// Hold system activation information.
export const activationState = ko.observable();

// Hold system name resolution attempt
export const nameResolutionState = ko.observable();

// Hold ntp server resolution attempt
export const ntpResolutionState = ko.observable();

// Hold diagnostics information
export const collectDiagnosticsState = ko.observable({});

// Hold last rest password attampt result.
export const resetPasswordState = ko.observable();

export const regenerateCredentialState = ko.observable();

// Hold funcs information
export const funcInfo = ko.observable();
export const funcList = ko.observableArray();

// Hold system usage history
export const systemUsageHistory = ko.observable();

// Hold verification state for attach server oprtations.
export const serverVerificationState = ko.observable();
