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

// Hold the audit log
export const auditLog = ko.observableArray();
auditLog.loadedCategories = ko.observableArray();

// Hold node test information.
export const nodeTestInfo = ko.observable();

// hold system upload ssl certificate status.
export const sslCertificateUploadStatus = ko.observable();

// Hold system activation information.
export const activationState = ko.observable();

// Hold system name resolution attempt
export const nameResolutionState = ko.observable();

// Hold diagnostics information
export const collectDiagnosticsState = ko.observable({});

// Hold last rest password attampt result (only used in change-password-form);
export const resetPasswordState = ko.observable();
