import state from 'state';
import { runAsync } from 'utils/core-utils';

const stateSub = Symbol('stateSub');
const oldState = Symbol('oldState');

export default class StateAwareViewModel {
    constructor() {
        this[stateSub] = undefined;
        this[oldState] = undefined;

        if (this.onState !== StateAwareViewModel.prototype.onState) {
            // Wait for child class constructor to execute before
            // adding the subscription.
            runAsync(() => {
                this[stateSub] = state.subscribe(
                    state => {
                        this.onState(state, this[oldState] || {});
                        this[oldState] = state;
                    }
                );
            });
        }
    }

    onState(/*state, oldState*/) {
    }

    dispose() {
        if (this[stateSub]) this[stateSub].dispose();
    }
}
