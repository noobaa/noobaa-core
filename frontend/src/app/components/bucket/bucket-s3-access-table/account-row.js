/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { action$ } from 'state';
import { openS3AccessDetailsModal } from 'action-creators';
import { realizeUri } from 'utils/browser-utils';

export default class AccountRowViewModel {
    baseRoute = '';
    name = ko.observable();
    credentialsDetails = ko.observable();

    constructor({ baseRoute }) {
        this.baseRoute = baseRoute;
        this.onShowDetails = this.onShowDetails.bind(this);
    }

    onState(account, endpoint) {
        const name = {
            text: account.name,
            href: realizeUri(this.baseRoute, { account: account.name })
        };
        const text = 'View';
        const click = this.onShowDetails;

        this.name(name);
        this.credentialsDetails({ text, click });
        this.accessKey = account.accessKeys.accessKey;
        this.secretKey = account.accessKeys.secretKey;
        this.endpoint = endpoint;
    }

    onShowDetails() {
        const { endpoint, accessKey, secretKey } = this;
        action$.onNext(openS3AccessDetailsModal(endpoint, accessKey, secretKey));
    }
}
