import { actions } from 'state-actions';
import { deepFreeze, noop } from 'utils/core-utils';
import appReducer from 'reducers/app-reducer';

const state = actions
    .startWith({ type: 'APPLICATION_INIT' })
    .tap(action => console.log('STATE ACTION DISPATCHED:', action))
    .scan((state, action) => deepFreeze(appReducer(state, action)), {})
    .tap(state => console.log('NEW STATE:', state))
    .shareReplay(1);

state.subscribe(
    noop,
    error => console.error('STATE STREAM ERROR:', error),
    () => console.error('STATE STREAM TERMINATED')
);

export default state;

