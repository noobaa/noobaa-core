import template from './notification-box.html';
import ko from 'knockout';
import { lastNotification } from 'model';
import { waitFor } from 'utils';
import { notificaitons as config } from 'config';

class NotificationBarViewModel {
    constructor() {
        this.notifications = ko.observableArray();
        this.count = ko.pureComputed(
            () => this.notifications().length
        );
        this.hovered = ko.observable(false);
        this.visible = ko.observable(false);

        let next = Promise.resolve();
        this.notifSub = lastNotification.subscribe(
            ({ message, severity }) => {
                next = next
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
        );
    }

    onTransition() {
        if (this.count() > 1 || !this.visible()) {
            this.notifications.pop();
        }
    }

    dispose() {
        this.notifSub.dispose();
    }
}

export default {
    viewModel: NotificationBarViewModel,
    template: template
};
