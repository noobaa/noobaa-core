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
import { get } from 'rx-extensions';
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

class SystemUpgradingModalViewModel extends Observer {
    progress = 0;
    upgradingMessage = ko.observable();
    completedRatio = ko.observable();
    letfRatio = ko.observable();
    progressText = ko.observable();
    serverRows = ko.observableArray();
    barValues = [
        {
            value: this.completedRatio,
            color: style['color8']
        },
        {
            value: this.letfRatio,
            color: 'transparent'
        }
    ];

    constructor() {
        super();

        this.observe(
            state$.pipe(get('topology', 'servers')),
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
        const progress = Math.max(progressSum / serverList.length, this.progress);
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
            action$.next(closeModal());
            action$.next(openPreUpgradeSystemFailedModal());
        }

        if (serverList.some(server => server.upgrade.error)) {
            action$.next(closeModal());
            action$.next(openUpgradeSystemFailedModal());
        }
    }

    onFakeProgress(fakeProgress) {
        const progress = Math.max(this.progress, fakeProgress);
        this.progress = progress;
        this.completedRatio(progress);
        this.letfRatio(1 - progress);
        this.progressText(_formatProgress(progress));
    }

    dispose() {
        clearInterval(this.tickHandle);
        super.dispose();
    }
}

export default {
    viewModel: SystemUpgradingModalViewModel,
    template: template
};

