import { action$ } from 'state-actions';
import { deepFreeze, noop, get, equal } from 'utils/core-utils';
import appReducer from 'reducers/app-reducer';
import { Observable } from 'rx';

Observable.prototype.get = function(...path) {
    return this
        .map(state => get(state, path))
        .distinctUntilChanged(undefined, equal);
};

Observable.prototype.getMany = function(...paths) {
    return Observable.combineLatest(
        ...paths.map(path => Array.isArray(path) ? this.get(...path) : this.get(path))
    );
};

const state$ = action$
    .startWith({ type: 'INIT_APPLICATION' })
    .tap(action => console.info('DISPATCHING:', action))
    .scan((state, action) => appReducer(state, action), {})
    .map(deepFreeze)
    .tap(state => console.info('NEW STATE:', state))
    .shareReplay(1);

state$.subscribe(
    noop,
    error => console.error('STATE STREAM ERROR:', error),
    () => console.error('STATE STREAM TERMINATED')
);

export default state$;
