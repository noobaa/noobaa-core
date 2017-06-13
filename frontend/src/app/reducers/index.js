/* Copyright (C) 2016 NooBaa */

import { combineReducers } from 'utils/reducer-utils';
import envReducer from './env-reducer';
import locationReducer from './location-reducer';
import sessionReducer from './session-reducer';
import drawerReducer from './drawer-reducer';
import modalsReducer from './modals-reducer';
import formsReducer from './forms-reducer';
import bucketsReducer from './buckets-reducer';
import nsBucketsReducer from './ns-buckets-reducer';
import nodePoolsReducer from './node-pools-reducer';
import cloudResourcesReducer from './cloud-resources-reducer';
import externalResourcesReducer from './external-resources-reducer';
import accountsReducer from './accounts-reducer';
import objectUploadsReducer from './object-uploads-reducer';
import alertsReducer from './alerts-reducer';
import notificationsReducer from './notificaitons-reducer';
import internalResourcesReducer from './internal-resources-reducer';


export default combineReducers({
    env: envReducer,
    location: locationReducer,
    session: sessionReducer,
    drawer: drawerReducer,
    modals: modalsReducer,
    forms: formsReducer,
    alerts: alertsReducer,
    buckets: bucketsReducer,
    nsBuckets: nsBucketsReducer,
    nodePools: nodePoolsReducer,
    cloudResources: cloudResourcesReducer,
    externalResources: externalResourcesReducer,
    internalResources: internalResourcesReducer,
    accounts: accountsReducer,
    objectUploads: objectUploadsReducer,
    notifications: notificationsReducer
});
