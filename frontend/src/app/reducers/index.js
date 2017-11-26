/* Copyright (C) 2016 NooBaa */

import { combineReducers } from 'utils/reducer-utils';
import envReducer from './env-reducer';
import locationReducer from './location-reducer';
import sessionReducer from './session-reducer';
import drawerReducer from './drawer-reducer';
import modalsReducer from './modals-reducer';
import formsReducer from './forms-reducer';
import bucketsReducer from './buckets-reducer';
import namespaceBucketsReducer from './namespace-buckets-reducer';
import hostPoolsReducer from './host-pools-reducer';
import cloudResourcesReducer from './cloud-resources-reducer';
import internalResourcesReducer from './internal-resources-reducer';
import namespaceResourcesReducer from './namespace-resources-reducer';
import hostsReducer from './hosts-reducer';
import accountsReducer from './accounts-reducer';
import objectUploadsReducer from './object-uploads-reducer';
import alertsReducer from './alerts-reducer';
import notificationsReducer from './notificaitons-reducer';
import topologyReducer from './topology-reducer';
import hostPartsReducer from './host-parts-reducer';
import cloudTargetsReducer from './cloud-targets-reducer';
import bucketObjectsReducer from './bucket-objects-reducer';
import storageHistoryReducer from './storage-history-reducer';
import systemReducer from './system-reducer';

export default combineReducers({
    env: envReducer,
    location: locationReducer,
    session: sessionReducer,
    drawer: drawerReducer,
    modals: modalsReducer,
    forms: formsReducer,
    notifications: notificationsReducer,
    alerts: alertsReducer,
    buckets: bucketsReducer,
    namespaceBuckets: namespaceBucketsReducer,
    cloudResources: cloudResourcesReducer,
    internalResources: internalResourcesReducer,
    namespaceResources: namespaceResourcesReducer,
    hostPools: hostPoolsReducer,
    hosts: hostsReducer,
    hostParts: hostPartsReducer,
    accounts: accountsReducer,
    objectUploads: objectUploadsReducer,
    topology: topologyReducer,
    cloudTargets: cloudTargetsReducer,
    bucketObjects: bucketObjectsReducer,
    storageHistory: storageHistoryReducer,
    system: systemReducer
});
