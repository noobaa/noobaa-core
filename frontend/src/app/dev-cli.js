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

const cli = Object.seal({
    model: model,
    schema: schema.def,
    actions: actions,
    state: undefined,
    api: api
});

state$.subscribe(state => { cli.state = state; });

export default cli;
