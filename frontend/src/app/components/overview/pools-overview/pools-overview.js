import template from './pools-overview.html';
import BaseViewModel from 'base-view-model';
import style from 'style';
import { systemInfo } from 'model';
import ko from 'knockout';
import { stringifyAmount} from 'utils/string-utils';

class PoolsOverviewViewModel extends BaseViewModel {
    constructor() {
        super();

        this.nodePoolsCount = ko.pureComputed(
            () => {
                const count = (systemInfo() ? systemInfo().pools : [])
                    .filter(
                        pool => Boolean(pool.nodes)
                    )
                    .length;

                return stringifyAmount('Resource', count, 'No');
            }
        );

        const onlineCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().nodes.online : 0
        );

        const offlineCount = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return 0;
                }

                const { count, online, has_issues } = systemInfo().nodes;
                return count - (online + has_issues);
            }
        );

        const withIssuesCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().nodes.has_issues : 0
        );

        this.chartValues = [
            {
                label: 'Online',
                value: onlineCount,
                color: style['color12']
            },
            {
                label: 'Has issues',
                value: withIssuesCount,
                color: style['color11']
            },
            {
                label: 'Offline',
                value: offlineCount,
                color: style['color10']
            }
        ];

        this.systemCapacity = ko.pureComputed(
            () => systemInfo() && systemInfo().storage.total
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatSize: true
        });

        const nodeCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().nodes.count : 0
        ).extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.nodeCountText = ko.pureComputed(
            () => `${nodeCount()} Nodes`
        );

        this.isInstallNodeModalVisible = ko.observable(false);

    }

    showInstallNodeModal() {
        this.isInstallNodeModalVisible(true);
    }

    hideInstallNodeModal() {
        this.isInstallNodeModalVisible(false);
    }
}

export default {
    viewModel: PoolsOverviewViewModel,
    template: template
};
