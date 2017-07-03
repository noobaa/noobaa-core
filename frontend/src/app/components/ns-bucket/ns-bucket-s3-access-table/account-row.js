/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { action$ } from 'state';
import { openS3AccessDetailsModal } from 'action-creators';

export default class AccountRowViewModel {
    constructor() {
        this.accountName = ko.observable();
        this.credentialsDetails = ko.observable();
    }

    onAccount({ name } ) {
        this.accountName({
            text: name,
            href: {
                route: 'account',
                params: {
                    account: name,
                    tab : null
                }
            }
        });

        this.credentialsDetails({
            text: 'View',
            click: this.onView.bind(this)
        });
    }

    onView() {
        action$.onNext(
            openS3AccessDetailsModal(this.accountName)
        );
    }
}
