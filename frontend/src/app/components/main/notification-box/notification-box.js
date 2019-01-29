/* Copyright (C) 2016 NooBaa */

import template from './notification-box.html';
import ConnectableViewModel from 'components/connectable';
import { hideNotification } from 'action-creators';
import ko from 'knockout';
import { deepFreeze, isFalsy, get } from 'utils/core-utils';
import { sleep, all } from 'utils/promise-utils';
import { notifications as config } from 'config';

const { minTimeOnScreen, charTimeContribution } = config;
const severityMapping = deepFreeze({
    info: {
        css: 'info',
        icon: 'notif-info'
    },
    success: {
        css: 'success',
        icon: 'notif-success'
    },
    warning: {
        css: 'warning',
        icon: 'problem'
    },
    error: {
        css: 'error',
        icon: 'problem'
    }
});

class NotificationBarViewModel extends ConnectableViewModel {
    notifications = ko.observableArray();
    borders = ko.observable();
    visible = ko.observable();
    hover = ko.observable();

    selectState(state) {
        return [
            get(state, ['notifications', 'list', '0'])
        ];
    }

    mapStateToProps(notif) {
        if (!notif) {
            this.visible(false);
            return;
        }

        const current = this.notifications.get(0);
        if (!current || current.id < notif.id) {
            this._processNotification(notif);
            this.visible(true);
        }
    }

    onTransitionEnd() {
        if (!this.visible() || this.notifications().length > 1) {
            this.notifications.shift();
        }
    }

    async _processNotification({ id, severity, message }){
        const next = {
            ...severityMapping[severity],
            id: id,
            text: message
        };

        this.notifications.push(next);
        if (this.notifications().length >= 1) {
            this.borders(`${next.css}-borders`);
        }

        await all(
            sleep(minTimeOnScreen),
            sleep(charTimeContribution * message.length)
        );

        await this.hover.when(isFalsy);
        this.dispatch(hideNotification(id));
    }
}

export default {
    viewModel: NotificationBarViewModel,
    template: template
};

