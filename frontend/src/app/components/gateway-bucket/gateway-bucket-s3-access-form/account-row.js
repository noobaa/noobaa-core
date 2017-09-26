/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { action$ } from 'state';
import { openS3AccessDetailsModal } from 'action-creators';
import { realizeUri } from 'utils/browser-utils';

export default class AccountRowViewModel {
    constructor() {
        this.name = ko.observable();
        this.credentialsDetails = {
            text: 'view',
            click: this.onView.bind(this)
        };
    }

    onAccount(account, accountRoute) {
        const name = {
            text: account.name,
            href: realizeUri(accountRoute, { account: account.name })
        };

        this.name(name);
    }

    onView() {
        action$.onNext(openS3AccessDetailsModal(this.name));
    }
}
