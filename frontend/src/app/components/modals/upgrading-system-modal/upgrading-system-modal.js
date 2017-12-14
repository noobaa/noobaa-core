/* Copyright (C) 2016 NooBaa */

import template from './upgrading-system-modal.html';
import Observer from 'observer';
import ServerRowViewModel from './server-row';
import ko from 'knockout';
import numeral from 'numeral';
import style from 'style';
import { state$, action$ } from 'state';
import { sumBy } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import Tweenable from 'shifty';
import {
    replaceToPreUpgradeSystemFailedModal,
    replaceToUpgradeSystemFailedModal
} from 'action-creators';

function _startFakeProgress(stepCallback) {
    setTimeout(
        () => new Tweenable().tween({
            from: { val: 0 },
            to: { val: .8 },
            duration: 45 * 1000,
            easing: 'linear',
            step: ({ val }) => stepCallback(val)
        }),
        1000
    );
}

function _formatProgress(progress) {
    return `${numeral(progress).format('%')} Completed`;
}

class SystemUpgradingModalViewModel extends Observer {
    constructor() {
        super();

        this.progress = 0;
        this.upgradingMessage = ko.observable();
        this.completedRatio = ko.observable();
        this.letfRatio = ko.observable();
        this.progressText = ko.observable();
        this.serverRows = ko.observableArray();
        this.barValues = [
            {
                value: this.completedRatio,
                color: style['color8']
            },
            {
                value: this.letfRatio,
                color: 'transparent'
            }
        ];

        this.observe(
            state$.get('topology', 'servers'),
            this.onState
        );

        // Start a fake progress process.
        _startFakeProgress(this.onFakeProgress.bind(this));

    }

    onState(servers) {
        if (!servers) return;

        const serverList = Object.values(servers);
        const progressSum = sumBy(
            serverList,
            server => server.upgrade.progress || 0
        );

        const upgradingMessage = `Upgrading ${stringifyAmount('server', serverList.length)}`;
        const progress = progressSum / serverList.length;
        const serverRows = Object.values(serverList)
            .map((server, i) => {
                const row = this.serverRows.get(i) || new ServerRowViewModel();
                row.onState(server);
                return row;
            });

        this.progress = progress;
        this.upgradingMessage(upgradingMessage);
        this.completedRatio(progress);
        this.letfRatio(1 - progress);
        this.progressText(_formatProgress(progress));
        this.serverRows(serverRows);

        if (serverList.some(server => server.upgrade.package.error)) {
            action$.onNext(replaceToPreUpgradeSystemFailedModal());
        }

        if (serverList.some(server => server.upgrade.error)) {
            action$.onNext(replaceToUpgradeSystemFailedModal());
        }
    }

    onFakeProgress(fakeProgress) {
        const { progress: realProgress } = this;
        const progress = Math.max(fakeProgress, realProgress);

        this.completedRatio(progress);
        this.letfRatio(1 - progress);
        this.progressText(_formatProgress(progress));
    }
}

export default {
    viewModel: SystemUpgradingModalViewModel,
    template: template
};

