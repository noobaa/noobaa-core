import { combineReducers } from 'utils/reducer-utils';
import drawerReducer from './drawer-reducer';
import modalsReducer from './modals-reducer';
import alertsReducer from './alerts-reducer';
import objectUploadsReducer from './object-uploads-reducer';
import cloudResourcesReducer from './cloud-resources-reducer';
import layoutReducer from './layout-reducer';

export default combineReducers({
    layout: layoutReducer,
    drawer: drawerReducer,
    modals: modalsReducer,
    alerts: alertsReducer,
    objectUploads: objectUploadsReducer,
    cloudResources: cloudResourcesReducer
});
