import ko from 'knockout';
import { isFunction, noop } from 'utils/core-utils';

export default function isModified(target, expr) {
    if (!ko.isComputed(target) && !ko.isWriteableObservable(target)) {
        throw new TypeError('Invalid target, must be a non writeable computed observable');
    }

    if (!isFunction(expr)) {
        throw new TypeError('Invalid expression, must be a function or observable');
    }

    target.isModified = ko.computed({
        read: expr,
        write: noop
    });
}
