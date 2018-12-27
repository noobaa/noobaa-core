/* Copyright (C) 2016 NooBaa */

import template from './file-uploads-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { formatSize } from 'utils/size-utils';
import numeral from 'numeral';
import { clearCompletedObjectUploads, closeModal } from 'action-creators';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';

const columns = deepFreeze([
    {
        name: 'fileName',
        type: 'fileName'
    },
    'bucketName',
    'size',
    'progress'
]);

const errorCodeToProgressText = deepFreeze({
    NoSuchUpload: 'ABORTED'
});

function _getUploadProgressSummary(stats) {
    const { uploading, batchSize, batchLoaded } = stats;
    if (uploading === 0) {
        return '';
    }

    return `Uploading ${
        formatSize(batchLoaded)
    } of ${
        formatSize(batchSize)
    } (${
        numeral(batchLoaded/batchSize).format('%')
    })`;
}

function _getUploadProgress(upload) {
    const { completed, error, size, loaded } = upload;

    if (completed) {
        if (error) {
            return {
                text: errorCodeToProgressText[error.code] || 'FAILED',
                tooltip: error.message,
                css: 'error'
            };
        } else {
            return {
                text: 'COMPLETED',
                css: 'success'
            };
        }
    } else {
        return {
            text: (size > 0 ? numeral(loaded/size).format('%') : 0)
        };
    }
}

function _mapUploadToRow(upload, system) {
    const { name, bucket, versionId, completed, error, size } = upload;
    const fileNameData = {
        text: name,
        tooltip: {
            text: name,
            breakWords: true
        }
    };

    if (completed && !error) {
        fileNameData.href = realizeUri(routes.object, {
            system,
            bucket,
            object: name,
            version: versionId
        });
    }

    return {
        fileName: fileNameData,
        bucketName: bucket,
        size: formatSize(size),
        progress: _getUploadProgress(upload)
    };
}

class UploadRowViewModel {
   fileName = ko.observable();
   bucketName = ko.observable();
   size = ko.observable();
   progress = ko.observable();
}


class FileUploadsModalViewModel extends ConnectableViewModel {
    columns = columns;
    countText = ko.observable();
    uploaded = ko.observable();
    failed = ko.observable();
    uploading = ko.observable();
    progress = ko.observable();
    progressText = ko.observable();
    rows = ko.observableArray()
        .ofType(UploadRowViewModel)

    selectState(state) {
        const { objectUploads, location } = state;
        return [
            objectUploads,
            location.params.system
        ];
    }

    mapStateToProps(objectUploads, system) {
        const { stats, objects } = objectUploads;

        ko.assignToProps(this, {
            countText: stringifyAmount('file', stats.count),
            uploading: stats.uploading,
            failed: stats.failed,
            uploaded: stats.uploaded,
            progress: stats.batchLoaded / stats.batchSize,
            progressText: _getUploadProgressSummary(stats),
            rows: Array.from(objects)
                .reverse()
                .map(upload => _mapUploadToRow(upload, system))
        });
    }

    onClearCompeleted() {
        this.dispatch(clearCompletedObjectUploads());
    }

    onClose() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: FileUploadsModalViewModel,
    template: template
};
