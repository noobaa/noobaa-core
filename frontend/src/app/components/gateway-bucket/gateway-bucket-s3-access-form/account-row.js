/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { action$ } from 'state';
import { openS3AccessDetailsModal } from 'action-creators';

export default class AccountRowViewModel {
    constructor() {
        this.name = ko.observable();
        this.credentialsDetails = {
            text: 'view',
            click: this.onView.bind(this)
        };
    }

    onAccount(account) {
        this.name(account.name);
    }

    onView() {
        action$.onNext(openS3AccessDetailsModal(this.name));
    }
}
