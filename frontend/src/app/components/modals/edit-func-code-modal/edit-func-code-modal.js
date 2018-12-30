/* Copyright (C) 2016 NooBaa */

import template from './edit-func-code-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { readFileAsArrayBuffer, toObjectUrl, openInNewTab } from 'utils/browser-utils';
import { formatSize } from 'utils/size-utils';
import { handlerFileSuffix, isValidHandlerFuncName, funcSizeLimit } from 'utils/func-utils';
import { shortString, stringifyAmount } from 'utils/string-utils';
import { getFormValues, isFieldTouchedAndInvalid } from 'utils/form-utils';
import { bufferStore } from 'services';
import JSZip from 'jszip';
import {
    updateForm,
    untouchForm,
    updateLambdaFuncCode,
    closeModal
} from 'action-creators';

const handlerFileTooltip = 'The name of the file which the handler function is written in';
const handlerFuncTooltip = 'The function within your code that will initiate the execution. The name should match to the function name in the selected file';
const inputFormatOptions = deepFreeze([
    {
        value: 'TEXT',
        label: 'Type code manually'
    },
    {
        value: 'PACKAGE',
        label: 'Upload a code package (zip file)'
    }
]);

async function _extractFileList(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    return Object.values(zip.files)
        .map(zipObj => zipObj.name)
        .filter(filename => filename.endsWith(handlerFileSuffix));
}

function _getHandlerFileOptions(pkg) {
    if (pkg.size > funcSizeLimit) {
        return pkg.filename ? [] : null;
    }

    return pkg.fileList.map(filename => {
        const value = filename;
        const label = shortString(filename, 35, 20);
        const tooltip = { text: filename, breakWords: true };
        return { value, label, tooltip };
    });
}

async function _extractFile(buffer, filename) {
    const zip = await JSZip.loadAsync(buffer);
    return zip.file(filename).async('string');
}

async function _packageInlineCode(filename, inlineCode) {
    const zip = new JSZip();
    zip.file(filename, inlineCode);
    const uint8 = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
    });
    return uint8.buffer;
}

class EditFuncCodeViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    inputFormatOptions = inputFormatOptions;
    formattedPkgSizeLimit = formatSize(funcSizeLimit);
    handlerFileTooltip = handlerFileTooltip;
    handlerFuncTooltip = handlerFuncTooltip;
    funcName = '';
    funcVersion = '';
    fileSelectionFilterPlaceholder = ko.observable();
    handlerFileOptions = ko.observable();
    isFileSelectionDisabled = ko.observable();
    isFuncSelectionDisabled = ko.observable();
    isShowFileContentBtnDisabled = ko.observable()
    showFileContentTooltip = ko.observable();
    formFields = ko.observable();

    selectState(state, params) {
        const { functions, forms } = state;
        const { funcName, funcVersion } = params;
        const funcId = `${funcName}:${funcVersion}`;
        return [
            functions && functions[funcId],
            forms[this.formName]
        ];
    }

    async mapStateToProps(func, form) {
        if (!form) {
            const { codeBuffer: { handle }, codeSize, execFile, execFunc } = func;
            const buffer = bufferStore.get(handle);
            const fileList = handle ? await _extractFileList(buffer) : 0;
            const isSingleFile = fileList.length === 1;

            ko.assignToProps(this, {
                funcName: func.name,
                funcVersion: func.version,
                formFields: {
                    inputFormat: isSingleFile ? 'TEXT' : 'PACKAGE',
                    inlineCode: isSingleFile ? await _extractFile(buffer, fileList[0]) : '',
                    codePackage: {
                        filename: '',
                        size: codeSize,
                        buffer: handle,
                        fileList: fileList
                    },
                    handlerFile: execFile,
                    handlerFunc: execFunc
                }
            });

        } else {
            const { codePackage, handlerFile } = getFormValues(form);
            const isCodePackageInvalid = isFieldTouchedAndInvalid(form, 'codePackage');
            const { size, fileList } = codePackage;
            const isOversized =  size > funcSizeLimit;
            const isSingleFile = fileList && fileList.length === 1;
            const fileSelectionFilterPlaceholder = fileList ?
                `Search in ${stringifyAmount('file', fileList.length)}` :
                '';
            const showFileContentTooltip = isOversized ?
                `Function is bigger than ${formatSize(funcSizeLimit)}, cannot display the content of the file` :
                '';

            ko.assignToProps(this, {
                funcName: func.name,
                funcVersion: func.version,
                handlerFileOptions: _getHandlerFileOptions(codePackage),
                fileSelectionFilterPlaceholder,
                showFileContentTooltip,
                isFileSelectionDisabled: isSingleFile || isCodePackageInvalid,
                isFuncSelectionDisabled: isCodePackageInvalid,
                isShowFileContentBtnDisabled: (
                    isSingleFile ||
                    isOversized ||
                    isCodePackageInvalid ||
                    !handlerFile
                )
            });
        }
    }

    onDropPackage(_, evt) {
        const [file] = evt.dataTransfer.files;
        this._onCodePackage(file);
    }

    onSelectPackage(_, evt) {
        const [file] = evt.target.files;
        this._onCodePackage(file);
    }

    async onShowFileContent(handle, path) {
        const buffer = handle && bufferStore.get(handle);
        if (buffer) {
            const file = await _extractFile(buffer, path);
            openInNewTab(toObjectUrl(file));
        }
    }

    onValidate(values) {
        const errors = {};
        const {
            inputFormat,
            inlineCode,
            codePackage,
            handlerFile,
            handlerFunc
        } = values;

        if (inputFormat === 'TEXT') {
            if (!inlineCode) {
                errors.inlineCode = 'Please enter javascript code';
            }

        } else if (codePackage.filename) {
            if (codePackage.size > funcSizeLimit) {
                errors.codePackage = `Package size exceeds ${formatSize(funcSizeLimit)}. Please use AWS API to complete the upload`;

            } else if (codePackage.fileList.length === 0) {
                errors.codePackage = 'Package does not contain execution files';

            } else if (!handlerFile) {
                errors.handlerFile = 'Please choose an execution file name';
            }
        }

        if (inputFormat === 'TEXT' || !errors.codePackage) {
            if (!handlerFunc) {
                errors.handlerFunc = 'Please enter the name of the requested execution function';

            } else if (!isValidHandlerFuncName(handlerFunc)) {
                errors.handlerFunc = 'Please enter a valid javascript function name';
            }
        }

        return errors;
    }

    async onSubmit(values) {
        const {
            inputFormat,
            inlineCode,
            codePackage,
            handlerFile,
            handlerFunc
        } = values;

        let updateAction = null;
        switch (inputFormat) {
            case 'PACKAGE': {
                updateAction = updateLambdaFuncCode(
                    this.funcName,
                    this.funcVersion,
                    handlerFile,
                    handlerFunc,
                    codePackage.buffer,
                    codePackage.size
                );
                break;
            }

            case 'TEXT': {
                const buffer = await _packageInlineCode('main.js', inlineCode);
                updateAction = updateLambdaFuncCode(
                    this.funcName,
                    this.funcVersion,
                    'main.js',
                    handlerFunc,
                    bufferStore.store(buffer),
                    buffer.byteLength
                );
                break;
            }
        }

        this.dispatch(
            updateAction,
            closeModal()
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    async _onCodePackage(pkg) {
        let handle = null;
        let fileList = null;
        if (pkg.size <= funcSizeLimit) {
            const buffer = await readFileAsArrayBuffer(pkg);
            handle = bufferStore.store(buffer);
            fileList = await _extractFileList(buffer);
        }

        this.dispatch(
            updateForm(this.formName, {
                codePackage: {
                    filename: pkg.name,
                    size: pkg.size,
                    buffer: handle,
                    fileList
                },
                handlerFile: '',
                handlerFunc: ''
            }),
            untouchForm(
                this.formName,
                ['handlerFile', 'handlerFunc']
            )
        );
    }
}

export default {
    viewModel: EditFuncCodeViewModel,
    template: template
};
