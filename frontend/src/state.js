import { actions } from 'state-actions';
import { deepFreeze } from 'utils/js-utils';
import appReducer from 'reducers/app-reducer';

const state = actions
    .startWith({ type: 'INIT' })
    .tap(action => console.log('ACTION DISPATCHED:', action))
    .scan((state, action) => deepFreeze(appReducer(state, action)), {})
    .tap(state => console.log('NEW STATE:', state))
    .shareReplay(1);

export default state;
