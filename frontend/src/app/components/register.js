/* Copyright (C) 2016 NooBaa */

// Register the components with knockout component container.
export default function register(ko) {

    // -------------------------------
    // Empty component
    // -------------------------------
    ko.components.register('empty', { template: ' ' });

    // -------------------------------
    // Application
    // -------------------------------
    ko.components.register('app',                       require('./application/app/app').default);
    ko.components.register('main-layout',               require('./application/main-layout/main-layout').default);
    ko.components.register('login-layout',              require('./application/login-layout/login-layout').default);
    ko.components.register('modal-manager',             require('./application/modal-manager/modal-manager').default);
    ko.components.register('exit-confirmation-message', require('./application/exit-confirmation-message/exit-confirmation-message').default);
    /** INJECT:application **/

    // -------------------------------
    // Login
    // -------------------------------
    ko.components.register('signin-form',                       require('./login/signin-form/signin-form').default);
    ko.components.register('create-system-form',                require('./login/create-system-form/create-system-form').default);
    ko.components.register('unsupported-form',                  require('./login/unsupported-form/unsupported-form').default);
    ko.components.register('unable-to-activate-modal',          require('./login/unable-to-activate-modal/unable-to-activate-modal').default);
    ko.components.register('internet-connectivity-problem-form',require('./login/internet-connectivity-problem-form/internet-connectivity-problem-form').default);
    ko.components.register('change-password-form',              require('./login/change-password-form/change-password-form').default);
    ko.components.register('splash-screen',                     require('./login/splash-screen/splash-screen').default);
    /** INJECT:login **/

    // -------------------------------
    // Main
    // -------------------------------
    ko.components.register('commands-bar',      require('./main/commands-bar/commands-bar').default);
    ko.components.register('notification-box',  require('./main/notification-box/notification-box').default);
    ko.components.register('account-menu',      require('./main/account-menu/account-menu').default);
    ko.components.register('uploads-indicator', require('./main/uploads-indicator/uploads-indicator').default);
    /** INJECT:main **/

    // -------------------------------
    // Stickies
    // -------------------------------
    ko.components.register('debug-mode-sticky',                 require('./stickies/debug-mode-sticky/debug-mode-sticky').default);
    ko.components.register('maintenance-sticky',                require('./stickies/maintenance-sticky/maintenance-sticky').default);
    ko.components.register('license-sticky',                    require('./stickies/license-sticky/license-sticky').default);
    ko.components.register('phone-home-connectivity-sticky',    require('./stickies/phone-home-connectivity-sticky/phone-home-connectivity-sticky').default);
    ko.components.register('cluster-availability-sticky',       require('./stickies/cluster-availability-sticky/cluster-availability-sticky').default);
    ko.components.register('prefered-browsers-sticky',          require('./stickies/prefered-browsers-sticky/prefered-browsers-sticky').default);
    /** INJECT:stickies **/

    // -------------------------------
    // Modals
    // -------------------------------
    ko.components.register('install-nodes-modal',                           require('./modals/install-nodes-modal/install-nodes-modal').default);
    ko.components.register('install-nodes-to-pool-modal',                   require('./modals/install-nodes-to-pool-modal/install-nodes-to-pool-modal').default);
    ko.components.register('welcome-modal',                                 require('./modals/welcome-modal/welcome-modal').default);
    ko.components.register('after-upgrade-modal',                           require('./modals/after-upgrade-modal/after-upgrade-modal').default);
    ko.components.register('add-cloud-resource-modal',                      require('./modals/add-cloud-resource-modal/add-cloud-resource-modal').default);
    ko.components.register('add-cloud-connection-modal',                    require('./modals/add-cloud-connection-modal/add-cloud-connection-modal').default);
    ko.components.register('s3-access-details-modal',                       require('./modals/s3-access-details-modal/s3-access-details-modal').default);
    ko.components.register('edit-bucket-s3-access-modal',                   require('./modals/edit-bucket-s3-access-modal/edit-bucket-s3-access-modal').default);
    ko.components.register('start-maintenance-modal',                       require('./modals/start-maintenance-modal/start-maintenance-modal').default);
    ko.components.register('file-uploads-modal',                            require('./modals/file-uploads-modal/file-uploads-modal').default);
    ko.components.register('delete-current-account-warning-modal',          require('./modals/delete-current-account-warning-modal/delete-current-account-warning-modal').default);
    ko.components.register('object-preview-modal',                          require('./modals/object-preview-modal/object-preview-modal').default);
    ko.components.register('test-node-modal',                               require('./modals/test-node-modal/test-node-modal').default);
    ko.components.register('edit-server-dns-settings-modal',                require('./modals/edit-server-dns-settings-modal/edit-server-dns-settings-modal').default);
    ko.components.register('edit-server-time-settings-modal',               require('./modals/edit-server-time-settings-modal/edit-server-time-settings-modal').default);
    ko.components.register('edit-account-s3-access-modal',                  require('./modals/edit-account-s3-access-modal/edit-account-s3-access-modal').default);
    ko.components.register('edit-server-details-modal',                     require('./modals/edit-server-details-modal/edit-server-details-modal').default);
    ko.components.register('assign-hosts-modal',                            require('./modals/assign-hosts-modal/assign-hosts-modal').default);
    ko.components.register('update-system-name-modal',                      require('./modals/update-system-name-modal/update-system-name-modal').default);
    ko.components.register('create-account-modal',                          require('./modals/create-account-modal/create-account-modal').default);
    ko.components.register('account-created-modal',                         require('./modals/account-created-modal/account-created-modal').default);
    ko.components.register('edit-bucket-quota-modal',                       require('./modals/edit-bucket-quota-modal/edit-bucket-quota-modal').default);
    ko.components.register('set-account-ip-restrictions-modal',             require('./modals/set-account-ip-restrictions-modal/set-account-ip-restrictions-modal').default);
    ko.components.register('create-pool-modal',                             require('./modals/create-pool-modal/create-pool-modal').default);
    ko.components.register('edit-host-storage-drives-modal',                require('./modals/edit-host-storage-drives-modal/edit-host-storage-drives-modal').default);
    ko.components.register('disable-host-endpoint-warning-modal',           require('./modals/disable-host-endpoint-warning-modal/disable-host-endpoint-warning-modal').default);
    ko.components.register('disable-host-storage-warning-modal',            require('./modals/disable-host-storage-warning-modal/disable-host-storage-warning-modal').default);
    ko.components.register('disable-host-last-service-warning-modal',       require('./modals/disable-host-last-service-warning-modal/disable-host-last-service-warning-modal').default);
    ko.components.register('connect-app-modal',                             require('./modals/connect-app-modal/connect-app-modal').default);
    ko.components.register('create-namespace-resource-modal',               require('./modals/create-namespace-resource-modal/create-namespace-resource-modal').default);
    ko.components.register('create-namespace-bucket-modal',                 require('./modals/create-namespace-bucket-modal/create-namespace-bucket-modal').default);
    ko.components.register('edit-namespace-bucket-data-placement-modal',    require('./modals/edit-namespace-bucket-data-placement-modal/edit-namespace-bucket-data-placement-modal').default);
    ko.components.register('edit-bucket-placement-modal',                   require('./modals/edit-bucket-placement-modal/edit-bucket-placement-modal').default);
    ko.components.register('empty-bucket-placement-warning-modal',          require('./modals/empty-bucket-placement-warning-modal/empty-bucket-placement-warning-modal').default);
    ko.components.register('set-node-as-trusted-modal',                     require('./modals/set-node-as-trusted-modal/set-node-as-trusted-modal').default);
    ko.components.register('confirm-delete-host-modal',                     require('./modals/confirm-delete-host-modal/confirm-delete-host-modal').default);
    ko.components.register('upgrade-system-modal',                          require('./modals/upgrade-system-modal/upgrade-system-modal').default);
    ko.components.register('upgrading-system-modal',                        require('./modals/upgrading-system-modal/upgrading-system-modal').default);
    ko.components.register('upgrade-system-failed-modal',                   require('./modals/upgrade-system-failed-modal/upgrade-system-failed-modal').default);
    ko.components.register('pre-upgrade-system-failed-modal',               require('./modals/pre-upgrade-system-failed-modal/pre-upgrade-system-failed-modal').default);
    ko.components.register('finalize-upgrade-modal',                        require('./modals/finalize-upgrade-modal/finalize-upgrade-modal').default);
    ko.components.register('edit-bucket-data-resiliency-modal',             require('./modals/edit-bucket-data-resiliency-modal/edit-bucket-data-resiliency-modal').default);
    ko.components.register('risky-bucket-data-resiliency-warning-modal',    require('./modals/risky-bucket-data-resiliency-warning-modal/risky-bucket-data-resiliency-warning-modal').default);
    ko.components.register('change-cluster-connectivity-ip-modal',          require('./modals/change-cluster-connectivity-ip-modal/change-cluster-connectivity-ip-modal').default);
    ko.components.register('management-console-error-modal',                require('./modals/management-console-error-modal/management-console-error-modal').default);
    ko.components.register('add-bucket-trigger-modal',                      require('./modals/add-bucket-trigger-modal/add-bucket-trigger-modal').default);
    ko.components.register('edit-bucket-trigger-modal',                     require('./modals/edit-bucket-trigger-modal/edit-bucket-trigger-modal').default);
    ko.components.register('attach-server-modal',                           require('./modals/attach-server-modal/attach-server-modal').default);
    ko.components.register('edit-bucket-spillover-modal',                   require('./modals/edit-bucket-spillover-modal/edit-bucket-spillover-modal').default);
    ko.components.register('create-func-modal',                             require('./modals/create-func-modal/create-func-modal').default);
    ko.components.register('after-upgrade-failure-modal',                   require('./modals/after-upgrade-failure-modal/after-upgrade-failure-modal').default);
    ko.components.register('create-bucket-modal',                           require('./modals/create-bucket-modal/create-bucket-modal').default);
    /** INJECT:modals **/

    // -------------------------------
    // Overview
    // -------------------------------
    ko.components.register('overview-panel',        require('./overview/overview-panel/overview-panel').default);
    ko.components.register('buckets-overview',      require('./overview/buckets-overview/buckets-overview').default);
    ko.components.register('resource-overview',     require('./overview/resource-overview/resource-overview').default);
    ko.components.register('system-health',         require('./overview/system-health/system-health').default);
    /** INJECT:overview **/

    // -------------------------------
    // Buckets
    // -------------------------------
    ko.components.register('buckets-panel',             require('./buckets/buckets-panel/buckets-panel').default);
    ko.components.register('buckets-table',             require('./buckets/buckets-table/buckets-table').default);
    ko.components.register('namespace-buckets-table',   require('./buckets/namespace-buckets-table/namespace-buckets-table').default);
    /** INJECT:buckets **/

    // -------------------------------
    // Bucket
    // -------------------------------
    ko.components.register('bucket-panel',                          require('./bucket/bucket-panel/bucket-panel').default);
    ko.components.register('bucket-summary',                        require('./bucket/bucket-summary/bucket-summary').default);
    ko.components.register('bucket-objects-table',                  require('./bucket/bucket-objects-table/bucket-objects-table').default);
    ko.components.register('bucket-s3-access-table',                require('./bucket/bucket-s3-access-table/bucket-s3-access-table').default);
    ko.components.register('bucket-data-policies-form',             require('./bucket/bucket-data-policies-form/bucket-data-policies-form').default);
    ko.components.register('bucket-spillover-policy-form',          require('./bucket/bucket-spillover-policy-form/bucket-spillover-policy-form').default);
    ko.components.register('bucket-quota-policy-form',              require('./bucket/bucket-quota-policy-form/bucket-quota-policy-form').default);
    ko.components.register('bucket-data-resiliency-policy-form',    require('./bucket/bucket-data-resiliency-policy-form/bucket-data-resiliency-policy-form').default);
    ko.components.register('bucket-data-placement-policy-form',     require('./bucket/bucket-data-placement-policy-form/bucket-data-placement-policy-form').default);
    ko.components.register('bucket-triggers-form',                  require('./bucket/bucket-triggers-form/bucket-triggers-form').default);
    /** INJECT:bucket **/

    // -------------------------------
    // Namespace Bucket
    // -------------------------------
    ko.components.register('namespace-bucket-panel',               require('./namespace-bucket/namespace-bucket-panel/namespace-bucket-panel').default);
    ko.components.register('namespace-bucket-summary',             require('./namespace-bucket/namespace-bucket-summary/namespace-bucket-summary').default);
    ko.components.register('namespace-bucket-data-placement-form', require('./namespace-bucket/namespace-bucket-data-placement-form/namespace-bucket-data-placement-form').default);
    ko.components.register('namespace-bucket-s3-access-form',      require('./namespace-bucket/namespace-bucket-s3-access-form/namespace-bucket-s3-access-form').default);
    /** INJECT:namespace-bucket **/

    // -------------------------------
    // Object
    // -------------------------------
    ko.components.register('object-panel',          require('./object/object-panel/object-panel').default);
    ko.components.register('object-summary',        require('./object/object-summary/object-summary').default);
    ko.components.register('object-parts-list',     require('./object/object-parts-list/object-parts-list').default);
    /** INJECT:object **/

    // -------------------------------
    // resources
    // -------------------------------
    ko.components.register('resources-panel',           require('./resources/resources-panel/resources-panel').default);
    ko.components.register('pools-table',               require('./resources/pools-table/pools-table').default);
    ko.components.register('cloud-resources-table',     require('./resources/cloud-resources-table/cloud-resources-table').default);
    ko.components.register('namespace-resources-table', require('./resources/namespace-resources-table/namespace-resources-table').default);
    ko.components.register('internal-resources-table',  require('./resources/internal-resources-table/internal-resources-table').default);
    /** INJECT:resources **/

    // -------------------------------
    // Pool
    // -------------------------------
    ko.components.register('pool-panel',                    require('./pool/pool-panel/pool-panel').default);
    ko.components.register('pool-summary',                  require('./pool/pool-summary/pool-summary').default);
    ko.components.register('pool-hosts-table',              require('./pool/pool-hosts-table/pool-hosts-table').default);
    ko.components.register('pool-associated-accounts-list', require('./pool/pool-associated-accounts-list/pool-associated-accounts-list').default);
    ko.components.register('pool-connected-buckets-list',   require('./pool/pool-connected-buckets-list/pool-connected-buckets-list').default);
    /** INJECT:pool **/

    // -------------------------------
    // Host
    // -------------------------------
    ko.components.register('host-panel',            require('./host/host-panel/host-panel').default);
    ko.components.register('host-summary',          require('./host/host-summary/host-summary').default);
    ko.components.register('host-details-form',     require('./host/host-details-form/host-details-form').default);
    ko.components.register('host-endpoint-form',    require('./host/host-endpoint-form/host-endpoint-form').default);
    ko.components.register('host-storage-form',     require('./host/host-storage-form/host-storage-form').default);
    ko.components.register('host-diagnostics-form', require('./host/host-diagnostics-form/host-diagnostics-form').default);
    ko.components.register('host-parts-table',      require('./host/host-parts-table/host-parts-table').default);
    /** INJECT:host **/

    // -------------------------------
    // Management
    // -------------------------------
    ko.components.register('management-panel',          require('./management/management-panel/management-panel').default);
    ko.components.register('p2p-form',                  require('./management/p2p-form/p2p-form').default);
    ko.components.register('system-address-form',       require('./management/system-address-form/system-address-form').default);
    ko.components.register('version-form',              require('./management/version-form/version-form').default);
    ko.components.register('diagnostics-form',          require('./management/diagnostics-form/diagnostics-form').default);
    ko.components.register('maintenance-form'   ,       require('./management/maintenance-form/maintenance-form').default);
    ko.components.register('proxy-server-form',         require('./management/proxy-server-form/proxy-server-form').default);
    ko.components.register('remote-syslog-form',        require('./management/remote-syslog-form/remote-syslog-form').default);
    ko.components.register('server-ssl-form',           require('./management/server-ssl-form/server-ssl-form').default);
    ko.components.register('server-time-form',          require('./management/server-time-form/server-time-form').default);
    ko.components.register('server-dns-settings-form',  require('./management/server-dns-settings-form/server-dns-settings-form').default);
    /** INJECT:management **/

    // -------------------------------
    // Accounts
    // -------------------------------
    ko.components.register('accounts-panel',    require('./accounts/accounts-panel/accounts-panel').default);
    ko.components.register('accounts-table',    require('./accounts/accounts-table/accounts-table').default);
    /** INJECT:accounts **/

    // -------------------------------
    // Account
    // -------------------------------
    ko.components.register('reset-password-modal',                  require('./account/reset-password-modal/reset-password-modal').default);
    ko.components.register('account-panel',                         require('./account/account-panel/account-panel').default);
    ko.components.register('account-details-form',                  require('./account/account-details-form/account-details-form').default);
    ko.components.register('account-s3-access-form',                require('./account/account-s3-access-form/account-s3-access-form').default);
    ko.components.register('regenerate-account-credentials-modal',  require('./account/regenerate-account-credentials-modal/regenerate-account-credentials-modal').default);
    ko.components.register('change-password-modal',                 require('./account/change-password-modal/change-password-modal').default);
    ko.components.register('account-connections-table',             require('./account/account-connections-table/account-connections-table').default);
    /** INJECT:account **/

    // -------------------------------
    // Cluster
    // -------------------------------
    ko.components.register('cluster-panel',                 require('./cluster/cluster-panel/cluster-panel').default);
    ko.components.register('server-table',                  require('./cluster/server-table/server-table').default);
    ko.components.register('cluster-summary',               require('./cluster/cluster-summary/cluster-summary').default);
    /** INJECT:cluster **/

    // -------------------------------
    // Server
    // -------------------------------
    ko.components.register('server-panel',              require('./server/server-panel/server-panel').default);
    ko.components.register('server-summary',            require('./server/server-summary/server-summary').default);
    ko.components.register('server-details-form',       require('./server/server-details-form/server-details-form').default);
    ko.components.register('server-diagnostics-form',   require('./server/server-diagnostics-form/server-diagnostics-form').default);
    ko.components.register('server-communication-form', require('./server/server-communication-form/server-communication-form').default);
    /** INJECT:server **/

    // -------------------------------
    // Funcs
    // -------------------------------
    ko.components.register('funcs-panel', require('./funcs/funcs-panel/funcs-panel').default);
    ko.components.register('funcs-table', require('./funcs/funcs-table/funcs-table').default);
    /** INJECT:funcs **/

    // -------------------------------
    // Func
    // -------------------------------
    ko.components.register('func-panel',        require('./func/func-panel/func-panel').default);
    ko.components.register('func-summary',      require('./func/func-summary/func-summary').default);
    ko.components.register('func-code',         require('./func/func-code/func-code').default);
    ko.components.register('func-invoke',       require('./func/func-invoke/func-invoke').default);
    ko.components.register('func-config',       require('./func/func-config/func-config').default);
    ko.components.register('func-monitoring',   require('./func/func-monitoring/func-monitoring').default);
    /** INJECT:func **/

    // -------------------------------
    // Admin
    // -------------------------------
    ko.components.register('audit-pane',  require('./admin/audit-pane/audit-pane').default);
    ko.components.register('alerts-pane', require('./admin/alerts-pane/alerts-pane').default);
    /** INJECT:admin **/

    // -------------------------------
    // shared
    // -------------------------------
    ko.components.register('svg-icon',                  require('./shared/svg-icon/svg-icon').default);
    ko.components.register('modal',                     require('./shared/modal/modal').default);
    ko.components.register('dropdown',                  require('./shared/dropdown/dropdown').default);
    ko.components.register('radio-btn',                 require('./shared/radio-btn/radio-btn').default);
    ko.components.register('radio-group',               require('./shared/radio-group/radio-group').default);
    ko.components.register('checkbox',                  require('./shared/checkbox/checkbox').default);
    ko.components.register('bar',                       require('./shared/bar/bar').default);
    ko.components.register('progress-bar',              require('./shared/progress-bar/progress-bar').default);
    ko.components.register('range-indicator',           require('./shared/range-indicator/range-indicator').default);
    ko.components.register('stepper',                   require('./shared/stepper/stepper').default);
    ko.components.register('multiselect',               require('./shared/multiselect/multiselect').default);
    ko.components.register('slider',                    require('./shared/slider/slider').default);
    ko.components.register('paginator',                 require('./shared/paginator/paginator').default);
    ko.components.register('drawer',                    require('./shared/drawer/drawer').default);
    ko.components.register('delete-button',             require('./shared/delete-button/delete-button').default);
    ko.components.register('file-selector',             require('./shared/file-selector/file-selector').default);
    ko.components.register('autocomplete',              require('./shared/autocomplete/autocomplete').default);
    ko.components.register('editor',                    require('./shared/editor/editor').default);
    ko.components.register('toggle-switch',             require('./shared/toggle-switch/toggle-switch').default);
    ko.components.register('property-sheet',            require('./shared/property-sheet/property-sheet').default);
    ko.components.register('capacity-bar',              require('./shared/capacity-bar/capacity-bar').default);
    ko.components.register('toggle-filter',             require('./shared/toggle-filter/toggle-filter').default);
    ko.components.register('data-table',                require('./shared/data-table/data-table').default);
    ko.components.register('timezone-chooser',          require('./shared/timezone-chooser/timezone-chooser').default);
    ko.components.register('date-time-chooser',         require('./shared/date-time-chooser/date-time-chooser').default);
    ko.components.register('pie-chart',                 require('./shared/pie-chart/pie-chart').default);
    ko.components.register('bar-chart',                 require('./shared/bar-chart/bar-chart').default);
    ko.components.register('chart-legend',              require('./shared/chart-legend/chart-legend').default);
    ko.components.register('copy-to-clipboard-button',  require('./shared/copy-to-clipboard-button/copy-to-clipboard-button').default);
    ko.components.register('password-field',            require('./shared/password-field/password-field').default);
    ko.components.register('working-button',            require('./shared/working-button/working-button').default);
    ko.components.register('collapsible-section',       require('./shared/collapsible-section/collapsible-section').default);
    ko.components.register('chartjs',                   require('./shared/chartjs/chartjs').default);
    ko.components.register('breadcrumbs',               require('./shared/breadcrumbs/breadcrumbs').default);
    ko.components.register('side-nav',                  require('./shared/side-nav/side-nav').default);
    ko.components.register('token-field',               require('./shared/token-field/token-field').default);
    ko.components.register('validation-message',        require('./shared/validation-message/validation-message').default);
    ko.components.register('validation-rules-list',     require('./shared/validation-rules-list/validation-rules-list').default);
    ko.components.register('validation-indicator',      require('./shared/validation-indicator/validation-indicator').default);
    ko.components.register('loading-indicator',         require('./shared/loading-indicator/loading-indicator').default);
    ko.components.register('drop-area',                 require('./shared/drop-area/drop-area').default);
    ko.components.register('wizard',                    require('./shared/wizard/wizard').default);
    ko.components.register('wizard-controls',           require('./shared/wizard-controls/wizard-controls').default);
    ko.components.register('managed-form',              require('./shared/managed-form/managed-form').default);
    ko.components.register('button-group',              require('./shared/button-group/button-group').default);
    /** INJECT:shared **/
}
