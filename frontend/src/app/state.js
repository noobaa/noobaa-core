/* Copyright (C) 2016 NooBaa */

import { action$ } from 'state-actions';
import { deepFreeze, noop } from 'utils/core-utils';
import appReducer from 'reducers/app-reducer';

const state$ = action$
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
