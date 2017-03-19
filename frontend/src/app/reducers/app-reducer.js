import { combineReducers } from 'utils/reducer-utils';
import sessionReducer from './session-reducer';
import drawerReducer from './drawer-reducer';
import modalsReducer from './modals-reducer';
import alertsReducer from './alerts-reducer';
import bucketsReducer from './buckets-reducer';
import nodePoolsReducer from './node-pools-reducer';
import cloudResourcesReducer from './cloud-resources-reducer';
import objectUploadsReducer from './object-uploads-reducer';
import layoutReducer from './layout-reducer';
import formsReducer from './forms-reducer-with-extenders';

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
    objectUploads: objectUploadsReducer
});
