// Copyright (C) 2016 NooBaa

import template from './version-form.html';
import Observer from 'observer';
import IssueRowViewModel from './issue-row';
import { upgradePackageSuffix, timeShortFormat } from 'config';
import { state$, action$ } from 'state';
import { deepFreeze, sumBy } from 'utils/core-utils';
import { aggregateUpgradePackageInfo } from 'utils/cluster-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import { Tweenable } from 'shifty';
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
        label: 'Server Name'
    },
    {
        name: 'details',
        type: 'issueDetails'
    }
]);

const pkgTextResultToInfo = deepFreeze({
    NO_RESULT: null,
    SUCCESS: {
        dropAreaMessage: 'Package uploaded and validated successfully',
        propertyText: 'Successful',
        icon: {
            name: 'healthy',
            css: 'success'
        }
    },
    FAILURE: {
        dropAreaMessage: 'Package failed validation',
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
    PACKAGE_NOT_READY: {
        align: 'end',
        text: 'Upgrade can be initiated only after uploading a valid package'
    },
    NOT_ALL_MEMBERS_UP: {
        align: 'end',
        text: 'All cluster members must be connected in order to start an upgrade. Please make sure all servers are up.'
    }
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

    return moment(lastUpgrade.time).format(timeShortFormat);
}

function _getPackageTestResult(state, numOfIssues) {
    return (state !== 'TESTED' && 'NO_RESULT') ||
        (numOfIssues > 0 && 'FAILURE') ||
        'SUCCESS';
}

function _getPackageVersionText(version) {
    if (!version) {
        return 'No previously validated version';
    }

    if (version === 'UNKNOWN') {
        return 'Package might be corrupted or not a NooBaa upgrade package';
    }

    return version;
}

function _startFakeProgress(stepCallback) {
    const durationInSec = 6 * 60;
    const t =  new Tweenable().setConfig({
        from: { val: 0 },
        to: { val: durationInSec },
        duration: durationInSec * 1000,
        easing: 'linear',
        step: ({ val }) => {
            const progress =
                // 0% - 20% in 00:40 min.
                (Math.min(val, 40) * .2 / 40) +
                // 20% - 95% in 5:20 min.
                (Math.max(val - 40, 0) * (.95 - .2) / (5 * 60 + 20));

            stepCallback(progress);
        }
    });
    t.tween();
    return t;
}


class VersionFormViewModel extends Observer {
    // Version control observables.
    version = ko.observable();
    lastUpgrade = ko.observable();
    clusterVersionStatus = ko.observable();
    versionInfo = [
        {
            label: 'Current Version',
            value: this.version
        },
        {
            label: 'Last Upgrade',
            value: this.lastUpgrade

        },
        {
            label: 'Cluster Servers Version',
            value: this.clusterVersionStatus
        },
        {
            label: 'License Information',
            value: true,
            template: 'licenseInfo'
        }
    ];

    // System upgrade observables.
    stateLoaded = ko.observable();
    uploadBtn = ko.observable();
    uploadArea =  ko.observable();
    upgradeBtn = ko.observable();
    pkgSuffix = upgradePackageSuffix;
    pkgState = ko.observable();
    pkgVersion = ko.observable();
    pkgVersionLabel = ko.observable();
    isPkgVersionDisabled = ko.observable();
    pkgTestTime = ko.observable();
    pkgTestResult = ko.observable();
    pkgStateProgress = 0;
    pkgStateProgressText = ko.observable();
    pkgIssuesColumns = pkgIssuesColumns;
    isPkgTestResultsVisible = ko.observable();
    pkgIssuesRows = ko.observableArray();
    progressTween = null;
    pkgInfo = [
        {
            label: this.pkgVersionLabel,
            value: this.pkgVersion,
            disabled: this.isPkgVersionDisabled
        },
        {
            label: 'Validated At',
            value: this.pkgTestTime,
            visible: this.pkgTestTime
        },
        {
            label: 'Validation Result',
            template: 'testResult',
            value: this.pkgTestResult,
            visible: this.pkgTestResult
        }
    ];

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'system',
                    ['topology', 'servers']
                )
            ),
            this.onState
        );
    }

    onState([system, servers]) {
        if (!system || !servers) {
            this.stateLoaded(false);
            this.uploadBtn({ disabled:  true });
            this.upgradeBtn({ disabled:  true });
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
        const pkgVersionLabel = `${pkgTestResult === 'SUCCESS' ? 'Staged' : 'Uploaded'} Version`;
        const isPkgUploadingOrTesting = state === 'UPLOADING' || state === 'TESTING';
        const uploadBtn = {
            disabled: Boolean(upgrade.preconditionFailure) || isPkgUploadingOrTesting,
            tooltip: uploadBtnTooltips[upgrade.preconditionFailure]
        };
        const upgradeBtn = {
            disabled: Boolean(upgrade.preconditionFailure) || pkgTestResult !== 'SUCCESS',
            tooltip: upgradeBtnTooltips[
                pkgTestResult !== 'SUCCESS' ? 'PACKAGE_NOT_READY' : upgrade.preconditionFailure
            ]
        };
        const uploadArea = {
            expanded: isPkgUploadingOrTesting,
            active: isPkgUploadingOrTesting
        };
        const pkgTestTime = testedAt ? moment(testedAt).format(timeShortFormat) : '';
        const pkgStateProgressText = numeral(progress).format('%');
        const isPkgTestResultsVisible = pkgTestResult === 'FAILURE';
        const pkgIssuesRows = issues
            .map((issue, i) => {
                const row = this.pkgIssuesRows.get(i) || new IssueRowViewModel();
                row.onState(issue, servers[issue.server]);
                return row;
            });

        this.version(version);
        this.lastUpgrade(_getLastUpgradeText(upgrade.lastUpgrade));
        this.clusterVersionStatus(_getVersionStatus(servers, version));
        this.uploadBtn(uploadBtn);
        this.upgradeBtn(upgradeBtn);
        this.uploadArea(uploadArea);
        this.pkgState(state);
        this.isPkgVersionDisabled(isPkgUploadingOrTesting);
        this.pkgVersionLabel(pkgVersionLabel);
        this.pkgVersion(_getPackageVersionText(pkgVersion));
        this.pkgTestTime(pkgTestTime);
        this.pkgTestResult(pkgTextResultToInfo[pkgTestResult]);
        this.pkgStateProgress = progress;
        this.pkgStateProgressText(pkgStateProgressText);
        this.pkgIssuesRows(pkgIssuesRows);
        this.isPkgTestResultsVisible(isPkgTestResultsVisible);
        this.stateLoaded(true);

        if (state === 'TESTING' && !this.progressTween){
            this.progressTween = _startFakeProgress(this.onFakeProgress.bind(this));

        } else if (state !== 'TESTING' && this.progressTween) {
            this.progressTween.stop().dispose();
            this.progressTween = null;
        }
    }

    onFakeProgress(fakeProgress) {
        const progress = Math.max(this.pkgStateProgress, fakeProgress);
        this.pkgStateProgress = progress;
        this.pkgStateProgressText(numeral(progress).format('%'));
    }

    onUploadPackage() {
        const { expanded, active } = this.uploadArea();
        this.uploadArea({
            active: active,
            expanded: !expanded
        });
    }

    onUpgradeNow() {
        action$.next(openUpgradeSystemModal());
    }

    onDropPackage(_, evt) {
        const [packageFile] = evt.dataTransfer.files;
        action$.next(uploadUpgradePackage(packageFile));
    }

    onSelectPackage(_, evt) {
        const [packageFile] = evt.target.files;
        action$.next(uploadUpgradePackage(packageFile));
    }

    onCancelUpload() {
        action$.next(abortUpgradePackageUpload());
    }

    onRerunTest() {
        action$.next(runUpgradePackageTests());
    }

    dispose() {
        if (this.progressTween) {
            this.progressTween.stop().dispose();
        }

        super.dispose();
    }
}

export default {
    viewModel: VersionFormViewModel,
    template: template
};
