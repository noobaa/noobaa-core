import Rx from 'rx';
import { deepFreeze } from 'utils/core-utils';

export const actions = new Rx.Subject();

function _dispatch(action) {
    if (!action.type) {
        throw TypeError('Action missing a type');
    }

    actions.onNext(deepFreeze(action));
}

export function dispatcher(impl) {
    return (...args) => impl(_dispatch, args);
}
