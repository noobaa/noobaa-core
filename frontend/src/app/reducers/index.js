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
import hostPoolsReducer from './host-pools-reducer';
import cloudResourcesReducer from './cloud-resources-reducer';
import externalResourcesReducer from './external-resources-reducer';
import hostsReducer from './hosts-reducer';
import accountsReducer from './accounts-reducer';
import objectUploadsReducer from './object-uploads-reducer';
import alertsReducer from './alerts-reducer';
import notificationsReducer from './notificaitons-reducer';
import topologyReducer from './topology-reducer';


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
    hostPools: hostPoolsReducer,
    cloudResources: cloudResourcesReducer,
    externalResources: externalResourcesReducer,
    hosts: hostsReducer,
    accounts: accountsReducer,
    objectUploads: objectUploadsReducer,
    notifications: notificationsReducer,
    topology: topologyReducer
});
