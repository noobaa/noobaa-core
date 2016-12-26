import template from './nodes-summary.html';
import Disposable from 'disposable';
import style from 'style';
import { systemInfo } from 'model';
import ko from 'knockout';

class NodesSummaryViewModel extends Disposable{
    constructor() {
        super();

        const onlineCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().nodes.online : 0
        );

        const offlineCount = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return 0;
                }

                const { count, online } = systemInfo().nodes;
                return count - online;
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
                label: 'Offline',
                value: offlineCount,
                color: style['color10']
            },
            {
                label: 'Has Issues',
                value: withIssuesCount,
                color: style['color11']
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

    }
}

export default {
    viewModel: NodesSummaryViewModel,
    template: template
};
