import { COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS } from 'action-types';
import { updateForm } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS)
        .map(action => updateForm(
            'installNodes',
            { commands: action.payload.commands }
        ));
}
