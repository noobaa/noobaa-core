import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { formatSize } from 'utils'

export default class UploadRowViewModel extends Disposable {
    constructor(request) {
        super();

        this.fileName = ko.pureComputed(
            () => request() ? request().name : ''
        );

        this.bucketName = ko.pureComputed(
            () => request() ? request().targetBucket : ''
        );

        this.size = ko.pureComputed(
            () => request() ? formatSize(request().size) : ''
        );

        this.progress = ko.pureComputed(
            () => {
                if (!request()) {
                    return '';
                }

                let { state, progress, error } = request();
                let text = state === 'UPLOADING' ? numeral(progress).format('0%') : state;
                let tooltip = state === 'FAILED' ? error.message : '';

                let css = '';
                if (state === 'COMPLETED') {
                    css = 'success';
                } else if (state === 'FAILED') {
                    css = 'error';
                }

                return { text, css, tooltip };
            }
        );
    }
}
