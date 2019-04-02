/* Copyright (C) 2016 NooBaa */

import template from './upgrade-system-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import moment from 'moment';
import { timeShortFormat } from 'config';
import { aggregateUpgradePackageInfo } from 'utils/cluster-utils';
import {
    fetchVersionReleaseNotes,
    invokeUpgradeSystem,
    closeModal
} from 'action-creators';

function _normalizeReleaseNotes(notes = {}) {
    const {
        fetching = false,
        error = false,
        text = error ? 'Minor bug fixes' : ''
    } = notes;

    return { fetching, text };
}

class UpgradeSystemModalViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    systemName = '';
    currVersion = ko.observable();
    upgradeSummary = [
        {
            label: 'Current Version',
            value: ko.observable()
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
    releaseNotes = {
        fetching: ko.observable(),
        text: ko.observable()
    };

    selectState(state) {
        const { location, system, topology } = state;
        return [
            location.params.system,
            system,
            topology && topology.servers
        ];
    }

    mapStateToProps(systemName, systemState, servers) {
        if (!systemState || !servers) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const {
                version: stagedVersion,
                testedAt
            } = aggregateUpgradePackageInfo(Object.values(servers));

            const testedAtFormatted = moment(testedAt).format(timeShortFormat);
            const { [stagedVersion]: notes } = systemState.releaseNotes || {};

            ko.assignToProps(this, {
                dataReady: true,
                systemName: systemName,
                upgradeSummary: [
                    { value: systemState.version },
                    { value: stagedVersion },
                    { value: testedAtFormatted }
                ],
                releaseNotes: _normalizeReleaseNotes(notes)
            });

            if (stagedVersion && !notes) {
                this.dispatch(fetchVersionReleaseNotes(stagedVersion));
            }
        }
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    onStartUpgrade() {
        this.dispatch(invokeUpgradeSystem(this.systemName));
    }
}

export default {
    viewModel: UpgradeSystemModalViewModel,
    template: template
};
