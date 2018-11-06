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
import namespaceResourcesReducer from './namespace-resources-reducer';
import hostsReducer from './hosts-reducer';
import accountsReducer from './accounts-reducer';
import objectUploadsReducer from './object-uploads-reducer';
import alertsReducer from './alerts-reducer';
import notificationsReducer from './notificaitons-reducer';
import topologyReducer from './topology-reducer';
import hostPartsReducer from './host-parts-reducer';
import cloudTargetsReducer from './cloud-targets-reducer';
import objectsReducer from './objects-reducer';
import objectPartsReducer from './object-parts-reducer';
import systemReducer from './system-reducer';
import functionsReducer from './functions-reducer';
import storageHistoryReducer from './storage-history-reducer';
import bucketUsageHistoryReducer from './bucket-usage-history-reducer';
import accountUsageHistoryReducer from './account-usage-history-reducer';
import lambdaUsageHistoryReducer from './lambda-usage-history-reducer';
import objectsDistributionReducer from './objects-distribution-reducer';
import cloudUsageStatsReducer  from './cloud-usage-stats-reducer';
import platformReducer  from './platform-reducer';
/** INJECT:import **/

/* eslint-disable comma-dangle */
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
    namespaceResources: namespaceResourcesReducer,
    hostPools: hostPoolsReducer,
    hosts: hostsReducer,
    hostParts: hostPartsReducer,
    accounts: accountsReducer,
    topology: topologyReducer,
    cloudTargets: cloudTargetsReducer,
    objects: objectsReducer,
    objectUploads: objectUploadsReducer,
    objectParts: objectPartsReducer,
    system: systemReducer,
    functions: functionsReducer,
    storageHistory: storageHistoryReducer,
    bucketUsageHistory: bucketUsageHistoryReducer,
    accountUsageHistory: accountUsageHistoryReducer,
    lambdaUsageHistory: lambdaUsageHistoryReducer,
    objectsDistribution: objectsDistributionReducer,
    cloudUsageStats: cloudUsageStatsReducer,
    platform: platformReducer,
    /** INJECT:list **/
});
