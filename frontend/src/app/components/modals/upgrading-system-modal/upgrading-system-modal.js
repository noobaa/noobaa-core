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
import {
    replaceToPreUpgradeSystemFailedModal,
    replaceToUpgradeSystemFailedModal
} from 'action-creators';

class SystemUpgradingModalViewModel extends Observer {
    constructor() {
        super();

        this.upgradingMessage = ko.observable();
        this.completedRatio = ko.observable();
        this.letfRatio = ko.observable();
        this.progress = ko.observable();
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

    }

    onState(servers) {
        if (!servers) return;

        const serverList = Object.values(servers);
        const progressSum = sumBy(
            serverList,
            server => server.upgrade.progress || 0
        );

        const upgradingMessage = `Upgrading ${stringifyAmount('server', serverList.length)}`;
        const completedRatio = progressSum / serverList.length;
        const letfRatio = 1 - completedRatio;
        const progress = `${numeral(completedRatio).format('%')} Completed`;
        const serverRows = Object.values(serverList)
            .map((server, i) => {
                const row = this.serverRows.get(i) || new ServerRowViewModel();
                row.onState(server);
                return row;
            });

        this.upgradingMessage(upgradingMessage);
        this.completedRatio(completedRatio);
        this.letfRatio(letfRatio);
        this.progress(progress);
        this.serverRows(serverRows);

        if (serverList.some(server => server.upgrade.package.error)) {
            action$.onNext(replaceToPreUpgradeSystemFailedModal());
        }

        if (serverList.some(server => server.upgrade.error)) {
            action$.onNext(replaceToUpgradeSystemFailedModal());
        }
    }
}

export default {
    viewModel: SystemUpgradingModalViewModel,
    template: template
};

