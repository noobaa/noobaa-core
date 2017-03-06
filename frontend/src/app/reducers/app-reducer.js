import { combineReducers } from 'utils/reducer-utils';
import sessionReducer from './session-reducer';
import drawerReducer from './drawer-reducer';
import modalsReducer from './modals-reducer';
import alertsReducer from './alerts-reducer';
import objectUploadsReducer from './object-uploads-reducer';
import cloudResourcesReducer from './cloud-resources-reducer';
import layoutReducer from './layout-reducer';
import formsReducer from './forms-reducer';


export default combineReducers({
    session: sessionReducer,
    layout: layoutReducer,
    drawer: drawerReducer,
    modals: modalsReducer,
    forms: formsReducer,
    alerts: alertsReducer,
    objectUploads: objectUploadsReducer,
    cloudResources: cloudResourcesReducer
});
