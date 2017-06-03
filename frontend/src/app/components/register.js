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
    ko.components.register('app',           require('./application/app/app').default);
    ko.components.register('main-layout',   require('./application/main-layout/main-layout').default);
    ko.components.register('login-layout',  require('./application/login-layout/login-layout').default);
    ko.components.register('modal-manager', require('./application/modal-manager/modal-manager').default);
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
    /** INJECT:login **/

    // -------------------------------
    // Main
    // -------------------------------
    ko.components.register('commands-bar',      require('./main/commands-bar/commands-bar').default);
    ko.components.register('notification-box',  require('./main/notification-box/notification-box').default);
    ko.components.register('account-menu',      require('./main/account-menu/account-menu').default);
    ko.components.register('uploads-indicator', require('./main/uploads-indicator/uploads-indicator').default);
    /** INJECT:login **/

    // -------------------------------
    // Stickies
    // -------------------------------
    ko.components.register('debug-mode-sticky',                 require('./stickies/debug-mode-sticky/debug-mode-sticky').default);
    ko.components.register('maintenance-sticky',                require('./stickies/maintenance-sticky/maintenance-sticky').default);
    ko.components.register('license-sticky',                    require('./stickies/license-sticky/license-sticky').default);
    ko.components.register('phone-home-connectivity-sticky',    require('./stickies/phone-home-connectivity-sticky/phone-home-connectivity-sticky').default);
    /** INJECT:stickies **/

    // -------------------------------
    // Modals
    // -------------------------------
    ko.components.register('install-nodes-modal',                   require('./modals/install-nodes-modal/install-nodes-modal').default);
    ko.components.register('upgraded-capacity-notification-modal',  require('./modals/upgraded-capacity-notification-modal/upgraded-capacity-notification-modal').default);
    ko.components.register('welcome-modal',                         require('./modals/welcome-modal/welcome-modal').default);
    ko.components.register('after-upgrade-modal',                   require('./modals/after-upgrade-modal/after-upgrade-modal').default);
    ko.components.register('add-cloud-resource-modal',              require('./modals/add-cloud-resource-modal/add-cloud-resource-modal').default);
    ko.components.register('add-cloud-connection-modal',            require('./modals/add-cloud-connection-modal/add-cloud-connection-modal').default);
    ko.components.register('set-cloud-sync-modal',                  require('./modals/set-cloud-sync-modal/set-cloud-sync-modal').default);
    ko.components.register('edit-cloud-sync-modal',                 require('./modals/edit-cloud-sync-modal/edit-cloud-sync-modal').default);
    ko.components.register('s3-access-details-modal',               require('./modals/s3-access-details-modal/s3-access-details-modal').default);
    ko.components.register('bucket-s3-access-modal',                require('./modals/bucket-s3-access-modal/bucket-s3-access-modal').default);
    ko.components.register('bucket-placement-policy-modal',         require('./modals/bucket-placement-policy-modal/bucket-placement-policy-modal').default);
    ko.components.register('start-maintenance-modal',               require('./modals/start-maintenance-modal/start-maintenance-modal').default);
    ko.components.register('file-uploads-modal',                    require('./modals/file-uploads-modal/file-uploads-modal').default);
    ko.components.register('delete-current-account-warning-modal',  require('./modals/delete-current-account-warning-modal/delete-current-account-warning-modal').default);
    ko.components.register('object-preview-modal',                  require('./modals/object-preview-modal/object-preview-modal').default);
    ko.components.register('test-node-modal',                       require('./modals/test-node-modal/test-node-modal').default);
    ko.components.register('edit-server-dns-settings-modal',        require('./modals/edit-server-dns-settings-modal/edit-server-dns-settings-modal').default);
    ko.components.register('edit-server-time-settings-modal',       require('./modals/edit-server-time-settings-modal/edit-server-time-settings-modal').default);
    ko.components.register('edit-account-s3-access-modal',          require('./modals/edit-account-s3-access-modal/edit-account-s3-access-modal').default);
    ko.components.register('edit-server-details-modal',             require('./modals/edit-server-details-modal/edit-server-details-modal').default);
    ko.components.register('assign-nodes-modal',                    require('./modals/assign-nodes-modal/assign-nodes-modal').default);
    ko.components.register('update-system-name-modal',              require('./modals/update-system-name-modal/update-system-name-modal').default);
    ko.components.register('system-upgrade-modal',                  require('./modals/system-upgrade-modal/system-upgrade-modal').default);
    ko.components.register('create-account-modal',                  require('./modals/create-account-modal/create-account-modal').default);
    ko.components.register('account-created-modal',                 require('./modals/account-created-modal/account-created-modal').default);
    ko.components.register('edit-bucket-quota-modal',               require('./modals/edit-bucket-quota-modal/edit-bucket-quota-modal').default);
    ko.components.register('set-account-ip-restrictions-modal',     require('./modals/set-account-ip-restrictions-modal/set-account-ip-restrictions-modal').default);
    /** INJECT:modals **/

    // -------------------------------
    // Overview
    // -------------------------------
    ko.components.register('overview-panel',        require('./overview/overview-panel/overview-panel').default);
    ko.components.register('connect-app-wizard',    require('./overview/connect-app-wizard/connect-app-wizard').default);
    ko.components.register('buckets-overview',      require('./overview/buckets-overview/buckets-overview').default);
    ko.components.register('resource-overview',     require('./overview/resource-overview/resource-overview').default);
    ko.components.register('system-health',         require('./overview/system-health/system-health').default);
    /** INJECT:overview **/

    // -------------------------------
    // Buckets
    // -------------------------------
    ko.components.register('buckets-panel',         require('./buckets/buckets-panel/buckets-panel').default);
    ko.components.register('buckets-table',         require('./buckets/buckets-table/buckets-table').default);
    ko.components.register('create-bucket-wizard',  require('./buckets/create-bucket-wizard/create-bucket-wizard').default);
    ko.components.register('ns-buckets-table',      require('./buckets/ns-buckets-table/ns-buckets-table').default);
    /** INJECT:buckets **/

    // -------------------------------
    // Bucket
    // -------------------------------
    ko.components.register('bucket-panel',                  require('./bucket/bucket-panel/bucket-panel').default);
    ko.components.register('bucket-summary',                require('./bucket/bucket-summary/bucket-summary').default);
    ko.components.register('bucket-objects-table',          require('./bucket/bucket-objects-table/bucket-objects-table').default);
    ko.components.register('bucket-data-placement-form',    require('./bucket/bucket-data-placement-form/bucket-data-placement-form').default);
    ko.components.register('bucket-cloud-sync-form',        require('./bucket/bucket-cloud-sync-form/bucket-cloud-sync-form').default);
    ko.components.register('bucket-s3-access-table',        require('./bucket/bucket-s3-access-table/bucket-s3-access-table').default);
    ko.components.register('bucket-namespace-form',         require('./bucket/bucket-namespace-form/bucket-namespace-form').default);
    ko.components.register('bucket-spillover',              require('./bucket/bucket-spillover/bucket-spillover').default);
    ko.components.register('bucket-data-placement-table',   require('./bucket/bucket-data-placement-table/bucket-data-placement-table').default);
    /** INJECT:bucket **/

    // -------------------------------
    // Namespace Bucket
    // -------------------------------
    ko.components.register('ns-bucket-panel',               require('./ns-bucket/ns-bucket-panel/ns-bucket-panel').default);
    ko.components.register('ns-bucket-summary',             require('./ns-bucket/ns-bucket-summary/ns-bucket-summary').default);
    ko.components.register('ns-bucket-data-placement-form', require('./ns-bucket/ns-bucket-data-placement-form/ns-bucket-data-placement-form').default);
    ko.components.register('ns-bucket-s3-access-table',     require('./ns-bucket/ns-bucket-s3-access-table/ns-bucket-s3-access-table').default);
    ko.components.register('ns-bucket-objects-table', require('./ns-bucket/ns-bucket-objects-table/ns-bucket-objects-table').default);
    /** INJECT:ns-bucket **/

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
    ko.components.register('create-pool-wizard',        require('./resources/create-pool-wizard/create-pool-wizard').default);
    ko.components.register('cloud-resources-table',     require('./resources/cloud-resources-table/cloud-resources-table').default);
    ko.components.register('external-resources-table',  require('./resources/external-resources-table/external-resources-table').default);
    ko.components.register('internal-resources-table',  require('./resources/internal-resources-table/internal-resources-table').default);
    /** INJECT:resources **/

    // -------------------------------
    // Pool
    // -------------------------------
    ko.components.register('pool-panel',                    require('./pool/pool-panel/pool-panel').default);
    ko.components.register('pool-summary',                  require('./pool/pool-summary/pool-summary').default);
    ko.components.register('pool-nodes-table',              require('./pool/pool-nodes-table/pool-nodes-table').default);
    ko.components.register('pool-associated-accounts-list', require('./pool/pool-associated-accounts-list/pool-associated-accounts-list').default);
    ko.components.register('pool-connected-buckets-list',   require('./pool/pool-connected-buckets-list/pool-connected-buckets-list').default);
    /** INJECT:pool **/

    // -------------------------------
    // Node
    // -------------------------------
    ko.components.register('node-panel',            require('./node/node-panel/node-panel').default);
    ko.components.register('node-summary',          require('./node/node-summary/node-summary').default);
    ko.components.register('node-parts-table',      require('./node/node-parts-table/node-parts-table').default);
    ko.components.register('node-details-form',     require('./node/node-details-form/node-details-form').default);
    ko.components.register('node-diagnostics-form', require('./node/node-diagnostics-form/node-diagnostics-form').default);
    /** INJECT:node **/

    // -------------------------------
    // Management
    // -------------------------------
    ko.components.register('management-panel',          require('./management/management-panel/management-panel').default);
    ko.components.register('accounts-table',            require('./management/accounts-table/accounts-table').default);
    ko.components.register('p2p-form',                  require('./management/p2p-form/p2p-form').default);
    ko.components.register('server-dns-form',           require('./management/server-dns-form/server-dns-form').default);
    ko.components.register('version-form',              require('./management/version-form/version-form').default);
    ko.components.register('diagnostics-form',          require('./management/diagnostics-form/diagnostics-form').default);
    ko.components.register('maintenance-form'   ,       require('./management/maintenance-form/maintenance-form').default);
    ko.components.register('phone-home-form',           require('./management/phone-home-form/phone-home-form').default);
    ko.components.register('remote-syslog-form',        require('./management/remote-syslog-form/remote-syslog-form').default);
    ko.components.register('server-ssl-form',           require('./management/server-ssl-form/server-ssl-form').default);
    ko.components.register('server-time-form',          require('./management/server-time-form/server-time-form').default);
    ko.components.register('server-dns-settings-form',  require('./management/server-dns-settings-form/server-dns-settings-form').default);
    /** INJECT:management **/

    // -------------------------------
    // Account
    // -------------------------------
    ko.components.register('reset-password-modal',                  require('./account/reset-password-modal/reset-password-modal').default);
    ko.components.register('account-panel',                         require('./account/account-panel/account-panel').default);
    ko.components.register('account-details-form',                  require('./account/account-details-form/account-details-form').default);
    ko.components.register('account-s3-access-form',                require('./account/account-s3-access-form/account-s3-access-form').default);
    ko.components.register('regenerate-account-credentials-modal',  require('./account/regenerate-account-credentials-modal/regenerate-account-credentials-modal').default);
    ko.components.register('change-password-modal',                 require('./account/change-password-modal/change-password-modal').default);
    /** INJECT:account **/

    // -------------------------------
    // Cluster
    // -------------------------------
    ko.components.register('cluster-panel',                 require('./cluster/cluster-panel/cluster-panel').default);
    ko.components.register('server-table',                  require('./cluster/server-table/server-table').default);
    ko.components.register('attach-server-modal',           require('./cluster/attach-server-modal/attach-server-modal').default);
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
    ko.components.register('wizard',                    require('./shared/wizard/wizard').default);
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
    ko.components.register('pool-selection-table',      require('./shared/pool-selection-table/pool-selection-table').default);
    ko.components.register('node-selection-table',      require('./shared/node-selection-table/node-selection-table').default);
    ko.components.register('chart-legend',              require('./shared/chart-legend/chart-legend').default);
    ko.components.register('copy-to-clipboard-button',  require('./shared/copy-to-clipboard-button/copy-to-clipboard-button').default);
    ko.components.register('password-field',            require('./shared/password-field/password-field').default);
    ko.components.register('working-button',            require('./shared/working-button/working-button').default);
    ko.components.register('collapsible-section',       require('./shared/collapsible-section/collapsible-section').default);
    ko.components.register('chartjs',                   require('./shared/chartjs/chartjs').default);
    ko.components.register('breadcrumbs',               require('./shared/breadcrumbs/breadcrumbs').default);
    ko.components.register('side-nav',                  require('./shared/side-nav/side-nav').default);
    ko.components.register('token-field',               require('./shared/token-field/token-field').default);
    ko.components.register('new-wizard',                require('./shared/new-wizard/new-wizard').default);
    ko.components.register('validation-message',        require('./shared/validation-message/validation-message').default);
    ko.components.register('validation-rules-list',     require('./shared/validation-rules-list/validation-rules-list').default);
    ko.components.register('validation-indicator',      require('./shared/validation-indicator/validation-indicator').default);
    /** INJECT:shared **/
}
