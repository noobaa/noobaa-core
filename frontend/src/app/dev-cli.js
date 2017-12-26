import * as model from 'model';
import { action$, state$ } from 'state';
import * as actionCreators from 'action-creators';
import schema from 'schema';
import api from 'services/api';
import { mapValues } from 'utils/core-utils';

const actions = mapValues(
    actionCreators,
    creator => function(...args) {
        action$.onNext(creator(...args));
    }
);

function print_json_in_new_tab(data) {
    data = JSON.stringify(data, undefined, 2);
    const blob = new Blob([data], { type: 'text/json' });
    window.open(window.URL.createObjectURL(blob));
}

const cli = Object.seal({
    model: model,
    schema: schema.def,
    actions: actions,
    state: undefined,
    api: api,
    print_json_in_new_tab
});

state$.subscribe(state => { cli.state = state; });

export default cli;
