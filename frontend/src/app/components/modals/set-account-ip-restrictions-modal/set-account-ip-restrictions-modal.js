/* Copyright (C) 2016 NooBaa */

import template from './set-account-ip-restrictions-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ko from 'knockout';
import { state$, action$ } from 'state';
import { isIPOrIPRange } from 'utils/net-utils';
import { setAccountIpRestrictions } from 'action-creators';
import { deepFreeze } from 'utils/core-utils';

const invalidIpReasonMapping = deepFreeze({
    MALFORMED: 'All values must be of the IPv4 format',
    INVALID_RANGE_ORDER: 'IP range must start with lowest value',
    INVALID_MULTIPLE_IPS: 'Some IPs are invalid',
});

const allowedIpsPlaceholder =
    `e.g., 10.5.3.2 or 10.2.253.5 - 24 and click enter ${String.fromCodePoint(0x23ce)}`;

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

        const allowedIps = (account.allowedIps || [])
            .map(({ start, end }) => start === end ? start : `${start} - ${end}`);

        this.form = new FormViewModel({
            name: 'setAccountIPRestriction',
            fields: {
                accountName: account.name,
                usingIpRestrictions: Boolean(allowedIps),
                allowedIps: allowedIps,
            },
            onValidate: this.onValidate,
            onSubmit: this.onSubmit.bind(this)
        });

        this.isAccountReady(true);
    }

    onValidate({ usingIpRestrictions, allowedIps }) {
        const errors = {};

        if (usingIpRestrictions) {
            let reson;

            for (let allowedIp of allowedIps) {
                const result = isIPOrIPRange(allowedIp);

                if (!result.valid) {
                    if(reson) {
                        reson = 'INVALID_MULTIPLE_IPS';
                        break;
                    } else {
                        reson = result.reason;
                    }
                }
            }

            if (invalidIpReasonMapping[reson]) {
                errors.allowedIps = invalidIpReasonMapping[reson]
            }
        }

        return errors;
    }

    onValidateToken(str) {
        return isIPOrIPRange(str).valid;
    }

    onSubmit({ accountName, usingIpRestrictions, allowedIps }) {
        action$.onNext(setAccountIpRestrictions(
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
