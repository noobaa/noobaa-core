import { get } from 'utils/core-utils';
import { Observable } from 'rx';

Observable.prototype.get = function(...path) {
    return this
        .map(state => get(state, path))
        .distinctUntilChanged(undefined, Object.is);
};

Observable.prototype.getMany = function(...paths) {
    return Observable.combineLatest(
        ...paths.map(path => Array.isArray(path) ? this.get(...path) : this.get(path))
    );
};
