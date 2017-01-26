import { combineReducers } from 'utils/reducer-utils';
import alertsReducer from './alerts-reducer';

export default combineReducers({
    alerts: alertsReducer
});
