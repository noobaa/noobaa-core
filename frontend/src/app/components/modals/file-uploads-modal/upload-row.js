import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { formatSize } from 'utils/size-utils';

export default class UploadRowViewModel extends BaseViewModel {
    constructor(upload) {
        super();

        this.fileName = ko.pureComputed(
            () => upload() ? upload().name : ''
        );

        this.bucketName = ko.pureComputed(
            () => upload() ? upload().targetBucket : ''
        );

        this.size = ko.pureComputed(
            () => upload() ? formatSize(upload().size) : ''
        );

        this.progress = ko.pureComputed(
            () => {
                if (!upload()) {
                    return {};
                }

                let { completed, error, size, progress } = upload();
                let text = completed ?
                    (error ? 'FAILED' : 'UPLOADED') :
                    numeral(progress/size).format('0%');

                let tooltip = error || '';

                let css = '';
                if (error) {
                    css = 'error';
                } else if (completed) {
                    css = 'success';
                }

                return { text, css, tooltip };
            }
        );
    }
}
