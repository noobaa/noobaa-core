// Copyright (C) 2016 NooBaa

import template from './version-form.html';
import ConnectableViewModel from 'components/connectable';
import { upgradePackageSuffix, timeShortFormat } from 'config';
import { deepFreeze, sumBy } from 'utils/core-utils';
import { aggregateUpgradePackageInfo } from 'utils/cluster-utils';
import { getServerDisplayName } from 'utils/cluster-utils';
import { formatEmailUri } from 'utils/browser-utils';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import { support } from 'config';
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

const pkgTestResultToMapping = deepFreeze({
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

function _updateTweenHandle(state, tweenHandle, progressTickHandler) {
    if (state === 'TESTING' && !tweenHandle){
        return _startFakeProgress(progressTickHandler);

    } else if (state !== 'TESTING' && tweenHandle) {
        tweenHandle.stop().dispose();
        return null;
    }
}

class IssueRowViewModel {
    icon = {
        name: 'problem',
        css: 'error',
        tooltip: 'Failure'
    };
    server = ko.observable();
    details = {
        message: ko.observable(),
        reportHref: ko.observable()
    };
}

class VersionFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    pkgIssuesColumns = pkgIssuesColumns;
    versionInfo = [
        {
            label: 'Current Version',
            value: ko.observable()
        },
        {
            label: 'Last Upgrade',
            value: ko.observable()

        },
        {
            label: 'Cluster Servers Version',
            value: ko.observable()
        },
        {
            label: 'License Information',
            value: true,
            template: 'licenseInfo'
        }
    ];
    uploadBtn = {
        disabled: ko.observable(),
        tooltip: ko.observable()
    };
    uploadArea =  {
        expanded: ko.observable(),
        active: ko.observable(),
        disable: ko.observable()
    };
    upgradeBtn = {
        disabled: ko.observable(),
        tooltip: ko.observable()
    };
    pkgSuffix = upgradePackageSuffix;
    pkgState = ko.observable();
    pkgTestResult = ko.observable();
    pkgInfo = [
        {
            label: ko.observable(),
            value: ko.observable(),
            disabled: ko.observable()
        },
        {
            label: 'Validated At',
            value: ko.observable(),
            visible: ko.observable()
        },
        {
            label: 'Validation Result',
            template: 'testResult',
            value: ko.observable(),
            visible: ko.observable()
        }
    ];
    pkgStateProgress = 0;
    pkgStateProgressText = ko.observable();
    isPkgTestResultsVisible = ko.observable();
    pkgIssuesRows = ko.observableArray()
        .ofType(IssueRowViewModel);

    progressTween = null;

    selectState(state) {
        const { system, topology } = state;
        return [
            system,
            topology && topology.servers
        ];
    }

    mapStateToProps(system, servers) {
        if (!system || !servers) {
            ko.assignToProps(this, {
                dataReady: false,
                uploadBtn: { disabled:  true },
                upgradeBtn: { disabled:  true },
                isPkgTestResultsVisible: false
            });

        } else {
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
            const pkgTestTime = testedAt ? moment(testedAt).format(timeShortFormat) : '';
            const pkgTestResultInfo = pkgTestResultToMapping[pkgTestResult];
            const pkgIssuesRows = issues.map(issue => {
                const { message, reportInfo }= issue;
                const reportHref = reportInfo && formatEmailUri(support.email, reportInfo);
                return {
                    server: getServerDisplayName(servers[issue.server]),
                    details: { message, reportHref }
                };
            });

            ko.assignToProps(this, {
                dataReady: true,
                versionInfo: [
                    { value: version },
                    { value: _getLastUpgradeText(upgrade.lastUpgrade) },
                    { value: _getVersionStatus(servers, version) }
                ],
                uploadBtn: {
                    disabled: Boolean(upgrade.preconditionFailure) || isPkgUploadingOrTesting,
                    tooltip: uploadBtnTooltips[upgrade.preconditionFailure]
                },
                upgradeBtn: {
                    disabled: Boolean(upgrade.preconditionFailure) || pkgTestResult !== 'SUCCESS',
                    tooltip: upgradeBtnTooltips[
                        pkgTestResult !== 'SUCCESS' ? 'PACKAGE_NOT_READY' : upgrade.preconditionFailure
                    ]
                },
                uploadArea: {
                    expanded: isPkgUploadingOrTesting,
                    active: isPkgUploadingOrTesting
                },
                pkgState: state,
                pkgTestResult: pkgTestResultInfo,
                pkgInfo: [
                    {
                        label: `${pkgTestResult === 'SUCCESS' ? 'Staged' : 'Uploaded'} Version`,
                        value: _getPackageVersionText(pkgVersion),
                        disabled: isPkgUploadingOrTesting
                    },
                    {
                        label: 'Validated At',
                        value: pkgTestTime,
                        visible: pkgTestTime
                    },
                    {
                        label: 'Validation Result',
                        template: 'testResult',
                        value: pkgTestResultInfo,
                        visible: Boolean(pkgTestResultInfo)
                    }
                ],
                progressTween: _updateTweenHandle(
                    state,
                    this.progressTween,
                    this.onFakeProgress.bind(this)
                ),
                pkgStateProgress: progress,
                pkgStateProgressText: numeral(progress).format('%'),
                isPkgTestResultsVisible: pkgTestResult === 'FAILURE',
                pkgIssuesRows
            });
        }
    }

    onFakeProgress(fakeProgress) {
        const progress = Math.max(this.pkgStateProgress, fakeProgress);
        ko.assignToProps(this, {
            pkgStateProgress: progress,
            pkgStateProgressText: numeral(progress).format('%')
        });
    }

    onUploadPackage() {
        const { expanded, active } = this.uploadArea;
        ko.assignToProps(this, {
            uploadArea: {
                active: active(),
                expanded: !expanded()
            }
        });
    }

    onUpgradeNow() {
        this.dispatch(openUpgradeSystemModal());
    }

    onDropPackage(_, evt) {
        const [packageFile] = evt.dataTransfer.files;
        this.dispatch(uploadUpgradePackage(packageFile));
    }

    onSelectPackage(_, evt) {
        const [packageFile] = evt.target.files;
        this.dispatch(uploadUpgradePackage(packageFile));
    }

    onCancelUpload() {
        this.dispatch(abortUpgradePackageUpload());
    }

    onRerunTest() {
        this.dispatch(runUpgradePackageTests());
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
