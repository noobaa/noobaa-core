/* Copyright (C) 2016 NooBaa */

import template from './upgrading-system-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import { sumBy, deepFreeze } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { tween } from 'shifty';
import {
    closeModal,
    openPreUpgradeSystemFailedModal,
    openUpgradeSystemFailedModal
} from 'action-creators';

function _startFakeProgress(stepCallback) {
    return tween({
        from: { val: 0 },
        to: { val: .95 },
        delay: 1000,
        duration: 4 * 60 * 1000,
        easing: 'linear',
        step: ({ val }) => stepCallback(val)
    });
}

function _formatProgress(progress) {
    return `${numeral(progress).format('%')} Completed`;
}

const icons = deepFreeze({
    UPGRADING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Upgrading'
    },
    UPGRADED: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Upgrade Completed'
    }
});

class serverRowViewModel {
    icon = ko.observable();
    name = ko.observable();
    markAsMaster = ko.observable();
}

class SystemUpgradingModalViewModel extends ConnectableViewModel {
    progress = ko.observable();
    upgradingMessage = ko.observable();
    progressText = ko.observable();
    serverRows = ko.observableArray()
        .ofType(serverRowViewModel);

    constructor(...args) {
        super(...args);

        // Start a fake progress process.
        _startFakeProgress(this.onFakeProgress.bind(this));
    }

    selectState(state) {
        const { topology } = state;
        return [
            topology && topology.servers
        ];
    }

    mapStateToProps(servers) {
        if (!servers) {
            return;
        }

        const serverList = Object.values(servers);
        const progressSum = sumBy(serverList, server => server.upgrade.progress || 0);
        const progress = Math.max(progressSum / serverList.length, this.progress.peek() || 0);

        ko.assignToProps(this, {
            progress,
            upgradingMessage: `Upgrading ${stringifyAmount('server', serverList.length)}`,
            progressText: _formatProgress(progress),
            serverRows: Object.values(serverList).map(server => {
                const { progress = 0 } = server.upgrade;
                return {
                    icon: icons[progress < 1 ? 'UPGRADING' : 'UPGRADED'],
                    name: `${server.hostname}-${server.secret}`,
                    markAsMaster: server.isMaster
                };
            })
        });

        if (serverList.some(server => (server.upgrade.package || {}).error)) {
            this.dispatch(
                closeModal(),
                openPreUpgradeSystemFailedModal()
            );
        }

        if (serverList.some(server => server.upgrade.error)) {
            this.dispatch(
                closeModal(),
                openUpgradeSystemFailedModal()
            );
        }
    }

    onFakeProgress(fakeProgress) {
        // console.warn(fakeProgress);
        const progress = Math.max(this.progress.peek(), fakeProgress);
        ko.assignToProps(this, {
            progress,
            progressText: _formatProgress(progress)
        });
    }
}

export default {
    viewModel: SystemUpgradingModalViewModel,
    template: template
};

