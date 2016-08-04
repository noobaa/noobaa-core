import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze } from 'utils';
import style from 'style';

const activityNameMapping = deepFreeze({
    RESTORING: 'Restoring',
    MIGRATING: 'Migrating',
    DECOMMISSIONING: 'Decommissioning',
    DELETING: 'deleting'
});

export default class NodeRowViewModel extends Disposable {
    constructor(node) {
        super();

        this.state = ko.pureComputed(
            () => {
                if (!node()) {
                    return '';
                }

                return {
                    name: node() && `node-${node().online ? 'online' : 'offline'}`,
                    tooltip: node().online  ? 'online' : 'offline'
                };
            }
        );

        this.name = ko.pureComputed(
            () => {
                if (!node()) {
                    return '';
                }

                let { name } = node();
                return {
                    text: name,
                    href: { route: 'node', params: { node: name } }
                };
            }
        );

        this.ip = ko.pureComputed(
            () => node() ? node().ip : ''
        );

        let storage = ko.pureComputed(
            () => node() ? node().storage : {}
        );

        this.capacity = {
            total: ko.pureComputed(
                () => storage().total
            ),
            used: [
                {
                    label: 'Used (Noobaa)',
                    value: ko.pureComputed(
                        () => storage().used
                    )
                },
                {
                    label: 'Used (other)',
                    value: ko.pureComputed(
                        () => storage().used_other
                    )
                }
            ]
        };

        this.trustLevel = ko.pureComputed(
            () => node() ?
                (node().trusted ? 'Trusted' : 'Untrusted') :
                ''
        );

        this.dataActivity = ko.pureComputed(
            () => {
                if (!node()) {
                    return '';
                }

                if (!node().data_activity) {
                    return 'No activity';
                }

                let { reason, completed_size, total_size } = node().data_activity;
                return `${
                    activityNameMapping[reason]
                } (${
                    numeral(completed_size / total_size).format('0%')
                })`;
            }
        );
    }
}
