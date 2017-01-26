import state from 'state';

export default class StateAwareViewModel {
    constructor() {
        this._stateSub;
        setImmediate(() => {
            this._stateSub = state.subscribe(
                state => this.onState(state)
            );
        });
    }

    onState(/*state*/) {
    }

    dispose() {
        this._stateSub.dispose();
    }
}
