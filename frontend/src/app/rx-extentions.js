import { get, equalItems, ensureArray } from 'utils/core-utils';
import { Observable } from 'rx';

Observable.prototype.get = function(...path) {
    return this
        .map(state => get(state, path))
        .distinctUntilChanged(undefined, Object.is);
};

Observable.prototype.getMany = function(...paths) {
    return this
        .map(state => paths.map(path => get(state, ensureArray(path))))
        .distinctUntilChanged(undefined, equalItems);
};

