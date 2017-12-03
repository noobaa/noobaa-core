// /* Copyright (C) 2016 NooBaa */

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
        this.isUploadAreaExpanded = ko.observable();
        this.isUploadAreaActive = ko.observable();
        this.isUploadDisabled = ko.observable();
        this.isUpgradeDisabled = ko.observable();
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
            this.isUploadAreaExpanded(false);
            this.isUploadDisabled(true);
            this.isUpgradeDisabled(true);
            this.isPkgTestResultsVisible(false);
            return;
        }

        const { version, lastUpgrade } = system;
        const {
            state,
            version: pkgVersion,
            testedAt,
            progress = 0,
            errors: issues = []
        } = aggregateUpgradePackageInfo(Object.values(servers));

        const pkgTestResult = _getPackageTestResult(state, issues.length);
        const isPkgUploadingOrTesting = state === 'UPLOADING' || state === 'TESTING';
        const isUpgradeDisabled = pkgTestResult !== 'SUCCESS';
        const isPkgTestResultsVisible = pkgTestResult === 'FAILURE';
        const pkgTestTime = testedAt ? moment(testedAt).format(timeShortFormat) : '';
        const pkgStateProgress = numeral(progress).format('%');
        const pkgIssuesRows = issues
            .map((issue, i) => {
                const row = this.pkgIssuesRows.get(i) || new IssueRowViewModel();
                row.onState(issue.message, servers[issue.server]);
                return row;
            });

        this.version(version);
        this.lastUpgrade(_getLastUpgradeText(lastUpgrade));
        this.clusterVersionStatus(_getVersionStatus(servers, version));
        this.isUploadAreaExpanded(isPkgUploadingOrTesting);
        this.isUploadAreaActive(isPkgUploadingOrTesting);
        this.isUploadDisabled(isPkgUploadingOrTesting);
        this.isUpgradeDisabled(isUpgradeDisabled);
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
        this.isUploadAreaExpanded.toggle();
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
