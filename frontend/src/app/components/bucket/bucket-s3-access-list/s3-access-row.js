/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { dispatch } from 'state';
import { openS3AccessDetailsModal } from 'action-creators';

export default class S3AccessRowViewModel extends BaseViewModel {
    constructor(account) {
        super();

        this.name = ko.pureComputed(
            () => {
                if (!account()) {
                    return '';
                }

                const email = account().email;
                return {
                    text: email,
                    href: {
                        route: 'account',
                        params: { account: email, tab: null }
                    }
                };
            }
        );

        // TODO: no data for this column yet
        /*this.recentlyUsed = ko.pureComputed(
            () =>
        ).extend({
            formatTime: true
        });*/

        this.credentialsDetails = ko.pureComputed(
            () => {
                if (!account()) {
                    return '';
                }

                const text = 'View';
                const click = () => dispatch(openS3AccessDetailsModal(account().email));
                return { text, click };
            }
        );
    }
}
