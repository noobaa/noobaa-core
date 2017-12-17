import { COMPLETE_UPGRADE_SYSTEM } from 'action-types';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';

export default function(action$, { browser }) {
    return action$
        .ofType(COMPLETE_UPGRADE_SYSTEM)
        .map(action => {
            const { system } = action.payload;
            const url = realizeUri(routes.system, { system }, { afterupgrade: true });
            browser.reload(url);
        });
}
