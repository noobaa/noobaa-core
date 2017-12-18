/* Copyright (C) 2016 NooBaa */

import template from './upgrade-system-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import moment from 'moment';
import { timeShortFormat } from 'config';
import { aggregateUpgradePackageInfo } from 'utils/cluster-utils';
import { fetchVersionReleaseNotes, invokeUpgradeSystem, closeModal } from 'action-creators';

function _normalizeReleaseNotes(notes = {}) {
    const {
        fetching = false,
        error = false,
        text = error ? 'Minor bug fixes' : ''
    } = notes;

    return { fetching, text };
}

class UpgradeSystemModalViewModel extends Observer {
    constructor() {
        super();

        this.systemName = '';
        this.stateLoaded = ko.observable();
        this.currVersion = ko.observable();
        this.stagedVersion = ko.observable();
        this.testedAt = ko.observable();
        this.releaseNotes = ko.observable();
        this.upgradeSummary = [
            {
                label: 'Current Version',
                value: this.currVersion
            },
            {
                label: 'New Version',
                value: this.stagedVersion
            },
            {
                label: 'Validated at',
                value: this.testedAt
            },
            {
                label: 'Validation Result',
                value: 'Successful'
            }
        ];

        this.observe(
            state$.getMany(
                ['location', 'params', 'system'],
                'system',
                ['topology', 'servers']
            ),
            this.onState
        );
    }

    onState([systemName, systemState, servers]) {
        if (!systemState || !servers) {
            this.stateLoaded(false);
            return;
        }

        const {
            version: stagedVersion,
            testedAt
        } = aggregateUpgradePackageInfo(Object.values(servers));

        const testedAtFormatted = moment(testedAt).format(timeShortFormat);
        const { [stagedVersion]: notes } = systemState.releaseNotes || {};

        this.systemName = systemName;
        this.currVersion(systemState.version);
        this.stagedVersion(stagedVersion);
        this.testedAt(testedAtFormatted);
        this.releaseNotes(_normalizeReleaseNotes(notes));
        this.stateLoaded(true);

        if (stagedVersion && !notes) {
            action$.onNext(fetchVersionReleaseNotes(stagedVersion));
        }
    }

    onCancel() {
        action$.onNext(closeModal());
    }

    onStartUpgrade() {
        action$.onNext(invokeUpgradeSystem(this.systemName));
    }
}

export default {
    viewModel: UpgradeSystemModalViewModel,
    template: template
};
