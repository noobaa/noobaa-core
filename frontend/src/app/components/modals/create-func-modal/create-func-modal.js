/* Copyright (C) 2016 NooBaa */

import template from './create-func-modal.html';
import Observer from 'observer';
import FromViewModel from 'components/form-view-model';
import ko from 'knockout';
import { deepFreeze, pick } from 'utils/core-utils';
import { readFileAsArrayBuffer, toObjectUrl, openInNewTab } from 'utils/browser-utils';
import { shortString, stringifyAmount } from 'utils/string-utils';
import { unitsInBytes, formatSize } from 'utils/size-utils';
import { getFormValues, isFieldValid } from 'utils/form-utils';
import { action$, state$ } from 'state';
import { createLambdaFunc, closeModal, updateForm, untouchForm } from 'action-creators';
import { bufferStore } from 'services';
import JSZip from 'jszip';


const steps = deepFreeze([
    'Basic Configuration',
    'Function Code',
    'Runtime Settings'
]);

const codeFormatOptions = deepFreeze([
    {
        value: 'TEXT',
        label: 'Type code manually'
    },
    {
        value: 'PACKAGE',
        label: 'Upload a code package (zip file)'
    }
]);

const memorySizeOptions = deepFreeze([
    {
        value: 128,
        label: '128 MB'
    },
    {
        value: 256,
        label: '256 MB'
    },
    {
        value: 512,
        label: '512 MB'
    }
]);


const pkgSizeLimit = unitsInBytes.MEGABYTE * 100;
const inlineCodeHandlerFile = 'main';
const handlerFileSuffix = '.js';
const funcNameRegExp = /^[a-zA-Z0-9-_]+$/;
const handlerFuncNameRegExp = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

const runtimeTooltip = 'The runtime environment for the function you are uploading. Currently, nodejs6 is the only available environment in NooBaa.';
const handlerFileTooltip = 'The name of the file which the handler function is written in';
const handlerFuncTooltip = 'The function within your code that will initiate the execution. The name should match to the function name in the selected file';

async function _selectCode(codeFormat, inlineCode, codePackage) {
    switch (codeFormat) {
        case 'TEXT': {
            const handlerFileName = `${inlineCodeHandlerFile}${handlerFileSuffix}`;
            const zip = new JSZip();
            zip.file(handlerFileName, inlineCode);
            const uint8 = await zip.generateAsync({
                type: 'uint8array',
                compression: 'DEFLATE',
                compressionOptions: { level: 9 }
            });
            return {
                bufferKey: bufferStore.store(uint8.buffer),
                size: uint8.byteLength
            };
        }

        case 'PACKAGE': {
            return pick(codePackage, ['bufferKey', 'size']);
        }

        default: {
            return null;
        }
    }

}

class CreateFuncModalViewModel extends Observer {
    steps = steps;
    runtime = 'nodejs6';
    formattedPkgSizeLimit = formatSize(pkgSizeLimit);
    codeFormatOptions = codeFormatOptions;
    memorySizeOptions = memorySizeOptions;
    runtimeTooltip = runtimeTooltip;
    handlerFileTooltip = handlerFileTooltip;
    handlerFuncTooltip = handlerFuncTooltip
    handlerFileFilterPlaceholder = ko.observable();
    isStateLoaded = ko.observable();
    existingNames = [];
    isHandlerSelectionDisabled = ko.observable();
    isShowFileContentBtnDisabled = ko.observable();
    handlerFileOptions = ko.observableArray();
    formName = this.constructor.name;
    form = null;
    selectedFileInfo = null;

    constructor() {
        super();

        this.form = new FromViewModel({
            name: this.formName,
            fields: {
                step: 0,
                funcName: '',
                funcDesc: '',
                codeFormat: codeFormatOptions[0].value,
                inlineCode: '',
                codePackage: null,
                handlerFile: '',
                handlerFunc: '',
                memorySize: memorySizeOptions[0].value,
                timeoutMinutes: 0,
                timeoutSeconds: 30
            },
            groups: {
                0: ['funcName', 'funcDesc'],
                1: ['codeFormat', 'inlineCode', 'codePackage', 'handlerFile', 'handlerFunc'],
                2: ['memorySize', 'timeoutMinutes', 'timeoutSeconds']
            },
            onValidate: values => this.onValidate(values, this.existingNames),
            onSubmit: this.onSubmit.bind(this)
        });

        this.observe(
            state$.getMany(
                'functions',
                ['forms', this.formName]
            ),
            this.onState
        );
    }

    onState([functions, form]) {
        if (!functions || !form) {
            this.isStateLoaded(false);
            return;
        }

        const existingNames = Object.values(functions)
            .map(func => func.name);

        const { codeFormat, codePackage, handlerFile } = getFormValues(form);
        const hasValidCodePkg = codeFormat !== 'PACKAGE' || isFieldValid(form, 'codePackage');
        const isPkgFileSelected = hasValidCodePkg && Boolean(handlerFile);

        const handlerFileOptions = (codePackage && codePackage.files || [])
            .map(filename => {
                const label = shortString(filename, 35, 20);
                const value = filename;
                const tooltip = {
                    text: filename,
                    breakWords: true
                };
                const disabled = !filename.endsWith(handlerFileSuffix);
                return { label, value, disabled, tooltip };
            });

        const selectedFileInfo = isPkgFileSelected ? {
            bufferKey: codePackage && codePackage.bufferKey,
            filename: handlerFile
        } : null;

        const handlerFileFilterPlaceholder = `Search in ${
            stringifyAmount('file', handlerFileOptions.length)
        }`;


        this.existingNames = existingNames;
        this.isHandlerSelectionDisabled(!hasValidCodePkg);
        this.isShowFileContentBtnDisabled(!isPkgFileSelected);
        this.handlerFileOptions(handlerFileOptions);
        this.handlerFileFilterPlaceholder(handlerFileFilterPlaceholder);
        this.selectedFileInfo = selectedFileInfo;
        this.isStateLoaded(true);
    }

    onValidate(values, existingNames) {
        const { step } = values;
        const errors = {};

        switch (step) {
            case 0: {
                const { funcName, funcDesc } = values;
                if (!funcName) {
                    errors.funcName = 'Name must contain at least one character';

                } else if (!funcNameRegExp.test(funcName)) {
                    errors.funcName = 'Please use only alphanumeric characters, hyphens or underscores';

                } else if (existingNames.includes(funcName)) {
                    errors.funcName = 'Function name already in use';
                }

                const overflow = funcDesc.length - 256;
                if (overflow > 0) {
                    errors.funcDesc = `${overflow} characters over the limit of 256`;
                }

                break;
            }

            case 1: {
                const { codeFormat, inlineCode, codePackage, handlerFile, handlerFunc } = values;

                if (codeFormat === 'TEXT') {
                    if (!inlineCode) {
                        errors.inlineCode = 'Please enter javascript code';
                    }
                } else {
                    if (!codePackage) {
                        errors.codePackage = 'Please upload a code package';

                    } else if (codePackage.oversized) {
                        errors.codePackage= `Package size exceeds ${formatSize(pkgSizeLimit)}. Please use AWS API to complete the upload`;

                    } else if (codePackage.files.length === 0) {
                        errors.codePackage = 'Package does not contain execution files';

                    } else if (!handlerFile) {
                        errors.handlerFile = 'Please choose an execution file name';
                    }
                }

                if (codeFormat === 'TEXT' || !errors.codePackage) {
                    if (!handlerFunc) {
                        errors.handlerFunc = 'Please enter the name of the requested execution function';

                    } else if (!handlerFuncNameRegExp.test(handlerFunc)) {
                        errors.handlerFunc = 'Please enter a valid javascript function name';
                    }
                }

                break;
            }

            case 2: {
                const { timeoutSeconds, timeoutMinutes } = values;

                if (!Number.isInteger(timeoutMinutes)) {
                    errors.timeoutMinutes = 'Please enter a valid timeout';

                } else if (timeoutMinutes < 0) {
                    errors.timeoutMinutes = 'Please enter a timeout greater then 0';
                }

                if (!Number.isInteger(timeoutSeconds)) {
                    errors.timeoutSeconds = 'Please enter a valid timeout';

                } else if (timeoutSeconds < 0) {
                    errors.timeoutSeconds = 'Please enter a timeout greater then 0';
                }

                if (timeoutMinutes === 0 && timeoutSeconds === 0) {
                    errors.timeoutMinutes = 'Please enter a timeout greater then 0';
                }

                break;
            }
        }

        return errors;
    }

    onBeforeStep(step) {
        if (!this.form.isValid()) {
            this.form.touch(step);
            return false;
        }

        return true;
    }

    onDropPackage(_, evt) {
        const [file] = evt.dataTransfer.files;
        this._onCodePackage(file);

    }

    onSelectPackage(_, evt) {
        const [file] = evt.target.files;
        this._onCodePackage(file);
    }

    async onSubmit(values) {
        const {
            funcName,
            funcDesc,
            handlerFile,
            handlerFunc,
            memorySize,
            timeoutMinutes,
            timeoutSeconds,
            codeFormat,
            inlineCode,
            codePackage
        } = values;

        const { bufferKey, size } = await _selectCode(codeFormat, inlineCode, codePackage);
        const selectedHandlerFile = codeFormat === 'TEXT' ?
            inlineCodeHandlerFile :
            handlerFile.slice(0, -handlerFileSuffix.length);

        action$.onNext(createLambdaFunc(
            funcName,
            '$LATEST',
            funcDesc,
            this.runtime,
            selectedHandlerFile,
            handlerFunc,
            memorySize,
            timeoutMinutes * 60 + timeoutSeconds,
            bufferKey,
            size
        ));
        action$.onNext(closeModal());
    }

    onCancel() {
        action$.onNext(closeModal());
    }

    async onShowFileContent() {
        const { bufferKey, filename } = this.selectedFileInfo;
        const buffer = bufferStore.get(bufferKey);
        if (buffer) {
            const zip = await JSZip.loadAsync(buffer);
            const file = await zip.file(filename).async('string');
            openInNewTab(toObjectUrl(file));
        }
    }

    async _onCodePackage(pkg) {
        const { name, size } = pkg;
        if (size > pkgSizeLimit) {
            const codePackage = { name, size, oversized: true };
            action$.onNext(updateForm(this.formName, { codePackage }));

        } else {
            const buffer = await readFileAsArrayBuffer(pkg);
            const bufferKey = bufferStore.store(buffer);

            const zip = await JSZip.loadAsync(buffer);
            const files = Object.values(zip.files)
                .filter(file => file.name.endsWith(handlerFileSuffix))
                .map(file => file.name);

            const codePackage = { name, size, files, bufferKey };
            action$.onNext(updateForm(this.formName, { codePackage, handlerFile: '', handlerFunc: '' }));
            action$.onNext(untouchForm(this.formName, ['handlerFile', 'handlerFunc']));
        }
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: CreateFuncModalViewModel,
    template: template
};
