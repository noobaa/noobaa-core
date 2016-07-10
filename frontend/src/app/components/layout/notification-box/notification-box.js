import template from './notification-box.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { lastNotification } from 'model';
import { waitFor } from 'utils';
import { notificaitons as config } from 'config';

class NotificationBarViewModel extends Disposable {
    constructor() {
        super();

        this.notifications = ko.observableArray();
        this.hovered = ko.observable(false);
        this.visible = ko.observable(false);
        this.count = ko.pureComputed(
            () => this.notifications().length
        );

        this.next = Promise.resolve();

        this.disposeWithMe(
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
                        icon: `notif-${severity}`,
                        text: message
                    });
                    this.visible(true);
                }
            )
            .then(
                () => waitFor(
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
