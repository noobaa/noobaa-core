import template from './notification-box.html';
import Observer from 'observer';
import state$ from 'state';
import { hideNotification } from 'dispatchers';
import ko from 'knockout';
import { deepFreeze, isFalsy } from 'utils/core-utils';
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

class NotificationBarViewModel extends Observer {
    constructor() {
        super();

        this.notifications = ko.observableArray();
        this.visible = ko.observable();
        this.hover = ko.observable();

        this.observe(state$.get('notifications', 'list', '0'), this.onState);
    }

    onState(next) {
        if (!next) {
            this.visible(false);
            return;
        }

        const current = this.notifications.get(0);
        if (!current || current.id < next.id) {
            this._processNotification({
                ...severityMapping[next.severity],
                id: next.id,
                text: next.message
            });
            this.visible(true);
        }
    }

    onTransitionEnd() {
        if (!this.visible() || this.notifications().length > 1) {
            this.notifications.shift();
        }
    }

    async _processNotification(notif){
        this.notifications.push(notif);
        this.visible(true);

        await all(
            sleep(minTimeOnScreen),
            sleep(charTimeContribution * notif.text.length)
        );
        await this.hover.when(isFalsy);

        hideNotification(notif.id);
    }
}

export default {
    viewModel: NotificationBarViewModel,
    template: template
};

