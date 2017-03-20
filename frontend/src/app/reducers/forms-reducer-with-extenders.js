import { combineReducers, reduceReducers } from 'utils/reducer-utils';
import formsReducer from './forms-reducer';
import installNodesFormReducer from './install-nodes-form-reducer';

const formsExtender = combineReducers({
    installNodes: installNodesFormReducer
});

export default reduceReducers(
    formsReducer,
    formsExtender
);
