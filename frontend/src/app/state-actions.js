import Rx from 'rx';
import { deepFreeze } from 'utils/core-utils';

export const actions = new Rx.Subject();

export function dispatch(action) {
    if (!action.type) {
        throw TypeError('Action missing a type');
    }

    actions.onNext(deepFreeze(action));
}
