import { combineReducers } from 'utils/reducer-utils';
import alertReducer from './alert-reducer';

export default combineReducers({
    alert: alertReducer
});
