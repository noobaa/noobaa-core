import { createReducer } from 'utils/reducer-utils';

function onInit() {
    return {};
}

export default createReducer({
    INIT: onInit
});
