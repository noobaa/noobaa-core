/* Copyright (C) 2016 NooBaa */

import template from './set-account-ip-restrictions-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ko from 'knockout';
import { state$, dispatch } from 'state';
import { isIP } from 'validations';
import { setAccountIpRestrictions } from 'action-creators';
// import numeral from 'numeral';
// import moment from 'moment';

const allowedIpsPlaceholder =
    `e.g., 10.5.3.2 or 10.2.1.5-24 and click enter ${String.fromCodePoint(0x23ce)}`;

class setAccountIpRestrictionsModalViewModel extends Observer {
    constructor({ onClose, accountName }) {
        super();

        this.close = onClose;
        this.allowedIpsPlaceholder = allowedIpsPlaceholder;
        this.isAccountReady = ko.observable(false);

        this.observe(
            state$.get('accounts', ko.unwrap(accountName)),
            this.onAccount
        );
    }

    onAccount(account) {
        if (!account || this.isAccountReady()) return;

        const { name, allowedIps} = account;
        this.form = new FormViewModel({
            name: 'setAccountIPRestriction',
            fields: {
                accountName: name,
                usingIpRestrictions: Boolean(allowedIps),
                allowedIps: allowedIps || [],
            },
            onValidate: this.onValdiate,
            onSubmit: this.onSubmit.bind(this)
        });

        this.isAccountReady(true);
    }

    onValdiate({ usingIpRestrictions, allowedIps }) {
        const errors = {};

        if (usingIpRestrictions && !allowedIps.every(isIP)) {
            errors.allowedIps = 'All values must be of the IPv4 format';
        }

        return errors;
    }

    onSubmit({ accountName, usingIpRestrictions, allowedIps }) {
        dispatch(setAccountIpRestrictions(
            accountName,
            usingIpRestrictions ? allowedIps : null
        ));

        this.close();
    }

    onCancel() {
        this.close();
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: setAccountIpRestrictionsModalViewModel,
    template: template
};
