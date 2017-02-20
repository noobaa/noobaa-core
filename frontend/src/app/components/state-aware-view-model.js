import state from 'state';
import { runAsync } from 'utils/core-utils';

const stateSub = Symbol('stateSub');
const prevState = Symbol('prevState');

export default class StateAwareViewModel {
    constructor() {
        this[stateSub] = undefined;
        this[prevState] = {};

        // Create a filter used filter out non relevet state events.
        const stateFilter = (state) => {
            const curr = this.stateEventsFilter(state);
            const prev = this.stateEventsFilter(this[prevState]);
            return prev && curr.length > 0 ?
                curr.some((item, i) => item !== prev[i]) :
                true;
        };

        // Check if the class override the onState before applying state
        // notifications.
        if (this.onState !== StateAwareViewModel.prototype.onState) {
            // Wait for child class constructor to execute before
            // adding the subscription.
            runAsync(() => {
                this[stateSub] = state
                    .filter(stateFilter)
                    .subscribe(
                        state => {
                            this.onState(state, this[prevState]);
                            this[prevState] = state;
                        }
                    );
            });
        }
    }

    stateEventsFilter(/*state*/) {
        return [];
    }

    onState(/*state, prevState*/) {
    }

    dispose() {
        if (this[stateSub]) this[stateSub].dispose();
    }
}
