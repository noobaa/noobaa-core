/* Copyright (C) 2016 NooBaa */

import template from './func-code-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { throttle } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { realizeUri } from 'utils/browser-utils';
import { all, sleep} from 'utils/promise-utils';
import { funcSizeLimit } from 'utils/func-utils';
import { formatSize } from 'utils/size-utils';
import { bufferStore } from 'services';
import JSZip from 'jszip';
import { paginationPageSize, inputThrottle } from 'config';
import {
    loadLambdaFuncCode,
    openEditFuncCodeModal,
    openInvokeFuncModal,
    requestLocation,
    dropLambdaFuncCode
} from 'action-creators';

async function _loadZip(handle) {
    const buffer = bufferStore.get(handle);
    const zip =  await JSZip.loadAsync(buffer);
    return zip;
}

class FuncCodeFormViewModel extends ConnectableViewModel {
    pageSize = paginationPageSize;
    funcSizeLimit = formatSize(funcSizeLimit);
    pathname = '';
    funcName = '';
    funcVersion = '';
    areActionsEnabled = ko.observable();
    zip = null;
    isFuncOversized = ko.observable()
    isZipLoaded = ko.observable();
    isZipStale = ko.observable();
    fileCount = ko.observable();
    formattedFileCount = ko.observable();
    execFile = {
        text: ko.observable(),
        align: 'start'
    };
    execFunc = {
        text: ko.observable(),
        align: 'start'
    };
    page = ko.observable();
    selectedFile = ko.observable();
    rows = ko.observableArray();
    fileLang = ko.observable();
    fileContent = ko.observable();
    isFileContentLoading = ko.observable();

    selectState(state, params) {
        const { funcName, funcVersion } = params;
        const id = `${funcName}:${funcVersion}`;
        const { functions, location, session } = state;
        const func = functions && functions[id];

        return [
            funcName,
            funcVersion,
            func,
            location,
            session && session.user
        ];
    }

    async mapStateToProps(name, version, func, location, user) {
        if (!func) {
            ko.assignToProps(this, {
                funcName: name,
                funcVersion: version,
                areActionsEnabled: false,
                isFuncOversized: false,
                isZipLoaded: false,
                isZipStale: false,
                formattedFileCount: '',
                execFile: { text: '' },
                execFunc: { text: '' }
            });

        } else if (func.codeSize > funcSizeLimit) {
            const { execFile, execFunc } = func;
            ko.assignToProps(this, {
                funcName: name,
                funcVersion: version,
                areActionsEnabled: true,
                isFuncOversized: true,
                formattedFileCount: '',
                execFile: { text: execFile },
                execFunc: { text: execFunc },
            });

        } else {
            const { pathname, query } = location;
            const { execFile, execFunc, codeBuffer, lastModifier } = func;
            const { loading, error, handle } = codeBuffer;

            if (!handle) {
                const modifiedByOtherAccount =  lastModifier !== user;
                const zip = modifiedByOtherAccount ? this.zip : null;

                ko.assignToProps(this, {
                    funcName: name,
                    funcVersion: version,
                    areActionsEnabled: false,
                    isFuncOversized: false,
                    isZipLoaded: Boolean(zip),
                    isZipStale: Boolean(zip),
                    zip: zip,
                    fileList: [],
                    formattedFileCount: '',
                    execFile: { text: execFile },
                    execFunc: { text: execFunc }
                });

            } else {
                let zip = this.zip || await _loadZip(handle);
                const page = Number(query.page || 0);
                const fileNames = Object.values(zip.files)
                    .filter(zipObj => !zipObj.dir)
                    .map(zipObj => zipObj.name)
                    .sort();

                const fileCount = fileNames.length;
                const formattedFileCount = stringifyAmount('file', fileCount);
                const pageStart = page * paginationPageSize;
                const rows = fileNames.slice(pageStart, pageStart + paginationPageSize);

                const selectedFile = (query.selected && fileNames.includes(query.selected)) ?
                    query.selected :
                    '';

                const [, fileLang = 'none'] = selectedFile.split(/\.(\w+)$/);
                const selectedFileChanged = this.selectedFile() !== selectedFile;
                const fileContent = selectedFileChanged ? '' : this.fileContent();
                const isFileContentLoading = selectedFile && !fileContent;

                ko.assignToProps(this, {
                    funcName: name,
                    funcVersion: version,
                    areActionsEnabled: true,
                    isZipLoaded: true,
                    isZipStale: false,
                    pathname,
                    execFile: { text: execFile },
                    execFunc: { text: execFunc },
                    zip,
                    fileCount,
                    formattedFileCount,
                    page,
                    selectedFile,
                    rows,
                    fileContent,
                    fileLang,
                    isFileContentLoading
                });

                if (selectedFileChanged) {
                    this._loadSelectedFileContent();
                }
            }

            if (!this.zip && !error && !loading) {
                this.dispatch(loadLambdaFuncCode(name, version));
            }
        }
    }

    onDownloadCode() {

    }

    onEditCode() {
        const { funcName, funcVersion } = this;
        this.dispatch(openEditFuncCodeModal(funcName, funcVersion));
    }

    onSetEventAndInvoke() {
        const { funcName, funcVersion } = this;
        this.dispatch(openInvokeFuncModal(funcName, funcVersion));
    }
    onRefresh() {
        ko.assignToProps(this, {
            zip: null
        });

        this._query({
            page: 0,
            selected: ''
        });
    }

    onSelectFile(filename = '') {
        this._query({ selected: filename });
    }

    onPage(page) {
        this._query({ page, selected: '' });
    }

    onX() {
        this._query({ selected: '' });
    }

    _loadSelectedFileContent = throttle(
        async () => {
            const { selectedFile, zip } = this;
            if (!zip || !selectedFile() ) {
                return;
            }

            const [fileContent] = await all(
                zip.files[selectedFile()].async('string'),
                sleep(750)
            );

            ko.assignToProps(this, {
                fileContent,
                isFileContentLoading: false
            });
        },
        inputThrottle,
        this
    );

    _query(query) {
        const {
            page = this.page(),
            selected = this.selectedFile()
        } = query;

        const url = realizeUri(this.pathname, null, {
            page,
            selected: selected || undefined
        });

        this.dispatch(requestLocation(url, true));
    }

    dispose() {
        const { funcName, funcVersion } = this;
        this.dispatch(dropLambdaFuncCode(funcName, funcVersion));
    }
}

export default {
    viewModel: FuncCodeFormViewModel,
    template: template
};
