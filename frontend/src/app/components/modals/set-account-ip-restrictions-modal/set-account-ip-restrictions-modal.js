/* Copyright (C) 2016 NooBaa */

import template from './set-account-ip-restrictions-modal.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$, action$ } from 'state';
import { isIPOrIPRange } from 'utils/net-utils';
import { setAccountIpRestrictions, closeModal } from 'action-creators';
import { deepFreeze } from 'utils/core-utils';
import { get } from 'rx-extensions';

const invalidIpReasonMapping = deepFreeze({
    MALFORMED: 'All values must be of the IPv4 format',
    INVALID_RANGE_ORDER: 'IP range must start with lowest value',
    MULTIPLE_INVALID_IPS: 'Some IPs are invalid'
});

const allowedIpsPlaceholder =
    `e.g., 10.5.3.2 or 10.2.253.5 - 24 and click enter ${String.fromCodePoint(0x23ce)}`;

class setAccountIpRestrictionsModalViewModel extends Observer {
    formName = this.constructor.name;
    tokenValidator = val => isIPOrIPRange(val).valid;
    allowedIpsPlaceholder = allowedIpsPlaceholder;
    fields = ko.observable();

    constructor({ accountName }) {
        super();

        this.observe(
            state$.pipe(get('accounts', ko.unwrap(accountName))),
            this.onAccount
        );
    }

    onAccount(account) {
        if (!account) return;

        const usingIpRestrictions = Boolean(account.allowedIps);
        const allowedIps = (account.allowedIps || [])
            .map(({ start, end }) => start === end ? start : `${start} - ${end}`);

        if (!this.fields()) {
            this.fields({
                accountName: account.name,
                usingIpRestrictions: usingIpRestrictions,
                allowedIps: allowedIps
            });
        }
    }

    onValidate({ usingIpRestrictions, allowedIps }) {
        const errors = {};

        if (usingIpRestrictions) {
            const ipErrors = allowedIps
                .map(isIPOrIPRange)
                .filter(({ valid }) => !valid);

            const errorCount = ipErrors.length;
            if (errorCount > 0) {
                const reason = errorCount === 1 ? ipErrors[0].reason : 'MULTIPLE_INVALID_IPS';
                errors.allowedIps = invalidIpReasonMapping[reason];
            }
        }

        return errors;
    }

    onSubmit({ accountName, usingIpRestrictions, allowedIps }) {
        action$.next(setAccountIpRestrictions(
            accountName,
            usingIpRestrictions ? allowedIps : null
        ));

        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: setAccountIpRestrictionsModalViewModel,
    template: template
};
