// Copyright (C) 2016 NooBaa

import template from './version-form.html';
import Observer from 'observer';
import IssueRowViewModel from './issue-row';
import { upgradePackageSuffix, timeShortFormat } from 'config';
import { state$, action$ } from 'state';
import { deepFreeze, sumBy } from 'utils/core-utils';
import { aggregateUpgradePackageInfo } from 'utils/cluster-utils';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import {
    uploadUpgradePackage,
    abortUpgradePackageUpload,
    runUpgradePackageTests,
    openUpgradeSystemModal
} from 'action-creators';

const pkgIssuesColumns = deepFreeze([
    {
        name: 'icon',
        label: '',
        type: 'icon'
    },
    {
        name: 'server',
        label: 'Issue Location'
    },
    {
        name: 'message',
        label: 'Details'
    }
]);

const pkgTextResultToInfo = deepFreeze({
    NO_RESULT: null,
    SUCCESS: {
        dropAreaMessage: 'Package uploaded and tested successfully',
        propertyText: 'Successful',
        icon: {
            name: 'healthy',
            css: 'success'
        }
    },
    FAILURE: {
        dropAreaMessage: 'Package failed testing',
        propertyText: 'Failure',
        icon: {
            name: 'problem',
            css: 'error'
        }
    }
});

const uploadBtnTooltips = {
    NOT_ALL_MEMBERS_UP: 'All cluster members must be connected in order to start an package upload. Please make sure all servers are up.',
    NOT_ENOUGH_SPACE: 'All cluster members must have at least 300MB of free space to start a package upload. Check and increase disk capacity in required servers.',
    VERSION_MISMATCH: 'All cluster members must be of the same version in order to start an package upload.'
};

const upgradeBtnTooltips = {
    NOT_ALL_MEMBERS_UP: 'All cluster members must be connected in order to start an upgrade. Please make sure all servers are up.'
};

function _getVersionStatus(servers, version) {
    const serverList = Object.values(servers);
    const upToDateCount = sumBy(
        serverList,
        server => Number(server.version === version)
    );

    const prefix = upToDateCount < serverList.length ?
            `${upToDateCount} of ${serverList.length}` :
            'All';

    return `${prefix} servers are synced with current version`;
}

function _getLastUpgradeText(lastUpgrade) {
    if (!lastUpgrade) {
        return 'System has never been upgraded';
    }

    return moment(lastUpgrade).format(timeShortFormat);
}

function _getPackageTestResult(state, numOfIssues) {
    return (state !== 'TESTED' && 'NO_RESULT') ||
        (numOfIssues > 0 && 'FAILURE') ||
        'SUCCESS';
}

function _getPackageVersionText(version) {
    if (!version) {
        return 'No previously tested version';
    }

    if (version === 'UNKNOWN') {
        return 'Not a NooBaa upgrade package';
    }

    return version;
}

class VersionFormViewModel extends Observer {
    constructor() {
        super();

        this.version = ko.observable();
        this.lastUpgrade = ko.observable();
        this.clusterVersionStatus = ko.observable();
        this.versionInfo = [
            {
                label: 'Current version',
                value: this.version
            },
            {
                label: 'Last upgrade',
                value: this.lastUpgrade

            },
            {
                label: 'Cluster Servers Version',
                value: this.clusterVersionStatus
            },
            {
                label: 'License information',
                value: true,
                template: 'licenseInfo'
            }
        ];
        this.stateLoaded = ko.observable();
        this.uploadBtn = ko.observable();
        this.uploadArea =  ko.observable();
        this.upgradeBtn = ko.observable();
        this.pkgSuffix = upgradePackageSuffix;
        this.pkgState = ko.observable();
        this.pkgVersion = ko.observable();
        this.pkgTestTime = ko.observable();
        this.pkgTestResult = ko.observable();
        this.pkgStateProgress = ko.observable();
        this.pkgIssuesColumns = pkgIssuesColumns;
        this.isPkgTestResultsVisible = ko.observable();
        this.pkgIssuesRows = ko.observableArray();
        this.pkgInfo = [
            {
                label: 'Staged Version',
                value: this.pkgVersion
            },
            {
                label: 'Uploaded and Tested at',
                value: this.pkgTestTime,
                visible: this.pkgTestTime
            },
            {
                label: 'Test result',
                template: 'testResult',
                value: this.pkgTestResult,
                visible: this.pkgTestResult
            }
        ];

        this.observe(
            state$.getMany(
                'system',
                ['topology', 'servers']
            ),
            this.onState
        );
    }

    onState([system, servers]) {
        if (!system || !servers) {
            this.stateLoaded(false);
            this.uploadBtn({});
            this.upgradeBtn({});
            this.uploadArea({});
            this.isPkgTestResultsVisible(false);
            return;
        }

        const { version, upgrade } = system;
        const serverList = Object.values(servers);

        const {
            state,
            version: pkgVersion,
            testedAt,
            progress = 0,
            errors: issues = []
        } = aggregateUpgradePackageInfo(serverList);

        const pkgTestResult = _getPackageTestResult(state, issues.length);
        const isPkgUploadingOrTesting = state === 'UPLOADING' || state === 'TESTING';
        const uploadBtn = {
            disabled: Boolean(upgrade.preconditionFailure) || isPkgUploadingOrTesting,
            tooltip: uploadBtnTooltips[upgrade.preconditionFailure]
        };
        const upgradeBtn = {
            disabled: Boolean(upgrade.preconditionFailure) || pkgTestResult !== 'SUCCESS',
            tooltip: upgradeBtnTooltips[upgrade.preconditionFailure]
        };
        const uploadArea = {
            expanded: isPkgUploadingOrTesting,
            active: isPkgUploadingOrTesting
        };
        const pkgTestTime = testedAt ? moment(testedAt).format(timeShortFormat) : '';
        const pkgStateProgress = numeral(progress).format('%');
        const isPkgTestResultsVisible = pkgTestResult === 'FAILURE';
        const pkgIssuesRows = issues
            .map((issue, i) => {
                const row = this.pkgIssuesRows.get(i) || new IssueRowViewModel();
                row.onState(issue.message, servers[issue.server]);
                return row;
            });


        this.version(version);
        this.lastUpgrade(_getLastUpgradeText(upgrade.lastUpgrade));
        this.clusterVersionStatus(_getVersionStatus(servers, version));
        this.uploadBtn(uploadBtn);
        this.upgradeBtn(upgradeBtn);
        this.uploadArea(uploadArea);
        this.pkgState(state);
        this.pkgVersion(_getPackageVersionText(pkgVersion));
        this.pkgTestTime(pkgTestTime);
        this.pkgTestResult(pkgTextResultToInfo[pkgTestResult]);
        this.pkgStateProgress(pkgStateProgress);
        this.pkgIssuesRows(pkgIssuesRows);
        this.isPkgTestResultsVisible(isPkgTestResultsVisible);
        this.stateLoaded(true);
    }

    onUploadPackage() {
        const { expanded, active } = this.uploadArea();
        this.uploadArea({
            active: active,
            expanded: !expanded
        });
    }

    onUpgradeNow() {
        action$.onNext(openUpgradeSystemModal());
    }

    onDropPackage(_, evt) {
        const [packageFile] = evt.dataTransfer.files;
        action$.onNext(uploadUpgradePackage(packageFile));
    }

    onSelectPackage(_, evt) {
        const [packageFile] = evt.target.files;
        action$.onNext(uploadUpgradePackage(packageFile));
    }

    onCancelUpload() {
        action$.onNext(abortUpgradePackageUpload());
    }

    onRerunTest() {
        action$.onNext(runUpgradePackageTests());
    }
}

export default {
    viewModel: VersionFormViewModel,
    template: template
};
