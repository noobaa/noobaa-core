import state from 'state';

const stateSub = Symbol('stateSub');
const oldState = Symbol('oldState');

export default class StateAwareViewModel {
    constructor() {
        this[stateSub] = undefined;
        this[oldState] = undefined;

        // Wait for child class constructor to execute before
        // adding the subscription.
        setImmediate(() => {
            this[stateSub] = state.subscribe(
                state => {
                    this.onState(state, this[oldState]);
                    this[oldState] = state;
                }
            );
        });
    }

    onState(/*state, oldState*/) {
    }

    dispose() {
        this[stateSub].dispose();
    }
}
