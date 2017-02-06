import { combineReducers } from 'utils/reducer-utils';
import alertsReducer from './alerts-reducer';
import drawerReducer from './drawer-reducer';

export default combineReducers({
    alerts: alertsReducer,
    drawer: drawerReducer
});
