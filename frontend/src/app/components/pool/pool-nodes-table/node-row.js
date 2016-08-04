import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze } from 'utils';

const activityNameMapping = deepFreeze({
    RESTORING: 'Restoring',
    MIGRATING: 'Migrating',
    DECOMMISSIONING: 'Decommissioning',
    DELETING: 'deleting'
});

export default class NodeRowViewModel extends Disposable {
    constructor(node) {
        super();

        this.online = ko.pureComputed(
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

        this.used = ko.pureComputed(
            () => {
                if (!node()) {
                    return {};
                }

                return {
                    total: node().storage.total,
                    usedNoobaa: node().storage.used,
                    usedOther: node().storage.used_other
                };
            }
        );

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
