import state from 'state';
import { runAsync } from 'utils/core-utils';

const stateSub = Symbol('stateSub');
const prevState = Symbol('prevState');

export default class StateListener {
    constructor() {
        this[stateSub] = undefined;
        this[prevState] = undefined;

        // Check if the class override the onState before applying state
        // notifications.
        if (this.onState !== StateListener.prototype.onState) {
            // Wait for child class constructor to execute before
            // adding the subscription.
            runAsync(() => {
                this[stateSub] = state
                    .map(state => this.stateSelector(state))
                    .filter(curr => {
                        const prev = this[prevState];
                        return !prev || curr.some((item, i) => item !== prev[i]);
                    })
                    .subscribe(
                        state => {
                            this.onState(...state);
                            this[prevState] = state;
                        }
                    );
            });
        }
    }

    stateSelector(state) {
        // By default select the whole state.
        return [state];
    }

    onState(/*...selectedState*/) {
    }

    dispose() {
        if (this[stateSub]) this[stateSub].dispose();
    }
}
