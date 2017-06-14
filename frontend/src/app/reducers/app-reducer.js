/* Copyright (C) 2016 NooBaa */

import { combineReducers } from 'utils/reducer-utils';
import sessionReducer from './session-reducer';
import drawerReducer from './drawer-reducer';
import modalsReducer from './modals-reducer';
import layoutReducer from './main-layout-reducer';
import formsReducer from './forms-reducer-with-extenders';
import bucketsReducer from './buckets-reducer';
import nodePoolsReducer from './node-pools-reducer';
import cloudResourcesReducer from './cloud-resources-reducer';
import accountsReducer from './accounts-reducer';
import objectUploadsReducer from './object-uploads-reducer';
import alertsReducer from './alerts-reducer';
import notificationsReducer from './notificaitons-reducer';
import internalResourcesReducer from './internal-resources-reducer';

export default combineReducers({
    session: sessionReducer,
    layout: layoutReducer,
    drawer: drawerReducer,
    modals: modalsReducer,
    forms: formsReducer,
    alerts: alertsReducer,
    buckets: bucketsReducer,
    nodePools: nodePoolsReducer,
    cloudResources: cloudResourcesReducer,
    accounts: accountsReducer,
    objectUploads: objectUploadsReducer,
    notifications: notificationsReducer,
    internalResources: internalResourcesReducer
});
