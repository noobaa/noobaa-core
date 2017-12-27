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
import moment from 'moment';
import { tween } from 'shifty';
import {
    replaceWithPreUpgradeSystemFailedModal,
    replaceWithUpgradeSystemFailedModal
} from 'action-creators';

function _startFakeProgress(stepCallback) {
    const delay = moment.duration(1, 'seconds').asMilliseconds();
    const duration = moment.duration(90, 'seconds').asMilliseconds();

    tween({
        from: { val: 0 },
        to: { val: .9 },
        delay: delay,
        duration: duration,
        easing: 'linear',
        step: ({ val }) => stepCallback(val)
    });
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
            action$.onNext(replaceWithPreUpgradeSystemFailedModal());
        }

        if (serverList.some(server => server.upgrade.error)) {
            action$.onNext(replaceWithUpgradeSystemFailedModal());
        }
    }

    onFakeProgress(onProgress) {
        const progress = Math.max(this.progress, onProgress);

        this.progress = progress;
        this.completedRatio(progress);
        this.letfRatio(1 - progress);
        this.progressText(_formatProgress(progress));
    }
}

export default {
    viewModel: SystemUpgradingModalViewModel,
    template: template
};

