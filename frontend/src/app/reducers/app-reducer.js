import { combineReducers } from 'utils/reducer-utils';
import drawerReducer from './drawer-reducer';
import modalsReducer from './modals-reducer';
import alertsReducer from './alerts-reducer';
import objectUploadsReducer from './object-uploads-reducer';

export default combineReducers({
    drawer: drawerReducer,
    modals: modalsReducer,
    alerts: alertsReducer,
    objectUploads: objectUploadsReducer
});
