// General actions.

// location actions.
export const REQUEST_LOCATION = 'REQUEST_LOCATION';
export const REFRESH_LOCATION = 'REFRESH_LOCATION';
export const CHANGE_LOCATION = 'CHANGE_LOCATION';

// Session related actions
export const RESTORE_SESSION = 'RESTORE_SESSION';
export const COMPLETE_RESTORE_SESSION = 'COMPLETE_RESTORE_SESSION';
export const FAIL_RESTORE_SESSION = 'FAIL_RESTORE_SESSION';
export const SIGN_IN = 'SIGN_IN';
export const COMPLETE_SIGN_IN = 'COMPLETE_SIGN_IN';
export const FAIL_SIGN_IN = 'FAIL_SIGN_IN';
export const SIGN_OUT = 'SIGN_OUT';

// Drawer related actions.
export const OPEN_DRAWER = 'OPEN_DRAWER';
export const CLOSE_DRAWER = 'CLOSE_DRAWER';

// Forms related actions.
export const INIT_FORM = 'INIT_FORM';
export const UPDATE_FORM = 'UPDATE_FORM';
export const RESET_FORM = 'RESET_FORM';
export const TOUCH_FORM = 'TOUCH_FORM';
export const SET_FORM_VALIDITY = 'SET_FORM_VALIDITY';
export const LOCK_FORM = 'LOCK_FORM';
export const UNLOCK_FORM = 'UNLOCK_FORM';
export const DROP_FROM = 'DROP_FROM';

// Modals related actions.
export const OPEN_MODAL = 'OPEN_MODAL';
export const UPDATE_MODAL = 'UPDATE_MODAL';
export const REPLACE_MODAL = 'REPLACE_MODAL';
export const LOCK_MODAL = 'LOCK_MODAL';
export const CLOSE_MODAL = 'CLOSE_MODAL';

// Notifications related actions.
export const HIDE_NOTIFICATION = 'HIDE_NOTIFICATION';
export const SHOW_NOTIFICATION = 'SHOW_NOTIFICATION';

// System related actions.
export const CREATE_SYSTEM = 'CREATE_SYSTEM';
export const COMPLETE_CREATE_SYSTEM = 'COMPLETE_CREATE_SYSTEM';
export const FAIL_CREATE_SYSTEM = 'FAIL_CREATE_SYSTEM';
export const FETCH_SYSTEM_INFO = 'FETCH_SYSTEM_INFO';
export const COMPLETE_FETCH_SYSTEM_INFO = 'COMPLETE_FETCH_SYSTEM_INFO';
export const FAIL_FETCH_SYSTEM_INFO = 'FAIL_FETCH_SYSTEM_INFO';
export const UPGRADE_SYSTEM = 'UPGRADE_SYSTEM';

// Node installation related actions.
export const FETCH_NODE_INSTALLATION_COMMANDS = 'FETCH_NODE_INSTALLATION_COMMANDS';
export const COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS = 'COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS';
export const FAIL_FETCH_NODE_INSTALLATION_COMMANDS = 'FAIL_FETCH_NODE_INSTALLATION_COMMANDS';

// Alerts related actions.
export const FETCH_ALERTS = 'FETCH_ALERTS';
export const COMPLETE_FETCH_ALERTS = 'COMPLETE_FETCH_ALERTS';
export const FAIL_FETCH_ALERTS = 'FAIL_FETCH_ALERTS';
export const UPDATE_ALERTS = 'UPDATE_ALERTS';
export const COMPLETE_UPDATE_ALERTS = 'COMPLETE_UPDATE_ALERTS';
export const FAIL_UPDATE_ALERTS = 'FAIL_UPDATE_ALERTS';
export const FETCH_UNREAD_ALERTS_COUNT = 'FETCH_UNREAD_ALERTS_COUNT';
export const COMPLETE_FETCH_UNREAD_ALERTS_COUNT = 'COMPLETE_FETCH_UNREAD_ALERTS_COUNT';
export const FAIL_FETCH_UREAD_ALERTS_COUNT = 'COMPLETE_FETCH_UNREAD_ALERTS_COUNT';
export const DROP_ALERTS = 'DROP_ALERTS';

// Account related actions.
export const CREATE_ACCOUNT = 'CREATE_ACCOUNT';
export const COMPLETE_CREATE_ACCOUNT = 'COMPLETE_CREATE_ACCOUNT';
export const FAIL_CREATE_ACCOUNT = 'FAIL_CREATE_ACCOUNT';
export const UPDATE_ACCOUNT_S3_ACCESS = 'UPDATE_ACCOUNT_S3_ACCESS';
export const COMPLETE_UPDATE_ACCOUNT_S3_ACCESS = 'COMPLETE_UPDATE_ACCOUNT_S3_ACCESS';
export const FAIL_UPDATE_ACCOUNT_S3_ACCESS = 'FAIL_UPDATE_ACCOUNT_S3_ACCESS';
export const SET_ACCOUNT_IP_RESTRICTIONS = 'SET_ACCOUNT_IP_RESTRICTIONS';
export const COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS = 'COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS';
export const FAIL_SET_ACCOUNT_IP_RESTRICTIONS = 'FAIL_SET_ACCOUNT_IP_RESTRICTIONS';
export const CHANGE_ACCOUNT_PASSWORD = 'CHANGE_ACCOUNT_PASSWORD';
export const COMPLETE_CHANGE_ACCOUNT_PASSWORD = 'COMPLETE_CHANGE_ACCOUNT_PASSWORD';
export const FAIL_CHANGE_ACCOUNT_PASSWORD = 'FAIL_CHANGE_ACCOUNT_PASSWORD';
export const ADD_EXTERNAL_CONNECTION = 'ADD_EXTERNAL_CONNECTION';
export const COMPLETE_ADD_EXTERNAL_CONNECTION = 'COMPLETE_ADD_EXTERNAL_CONNECTION';
export const FAIL_ADD_EXTERNAL_CONNECTION = 'FAIL_ADD_EXTERNAL_CONNECTION';
export const TRY_DELETE_ACCOUNT = 'TRY_DELETE_ACCOUNT';
export const COMPLETE_DELETE_ACCOUNT = 'COMPLETE_DELETE_ACCOUNT';
export const FAIL_DELETE_ACCOUNT = 'FAIL_DELETE_ACCOUNT';
export const DELETE_EXTERNAL_CONNECTION = 'DELETE_EXTERNAL_CONNECTION';
export const COMPLETE_DELETE_EXTERNAL_CONNECTION = 'COMPLETE_DELETE_EXTERNAL_CONNECTION';
export const FAIL_DELETE_EXTERNAL_CONNECTION = 'FAIL_DELETE_EXTERNAL_CONNECTION';

// Object related actions.
export const UPLOAD_OBJECTS = 'UPLOAD_OBJECTS';
export const UPDATE_OBJECT_UPLOAD = 'UPDATE_OBJECT_UPLOAD';
export const COMPLETE_OBJECT_UPLOAD = 'COMPLETE_OBJECT_UPLOAD';
export const FAIL_OBJECT_UPLOAD = 'FAIL_OBJECT_UPLOAD';
export const CLEAR_COMPLETED_OBJECT_UPLOADES = 'CLEAR_COMPLETED_OBJECT_UPLOADES';

// Bucket related actions.
export const UPDATE_BUCKET_QUOTA = 'UPDATE_BUCKET_QUOTA';
export const COMPLETE_UPDATE_BUCKET_QUOTA = 'COMPLETE_UPDATE_BUCKET_QUOTA';
export const FAIL_UPDATE_BUCKET_QUOTA = 'FAIL_UPDATE_BUCKET_QUOTA';
export const TOGGLE_BUCKET_SPILLOVER = 'TOGGLE_BUCKET_SPILLOVER';
export const COMPLETE_TOGGLE_BUCKET_SPILLOVER = 'COMPLETE_TOGGLE_BUCKET_SPILLOVER';
export const FAIL_TOGGLE_BUCKET_SPILLOVER = 'FAIL_TOGGLE_BUCKET_SPILLOVER';
export const TOGGLE_BUCKETS_SPILLOVER = 'TOGGLE_BUCKETS_SPILLOVER';
export const COMPLETE_TOGGLE_BUCKETS_SPILLOVER = 'COMPLETE_TOGGLE_BUCKETS_SPILLOVER';
export const FAIL_TOGGLE_BUCKETS_SPILLOVER = 'FAIL_TOGGLE_BUCKETS_SPILLOVER';
export const UPDATE_BUCKET_PLACEMENT_POLICY = 'UPDATE_BUCKET_PLACEMENT_POLICY';
export const COMPLETE_UPDATE_BUCKET_PLACEMENT_POLICY = 'COMPLETE_UPDATE_BUCKET_PLACEMENT_POLICY';
export const FAIL_UPDATE_BUCKET_PLACEMENT_POLICY = 'FAIL_UPDATE_BUCKET_PLACEMENT_POLICY';
export const DELETE_BUCKET = 'DELETE_BUCKET';
export const COMPLETE_DELETE_BUCKET = 'COMPLETE_DELETE_BUCKET';
export const FAIL_DELETE_BUCKET = 'FAIL_DELETE_BUCKET';
export const CREATE_GATEWAY_BUCKET = 'CREATE_GATEWAY_BUCKET';
export const COMPLETE_CREATE_GATEWAY_BUCKET = 'COMPLETE_CREATE_GATEWAY_BUCKET';
export const FAIL_CREATE_GATEWAY_BUCKET = 'FAIL_CREATE_GATEWAY_BUCKET';
export const UPDATE_GATEWAY_BUCKET_PLACEMENT = 'UPDATE_GATEWAY_BUCKET_PLACEMENT';
export const COMPLETE_UPDATE_GATEWAY_BUCKET_PLACEMENT = 'COMPLETE_UPDATE_GATEWAY_BUCKET_PLACEMENT';
export const FAIL_UPDATE_GATEWAY_BUCKET_PLACEMENT = 'FAIL_UPDATE_GATEWAY_BUCKET_PLACEMENT';
export const DELETE_GATEWAY_BUCKET = 'DELETE_GATEWAY_BUCKET';
export const COMPLETE_DELETE_GATEWAY_BUCKET = 'COMPLETE_DELETE_GATEWAY_BUCKET';
export const FAIL_DELETE_GATEWAY_BUCKET = 'FAIL_DELETE_GATEWAY_BUCKET';

// Resource related actions.
export const CREATE_HOSTS_POOL = 'CREATE_HOSTS_POOL';
export const COMPLETE_CREATE_HOSTS_POOL = 'COMPLETE_CREATE_HOSTS_POOL';
export const FAIL_CREATE_HOSTS_POOL = 'FAIL_CREATE_HOSTS_POOL';
export const DELETE_RESOURCE = 'DELETE_RESOURCE';
export const COMPLETE_DELETE_RESOURCE = 'COMPLETE_DELETE_RESOURCE';
export const FAIL_DELETE_RESOURCE = 'FAIL_DELETE_RESOURCE';
export const ASSIGN_HOSTS_TO_POOL = 'ASSIGN_HOSTS_TO_POOL';
export const COMPLETE_ASSIGN_HOSTS_TO_POOL = 'COMPLETE_ASSIGN_HOSTS_TO_POOL';
export const FAIL_ASSIGN_HOSTS_TO_POOL = 'FAIL_ASSIGN_HOSTS_TO_POOL';

// Namespace related actions
export const CREATE_NAMESPACE_RESOURCE = 'CREATE_NAMESPACE_RESOURCE';
export const COMPLETE_CREATE_NAMESPACE_RESOURCE = 'COMPLETE_CREATE_NAMESPACE_RESOURCE' ;
export const FAIL_CREATE_NAMESPACE_RESOURCE = 'FAIL_CREATE_NAMESPACE_RESOURCE';
export const DELETE_NAMESPACE_RESOURCE = 'DELETE_NAMESPACE_RESOURCE';
export const COMPLETE_DELETE_NAMESPACE_RESOURCE = 'COMPLETE_DELETE_NAMESPACE_RESOURCE';
export const FAIL_DELETE_NAMESPACE_RESOURCE = 'FAIL_DELETE_NAMESPACE_RESOURCE';

// Hosts related actions.
export const FETCH_HOSTS = 'FETCH_HOSTS';
export const COMPLETE_FETCH_HOSTS = 'COMPLETE_FETCH_HOSTS';
export const FAIL_FETCH_HOSTS = 'FAIL_FETCH_HOSTS';
export const COLLECT_HOST_DIAGNOSTICS = 'COLLECT_HOST_DIAGNOSTICS';
export const COMPLETE_COLLECT_HOST_DIAGNOSTICS = 'COMPLETE_COLLECT_HOST_DIAGNOSTICS';
export const FAIL_COLLECT_HOST_DIAGNOSTICS = 'FAIL_COLLECT_HOST_DIAGNOSTICS';
export const SET_HOST_DEBUG_MODE = 'SET_HOST_DEBUG_MODE';
export const COMPLETE_SET_HOST_DEBUG_MODE = 'COMPLETE_SET_HOST_DEBUG_MODE';
export const FAIL_SET_HOST_DEBUG_MODE = 'FAIL_SET_HOST_DEBUG_MODE';
export const DROP_HOSTS_VIEW = 'DROP_HOSTS_VIEW';
export const TOGGLE_HOST_SERVICES = 'TOGGLE_HOST_SERVICES';
export const COMPLETE_TOGGLE_HOST_SERVICES = 'COMPLETE_TOGGLE_HOST_SERVICES';
export const FAIL_TOGGLE_HOST_SERVICES = 'FAIL_TOGGLE_HOST_SERVICES';
export const TOGGLE_HOST_NODES = 'TOGGLE_HOST_NODES';
export const COMPLETE_TOGGLE_HOST_NODES = 'COMPLETE_TOGGLE_HOST_NODES';
export const FAIL_TOGGLE_HOST_NODES = 'FAIL_TOGGLE_HOST_NODES';
export const FETCH_HOST_OBJECTS = 'FETCH_HOST_OBJECTS';
export const COMPLETE_FETCH_HOST_OBJECTS = 'COMPLETE_FETCH_HOST_OBJECTS';
export const FAIL_FETCH_HOST_OBJECTS = 'FAIL_FETCH_HOST_OBJECTS';
export const RETRUST_HOST = 'RETRUST_HOST';
export const COMPLETE_RETRUST_HOST = 'COMPLETE_RETRUST_HOST';
export const FAIL_RETRUST_HOST = 'FAIL_RETRUST_HOST';

// Cloud related actions.
export const FETCH_CLOUD_TARGETS = 'FETCH_CLOUD_TARGETS';
export const COMPLETE_FETCH_CLOUD_TARGETS = 'COMPLETE_FETCH_CLOUD_TARGETS';
export const FAIL_FETCH_CLOUD_TARGETS = 'FAIL_FETCH_CLOUD_TARGETS';
export const DROP_CLOUD_TARGETS = 'DROP_CLOUD_TARGETS';

// Environment actions.
export const TOGGLE_PREVIEW_CONTENT = 'TOGGLE_PREVIEW_CONTENT';

