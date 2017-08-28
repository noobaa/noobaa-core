import * as model from 'model';
import { action$, state$ } from 'state';
import { togglePreviewContent } from 'action-creators';
import api from 'services/api';

function bindToActionStream(actionCreator) {
    return function(...args) {
        action$.onNext(actionCreator(...args));
    };
}

const cli = Object.seal({
    model: model,
    state: undefined,
    api: api,
    togglePreviewContent: bindToActionStream(togglePreviewContent)
});

state$.subscribe(state => { cli.state = state; });

export default cli;
