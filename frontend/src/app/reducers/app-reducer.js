import { combineReducers } from 'utils/reducer-utils';
import sessionReducer from './session-reducer';
import drawerReducer from './drawer-reducer';
import modalsReducer from './modals-reducer';
import layoutReducer from './layout-reducer';
import formsReducer from './forms-reducer-with-extenders';
import bucketsReducer from './buckets-reducer';
import nodePoolsReducer from './node-pools-reducer';
import cloudResourcesReducer from './cloud-resources-reducer';
import accountsReducer from './accounts-reducer';
import objectUploadsReducer from './object-uploads-reducer';
import alertsReducer from './alerts-reducer';

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
    objectUploads: objectUploadsReducer
});
