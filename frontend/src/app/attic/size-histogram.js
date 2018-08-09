export const tests = (function(db) {
    var MB = Math.pow(1024, 2);
    var TB = Math.pow(1024, 4);

    var buckets = [
        'first.bucket'
    ];

    var templateData = Array.from({ length: 52 }, () => ({
        label: '',
        aggregated_sum: 0,
        count: 0
    }));

    function cloneData(label) {
        return templateData.map(rec => Object.assign({ }, rec, { label: label }));
    }

    function updateRecord(rec, count, sum) {
        rec.count = count;
        rec.aggregated_sum = sum;
        return rec;
    }

    function updateDb(data) {
        db.buckets.updateOne(
            { name: { $in: buckets } },
            { $set: { 'storage_stats.objects_hist': data } }
        );
    }

    function findSizeIndex(size) {
        return Math.floor(Math.log2(size));
    }

    function test1() {
        const size = 5 * MB;
        const index = findSizeIndex(size);
        const data = cloneData('test1').slice(0, index + 1);
        updateRecord(data[index], 5, 5 * size);
        updateDb(data);
    }

    // 5 files, no aggregation.
    function test2() {
        const data = cloneData('test2')
            .slice(0, 5)
            .map((rec, i) => updateRecord(rec, 1, Math.pow(2, i)));

        updateDb(data);
    }

    // 10 files, aggregation of 2 consecutive bins.
    function test3() {
        const data = cloneData('test3')
            .slice(0, 10)
            .map((rec, i) => updateRecord(rec, 1, Math.pow(2, i)));

        updateDb(data);
    }

    // 12 files, aggregation of 3 consecutive bins + projection into non existing bins.
    function test4() {
        const data = cloneData('test4')
            .slice(0, 13)
            .map((rec, i) => updateRecord(rec, 1, Math.pow(2, i)));

        updateDb(data);
    }

    // 1 file, creating a bin for 1TB (32GB - 16TB 16TB)
    function test5() {
        const index = findSizeIndex(TB);
        const data = cloneData('test1').slice(0, index + 1);
        updateRecord(data[index], 1, TB);
        updateDb(data);
    }


    return {
        test1,
        test2,
        test3,
        test4,
        test5
    };

})();
