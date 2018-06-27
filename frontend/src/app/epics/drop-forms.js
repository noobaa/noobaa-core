import { map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { dropForms } from 'action-creators';
import * as types from 'action-types';

export default function(action$) {
    return action$.pipe(
        ofType(
            types.COMPLETE_UPDATE_PROXY_ADDRESS,
            types.FAIL_UPDATE_PROXY_ADDRESS
        ),
        map((action) => dropForms(action.type))
    );
}
