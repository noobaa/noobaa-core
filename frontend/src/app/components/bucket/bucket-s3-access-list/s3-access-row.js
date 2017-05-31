/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { openS3AccessDetailsModal } from 'dispatchers';

export default class S3AccessRowViewModel extends BaseViewModel {
    constructor(account) {
        super();

        this.name = ko.pureComputed(
            () => {
                if (!account()) {
                    return '';
                }

                const email = account().email;
                const text = email;
                const href = {
                    route: 'account',
                    params: { account: email, tab: null }
                };

                return { text, href };
            }
        );

        this.recentlyUsed = ko.pureComputed(
            () => account() && account().external_connections
        ).extend({
            formatTime: true
        });

        this.credentialsDetails = ko.pureComputed(
            () => {
                if (!account()) {
                    return '';
                }

                const email = account().email;
                const text = 'View';
                const click = openS3AccessDetailsModal.bind(null, email);
                return { text, click };
            }
        );
    }
}
