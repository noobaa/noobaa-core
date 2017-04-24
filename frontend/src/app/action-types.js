// Misc actions.
export const INIT_APPLICATION = 'INIT_APPLICATION';
export const CHANGE_LOCATION = 'CHANGE_LOCATION';

// Session related actions
export const RESTORE_LAST_SESSION = 'RESTORE_LAST_SESSION';
export const SIGN_IN = 'SIGN_IN';
export const SIGN_OUT = 'SIGN_OUT';

// Drawer related actions.
export const OPEN_DRAWER = 'OPEN_DRAWER';
export const CLOSE_DRAWER = 'CLOSE_DRAWER';

// Forms related actions.
export const INIT_FORM = 'INIT_FORM';
export const UPDATE_FORM = 'UPDATE_FORM';
export const RESET_FORM = 'RESET_FORM';
export const RESET_FORM_FIELD = 'RESET_FORM_FIELD';
export const SET_FORM_VALIDITY = 'SET_FORM_VALIDITY';
export const TOUCH_FORM = 'TOUCH_FORM';
export const DISPOSE_FORM = 'DISPOSE_FORM';

// Modals related actions.
export const OPEN_MODAL = 'OPEN_MODAL';
export const UPDATE_MODAL = 'UPDATE_MODAL';
export const REPLACE_MODAL = 'REPLACE_MODAL';
export const LOCK_ACTIVE_MODAL = 'LOCK_ACTIVE_MODAL';
export const CLOSE_ACTIVE_MODAL = 'CLOSE_ACTIVE_MODAL';

// Notifications related actions.
export const HIDE_NOTIFICATION = 'HIDE_NOTIFICATION';
export const SHOW_NOTIFICATION = 'SHOW_NOTIFICATION'; // TODO REMOVE: This is a temp action to support older architecture

// System related actions.
export const UPGRADE_SYSTEM = 'UPGRADE_SYSTEM';
export const SYSTEM_INFO_FETCHED = 'SYSTEM_INFO_FETCHED';
export const NODE_INSTALLATION_COMMANDS_FETCHED = 'NODE_INSTALLATION_COMMANDS_FETCHED';

// Alerts related actions.
export const ALERTS_FETCH = 'ALERTS_FETCH';
export const ALERTS_FETCHED = 'ALERTS_FETCHED';
export const ALERTS_FETCH_FAILED = 'ALERTS_FETCH_FAILED';
export const ALERTS_UPDATE = 'ALERTS_UPDATE';
export const ALERTS_UPDATED = 'ALERTS_UPDATED';
export const ALERTS_UPDATE_FAILED = 'ALERTS_UPDATE_FAILED';
export const ALERTS_UPDATE_UNREAD_COUNT = 'ALERTS_UPDATE_UNREAD_COUNT';
export const ALERTS_DROP_STATE = 'ALERTS_DROP_STATE';

// Account related actions.
export const CREATE_ACCOUNT = 'CREATE_ACCOUNT';
export const ACCOUNT_CREATION_FAILED = 'ACCOUNT_CREATION_FAILED';
export const ACCOUNT_S3_ACCESS_UPDATED = 'ACCOUNT_S3_ACCESS_UPDATED';
export const ACCOUNT_S3_ACCESS_UPDATE_FAILED = 'ACCOUNT_S3_ACCESS_UPDATE_FAILED';

// Object related actions.
export const OBJECT_UPLOAD_STARTED = 'OBJECT_UPLOAD_STARTED';
export const OBJECT_UPLOAD_PROGRESS = 'OBJECT_UPLOAD_PROGRESS';
export const OBJECT_UPLOAD_COMPLETED = 'OBJECT_UPLOAD_COMPLETED';
export const OBJECT_UPLOAD_FAIELD = 'OBJECT_UPLOAD_FAIELD';
export const CLEAR_COMPLETED_OBJECT_UPLOADES = 'CLEAR_COMPLETED_OBJECT_UPLOADES';


