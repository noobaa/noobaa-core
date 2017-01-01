import template from './notification-box.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { lastNotification } from 'model';
import { sleep } from 'utils/promise-utils';
import { notificaitons as config } from 'config';

class NotificationBarViewModel extends BaseViewModel {
    constructor() {
        super();

        this.notifications = ko.observableArray();
        this.hovered = ko.observable(false);
        this.visible = ko.observable(false);
        this.count = ko.pureComputed(
            () => this.notifications().length
        );

        this.next = Promise.resolve();

        this.addToDisposeList(
            lastNotification.subscribe(
                notif => this.handleIncomingNotification(notif)
            )
        );
    }

    handleIncomingNotification({ message, severity }) {
        this.next = this.next
            .then(
                () => {
                    this.notifications.unshift({
                        css: `notif-${severity}`,
                        icon: `notif-${severity}`,
                        text: message
                    });
                    this.visible(true);
                }
            )
            .then(
                () => sleep(
                    Math.max(
                        config.minTimeOnScreen,
                        config.charTimeContribution * message.length
                    )
                )
            )
            .then(
                () => {
                    if (this.hovered()) {
                        return new Promise(
                            resolve => this.hovered.once(resolve)
                        );
                    }
                }
            )
            .then(
                () => {
                    if (this.count() === 1)  {
                        this.visible(false);
                    }
                }
            );
    }

    onTransition() {
        if (this.count() > 1 || !this.visible()) {
            this.notifications.pop();
        }
    }
}

export default {
    viewModel: NotificationBarViewModel,
    template: template
};
